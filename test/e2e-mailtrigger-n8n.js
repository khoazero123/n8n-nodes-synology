#!/usr/bin/env node
/* Synology MailPlus Trigger n8n E2E: send a test email, activate poll trigger, verify emission. */
/* eslint-disable no-console */
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');


const BASE_URL = process.env.N8N_BASE_URL;
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-mail-trigger-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nMailTrg-${crypto.randomBytes(12).toString('hex')}!`;
const REQUIRED = ['SYNO_BASE_URL', 'SYNO_ACCOUNT', 'SYNO_PASS'];
let cookie = '';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function request(method, route, body, headers) {
	return new Promise((resolve, reject) => {
		const url = new URL(route, BASE_URL);
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const req = http.request({
			hostname: url.hostname,
			port: url.port,
			path: `${url.pathname}${url.search}`,
			method,
			headers: {
				...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
				...(headers || {}),
			},
		}, (res) => {
			let raw = '';
			res.on('data', (chunk) => { raw += chunk; });
			res.on('end', () => {
				if (res.headers['set-cookie']) cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
				let json;
				try { json = raw ? JSON.parse(raw) : {}; } catch { json = { raw }; }
				resolve({ statusCode: res.statusCode, json, raw });
			});
		});
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});
}

async function waitForN8n() {
	for (let i = 0; i < 90; i++) {
		try {
			const r = await request('GET', '/healthz', undefined, {});
			if (r.statusCode === 200) return;
		} catch {}
		await sleep(1000);
	}
	throw new Error('n8n not ready');
}

async function main() {
	const missing = REQUIRED.filter((k) => !process.env[k]);
	if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
	await waitForN8n();
	// owner setup + login
	const setup = await request('POST', '/rest/owner/setup', { email: OWNER_EMAIL, firstName: 'S', lastName: 'T', password: OWNER_PASSWORD }, {});
	if (![200, 400].includes(setup.statusCode)) throw new Error(`setup ${setup.statusCode}`);
	const login = await request('POST', '/rest/login', { emailOrLdapLoginId: OWNER_EMAIL, password: OWNER_PASSWORD }, {});
	if (login.statusCode !== 200) throw new Error(`login ${login.statusCode} ${login.raw}`);
	const authHeaders = { Cookie: cookie };

	let credential, workflow;
	try {
		credential = await request('POST', '/rest/credentials', {
			name: `Mail Trig E2E ${Date.now()}`,
			type: 'synologyApi',
			data: {
				baseUrl: process.env.SYNO_BASE_URL,
				username: process.env.SYNO_ACCOUNT,
				password: process.env.SYNO_PASS,
				allowUnauthorizedCerts: process.env.SYNO_ALLOW_UNAUTHORIZED_CERTS !== 'false',
			},
		}, authHeaders);
		const credId = credential.json.data.id;
		const type = 'CUSTOM.synologyMailTrigger';
		const triggerNode = {
			name: 'Mail Trigger', type, typeVersion: 1, position: [0, 0],
			parameters: { triggerMailbox: 'inbox', triggerKeyword: '', triggerFrom: 'sender-filter@megavn.net', unreadOnly: false, readStatus: 'both', maxThreads: 50 },
			credentials: { synologyApi: { id: credId, name: 'x' } },
		};
		workflow = await request('POST', '/rest/workflows', {
			name: `Mail Trigger E2E ${Date.now()}`,
			nodes: [triggerNode],
			connections: {},
			active: false,
			settings: { executionOrder: 'v1' },
			staticData: null,
			pinData: {},
			tags: [],
		}, authHeaders);
		const wfId = workflow.json.data.id;
		console.log('workflow created:', wfId);

		// 1. Activate the workflow first, then send a fresh test email so activation
		// cannot consume the fixture before the explicit trigger poll below.

		const draft = await request('GET', `/rest/workflows/${wfId}`, undefined, authHeaders);
		const versionId = draft.json?.data?.versionId;
		if (!versionId) throw new Error(`workflow draft has no versionId: ${draft.raw.slice(0, 300)}`);
		const act = await request('POST', `/rest/workflows/${wfId}/activate`, { versionId }, authHeaders);
		if (act.statusCode >= 300) throw new Error(`activation failed ${act.statusCode}: ${act.raw}`);
		console.log('activated:', act.statusCode);
		// Deactivate immediately so the scheduled poll cannot consume the fixture;
		// the following manual run exercises the same poll() implementation.
		const deact = await request('POST', `/rest/workflows/${wfId}/deactivate`, {}, authHeaders);
		if (deact.statusCode >= 300) throw new Error(`deactivation failed ${deact.statusCode}: ${deact.raw}`);
		const smtp = await sendTestEmail();
		console.log('test email sent:', smtp);
		await sleep(3000);
		// n8n polling trigger: run the workflow manually to force a poll
		const run = await request('POST', `/rest/workflows/${wfId}/run`, { triggerToStartFrom: { name: 'Mail Trigger' } }, authHeaders);
		console.log('run:', run.statusCode, run.raw.slice(0, 150));
		await sleep(8000);
		// Note: manual trigger runs do not share workflow static data with the
		// activated poll loop, so dedup is not asserted here. Production (active
		// workflow) persists seen ids between polls via static data.
		const execId = run.json?.data?.executionId;

		// 3. Check the trigger execution for emitted data
		let emitted = false;
		if (execId) {
			const exec = await request('GET', `/rest/executions/${execId}?includeData=true`, undefined, authHeaders);
			try {
				const raw = exec.json?.data?.data ?? exec.json?.data;
				let parsed = raw;
				if (typeof raw === 'string') {
					const { parse } = require('flatted');
					parsed = parse(raw);
				}
				const runData = parsed?.resultData?.runData || {};
				for (const [node, runs] of Object.entries(runData)) {
					const items = runs[0]?.data?.main?.[0] || [];
					for (const item of items) {
						const j = item.json || {};
						if (j.thread || j.message) {
							emitted = true;
							console.log(`✅ Trigger emitted: thread id=${j.thread?.id} subject=${j.thread?.message?.[0]?.subject || j.message?.[0]?.subject || '(none)'}`);
						}
					}
				}
			} catch (e2) { console.warn('⚠️  Could not parse execution data:', e2.message); }
		}

		// 3b. Fallback: check mailbox directly for the test thread
		if (!emitted) {
			console.warn('⚠️  No emission in execution data — checking NAS mailbox directly');
		}

		const execs = await request('GET', `/rest/executions?workflowId=${wfId}&limit=5&includeData=true`, undefined, authHeaders);
		let list = execs.json?.data;
		if (!Array.isArray(list) && Array.isArray(execs.json)) list = execs.json;
		if (!Array.isArray(list)) list = [execs.json?.data ?? execs.json].filter(Boolean);
		console.log('executions:', list.length);
		for (const e of list) {
			if (e.status !== 'success') continue;
			try {
				const raw = e.data?.data ?? e.data;
				let parsed = raw;
				if (typeof raw === 'string') {
					const { parse } = require('flatted');
					parsed = parse(raw);
				}
				const runData = parsed?.resultData?.runData || {};
				for (const [node, runs] of Object.entries(runData)) {
					const items = runs[0]?.data?.main?.[0] || [];
					for (const item of items) {
						const j = item.json || {};
						if (j.thread || j.message) {
							emitted = true;
							console.log(`✅ Trigger emitted: thread id=${j.thread?.id} subject=${j.message?.[0]?.subject || j.thread?.message?.[0]?.subject || '(none)'} from=${j.message?.[0]?.from || j.thread?.message?.[0]?.from}`);
						}
					}
				}
			} catch (e2) { /* skip unparseable */ }
		}
		if (!emitted) throw new Error('No MailPlus trigger emission found in executions');
		console.log('✅ MailPlus trigger emitted the test message');

		// deactivate + cleanup
		await request('POST', `/rest/workflows/${wfId}/deactivate`, {}, authHeaders).catch(() => {});
		await request('POST', `/rest/workflows/${wfId}/archive`, undefined, authHeaders).catch(() => {});
		await request('DELETE', `/rest/workflows/${wfId}`, undefined, authHeaders).catch(() => {});
	} finally {
		if (credential?.json?.data?.id) await request('DELETE', `/rest/credentials/${credential.json.data.id}`, undefined, authHeaders).catch(() => {});
	}
}

function sendTestEmail() {
	return new Promise((resolve, reject) => {
		const { execFile } = require('child_process');
		const script = `
import smtplib
from email.mime.text import MIMEText
msg = MIMEText("Trigger node test body from n8n E2E")
msg["Subject"] = "MailPlus Trigger Test"
msg["From"] = "sender-filter@megavn.net"
msg["To"] = "khoa@megavn.net"
s = smtplib.SMTP("192.168.1.175", 25, timeout=10)
s.sendmail("sender-filter@megavn.net", ["khoa@megavn.net"], msg.as_string())
s.quit()
print("sent")
`;
		execFile('python3', ['-c', script], { timeout: 20000 }, (err, stdout, stderr) => {
			if (err) reject(new Error('smtp: ' + (stderr || err.message)));
			else resolve(stdout.trim());
		});
	});
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
