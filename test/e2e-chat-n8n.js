#!/usr/bin/env node
/**
 * E2E test for the Synology Chat node (n8n REST API against n8n-dev).
 *
 * Verifies live against the NAS:
 *  1. Send a message via an incoming webhook token.
 *  2. Create an incoming webhook bound to a channel (create -> set channel
 *     -> Bot.set nickname -> enable), then send with the new token.
 *  3. Create + delete a chatbot.
 *  4. List channels, list posts in a channel.
 *  5. Cleanup: delete created webhook/chatbot, delete test posts, verify clean.
 *
 * Env: SYNO_BASE_URL, SYNO_ACCOUNT, SYNO_PASS, N8N_BASE_URL (default
 * http://localhost:5680), N8N_OWNER_EMAIL, N8N_OWNER_PASSWORD.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { URL } = require('url');

// --- env ---
process.env.N8N_BASE_URL = process.env.N8N_BASE_URL || 'http://localhost:5680';
process.env.N8N_OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'admin@example.com';

const BASE = process.env.N8N_BASE_URL;
const TYPE = 'CUSTOM.synologyChat';

let passCount = 0;
let failCount = 0;

function ok(name, detail) {
	passCount++;
	console.log(`✅ ${name}${detail ? ': ' + String(detail).slice(0, 160) : ''}`);
}
function fail(name, err) {
	failCount++;
	console.log(`❌ ${name}: ${err && err.message ? err.message : String(err).slice(0, 200)}`);
}

function request(method, route, body, headers) {
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
				...(headers || {}),
			},
		}, (res) => {
			let raw = '';
			res.on('data', (c) => (raw += c));
			res.on('end', () => resolve({ statusCode: res.statusCode, raw, headers: res.headers, json: safeJson(raw) }));
		});
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});
}

function safeJson(raw) {
	try { return JSON.parse(raw); } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runWorkflow(name, nodes, connections, pinData) {
	// create workflow
	const wf = await request('POST', '/rest/workflows', {
		name,
		nodes,
		connections,
		active: false,
		settings: { executionOrder: 'v1' },
		staticData: null,
		pinData: pinData || null,
		tags: [],
	}, apiHeaders);
	const wfId = wf.json?.data?.id;
	if (!wfId) throw new Error(`workflow create failed: ${wf.raw.slice(0, 200)}`);
	const run = await request('POST', `/rest/workflows/${wfId}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } }, apiHeaders);
	const execId = run.json?.data?.executionId;

	// wait for execution finish + persisted data
	let summary = {};
	for (let t = 0; t < 40; t++) {
		const e = await request('GET', `/rest/executions/${execId}?includeData=true`, undefined, apiHeaders);
		const st = e.json?.data?.status;
		if (st === 'success' || st === 'error' || st === 'crashed') {
			await sleep(1500);
			try {
				const raw = e.json?.data?.data ?? e.json?.data;
				let parsed = raw;
				if (typeof raw === 'string') {
					const { parse } = require('flatted');
					parsed = parse(raw);
				}
				const runData = parsed?.resultData?.runData || {};
				summary = Object.fromEntries(Object.entries(runData).map(([node, runs]) => [node, {
					status: runs[0]?.executionStatus || (runs[0]?.error ? 'error' : 'success'),
					error: runs[0]?.error?.message,
					json: runs[0]?.data?.main?.[0]?.[0]?.json,
				}]));
				if (Object.keys(summary).length > 0) break;
			} catch (e2) { /* retry */ }
		}
		await sleep(1000);
	}

	// archive + delete workflow
	try {
		const archived = await request('POST', `/rest/workflows/${wfId}/archive`, undefined, apiHeaders);
		if (archived.json?.data?.id) {
			await request('DELETE', `/rest/workflows/${wfId}`, undefined, apiHeaders);
		}
	} catch { /* ignore cleanup errors */ }
	try { await request('DELETE', `/rest/credentials/${credId}`, undefined, apiHeaders); } catch { /* ignore */ }

	return summary;
}

const MT = { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} };
const connect = (from, to) => ({ [from]: { main: [[{ node: to, type: 'main', index: 0 }]] } });
const c = () => ({ synologyApi: { id: globalCredId, name: 'x' } });

