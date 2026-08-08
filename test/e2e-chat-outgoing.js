#!/usr/bin/env node
/**
 * E2E: outgoing webhook CRUD via SynologyChat node.
 * Create -> List -> Get -> Set -> Delete, cleanup.
 */
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const BASE = process.env.N8N_BASE_URL || 'http://127.0.0.1:5680';
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-chat-ow-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nChatOw-${crypto.randomBytes(12).toString('hex')}!`;
const REQUIRED = ['SYNO_BASE_URL', 'SYNO_ACCOUNT', 'SYNO_PASS'];
const TYPE = 'CUSTOM.synologyChat';
const CHANNEL_ID = Number(process.env.SYNO_CHAT_CHANNEL_ID || 2);

let pass = 0;
let fail = 0;
let cookie = '';
let globalCredId = '';

const ok = (n, d) => { pass++; console.log(`✅ ${n}${d ? ': ' + String(d).slice(0, 150) : ''}`); };
const bad = (n, e) => { fail++; console.log(`❌ ${n}: ${e && e.message ? e.message : String(e).slice(0, 200)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, route, body, useAuth = true) {
	return new Promise((resolve, reject) => {
		const url = new URL(route, BASE);
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const req = http.request({
			hostname: url.hostname,
			port: url.port,
			path: url.pathname + url.search,
			method,
			headers: {
				...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
				...(useAuth && cookie ? { Cookie: cookie } : {}),
			},
		}, (res) => {
			let raw = '';
			res.on('data', (c) => (raw += c));
			res.on('end', () => {
				if (res.headers['set-cookie']?.length) {
					cookie = res.headers['set-cookie'].map((x) => x.split(';')[0]).join('; ');
				}
				let json = null;
				try { json = raw ? JSON.parse(raw) : {}; } catch { json = { raw }; }
				resolve({ statusCode: res.statusCode, raw, json, headers: res.headers });
			});
		});
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});
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
		lastName: 'Chat OW E2E',
		password: OWNER_PASSWORD,
	}, false);
	if (![200, 400].includes(setup.statusCode)) {
		throw new Error(`Owner setup failed: ${setup.statusCode} ${setup.raw.slice(0, 300)}`);
	}
	const login = await request('POST', '/rest/login', {
		emailOrLdapLoginId: OWNER_EMAIL,
		password: OWNER_PASSWORD,
	}, false);
	if (login.statusCode !== 200 || !cookie) {
		throw new Error(`Login failed: ${login.statusCode} ${login.raw.slice(0, 300)}`);
	}
}

const MT = { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} };
const connect = (from, to) => ({ [from]: { main: [[{ node: to, type: 'main', index: 0 }]] } });
const creds = () => ({ synologyApi: { id: globalCredId, name: 'x' } });

