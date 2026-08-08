#!/usr/bin/env node
/* Synology MailPlus extended operations E2E (live NAS, with cleanup). */
 
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-mail-ext-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nMailExt-${crypto.randomBytes(12).toString('hex')}!`;
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

async function runWorkflow(api, type, c, name, nodes, connections, pinData) {
	const wf = await request('POST', '/rest/workflows', { name, nodes, connections, active: false, settings: { executionOrder: 'v1' }, staticData: null, pinData, tags: [] }, api);
	const wfId = wf.json?.data?.id;
	const run = await request('POST', `/rest/workflows/${wfId}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } }, api);
	const execId = run.json?.data?.executionId;
	// wait for execution to finish and data to be persisted
	let summary = {};
	for (let t = 0; t < 30; t++) {
		const e = await request('GET', `/rest/executions/${execId}?includeData=true`, undefined, api);
		const st = e.json?.data?.status;
		if (st === 'success' || st === 'error' || st === 'crashed') {
			await sleep(2000);
			try {
				const raw = e.json?.data?.data ?? e.json?.data;
				let parsed = raw;
				if (typeof raw === 'string') {
					const { parse } = require('flatted');
					parsed = parse(raw);
				}
				const runData = parsed?.resultData?.runData || {};
				summary = Object.fromEntries(Object.entries(runData).map(([node, runs]) => [node, { status: runs[0]?.executionStatus || (runs[0]?.error ? 'error' : 'success'), error: runs[0]?.error?.message, json: runs[0]?.data?.main?.[0]?.[0]?.json }]));
				if (Object.keys(summary).length > 0) break;
			} catch (e2) { /* retry */ }
		}
		await sleep(1000);
	}
	await request('POST', `/rest/workflows/${wfId}/archive`, undefined, api).catch(() => {});
	await request('DELETE', `/rest/workflows/${wfId}`, undefined, api).catch(() => {});
	return summary;
}