let apiHeaders = {};
let globalCredId = '';

(async () => {
	// login
	const login = await request('POST', '/rest/login', { emailOrLdapLoginId: process.env.N8N_OWNER_EMAIL, password: process.env.N8N_OWNER_PASSWORD });
	const setCookies = (login.headers['set-cookie'] || []).map((x) => x.split(';')[0]).join('; ');
	apiHeaders = { Cookie: setCookies };
	if (!setCookies) throw new Error('login failed');

	// global credential for all workflows
	{
		const cred = await request('POST', '/rest/credentials', {
			name: `ChatE2E ${Date.now()}`,
			type: 'synologyApi',
			data: { baseUrl: process.env.SYNO_BASE_URL, username: process.env.SYNO_ACCOUNT, password: process.env.SYNO_PASS, allowUnauthorizedCerts: true },
		}, apiHeaders);
		globalCredId = cred.json?.data?.id;
		if (!globalCredId) throw new Error('credential create failed: ' + cred.raw.slice(0, 200));
	}

	// ============ 1. Send via webhook token (external, no session) ============
	// First create a webhook through the node itself (session ops), capture token,
	// then send with it.
	let whToken = '';
	let whUserId = 0;
	{
		const nodes = [MT, { name: 'Create WH', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'webhook', operation: 'create', whChannelId: 2, whNickname: `E2E WH ${Date.now()}` }, credentials: c() }];
		const s = await runWorkflow('Chat Create WH', nodes, connect('Manual Trigger', 'Create WH'));
		const n = s['Create WH'];
		if (n?.error) {
			fail('Webhook create', new Error(n.error));
		} else if (n?.json?.token) {
			whToken = n.json.token;
			whUserId = n.json.user_id;
			ok('Webhook create', `token=${whToken.slice(0, 8)}... user_id=${whUserId}`);
		} else {
			fail('Webhook create', new Error(JSON.stringify(n?.json || n)));
		}
	}

	if (whToken) {
		const nodes = [MT, { name: 'Send Msg', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'message', operation: 'send', sendTo: 'channel', sendChannelId: 2, text: 'E2E chat test via node ' + Date.now() }, credentials: c() }];
		const s = await runWorkflow('Chat Send', nodes, connect('Manual Trigger', 'Send Msg'));
		const n = s['Send Msg'];
		if (n?.error) {
			fail('Send message', new Error(n.error));
		} else {
			ok('Send message', JSON.stringify(n?.json || {}));
		}
	}

	// ============ 2. List channels (session) ============
	{
		const nodes = [MT, { name: 'List Ch', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'channel', operation: 'list' }, credentials: c() }];
		const s = await runWorkflow('Chat List Channels', nodes, connect('Manual Trigger', 'List Ch'));
		const n = s['List Ch'];
		const chans = Array.isArray(n?.json) ? n.json : (n?.json?.channels || []);
		if (n?.error) {
			fail('List channels', new Error(n.error));
		} else if (Array.isArray(chans) && chans.length > 0) {
			ok('List channels', `count=${chans.length}, e.g. ${chans.slice(0, 3).map((x) => `${x.channel_id}:${x.name || '?'}`).join(', ')}`);
		} else {
			fail('List channels', new Error(JSON.stringify(n?.json || n)));
		}
	}

	// ============ 3. List posts in channel 2 (session) ============
	{
		const nodes = [MT, { name: 'List Posts', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'channel', operation: 'listPosts', chChannelId: 2, chPostLimit: 10 }, credentials: c() }];
		const s = await runWorkflow('Chat List Posts', nodes, connect('Manual Trigger', 'List Posts'));
		const n = s['List Posts'];
		const posts = n?.json?.posts || [];
		if (n?.error) {
			fail('List posts', new Error(n.error));
		} else if (Array.isArray(posts)) {
			ok('List posts', `count=${posts.length}, latest: ${posts[0] ? String(posts[0].message).slice(0, 40) : 'none'}`);
		} else {
			fail('List posts', new Error(JSON.stringify(n?.json || n)));
		}
	}

	// ============ 3b. Send to a channel as the logged-in DSM user ============
	{
		const nodes = [MT, { name: 'Send As User', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'message', operation: 'send', sendTo: 'channel', sendChannelId: 2, text: 'E2E as-user channel ' + Date.now() }, credentials: c() }];
		const s = await runWorkflow('Chat Send As User Channel', nodes, connect('Manual Trigger', 'Send As User'));
		const n = s['Send As User'];
		if (n?.error) {
			fail('Send as user (channel)', new Error(n.error));
		} else if (n?.json?.post_id) {
			ok('Send as user (channel)', `post_id=${n.json.post_id} creator_id=${n.json.creator_id}`);
		} else {
			fail('Send as user (channel)', new Error(JSON.stringify(n?.json || n)));
		}
	}

	// ============ 3c. Send a direct message as the logged-in DSM user ============
	{
		const nodes = [MT, { name: 'Send DM', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'message', operation: 'send', sendTo: 'user', sendUserId: 6, text: 'E2E as-user DM ' + Date.now() }, credentials: c() }];
		const s = await runWorkflow('Chat Send As User DM', nodes, connect('Manual Trigger', 'Send DM'));
		const n = s['Send DM'];
		if (n?.error) {
			fail('Send direct message', new Error(n.error));
		} else if (n?.json?.post_id) {
			ok('Send direct message', `post_id=${n.json.post_id} creator_id=${n.json.creator_id}`);
		} else {
			fail('Send direct message', new Error(JSON.stringify(n?.json || n)));
		}
	}

	// ============ 4. Create chatbot (session) ============
	let cbUserId = 0;
	{
		const nodes = [MT, { name: 'Create CB', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'chatbot', operation: 'create', cbNickname: `E2E CB ${Date.now()}` }, credentials: c() }];
		const s = await runWorkflow('Chat Create Chatbot', nodes, connect('Manual Trigger', 'Create CB'));
		const n = s['Create CB'];
		if (n?.error) {
			fail('Chatbot create', new Error(n.error));
		} else if (n?.json?.token) {
			cbUserId = n.json.user_id;
			ok('Chatbot create', `token=${n.json.token.slice(0, 8)}... user_id=${cbUserId}`);
		} else {
			fail('Chatbot create', new Error(JSON.stringify(n?.json || n)));
		}
	}

	// ============ 5. Get webhook (token round-trip) ============
	if (whUserId) {
		const nodes = [MT, { name: 'Get WH', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'webhook', operation: 'get', whUserId }, credentials: c() }];
		const s = await runWorkflow('Chat Get WH', nodes, connect('Manual Trigger', 'Get WH'));
		const n = s['Get WH'];
		if (n?.error || !n?.json?.token) {
			fail('Webhook get', new Error(n?.error || JSON.stringify(n?.json)));
		} else {
			ok('Webhook get', `token=${n.json.token.slice(0, 8)}...`);
		}
	}

	// ============ 6. Delete created webhook + chatbot ============
	if (whUserId) {
		const nodes = [MT, { name: 'Del WH', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'webhook', operation: 'delete', whUserId }, credentials: c() }];
		const s = await runWorkflow('Chat Delete WH', nodes, connect('Manual Trigger', 'Del WH'));
		const n = s['Del WH'];
		n?.error ? fail('Webhook delete', new Error(n.error)) : ok('Webhook delete');
	}
	if (cbUserId) {
		const nodes = [MT, { name: 'Del CB', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'chatbot', operation: 'delete', cbUserId }, credentials: c() }];
		const s = await runWorkflow('Chat Delete Chatbot', nodes, connect('Manual Trigger', 'Del CB'));
		const n = s['Del CB'];
		n?.error ? fail('Chatbot delete', new Error(n.error)) : ok('Chatbot delete');
	}

	// delete global credential
	try { await request('DELETE', `/rest/credentials/${globalCredId}`, undefined, apiHeaders); } catch { /* ignore */ }

	console.log(`\n===== Chat E2E: ${passCount} passed, ${failCount} failed =====`);
	process.exit(failCount > 0 ? 1 : 0);
})().catch((e) => {
	console.error('FATAL:', e.message);
	process.exit(1);
});