async function runWorkflow(name, nodes, connections) {
	const wf = await request('POST', '/rest/workflows', {
		name,
		nodes,
		connections,
		active: false,
		settings: { executionOrder: 'v1' },
		staticData: null,
		pinData: { 'Manual Trigger': [{ json: {} }] },
		tags: [],
	});
	const wfId = wf.json?.data?.id;
	if (!wfId) throw new Error('workflow create failed: ' + wf.raw.slice(0, 200));
	const run = await request('POST', `/rest/workflows/${wfId}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } });
	const execId = run.json?.data?.executionId;
	if (!execId) throw new Error('workflow run failed: ' + run.raw.slice(0, 200));
	let summary = {};
	for (let t = 0; t < 40; t++) {
		const e = await request('GET', `/rest/executions/${execId}?includeData=true`);
		const st = e.json?.data?.status;
		if (st === 'success' || st === 'error' || st === 'crashed') {
			await sleep(500);
			try {
				const raw = e.json?.data?.data ?? e.json?.data;
				let parsed = raw;
				if (typeof raw === 'string') { const { parse } = require('flatted'); parsed = parse(raw); }
				const runData = parsed?.resultData?.runData || {};
				summary = Object.fromEntries(Object.entries(runData).map(([node, runs]) => [node, {
					status: runs[0]?.executionStatus || (runs[0]?.error ? 'error' : 'success'),
					error: runs[0]?.error?.message,
					json: runs[0]?.data?.main?.[0]?.[0]?.json,
				}]));
				if (Object.keys(summary).length > 0) break;
			} catch { /* retry */ }
		}
		await sleep(1000);
	}
	try {
		const archived = await request('POST', `/rest/workflows/${wfId}/archive`);
		if (archived.json?.data?.id) await request('DELETE', `/rest/workflows/${wfId}`);
	} catch { /* ignore */ }
	return summary;
}

(async () => {
	const missing = REQUIRED.filter((name) => !process.env[name]);
	if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

	await setupOwnerAndLogin();
	const cred = await request('POST', '/rest/credentials', {
		name: `ChatOW ${Date.now()}`,
		type: 'synologyApi',
		data: {
			baseUrl: process.env.SYNO_BASE_URL,
			username: process.env.SYNO_ACCOUNT,
			password: process.env.SYNO_PASS,
			allowUnauthorizedCerts: process.env.SYNO_ALLOW_UNAUTHORIZED_CERTS !== 'false',
		},
	});
	globalCredId = cred.json?.data?.id;
	if (!globalCredId) throw new Error('credential create failed: ' + cred.raw.slice(0, 200));

	const nodes = [MT, {
		name: 'Create OW',
		type: TYPE,
		typeVersion: 1,
		position: [240, 0],
		parameters: {
			resource: 'outgoingWebhook',
			operation: 'create',
			owChannelId: CHANNEL_ID,
			owTriggerWord: 'ping',
			owUrl: 'http://127.0.0.1:5680/webhook/e2e-ow',
			owNickname: 'E2E OW Node',
		},
		credentials: creds(),
	}];
	const s = await runWorkflow('Chat OW Create', nodes, connect('Manual Trigger', 'Create OW'));
	const n = s['Create OW'];
	let owUserId = 0;
	if (n?.error) bad('OW create', new Error(n.error));
	else if (n?.json?.user_id) { owUserId = n.json.user_id; ok('OW create', `user_id=${owUserId} token=${String(n.json.token).slice(0, 8)}...`); }
	else bad('OW create', new Error(JSON.stringify(n?.json || n)));

	if (owUserId) {
		const nodes2 = [MT, { name: 'List OW', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'outgoingWebhook', operation: 'list' }, credentials: creds() }];
		const s2 = await runWorkflow('Chat OW List', nodes2, connect('Manual Trigger', 'List OW'));
		const n2 = s2['List OW'];
		const arr = Array.isArray(n2?.json) ? n2.json : (n2?.json?.webhook_outgoings || []);
		const found = (arr || []).find((x) => x.user_id === owUserId);
		if (found) ok('OW list', `found uid=${found.user_id} trigger=${found.trigger_word} channel=${found.channel_id}`);
		else bad('OW list', new Error(JSON.stringify(n2?.json || n2)).slice(0, 200));
	}

	if (owUserId) {
		const nodes3 = [MT, { name: 'Get OW', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'outgoingWebhook', operation: 'get', owUserId }, credentials: creds() }];
		const s3 = await runWorkflow('Chat OW Get', nodes3, connect('Manual Trigger', 'Get OW'));
		const n3 = s3['Get OW'];
		if (n3?.error || !n3?.json?.token) bad('OW get', new Error(n3?.error || JSON.stringify(n3?.json)));
		else ok('OW get', `token=${String(n3.json.token).slice(0, 8)}...`);
	}

	if (owUserId) {
		const nodes4 = [MT, {
			name: 'Set OW',
			type: TYPE,
			typeVersion: 1,
			position: [240, 0],
			parameters: {
				resource: 'outgoingWebhook',
				operation: 'set',
				owUserId,
				owSetChannelId: CHANNEL_ID,
				owSetTriggerWord: 'pong',
				owSetUrl: 'http://127.0.0.1:5680/webhook/e2e-ow2',
			},
			credentials: creds(),
		}];
		const s4 = await runWorkflow('Chat OW Set', nodes4, connect('Manual Trigger', 'Set OW'));
		const n4 = s4['Set OW'];
		if (n4?.error) bad('OW set', new Error(n4.error));
		else ok('OW set', JSON.stringify(n4?.json || {}));
	}

	if (owUserId) {
		const nodes5 = [MT, { name: 'Del OW', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'outgoingWebhook', operation: 'delete', owUserId }, credentials: creds() }];
		const s5 = await runWorkflow('Chat OW Delete', nodes5, connect('Manual Trigger', 'Del OW'));
		const n5 = s5['Del OW'];
		if (n5?.error) bad('OW delete', new Error(n5.error));
		else ok('OW delete');
	}

	try { await request('DELETE', `/rest/credentials/${globalCredId}`); } catch { /* ignore */ }
	console.log(`\n===== Chat Outgoing Webhook CRUD: ${pass} passed, ${fail} failed =====`);
	process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
	console.error('FATAL:', e.message);
	process.exit(1);
});
