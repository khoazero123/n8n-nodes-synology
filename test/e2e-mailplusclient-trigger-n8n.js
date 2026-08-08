#!/usr/bin/env node
/* Synology MailPlus Trigger n8n E2E: activation, poll emission, and filter matrix. */
 
const http = require('http');
const crypto = require('crypto');

const { ensureN8nSession, waitForExecution } = require('./n8nE2eAuth');
const { sendTestEmail, mailAddress, mailboxAddress } = require('./n8nE2eSmtp');
const { detail, pass, warn, logRun } = require('./n8nE2eLog');

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

async function testTriggerFilter(authHeaders, credId, extraParams, expectedSubject, label) {
	const type = 'CUSTOM.synologyMailPlusClientTrigger';
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
	const execId = run.json?.data?.executionId;
	detail(`[${label}] run:`, run.statusCode, execId);
	const getExecution = (id) => request('GET', `/rest/executions/${id}?includeData=true`, undefined, authHeaders);
	let emitted = [];
	if (execId) {
		const { runData } = await waitForExecution(getExecution, execId);
		for (const [, runs] of Object.entries(runData)) {
			for (const item of runs[0]?.data?.main?.[0] || []) {
				if (item.json?.thread) emitted.push(item.json.thread);
			}
		}
	}
	detail(`[${label}] emitted ${emitted.length}`);
	const hasExpected = emitted.some((t) => (t.message?.[0]?.subject || '') === expectedSubject);
	if (hasExpected) pass(`[${label}] filter emitted the expected email`);
	else warn(`[${label}] expected email not in emissions`);
	await request('POST', `/rest/workflows/${wfId}/archive`, undefined, authHeaders).catch(() => {});
	await request('DELETE', `/rest/workflows/${wfId}`, undefined, authHeaders).catch(() => {});
	return hasExpected;
}

async function main() {
	const missing = REQUIRED.filter((k) => !process.env[k]);
	if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
	await waitForN8n();
	await ensureN8nSession({
		request: (method, route, body, useAuth = true) => request(method, route, body, useAuth && cookie ? { Cookie: cookie } : {}),
		getCookie: () => cookie,
		setCookie: (value) => { cookie = value; },
		email: OWNER_EMAIL,
		password: OWNER_PASSWORD,
		firstName: 'S',
		lastName: 'T',
	});
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
		const type = 'CUSTOM.synologyMailPlusClientTrigger';
		const senderFilter = mailAddress('sender-filter');
		const triggerNode = {
			name: 'Mail Trigger', type, typeVersion: 1, position: [0, 0],
			parameters: { mailbox: 'inbox', keyword: '', from: senderFilter, unreadOnly: false, readStatus: 'both', maxThreads: 50 },
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
		detail('workflow created:', wfId);

		// 1. Activate the workflow first, then send a fresh test email so activation
		// cannot consume the fixture before the explicit trigger poll below.

		const draft = await request('GET', `/rest/workflows/${wfId}`, undefined, authHeaders);
		const versionId = draft.json?.data?.versionId;
		if (!versionId) throw new Error(`workflow draft has no versionId: ${draft.raw.slice(0, 300)}`);
		const act = await request('POST', `/rest/workflows/${wfId}/activate`, { versionId }, authHeaders);
		if (act.statusCode >= 300) throw new Error(`activation failed ${act.statusCode}: ${act.raw}`);
		detail('activated:', act.statusCode);
		// Deactivate immediately so the scheduled poll cannot consume the fixture;
		// the following manual run exercises the same poll() implementation.
		const deact = await request('POST', `/rest/workflows/${wfId}/deactivate`, {}, authHeaders);
		if (deact.statusCode >= 300) throw new Error(`deactivation failed ${deact.statusCode}: ${deact.raw}`);
		const smtp = await sendTestEmail({
			from: senderFilter,
			to: mailboxAddress(),
			subject: 'MailPlus Trigger Test',
			body: 'Trigger node test body from n8n E2E',
		});
		detail('test email sent');
		await sleep(5000);
		const run = await request('POST', `/rest/workflows/${wfId}/run`, { triggerToStartFrom: { name: 'Mail Trigger' } }, authHeaders);
		const execId = run.json?.data?.executionId;
		detail('run:', run.statusCode, execId);
		if (!execId) throw new Error('manual run returned no executionId');

		const getExecution = (id) => request('GET', `/rest/executions/${id}?includeData=true`, undefined, authHeaders);
		const { runData } = await waitForExecution(getExecution, execId);
		let emitted = false;
		for (const [node, runs] of Object.entries(runData)) {
			const items = runs[0]?.data?.main?.[0] || [];
			for (const item of items) {
				const j = item.json || {};
				if (j.thread || j.message) emitted = true;
			}
		}
		if (!emitted) throw new Error('No MailPlus trigger emission found in executions');
		pass('MailPlus trigger emitted the test message');

		// --- Filter matrix (same fixture mail, fresh workflows) ---
		const filterFrom = mailAddress(`flt-${Date.now()}`);
		const filterSubject = `Filter E2E ${Date.now()}`;
		await sendTestEmail({ from: filterFrom, to: mailboxAddress(), subject: filterSubject, body: 'filter e2e body' });
		detail('filter fixture sent');
		await sleep(8000);
		let filterFailures = 0;
		for (const [extraParams, label] of [
			[{ from: filterFrom }, 'from'],
			[{ unreadOnly: true }, 'unreadOnly'],
			[{ readStatus: 'unread' }, 'readStatus=unread'],
		]) {
			const ok = await testTriggerFilter(authHeaders, credId, extraParams, filterSubject, label);
			if (!ok) filterFailures++;
		}
		if (process.env.SYNO_MAIL_FILTER_FIXTURES === 'true') {
			for (const [extraParams, label, subject] of [
				[{ starredOnly: true }, 'starredOnly', 'Filter Starred'],
				[{ hasAttachmentOnly: true }, 'hasAttachmentOnly', 'Filter Attachment'],
				[{ label: '1' }, 'label=1', 'Filter Starred'],
			]) {
				const ok = await testTriggerFilter(authHeaders, credId, extraParams, subject, label);
				if (!ok) filterFailures++;
			}
		}
		if (filterFailures > 0) throw new Error(`${filterFailures} MailPlus filter assertion(s) failed`);

		// deactivate + cleanup
		await request('POST', `/rest/workflows/${wfId}/deactivate`, {}, authHeaders).catch(() => {});
		await request('POST', `/rest/workflows/${wfId}/archive`, undefined, authHeaders).catch(() => {});
		await request('DELETE', `/rest/workflows/${wfId}`, undefined, authHeaders).catch(() => {});
	} finally {
		if (credential?.json?.data?.id) await request('DELETE', `/rest/credentials/${credential.json.data.id}`, undefined, authHeaders).catch(() => {});
	}
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
