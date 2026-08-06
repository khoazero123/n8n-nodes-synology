#!/usr/bin/env node
/**
 * E2E: outgoing webhook CRUD via SynologyChat node.
 * Create -> List -> Get -> Set -> Delete, cleanup.
 */
const fs = require('fs');
const http = require('http');
const { URL } = require('url');

function loadEnvFile(file) {
	if (!fs.existsSync(file)) return;
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		const m = line.match(/^([A-Z_]+)=(.*)$/);
		if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
	}
}
loadEnvFile('/home/ubuntu/.openclaw/workspace/.secrets/n8n-synology-e2e.env');
process.env.N8N_BASE_URL = process.env.N8N_BASE_URL || 'http://localhost:5680';
process.env.N8N_OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'admin@example.com';
if (!process.env.N8N_OWNER_PASSWORD) process.env.N8N_OWNER_PASSWORD = fs.readFileSync('/tmp/mail-e2e-pass.txt', 'utf8').trim();

const BASE = process.env.N8N_BASE_URL;
const TYPE = 'CUSTOM.synologyChat';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`✅ ${n}${d ? ': ' + String(d).slice(0, 150) : ''}`); };
const bad = (n, e) => { fail++; console.log(`❌ ${n}: ${e && e.message ? e.message : String(e).slice(0, 200)}`); };

function request(method, route, body, headers) {
	return new Promise((resolve, reject) => {
		const url = new URL(route, BASE);
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
			headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...(headers || {}) } },
			(res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch {} resolve({ statusCode: res.statusCode, raw, json, headers: res.headers }); }); });
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MT = { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} };
const connect = (from, to) => ({ [from]: { main: [[{ node: to, type: 'main', index: 0 }]] } });
let apiHeaders = {}, globalCredId = '';