async function main() {
	const missing = REQUIRED.filter((k) => !process.env[k]);
	if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
	await waitForN8n();
	const setup = await request('POST', '/rest/owner/setup', { email: OWNER_EMAIL, firstName: 'S', lastName: 'X', password: OWNER_PASSWORD }, {});
	if (![200, 400].includes(setup.statusCode)) throw new Error(`setup ${setup.statusCode}`);
	const login = await request('POST', '/rest/login', { emailOrLdapLoginId: OWNER_EMAIL, password: OWNER_PASSWORD }, {});
	if (login.statusCode !== 200) throw new Error(`login ${login.statusCode}`);
	const authHeaders = { Cookie: cookie };

	// send a test email so there is a message/thread to act on
	const { sendTestEmail } = require('./n8nE2eSmtp');
	await sendTestEmail({
		from: 'user@example.com',
		to: 'user@example.com',
		subject: 'Ext Ops E2E',
		body: 'ext ops e2e body',
	});
	console.log('test email sent');
	await sleep(5000);

	let credential;
	try {
		credential = await request('POST', '/rest/credentials', {
			name: `Mail Ext E2E ${Date.now()}`,
			type: 'synologyApi',
			data: { baseUrl: process.env.SYNO_BASE_URL, username: process.env.SYNO_ACCOUNT, password: process.env.SYNO_PASS, allowUnauthorizedCerts: true },
		}, authHeaders);
		const credId = credential.json?.data?.id;
		const type = 'CUSTOM.synologyMailPlusClient';
		const c = { synologyApi: { id: credId, name: 'x' } };
		const MT = { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} };

		// 1. List filters / SMTP / templates / mail merges
		for (const [resource, nodeName] of [['filter', 'List Filters'], ['smtp', 'List SMTP'], ['template', 'List Templates'], ['mailMerge', 'List Merges']]) {
			const nodes = [MT, { name: nodeName, type, typeVersion: 1, position: [240, 0], parameters: { resource, operation: 'list' }, credentials: c }];
			const s = await runWorkflow(authHeaders, type, c, `Ext ${nodeName} ${Date.now()}`, nodes, { 'Manual Trigger': { main: [[{ node: nodeName, type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
			const out = s[nodeName];
			if (out?.status === 'error') throw new Error(`${nodeName} failed: ${out.error}`);
			console.log(`✅ ${nodeName}:`, JSON.stringify(out?.json).slice(0, 120));
		}

		// 2. Signature create + list + delete
		let sigId;
		{
			const createNodes = [MT, { name: 'Create Sig', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'signature', operation: 'create', sigName: `E2E Sig ${Date.now()}`, sigContent: 'test sig' }, credentials: c }];
			const s = await runWorkflow(authHeaders, type, c, 'Sig Create', createNodes, { 'Manual Trigger': { main: [[{ node: 'Create Sig', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
			const out = s['Create Sig'];
			if (out?.status === 'error') throw new Error(`Signature create failed: ${out.error}`);
			sigId = out?.json?.id;
			console.log(`✅ Signature created id=${sigId}`);
		}

		// 3. Label create
		let labelId;
		{
			const nodes = [MT, { name: 'Create Label', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'label', operation: 'create', labelName: `E2ELabel ${Date.now()}`, backgroundColor: 'FFCCCC', textColor: 'FFFFFF' }, credentials: c }];
			const s = await runWorkflow(authHeaders, type, c, 'Label Create', nodes, { 'Manual Trigger': { main: [[{ node: 'Create Label', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
			const out = s['Create Label'];
			if (out?.status === 'error') throw new Error(`Label create failed: ${out.error}`);
			labelId = out?.json?.id;
			console.log(`✅ Label created id=${labelId}`);
		}

		// 4. Thread actions: find thread 1 -> mark read -> add label -> move to trash -> delete
		{
			const nodes = [
				MT,
				{ name: 'List Threads', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'thread', operation: 'list', mailbox: 'inbox', limit: 10 }, credentials: c },
				{ name: 'Mark Read', type, typeVersion: 1, position: [480, 0], parameters: { resource: 'thread', operation: 'setRead', threadIds: '={{ $json.thread[0].id }}' }, credentials: c },
				{ name: 'Add Label', type, typeVersion: 1, position: [720, 0], parameters: { resource: 'thread', operation: 'addLabel', threadIds: '={{ $json.thread[0].id }}', labelId: labelId }, credentials: c },
				{ name: 'Move Trash', type, typeVersion: 1, position: [960, 0], parameters: { resource: 'thread', operation: 'move', threadIds: '={{ $json.thread[0].id }}', threadSrcMailbox: -1, threadDestMailbox: -6 }, credentials: c },
				{ name: 'Delete', type, typeVersion: 1, position: [1200, 0], parameters: { resource: 'thread', operation: 'delete', threadIds: '={{ $json.thread[0].id }}', threadSrcMailbox: -6 }, credentials: c },
			];
			const conns = {};
			for (let i = 0; i < nodes.length - 1; i++) conns[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
			const s = await runWorkflow(authHeaders, type, c, 'Thread Ops', nodes, conns, { 'Manual Trigger': [{ json: {} }] });
			for (const n of ['List Threads', 'Mark Read', 'Add Label', 'Move Trash', 'Delete']) {
				const out = s[n];
				if (out?.status === 'error') throw new Error(`${n} failed: ${out.error}`);
				console.log(`✅ ${n}:`, JSON.stringify(out?.json).slice(0, 100));
			}
		}

		// 5. Mailbox create + delete
		let mbId;
		{
			const createNodes = [MT, { name: 'Create Box', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'mailbox', operation: 'create', mailboxName: `E2EBox ${Date.now()}` }, credentials: c }];
			const s = await runWorkflow(authHeaders, type, c, 'Box Create', createNodes, { 'Manual Trigger': { main: [[{ node: 'Create Box', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
			const out = s['Create Box'];
			if (out?.status === 'error') throw new Error(`Mailbox create failed: ${out.error}`);
			mbId = out?.json?.id;
			console.log(`✅ Mailbox created id=${mbId}`);
		}

		// 6. Reply draft
		{
			const nodes = [MT, { name: 'Reply', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'draft', operation: 'reply', from: 'user@example.com', to: 'user@example.com', subject: 'Re: test', body: 'reply body', referTo: 1 }, credentials: c }];
			const s = await runWorkflow(authHeaders, type, c, 'Reply Draft', nodes, { 'Manual Trigger': { main: [[{ node: 'Reply', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
			const out = s['Reply'];
			if (out?.status === 'error') throw new Error(`Reply failed: ${out.error}`);
			console.log(`✅ Reply draft created id=${out?.json?.id}`);
		}

		// 7. Upload attachment to the reply draft
		{
			const draftId = (await (async () => {
				const nodes = [MT, { name: 'List Drafts', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'thread', operation: 'list', mailbox: 'drafts', limit: 5 }, credentials: c }];
				const s = await runWorkflow(authHeaders, type, c, 'Draft List', nodes, { 'Manual Trigger': { main: [[{ node: 'List Drafts', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
				return s['List Drafts']?.json?.thread?.[0]?.id;
			})());
			console.log('draft id for upload:', draftId);
			if (draftId) {
				const nodes = [
					MT,
					{ name: 'Set Bin', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [240, 0], parameters: { assignments: { assignments: [{ id: '1', name: 'data', value: '={{ $json }}', type: 'string' }] } } },
					{ name: 'Upload Att', type, typeVersion: 1, position: [480, 0], parameters: { resource: 'draft', operation: 'uploadAttachment', uploadDraftId: draftId, binaryPropertyName: 'data', uploadFilename: 'e2e.txt' }, credentials: c },
				];
				const pin = { 'Manual Trigger': [{ json: {} }], 'Set Bin': [{ json: {}, binary: { data: { data: Buffer.from('e2e-attachment').toString('base64'), mimeType: 'text/plain', fileName: 'e2e.txt' } } }] };
				const s = await runWorkflow(authHeaders, type, c, 'Upload Att', nodes, { 'Manual Trigger': { main: [[{ node: 'Set Bin', type: 'main', index: 0 }]] }, 'Set Bin': { main: [[{ node: 'Upload Att', type: 'main', index: 0 }]] } }, pin);
				const out = s['Upload Att'];
				if (out?.status === 'error') throw new Error(`Upload attachment failed: ${out.error}`);
				console.log(`✅ Attachment uploaded id=${out?.json?.id}`);
			}
		}

		// cleanup: delete label + signature + mailbox created
		if (labelId) {
			const nodes = [MT, { name: 'Del Label', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'label', operation: 'delete', labelIds: String(labelId) }, credentials: c }];
			await runWorkflow(authHeaders, type, c, 'Del Label', nodes, { 'Manual Trigger': { main: [[{ node: 'Del Label', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
			console.log('🧹 label deleted');
		}
		if (sigId) {
			const nodes = [MT, { name: 'Del Sig', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'signature', operation: 'delete', sigIds: String(sigId) }, credentials: c }];
			await runWorkflow(authHeaders, type, c, 'Del Sig', nodes, { 'Manual Trigger': { main: [[{ node: 'Del Sig', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
			console.log('🧹 signature deleted');
		}
		if (mbId) {
			const nodes = [MT, { name: 'Del Box', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'mailbox', operation: 'delete', mailboxId2: mbId }, credentials: c }];
			await runWorkflow(authHeaders, type, c, 'Del Box', nodes, { 'Manual Trigger': { main: [[{ node: 'Del Box', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
			console.log('🧹 mailbox deleted');
		}
	} finally {
		if (credential?.json?.data?.id) await request('DELETE', `/rest/credentials/${credential.json.data.id}`, undefined, authHeaders).catch(() => {});
	}
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
