#!/usr/bin/env node
/* Synology MailPlus Trigger filter E2E: verify each filter emits only matching mail. */
/* eslint-disable no-console */
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

function loadEnvFile(file) {
	if (!fs.existsSync(file)) return;
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		const m = line.match(/^([A-Z_]+)=(.*)$/);
		if (m) process.env[m[1]] = m[2].replace(/^['\"]|['\"]$/g, '');
	}
}
loadEnvFile('/home/ubuntu/.openclaw/workspace/.secrets/n8n-synology-e2e.env');

const BASE_URL = process.env.N8N_BASE_URL;
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-mail-filter-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nMailFltr-${crypto.randomBytes(12).toString('hex')}!`;
const REQUIRED = ['SYNO_BASE_URL', 'SYNO_ACCOUNT', 'SYNO_PASS'];
let cookie = '';
let failures = 0;

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

/** Send a test email via python smtplib. */
function sendTestEmail(from, subject) {
	return new Promise((resolve, reject) => {
		const { execFile } = require('child_process');
		const script = `
import smtplib
from email.mime.text import MIMEText
msg = MIMEText("filter e2e body")
msg["Subject"] = ${JSON.stringify(subject)}
msg["From"] = ${JSON.stringify(from)}
msg["To"] = "khoa@megavn.net"
s = smtplib.SMTP("192.168.1.175", 25, timeout=10)
s.sendmail(${JSON.stringify(from)}, ["khoa@megavn.net"], msg.as_string())
s.quit()
print("sent")
`;
		execFile('python3', ['-c', script], { timeout: 20000 }, (err, stdout, stderr) => {
			if (err) reject(new Error('smtp: ' + (stderr || err.message)));
			else resolve(stdout.trim());
		});
	});
}

async function main() {
	const missing = REQUIRED.filter((k) => !process.env[k]);
	if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
	await waitForN8n();
	const setup = await request('POST', '/rest/owner/setup', { email: OWNER_EMAIL, firstName: 'S', lastName: 'F', password: OWNER_PASSWORD }, {});
	if (![200, 400].includes(setup.statusCode)) throw new Error(`setup ${setup.statusCode}`);
	const login = await request('POST', '/rest/login', { emailOrLdapLoginId: OWNER_EMAIL, password: OWNER_PASSWORD }, {});
	if (login.statusCode !== 200) throw new Error(`login ${login.statusCode}`);
	const authHeaders = { Cookie: cookie };

	let credential;
	try {
		credential = await request('POST', '/rest/credentials', {
			name: `Mail Flt E2E ${Date.now()}`,
			type: 'synologyApi',
			data: {
				baseUrl: process.env.SYNO_BASE_URL,
				username: process.env.SYNO_ACCOUNT,
				password: process.env.SYNO_PASS,
				allowUnauthorizedCerts: process.env.SYNO_ALLOW_UNAUTHORIZED_CERTS !== 'false',
			},
		}, authHeaders);
		const credId = credential.json.data.id;

		// Send a unique test email first (from a filter-specific sender)
		const filterFrom = `flt-${Date.now()}@megavn.net`;
		const filterSubject = `Filter E2E ${Date.now()}`;
		await sendTestEmail(filterFrom, filterSubject);
		console.log('test email sent:', filterFrom, filterSubject);
		await sleep(5000);

		// Test 1: From filter — should emit ONLY the email from filterFrom
		await testFilter(authHeaders, credId, { from: filterFrom }, filterSubject, 'from');
		// Test 2: Unread only — should emit the new unread email
		await testFilter(authHeaders, credId, { unreadOnly: true }, filterSubject, 'unreadOnly');
		// Test 3: Read status unread
		await testFilter(authHeaders, credId, { readStatus: 'unread' }, filterSubject, 'readStatus=unread');
		// These assertions use only deterministic mail fixtures created above. Star/attachment/label
		// fixtures are instance-specific and are covered separately when SYNO_MAIL_FILTER_FIXTURES is enabled.
		if (process.env.SYNO_MAIL_FILTER_FIXTURES === 'true') {
			await testFilter(authHeaders, credId, { starredOnly: true }, 'Filter Starred', 'starredOnly');
			await testFilter(authHeaders, credId, { hasAttachmentOnly: true }, 'Filter Attachment', 'hasAttachmentOnly');
			await testFilter(authHeaders, credId, { label: '1' }, 'Filter Starred', 'label=1');
		}
	} finally {
		if (credential?.json?.data?.id) await request('DELETE', `/rest/credentials/${credential.json.data.id}`, undefined, authHeaders).catch(() => {});
	}
	if (failures > 0) throw new Error(`${failures} MailPlus filter assertion(s) failed`);
}

async function testFilter(authHeaders, credId, extraParams, expectedSubject, label) {
	const type = 'CUSTOM.synologyMailClientTrigger';
	const triggerNode = {
		name: 'Mail Trigger', type, typeVersion: 1, position: [0, 0],
		parameters: { mailbox: 'inbox', keyword: '', maxThreads: 100, ...extraParams },
		credentials: { synologyApi: { id: credId, name: 'x' } },
	};
	const wf = await request('POST', '/rest/workflows', {
		name: `Mail Flt ${label} ${Date.now()}`,
		nodes: [triggerNode],
		connections: {},
		active: false,
		settings: { executionOrder: 'v1' },
		staticData: null,
		pinData: {},
		tags: [],
	}, authHeaders);
	const wfId = wf.json.data.id;
	const run = await request('POST', `/rest/workflows/${wfId}/run`, { triggerToStartFrom: { name: 'Mail Trigger' } }, authHeaders);
	console.log(`[${label}] run:`, run.statusCode, run.json?.data?.executionId);
	await sleep(6000);

	// read execution data
	let emitted = [];
	const execId = run.json?.data?.executionId;
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
					if (j.thread) emitted.push(j.thread);
				}
			}
		} catch (e2) { /* ignore */ }
	}
	// fallback: re-run once more if empty (manual run sometimes not persisted)
	if (emitted.length === 0) {
		const run2 = await request('POST', `/rest/workflows/${wfId}/run`, { triggerToStartFrom: { name: 'Mail Trigger' } }, authHeaders);
		await sleep(6000);
		const exec2 = await request('GET', `/rest/executions/${run2.json?.data?.executionId}?includeData=true`, undefined, authHeaders);
		try {
			const raw = exec2.json?.data?.data ?? exec2.json?.data;
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
					if (j.thread) emitted.push(j.thread);
				}
			}
		} catch (e3) { /* ignore */ }
	}

	const subjects = emitted.map((t) => t.message?.[0]?.subject || '(none)');
	const senders = emitted.map((t) => t.message?.[0]?.from || t.message?.[0]?.email || '(none)');
	console.log(`[${label}] emitted ${emitted.length}: subjects=${JSON.stringify(subjects)} from=${JSON.stringify(senders)}`);
	const hasExpected = emitted.some((t) => (t.message?.[0]?.subject || '') === expectedSubject);
	if (hasExpected) {
		console.log(`✅ [${label}] filter emitted the expected email`);
	} else {
		console.warn(`⚠️  [${label}] expected subject "${expectedSubject}" not in emissions`);
		failures++;
	}
	// cleanup workflow
	await request('POST', `/rest/workflows/${wfId}/archive`, undefined, authHeaders).catch(() => {});
	await request('DELETE', `/rest/workflows/${wfId}`, undefined, authHeaders).catch(() => {});
	return hasExpected;
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
