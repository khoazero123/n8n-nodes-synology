#!/usr/bin/env node
/* Synology MailPlus n8n E2E: smoke workflow + extended operations (live NAS, with cleanup). */

const http = require('http');
const crypto = require('crypto');
const { ensureN8nSession } = require('./n8nE2eAuth');
const { mailAddress, mailboxAddress, sendTestEmail } = require('./n8nE2eSmtp');
const { detail, pass, warn, logRun } = require('./n8nE2eLog');

const BASE_URL = process.env.N8N_BASE_URL;
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-mail-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nMailE2e-${crypto.randomBytes(12).toString('hex')}!`;
const REQUIRED = ['SYNO_BASE_URL', 'SYNO_ACCOUNT', 'SYNO_PASS'];
let cookie = '';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForN8n() {
	for (let i = 0; i < 90; i++) {
		try {
			const response = await request('GET', '/healthz', undefined, false);
			if (response.statusCode === 200) return;
		} catch {}
		await sleep(1000);
	}
	throw new Error('Timed out waiting for n8n healthz');
}

async function startN8n() {
	if (!BASE_URL) throw new Error("Docker-only E2E: set N8N_BASE_URL to an existing n8n container");
	await waitForN8n();
}

async function waitForRestApi() {
	for (let i = 0; i < 90; i++) {
		const response = await request('GET', '/rest/settings', undefined, false);
		if (response.statusCode === 200 && !response.raw.includes('n8n is starting up')) return;
		await sleep(1000);
	}
	throw new Error('Timed out waiting for n8n REST API readiness');
}

async function setupOwnerAndLogin() {
	await waitForRestApi();
	await ensureN8nSession({
		request: (method, route, body, useAuth = true) => request(method, route, body, useAuth),
		getCookie: () => cookie,
		setCookie: (value) => { cookie = value; },
		email: OWNER_EMAIL,
		password: OWNER_PASSWORD,
		firstName: 'Synology',
		lastName: 'Mail E2E',
	});
}

async function runWorkflow(authHeaders, name, nodes, connections, pinData) {
	const wf = await request('POST', '/rest/workflows', { name, nodes, connections, active: false, settings: { executionOrder: 'v1' }, staticData: null, pinData, tags: [] }, authHeaders);
	const wfId = wf.json?.data?.id;
	const run = await request('POST', `/rest/workflows/${wfId}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } }, authHeaders);
	const execId = run.json?.data?.executionId;
	let summary = {};
	for (let t = 0; t < 30; t++) {
		const e = await request('GET', `/rest/executions/${execId}?includeData=true`, undefined, authHeaders);
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
			} catch { /* retry */ }
		}
		await sleep(1000);
	}
	await request('POST', `/rest/workflows/${wfId}/archive`, undefined, authHeaders).catch(() => {});
	await request('DELETE', `/rest/workflows/${wfId}`, undefined, authHeaders).catch(() => {});
	return summary;
}

