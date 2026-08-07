#!/usr/bin/env node
/* Synology MailPlus n8n workflow E2E smoke test (live NAS, read-only + draft ops). */
/* eslint-disable no-console */
const http = require('http');
const crypto = require('crypto');

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
	const setup = await request('POST', '/rest/owner/setup', {
		email: OWNER_EMAIL,
		firstName: 'Synology',
		lastName: 'Mail E2E',
		password: OWNER_PASSWORD,
	}, false);
	if (![200, 400].includes(setup.statusCode)) throw new Error(`Owner setup failed: ${setup.statusCode} ${setup.raw}`);
	const login = await request('POST', '/rest/login', { emailOrLdapLoginId: OWNER_EMAIL, password: OWNER_PASSWORD }, false);
	if (login.statusCode !== 200) throw new Error(`Login failed: ${login.statusCode} ${login.raw}`);
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
			name: `Synology Mail E2E ${Date.now()}`,
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
			{ name: 'Get Info', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'mail', operation: 'getInfo' }, credentials: c },
			{ name: 'Get Mailboxes', type, typeVersion: 1, position: [480, 0], parameters: { resource: 'mailbox', operation: 'list' }, credentials: c },
			{ name: 'Get Labels', type, typeVersion: 1, position: [720, 0], parameters: { resource: 'label', operation: 'list' }, credentials: c },
			{ name: 'List Threads', type, typeVersion: 1, position: [960, 0], parameters: { resource: 'thread', operation: 'list', mailbox: 'inbox', limit: 50 }, credentials: c },
			{ name: 'Get Message', type, typeVersion: 1, position: [1200, 0], parameters: { resource: 'message', operation: 'get', messageId: '={{ $json.thread[0].message[0].id }}' }, credentials: c },
			{ name: 'Create Draft', type, typeVersion: 1, position: [1440, 0], parameters: { resource: 'draft', operation: 'create', from: 'khoa@megavn.net', to: 'test@megavn.net', subject: 'n8n draft test', body: 'draft body' }, credentials: c },
			{ name: 'Send Draft', type, typeVersion: 1, position: [1680, 0], parameters: { resource: 'draft', operation: 'send', draftId: '={{ $json.id }}' }, credentials: c },
		];
		const connections = {};
		for (let i = 0; i < nodes.length - 1; i++) connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
		workflow = await request('POST', '/rest/workflows', {
			name: `Synology Mail Node E2E ${Date.now()}`,
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
		console.log(JSON.stringify({ workflowId: workflow.json.data.id, executionId: run.json.data.executionId, status: execution.json?.data?.status, lastNode: data.resultData.lastNodeExecuted, summary }, null, 2));

		const infoOut = summary['Get Info']?.[0]?.json?.[0];
		if (!infoOut || infoOut.database_ready !== true) throw new Error(`Get Info output unexpected: ${JSON.stringify(infoOut)}`);
		console.log('✅ MailPlus info returned (database_ready=true)');

		const mbOut = summary['Get Mailboxes']?.[0]?.json?.[0];
		if (!mbOut || !Array.isArray(mbOut.mailbox) || !mbOut.mailbox.length) throw new Error(`Mailbox list unexpected: ${JSON.stringify(mbOut)}`);
		console.log(`✅ Mailboxes returned (${mbOut.mailbox.length})`);

		const labelOut = summary['Get Labels']?.[0]?.json?.[0];
		console.log('✅ Labels returned:', JSON.stringify(labelOut).slice(0, 120));

		const threadOut = summary['List Threads']?.[0]?.json?.[0];
		if (!threadOut || !Array.isArray(threadOut.thread)) throw new Error(`Thread list unexpected: ${JSON.stringify(threadOut)}`);
		console.log(`✅ Threads returned total=${threadOut.total}`);
		if (threadOut.thread.length > 0) {
			const msgOut = summary['Get Message']?.[0]?.json?.[0];
			if (msgOut && Array.isArray(msgOut.message) && msgOut.message.length) {
				const m = msgOut.message[0];
				console.log(`✅ Message content: from=${m.from} subject=${m.subject || '(none)'} body=${(m.body?.plain || '').slice(0, 50)}`);
			} else {
				console.warn('⚠️  Get Message output unexpected:', JSON.stringify(msgOut).slice(0, 200));
			}
		}

		const draftOut = summary['Create Draft']?.[0]?.json?.[0];
		if (!draftOut || draftOut.id === undefined) {
			console.warn('⚠️  Create Draft output unexpected:', JSON.stringify(draftOut).slice(0, 200));
		} else {
			console.log('✅ Draft created id=' + draftOut.id);
			const sendOut = summary['Send Draft']?.[0];
			if (sendOut?.status === 'error') throw new Error(`Send Draft failed: ${sendOut.error}`);
			console.log('✅ Draft sent:', JSON.stringify(sendOut?.json?.[0]).slice(0, 120));
		}

		if (execution.json?.data?.status !== 'success') {
			console.error(`Execution status: ${execution.json?.data?.status}`);
			process.exitCode = 1;
		}
	} finally {
		if (workflow?.json?.data?.id) await request('DELETE', `/rest/workflows/${workflow.json.data.id}`);
		if (credential?.json?.data?.id) await request('DELETE', `/rest/credentials/${credential.json.data.id}`);
	}
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