async function runWorkflow(name, nodes, connections) {
	const wf = await request('POST', '/rest/workflows', { name, nodes, connections, active: false, settings: { executionOrder: 'v1' }, staticData: null, pinData: null, tags: [] }, apiHeaders);
	const wfId = wf.json?.data?.id;
	if (!wfId) throw new Error('workflow create failed: ' + wf.raw.slice(0, 200));
	const run = await request('POST', `/rest/workflows/${wfId}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } }, apiHeaders);
	const execId = run.json?.data?.executionId;
	let summary = {};
	for (let t = 0; t < 40; t++) {
		const e = await request('GET', `/rest/executions/${execId}?includeData=true`, undefined, apiHeaders);
		const st = e.json?.data?.status;
		if (st === 'success' || st === 'error' || st === 'crashed') {
			await sleep(1500);
			try {
				const raw = e.json?.data?.data ?? e.json?.data;
				let parsed = raw;
				if (typeof raw === 'string') { const { parse } = require('flatted'); parsed = parse(raw); }
				const runData = parsed?.resultData?.runData || {};
				summary = Object.fromEntries(Object.entries(runData).map(([node, runs]) => [node, { status: runs[0]?.executionStatus || (runs[0]?.error ? 'error' : 'success'), error: runs[0]?.error?.message, json: runs[0]?.data?.main?.[0]?.[0]?.json }]));
				if (Object.keys(summary).length > 0) break;
			} catch { /* retry */ }
		}
		await sleep(1000);
	}
	try {
		const archived = await request('POST', `/rest/workflows/${wfId}/archive`, undefined, apiHeaders);
		if (archived.json?.data?.id) await request('DELETE', `/rest/workflows/${wfId}`, undefined, apiHeaders);
	} catch {}
	return summary;
}

(async () => {
	const login = await request('POST', '/rest/login', { emailOrLdapLoginId: process.env.N8N_OWNER_EMAIL, password: process.env.N8N_OWNER_PASSWORD });
	apiHeaders = { Cookie: (login.headers['set-cookie'] || []).map((x) => x.split(';')[0]).join('; ') };
	if (!apiHeaders.Cookie) throw new Error('login failed');
	const cred = await request('POST', '/rest/credentials', { name: `ChatOW ${Date.now()}`, type: 'synologyApi', data: { baseUrl: process.env.SYNO_BASE_URL, username: process.env.SYNO_ACCOUNT, password: process.env.SYNO_PASS, allowUnauthorizedCerts: true } }, apiHeaders);
	globalCredId = cred.json?.data?.id;
	const c = () => ({ synologyApi: { id: globalCredId, name: 'x' } });

	// 1. Create outgoing webhook
	const nodes = [MT, { name: 'Create OW', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'outgoingWebhook', operation: 'create', owChannelId: 2, owTriggerWord: 'ping', owUrl: 'http://10.10.20.104:5680/webhook/e2e-ow', owNickname: 'E2E OW Node' }, credentials: c() }];
	const s = await runWorkflow('Chat OW Create', nodes, connect('Manual Trigger', 'Create OW'));
	const n = s['Create OW'];
	let owUserId = 0;
	if (n?.error) bad('OW create', new Error(n.error));
	else if (n?.json?.user_id) { owUserId = n.json.user_id; ok('OW create', `user_id=${owUserId} token=${String(n.json.token).slice(0, 8)}...`); }
	else bad('OW create', new Error(JSON.stringify(n?.json || n)));

	// 2. List
	if (owUserId) {
		const nodes2 = [MT, { name: 'List OW', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'outgoingWebhook', operation: 'list' }, credentials: c() }];
		const s2 = await runWorkflow('Chat OW List', nodes2, connect('Manual Trigger', 'List OW'));
		const n2 = s2['List OW'];
		const arr = Array.isArray(n2?.json) ? n2.json : (n2?.json?.webhook_outgoings || []);
		const found = (arr || []).find((x) => x.user_id === owUserId);
		if (found) ok('OW list', `found uid=${found.user_id} trigger=${found.trigger_word} channel=${found.channel_id}`);
		else bad('OW list', new Error(JSON.stringify(n2?.json || n2)).slice(0, 200));
	}

	// 3. Get
	if (owUserId) {
		const nodes3 = [MT, { name: 'Get OW', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'outgoingWebhook', operation: 'get', owUserId }, credentials: c() }];
		const s3 = await runWorkflow('Chat OW Get', nodes3, connect('Manual Trigger', 'Get OW'));
		const n3 = s3['Get OW'];
		if (n3?.error || !n3?.json?.token) bad('OW get', new Error(n3?.error || JSON.stringify(n3?.json)));
		else ok('OW get', `token=${String(n3.json.token).slice(0, 8)}...`);
	}

	// 4. Set
	if (owUserId) {
		const nodes4 = [MT, { name: 'Set OW', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'outgoingWebhook', operation: 'set', owUserId, owSetChannelId: 2, owSetTriggerWord: 'pong', owSetUrl: 'http://10.10.20.104:5680/webhook/e2e-ow2' }, credentials: c() }];
		const s4 = await runWorkflow('Chat OW Set', nodes4, connect('Manual Trigger', 'Set OW'));
		const n4 = s4['Set OW'];
		if (n4?.error) bad('OW set', new Error(n4.error));
		else ok('OW set', JSON.stringify(n4?.json || {}));
	}

	// 5. Delete
	if (owUserId) {
		const nodes5 = [MT, { name: 'Del OW', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'outgoingWebhook', operation: 'delete', owUserId }, credentials: c() }];
		const s5 = await runWorkflow('Chat OW Delete', nodes5, connect('Manual Trigger', 'Del OW'));
		const n5 = s5['Del OW'];
		if (n5?.error) bad('OW delete', new Error(n5.error));
		else ok('OW delete');
	}

	try { await request('DELETE', `/rest/credentials/${globalCredId}`, undefined, apiHeaders); } catch {}
	console.log(`\n===== Chat Outgoing Webhook CRUD: ${pass} passed, ${fail} failed =====`);
	process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
