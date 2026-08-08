#!/usr/bin/env node
/**
 * E2E test for the Synology Chat node (n8n REST API).
 *
 * Covers the current node surface:
 *  1. Incoming webhook create / get / delete
 *  2. Message → Send a Message to a channel (session / Post.create)
 *  3. Channel list + list posts
 *  4. Message → Send a Message as DM to a user
 *  5. Chatbot create / delete
 *
 * Env: SYNO_BASE_URL, SYNO_ACCOUNT, SYNO_PASS, N8N_BASE_URL,
 * N8N_OWNER_EMAIL, N8N_OWNER_PASSWORD. Optional: SYNO_CHAT_CHANNEL_ID
 * (default 2), SYNO_CHAT_DM_USER_ID (default 6).
 */
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { pass: e2ePass, fail: e2eFail } = require('./n8nE2eLog');

const BASE = process.env.N8N_BASE_URL || 'http://127.0.0.1:5680';
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-chat-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nChatE2e-${crypto.randomBytes(12).toString('hex')}!`;
const REQUIRED = ['SYNO_BASE_URL', 'SYNO_ACCOUNT', 'SYNO_PASS'];
const TYPE = 'CUSTOM.synologyChat';
const CHANNEL_ID = Number(process.env.SYNO_CHAT_CHANNEL_ID || 2);
const DM_USER_ID = Number(process.env.SYNO_CHAT_DM_USER_ID || 6);

let passCount = 0;
let failCount = 0;
let cookie = '';
let globalCredId = '';

function ok(name, detail) {
	passCount++;
	e2ePass(name, detail);
}
function fail(name, err) {
	failCount++;
	e2eFail(name, err);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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
			res.on('data', (chunk) => { raw += chunk; });
			res.on('end', () => {
				if (res.headers['set-cookie']?.length) {
					cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
				}
				let json;
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
		lastName: 'Chat E2E',
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
	if (!wfId) throw new Error(`workflow create failed: ${wf.raw.slice(0, 200)}`);

	const run = await request('POST', `/rest/workflows/${wfId}/run`, {
		triggerToStartFrom: { name: 'Manual Trigger' },
	});
	const execId = run.json?.data?.executionId;
	if (!execId) throw new Error(`workflow run failed: ${run.raw.slice(0, 200)}`);

	let summary = {};
	for (let t = 0; t < 40; t++) {
		const e = await request('GET', `/rest/executions/${execId}?includeData=true`);
		const st = e.json?.data?.status;
		if (st === 'success' || st === 'error' || st === 'crashed') {
			await sleep(500);
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
			} catch {
				/* retry until execution data is readable */
			}
		}
		await sleep(1000);
	}

	try {
		const archived = await request('POST', `/rest/workflows/${wfId}/archive`);
		if (archived.json?.data?.id) {
			await request('DELETE', `/rest/workflows/${wfId}`);
		}
	} catch {
		/* ignore cleanup errors */
	}

	return summary;
}

const MT = {
	name: 'Manual Trigger',
	type: 'n8n-nodes-base.manualTrigger',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
const connect = (from, to) => ({ [from]: { main: [[{ node: to, type: 'main', index: 0 }]] } });
const creds = () => ({ synologyApi: { id: globalCredId, name: 'x' } });

async function main() {
	const missing = REQUIRED.filter((name) => !process.env[name]);
	if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

	await setupOwnerAndLogin();

	const cred = await request('POST', '/rest/credentials', {
		name: `ChatE2E ${Date.now()}`,
		type: 'synologyApi',
		data: {
			baseUrl: process.env.SYNO_BASE_URL,
			username: process.env.SYNO_ACCOUNT,
			password: process.env.SYNO_PASS,
			allowUnauthorizedCerts: process.env.SYNO_ALLOW_UNAUTHORIZED_CERTS !== 'false',
		},
	});
	globalCredId = cred.json?.data?.id;
	if (!globalCredId) throw new Error(`credential create failed: ${cred.raw.slice(0, 200)}`);

	let whToken = '';
	let whUserId = 0;
	{
		const nodes = [MT, {
			name: 'Create WH',
			type: TYPE,
			typeVersion: 1,
			position: [240, 0],
			parameters: {
				resource: 'webhook',
				operation: 'create',
				whChannelId: CHANNEL_ID,
				whNickname: `E2E WH ${Date.now()}`,
			},
			credentials: creds(),
		}];
		const s = await runWorkflow('Chat Create WH', nodes, connect('Manual Trigger', 'Create WH'));
		const n = s['Create WH'];
		if (n?.error) fail('Webhook create', new Error(n.error));
		else if (n?.json?.token) {
			whToken = n.json.token;
			whUserId = n.json.user_id;
			ok('Webhook create', `token=${whToken.slice(0, 8)}... user_id=${whUserId}`);
		} else fail('Webhook create', new Error(JSON.stringify(n?.json || n)));
	}

	{
		const nodes = [MT, {
			name: 'Send Msg',
			type: TYPE,
			typeVersion: 1,
			position: [240, 0],
			parameters: {
				resource: 'message',
				operation: 'send',
				sendTo: 'channel',
				sendChannelId: CHANNEL_ID,
				text: `E2E chat channel ${Date.now()}`,
			},
			credentials: creds(),
		}];
		const s = await runWorkflow('Chat Send', nodes, connect('Manual Trigger', 'Send Msg'));
		const n = s['Send Msg'];
		if (n?.error) fail('Send message (channel)', new Error(n.error));
		else if (n?.json?.post_id) ok('Send message (channel)', `post_id=${n.json.post_id}`);
		else fail('Send message (channel)', new Error(JSON.stringify(n?.json || n)));
	}

	{
		const nodes = [MT, {
			name: 'List Ch',
			type: TYPE,
			typeVersion: 1,
			position: [240, 0],
			parameters: { resource: 'channel', operation: 'list' },
			credentials: creds(),
		}];
		const s = await runWorkflow('Chat List Channels', nodes, connect('Manual Trigger', 'List Ch'));
		const n = s['List Ch'];
		const chans = Array.isArray(n?.json) ? n.json : (n?.json?.channels || []);
		if (n?.error) fail('List channels', new Error(n.error));
		else if (Array.isArray(chans) && chans.length > 0) {
			ok('List channels', `count=${chans.length}, e.g. ${chans.slice(0, 3).map((x) => `${x.channel_id}:${x.name || '?'}`).join(', ')}`);
		} else fail('List channels', new Error(JSON.stringify(n?.json || n)));
	}

	{
		const nodes = [MT, {
			name: 'List Posts',
			type: TYPE,
			typeVersion: 1,
			position: [240, 0],
			parameters: {
				resource: 'channel',
				operation: 'listPosts',
				chChannelId: CHANNEL_ID,
				chPostLimit: 10,
			},
			credentials: creds(),
		}];
		const s = await runWorkflow('Chat List Posts', nodes, connect('Manual Trigger', 'List Posts'));
		const n = s['List Posts'];
		const posts = n?.json?.posts || [];
		if (n?.error) fail('List posts', new Error(n.error));
		else if (Array.isArray(posts)) {
			ok('List posts', `count=${posts.length}, latest: ${posts[0] ? String(posts[0].message).slice(0, 40) : 'none'}`);
		} else fail('List posts', new Error(JSON.stringify(n?.json || n)));
	}

	{
		const nodes = [MT, {
			name: 'Send DM',
			type: TYPE,
			typeVersion: 1,
			position: [240, 0],
			parameters: {
				resource: 'message',
				operation: 'send',
				sendTo: 'user',
				sendUserId: DM_USER_ID,
				text: `E2E as-user DM ${Date.now()}`,
			},
			credentials: creds(),
		}];
		const s = await runWorkflow('Chat Send As User DM', nodes, connect('Manual Trigger', 'Send DM'));
		const n = s['Send DM'];
		if (n?.error) fail('Send direct message', new Error(n.error));
		else if (n?.json?.post_id) ok('Send direct message', `post_id=${n.json.post_id} creator_id=${n.json.creator_id}`);
		else fail('Send direct message', new Error(JSON.stringify(n?.json || n)));
	}

	let cbUserId = 0;
	{
		const nodes = [MT, {
			name: 'Create CB',
			type: TYPE,
			typeVersion: 1,
			position: [240, 0],
			parameters: {
				resource: 'chatbot',
				operation: 'create',
				cbNickname: `E2E CB ${Date.now()}`,
			},
			credentials: creds(),
		}];
		const s = await runWorkflow('Chat Create Chatbot', nodes, connect('Manual Trigger', 'Create CB'));
		const n = s['Create CB'];
		if (n?.error) fail('Chatbot create', new Error(n.error));
		else if (n?.json?.token) {
			cbUserId = n.json.user_id;
			ok('Chatbot create', `token=${n.json.token.slice(0, 8)}... user_id=${cbUserId}`);
		} else fail('Chatbot create', new Error(JSON.stringify(n?.json || n)));
	}

	if (whUserId) {
		const nodes = [MT, {
			name: 'Get WH',
			type: TYPE,
			typeVersion: 1,
			position: [240, 0],
			parameters: { resource: 'webhook', operation: 'get', whUserId },
			credentials: creds(),
		}];
		const s = await runWorkflow('Chat Get WH', nodes, connect('Manual Trigger', 'Get WH'));
		const n = s['Get WH'];
		if (n?.error || !n?.json?.token) fail('Webhook get', new Error(n?.error || JSON.stringify(n?.json)));
		else ok('Webhook get', `token=${n.json.token.slice(0, 8)}...`);
	}

	if (whUserId) {
		const nodes = [MT, {
			name: 'Del WH',
			type: TYPE,
			typeVersion: 1,
			position: [240, 0],
			parameters: { resource: 'webhook', operation: 'delete', whUserId },
			credentials: creds(),
		}];
		const s = await runWorkflow('Chat Delete WH', nodes, connect('Manual Trigger', 'Del WH'));
		const n = s['Del WH'];
		n?.error ? fail('Webhook delete', new Error(n.error)) : ok('Webhook delete');
	}
	if (cbUserId) {
		const nodes = [MT, {
			name: 'Del CB',
			type: TYPE,
			typeVersion: 1,
			position: [240, 0],
			parameters: { resource: 'chatbot', operation: 'delete', cbUserId },
			credentials: creds(),
		}];
		const s = await runWorkflow('Chat Delete Chatbot', nodes, connect('Manual Trigger', 'Del CB'));
		const n = s['Del CB'];
		n?.error ? fail('Chatbot delete', new Error(n.error)) : ok('Chatbot delete');
	}

	try { await request('DELETE', `/rest/credentials/${globalCredId}`); } catch { /* ignore */ }

	console.log(`\n===== Chat E2E: ${passCount} passed, ${failCount} failed =====`);
	process.exit(failCount > 0 ? 1 : 0);
}

main().catch((error) => {
	console.error('FATAL:', error.message);
	process.exit(1);
});