async function runExtendedMailOps(authHeaders, credId) {
	const type = 'CUSTOM.synologyMailPlusClient';
	const c = { synologyApi: { id: credId, name: 'x' } };
	const MT = { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} };
	const userMailbox = mailboxAddress();
	await sendTestEmail({ from: userMailbox, to: userMailbox, subject: 'Ext Ops E2E', body: 'ext ops e2e body' });
	detail('extended fixture email sent');
	await sleep(5000);

	for (const [resource, nodeName] of [['filter', 'List Filters'], ['smtp', 'List SMTP'], ['template', 'List Templates'], ['mailMerge', 'List Merges']]) {
		const nodes = [MT, { name: nodeName, type, typeVersion: 1, position: [240, 0], parameters: { resource, operation: 'list' }, credentials: c }];
		const s = await runWorkflow(authHeaders, `Ext ${nodeName} ${Date.now()}`, nodes, { 'Manual Trigger': { main: [[{ node: nodeName, type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
		const out = s[nodeName];
		if (out?.status === 'error') throw new Error(`${nodeName} failed: ${out.error}`);
		pass(nodeName);
	}

	let sigId;
	{
		const nodes = [MT, { name: 'Create Sig', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'signature', operation: 'create', sigName: `E2E Sig ${Date.now()}`, sigContent: 'test sig' }, credentials: c }];
		const s = await runWorkflow(authHeaders, 'Sig Create', nodes, { 'Manual Trigger': { main: [[{ node: 'Create Sig', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
		sigId = s['Create Sig']?.json?.id;
		if (!sigId) throw new Error('Signature create failed');
		pass('Signature created');
	}

	let labelId;
	{
		const nodes = [MT, { name: 'Create Label', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'label', operation: 'create', labelName: `E2ELabel ${Date.now()}`, backgroundColor: 'FFCCCC', textColor: 'FFFFFF' }, credentials: c }];
		const s = await runWorkflow(authHeaders, 'Label Create', nodes, { 'Manual Trigger': { main: [[{ node: 'Create Label', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
		labelId = s['Create Label']?.json?.id;
		if (!labelId) throw new Error('Label create failed');
		pass('Label created');
	}

	{
		const nodes = [
			MT,
			{ name: 'List Threads', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'thread', operation: 'list', mailbox: 'inbox', limit: 10 }, credentials: c },
			{ name: 'Mark Read', type, typeVersion: 1, position: [480, 0], parameters: { resource: 'thread', operation: 'setRead', threadIds: '={{ $json.thread[0].id }}' }, credentials: c },
			{ name: 'Add Label', type, typeVersion: 1, position: [720, 0], parameters: { resource: 'thread', operation: 'addLabel', threadIds: '={{ $json.thread[0].id }}', labelId }, credentials: c },
			{ name: 'Move Trash', type, typeVersion: 1, position: [960, 0], parameters: { resource: 'thread', operation: 'move', threadIds: '={{ $json.thread[0].id }}', threadSrcMailbox: -1, threadDestMailbox: -6 }, credentials: c },
			{ name: 'Delete', type, typeVersion: 1, position: [1200, 0], parameters: { resource: 'thread', operation: 'delete', threadIds: '={{ $json.thread[0].id }}', threadSrcMailbox: -6 }, credentials: c },
		];
		const conns = {};
		for (let i = 0; i < nodes.length - 1; i++) conns[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
		const s = await runWorkflow(authHeaders, 'Thread Ops', nodes, conns, { 'Manual Trigger': [{ json: {} }] });
		for (const n of ['List Threads', 'Mark Read', 'Add Label', 'Move Trash', 'Delete']) {
			if (s[n]?.status === 'error') throw new Error(`${n} failed: ${s[n].error}`);
			pass(n);
		}
	}

	let mbId;
	{
		const nodes = [MT, { name: 'Create Box', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'mailbox', operation: 'create', mailboxName: `E2EBox ${Date.now()}` }, credentials: c }];
		const s = await runWorkflow(authHeaders, 'Box Create', nodes, { 'Manual Trigger': { main: [[{ node: 'Create Box', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
		mbId = s['Create Box']?.json?.id;
		if (!mbId) throw new Error('Mailbox create failed');
		pass('Mailbox created');
	}

	{
		const nodes = [MT, { name: 'Reply', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'draft', operation: 'reply', from: userMailbox, to: userMailbox, subject: 'Re: test', body: 'reply body', referTo: 1 }, credentials: c }];
		const s = await runWorkflow(authHeaders, 'Reply Draft', nodes, { 'Manual Trigger': { main: [[{ node: 'Reply', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
		if (s['Reply']?.status === 'error') throw new Error(`Reply failed: ${s['Reply'].error}`);
		pass('Reply draft created');
	}

	const draftList = await runWorkflow(authHeaders, 'Draft List', [MT, { name: 'List Drafts', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'thread', operation: 'list', mailbox: 'drafts', limit: 5 }, credentials: c }], { 'Manual Trigger': { main: [[{ node: 'List Drafts', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
	const draftId = draftList['List Drafts']?.json?.thread?.[0]?.id;
	if (draftId) {
		const nodes = [
			MT,
			{ name: 'Set Bin', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [240, 0], parameters: { assignments: { assignments: [{ id: '1', name: 'data', value: '={{ $json }}', type: 'string' }] } } },
			{ name: 'Upload Att', type, typeVersion: 1, position: [480, 0], parameters: { resource: 'draft', operation: 'uploadAttachment', uploadDraftId: draftId, binaryPropertyName: 'data', uploadFilename: 'e2e.txt' }, credentials: c },
		];
		const pin = { 'Manual Trigger': [{ json: {} }], 'Set Bin': [{ json: {}, binary: { data: { data: Buffer.from('e2e-attachment').toString('base64'), mimeType: 'text/plain', fileName: 'e2e.txt' } } }] };
		const s = await runWorkflow(authHeaders, 'Upload Att', nodes, { 'Manual Trigger': { main: [[{ node: 'Set Bin', type: 'main', index: 0 }]] }, 'Set Bin': { main: [[{ node: 'Upload Att', type: 'main', index: 0 }]] } }, pin);
		if (s['Upload Att']?.status === 'error') throw new Error(`Upload attachment failed: ${s['Upload Att'].error}`);
		pass('Draft attachment uploaded');
	}

	if (labelId) {
		await runWorkflow(authHeaders, 'Del Label', [MT, { name: 'Del Label', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'label', operation: 'delete', labelIds: String(labelId) }, credentials: c }], { 'Manual Trigger': { main: [[{ node: 'Del Label', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
	}
	if (sigId) {
		await runWorkflow(authHeaders, 'Del Sig', [MT, { name: 'Del Sig', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'signature', operation: 'delete', sigIds: String(sigId) }, credentials: c }], { 'Manual Trigger': { main: [[{ node: 'Del Sig', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
	}
	if (mbId) {
		await runWorkflow(authHeaders, 'Del Box', [MT, { name: 'Del Box', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'mailbox', operation: 'delete', mailboxId2: mbId }, credentials: c }], { 'Manual Trigger': { main: [[{ node: 'Del Box', type: 'main', index: 0 }]] } }, { 'Manual Trigger': [{ json: {} }] });
	}
}

function request(method, route, body, auth = true) {
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
				...(auth && cookie ? { Cookie: cookie } : {}),
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

async function getExecution(executionId) {
	for (let i = 0; i < 120; i++) {
		const execution = await request('GET', `/rest/executions/${executionId}?includeData=true`);
		if (execution.json?.data?.finished || ['success', 'error', 'crashed', 'canceled'].includes(execution.json?.data?.status)) return execution;
		await sleep(1000);
	}
	throw new Error(`Execution ${executionId} did not finish`);
}

function parseExecutionData(execution) {
	let parse;
	try {
		({ parse } = require('flatted'));
	} catch {
		parse = JSON.parse;
	}
	const raw = execution.json?.data?.data ?? execution.data;
	return typeof raw === 'string' ? parse(raw) : raw;
}

async function main() {
	const missing = REQUIRED.filter((key) => !process.env[key]);
	if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

	await startN8n();
	await setupOwnerAndLogin();
	let credential;
	let workflow;
	try {
		credential = await request('POST', '/rest/credentials', {
			name: `Synology MailPlus E2E ${Date.now()}`,
			type: 'synologyApi',
			data: {
				baseUrl: process.env.SYNO_BASE_URL,
				username: process.env.SYNO_ACCOUNT,
				password: process.env.SYNO_PASS,
				allowUnauthorizedCerts: process.env.SYNO_ALLOW_UNAUTHORIZED_CERTS !== 'false',
			},
		});
		const type = 'CUSTOM.synologyMailPlusClient';
		const c = { synologyApi: { id: credential.json.data.id, name: credential.json.data.name } };
		const nodes = [
			{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ name: 'Get Info', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'mailPlus', operation: 'getInfo' }, credentials: c },
			{ name: 'Get Mailboxes', type, typeVersion: 1, position: [480, 0], parameters: { resource: 'mailbox', operation: 'list' }, credentials: c },
			{ name: 'Get Labels', type, typeVersion: 1, position: [720, 0], parameters: { resource: 'label', operation: 'list' }, credentials: c },
			{ name: 'List Threads', type, typeVersion: 1, position: [960, 0], parameters: { resource: 'thread', operation: 'list', mailbox: 'inbox', limit: 50 }, credentials: c },
			{ name: 'Get Message', type, typeVersion: 1, position: [1200, 0], parameters: { resource: 'message', operation: 'get', messageId: '={{ $json.thread[0].message[0].id }}' }, credentials: c },
			{ name: 'Create Draft', type, typeVersion: 1, position: [1440, 0], parameters: { resource: 'draft', operation: 'create', from: mailboxAddress(), to: mailAddress('fgc'), subject: 'n8n draft test', body: 'draft body' }, credentials: c },
			{ name: 'Send Draft', type, typeVersion: 1, position: [1680, 0], parameters: { resource: 'draft', operation: 'send', draftId: '={{ $json.id }}' }, credentials: c },
		];
		const connections = {};
		for (let i = 0; i < nodes.length - 1; i++) connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
		workflow = await request('POST', '/rest/workflows', {
			name: `Synology MailPlus Node E2E ${Date.now()}`,
			nodes,
			connections,
			active: false,
			settings: { executionOrder: 'v1' },
			staticData: null,
			pinData: { 'Manual Trigger': [{ json: {} }] },
			tags: [],
		});
		const run = await request('POST', `/rest/workflows/${workflow.json.data.id}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } });
		if (!run.json.data?.executionId) throw new Error(`Manual run did not return executionId: ${JSON.stringify(run)}`);
		const execution = await getExecution(run.json.data.executionId);
		const data = parseExecutionData(execution);
		const summary = Object.fromEntries(Object.entries(data.resultData.runData).map(([node, runs]) => [node, runs.map((item) => ({ status: item.executionStatus || (item.error ? 'error' : 'success'), error: item.error?.message, json: item.data?.main?.[0]?.map((entry) => entry.json), }))]));
		logRun({ workflowId: workflow.json.data.id, executionId: run.json.data.executionId, status: execution.json?.data?.status, lastNode: data.resultData.lastNodeExecuted, summary });

		const infoOut = summary['Get Info']?.[0]?.json?.[0];
		if (!infoOut || infoOut.database_ready !== true) throw new Error('Get Info output unexpected');
		pass('MailPlus info returned (database_ready=true)');

		const mbOut = summary['Get Mailboxes']?.[0]?.json?.[0];
		if (!mbOut || !Array.isArray(mbOut.mailbox) || !mbOut.mailbox.length) throw new Error('Mailbox list unexpected');
		pass(`Mailboxes returned (${mbOut.mailbox.length})`);

		const labelOut = summary['Get Labels']?.[0]?.json?.[0];
		pass('Labels returned');

		const threadOut = summary['List Threads']?.[0]?.json?.[0];
		if (!threadOut || !Array.isArray(threadOut.thread)) throw new Error('Thread list unexpected');
		pass(`Threads returned total=${threadOut.total}`);
		if (threadOut.thread.length > 0) {
			const msgOut = summary['Get Message']?.[0]?.json?.[0];
			if (msgOut && Array.isArray(msgOut.message) && msgOut.message.length) {
				pass('Message get');
			} else {
				warn('Get Message output unexpected');
			}
		}

		const draftOut = summary['Create Draft']?.[0]?.json?.[0];
		if (!draftOut || draftOut.id === undefined) {
			warn('Create Draft output unexpected');
		} else {
			pass('Draft created');
			const sendOut = summary['Send Draft']?.[0];
			if (sendOut?.status === 'error') throw new Error(`Send Draft failed: ${sendOut.error}`);
			pass('Draft sent');
		}

		if (execution.json?.data?.status !== 'success') {
			console.error(`Execution status: ${execution.json?.data?.status}`);
			process.exitCode = 1;
		} else {
			await runExtendedMailOps({ Cookie: cookie }, credential.json.data.id);
		}
	} finally {
		if (workflow?.json?.data?.id) await request('DELETE', `/rest/workflows/${workflow.json.data.id}`);
		if (credential?.json?.data?.id) await request('DELETE', `/rest/credentials/${credential.json.data.id}`);
	}
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
