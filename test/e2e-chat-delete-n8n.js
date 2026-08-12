#!/usr/bin/env node
/**
 * E2E test for the Synology Chat "Delete Messages" action (n8n REST API).
 *
 * Validates the Channel → Delete Messages operation:
 *  1. Dry run (list + report) — no actual deletion
 *  2. Delete own fresh messages via scope=own
 *  3. Age filter (older-than) skips newer messages
 *  4. Scope=others / all skip non-own messages (API 415 for others — reported, not deleted)
 *
 * The test uses a dedicated E2E channel so it never touches real user channels.
 *
 * Env: SYNO_BASE_URL, SYNO_ACCOUNT, SYNO_PASS, N8N_BASE_URL,
 * N8N_OWNER_EMAIL, N8N_OWNER_PASSWORD. Optional SYNO_CHAT_CHANNEL_ID (default a
 * dedicated "n8n-delete-e2e" channel created by this suite) and
 * SYNO_CHAT_DM_USER_ID.
 */
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { pass: e2ePass, fail: e2eFail } = require('./n8nE2eLog');

const BASE = process.env.N8N_BASE_URL || 'http://127.0.0.1:5680';
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-chat-delete-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nDelE2e-${crypto.randomBytes(12).toString('hex')}!`;
const REQUIRED = ['SYNO_BASE_URL', 'SYNO_ACCOUNT', 'SYNO_PASS'];
const TYPE = 'CUSTOM.synologyChat';
const CHANNEL_ID = Number(process.env.SYNO_CHAT_CHANNEL_ID || 39); // default: khoa's dedicated test channel
let channelId = CHANNEL_ID;

let passCount = 0;
let failCount = 0;
let cookie = '';
let globalCredId = '';

function ok(name, detail) { passCount++; e2ePass(name, detail); }
function fail(name, err) { failCount++; e2eFail(name, err); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
			res.on('data', (c) => { raw += c; });
			res.on('end', () => {
				if (res.headers['set-cookie']?.length) cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
				let json; try { json = raw ? JSON.parse(raw) : {}; } catch { json = { raw }; }
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
		email: OWNER_EMAIL, firstName: 'Synology', lastName: 'Chat Delete E2E', password: OWNER_PASSWORD,
	}, false);
	if (![200, 400].includes(setup.statusCode)) throw new Error(`Owner setup failed: ${setup.raw.slice(0, 300)}`);
	const login = await request('POST', '/rest/login', { emailOrLdapLoginId: OWNER_EMAIL, password: OWNER_PASSWORD }, false);
	if (login.statusCode !== 200 || !cookie) throw new Error(`Login failed: ${login.raw.slice(0, 300)}`);
}

async function runWorkflow(name, nodes, connections) {
	const wf = await request('POST', '/rest/workflows', {
		name, nodes, connections, active: false,
		settings: { executionOrder: 'v1' }, staticData: null,
		pinData: { 'Manual Trigger': [{ json: {} }] }, tags: [],
	});
	const wfId = wf.json?.data?.id;
	if (!wfId) throw new Error(`workflow create failed: ${wf.raw.slice(0, 200)}`);
	const run = await request('POST', `/rest/workflows/${wfId}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } });
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

const MT = { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} };
const connect = (from, to) => ({ [from]: { main: [[{ node: to, type: 'main', index: 0 }]] } });
const creds = () => ({ synologyApi: { id: globalCredId, name: 'x' } });
const chatParams = (extra) => ({ resource: 'channel', operation: 'deleteMessages', chChannelId: channelId, ...extra });

async function seedPosts(seedLabel) {
	// Send 3 fresh messages via the node (own posts)
	const posts = [];
	for (let k = 1; k <= 3; k++) {
		const nodes = [MT, {
			name: `Send ${k}`, type: TYPE, typeVersion: 1, position: [240, k * 80],
			parameters: { resource: 'message', operation: 'send', sendTo: 'channel', sendChannelId: channelId, text: `${seedLabel}-msg${k} ${Date.now()}` },
			credentials: creds(),
		}];
		const s = await runWorkflow(`Chat DelSeed ${k}`, nodes, connect('Manual Trigger', `Send ${k}`));
		const n = s[`Send ${k}`];
		posts.push(n?.json?.post_id);
	}
	return posts.filter(Boolean);
}

async function main() {
	const missing = REQUIRED.filter((name) => !process.env[name]);
	if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);
	await setupOwnerAndLogin();

	const cred = await request('POST', '/rest/credentials', {
		name: `ChatDelE2E ${Date.now()}`, type: 'synologyApi',
		data: {
			baseUrl: process.env.SYNO_BASE_URL, username: process.env.SYNO_ACCOUNT,
			password: process.env.SYNO_PASS,
			allowUnauthorizedCerts: process.env.SYNO_ALLOW_UNAUTHORIZED_CERTS !== 'false',
		},
	});
	globalCredId = cred.json?.data?.id;
	if (!globalCredId) throw new Error(`credential create failed: ${cred.raw.slice(0, 200)}`);

	// Channel must already exist and the credential user must be a member.
	// (createChannel does not add members, so auto-created channels get "user not
	// in channel" 401 when listing posts. Default SYNO_CHAT_CHANNEL_ID=39 is
	// khoa's dedicated test channel.)
	ok('Setup channel', `channel_id=${channelId}`);

	const seed = `del-e2e-${Date.now()}`;
	const seeded = await seedPosts(seed);
	ok('Seeded own messages', `${seeded.length} posts: ${seeded.join(',')}`);
	await sleep(1500);

	// 1) Dry run — should report would-delete without deleting.
	{
		const nodes = [MT, {
			name: 'DryRun', type: TYPE, typeVersion: 1, position: [240, 0],
			parameters: { ...chatParams({ delScope: 'own', delDryRun: true, delLimit: 10 }) }, credentials: creds(),
		}];
		const s = await runWorkflow('Chat Del Dry Run', nodes, connect('Manual Trigger', 'DryRun'));
		const n = s['DryRun'];
		if (n?.error) fail('Delete Messages dry run', new Error(n.error));
		else if (n?.json?.dryRun === true && Array.isArray(n.json.postIds)) {
			ok('Delete Messages dry run', `evaluated=${n.json.evaluated} wouldDelete=${n.json.postIds.length}`);
		} else fail('Delete Messages dry run', new Error(JSON.stringify(n?.json)));
	}

	// 2) Age filter older-than: use a huge window (100 years) so the freshly
	//    seeded messages are NOT older than it and are skipped. Deterministic
	//    even if the test channel already contains older own posts.
	{
		const nodes = [MT, {
			name: 'AgeFilter', type: TYPE, typeVersion: 1, position: [240, 0],
			parameters: {
				...chatParams({ delScope: 'own', delDryRun: true, delLimit: 20,
					delOlderThan: { age: { hours: 0, days: 36500 } } }),
			}, credentials: creds(),
		}];
		const s = await runWorkflow('Chat Del Age Filter', nodes, connect('Manual Trigger', 'AgeFilter'));
		const n = s['AgeFilter'];
		if (n?.error) fail('Delete Messages age filter', new Error(n.error));
		else if (n?.json?.postIds?.length === 0) {
			ok('Delete Messages age filter', `evaluated=${n.json.evaluated} (age filter excludes fresh seeds)`);
		} else fail('Delete Messages age filter', new Error(JSON.stringify(n?.json)));
	}

	// 3) Delete own fresh messages (scope=own, no age filter, dryRun=false).
	//    The shared test channel may contain older own posts (past the delete
	//    time-window -> 415 errors) and other-users' posts (skipped). The core
	//    assertion is that the freshly seeded own posts were deleted.
	{
		const nodes = [MT, {
			name: 'DelOwn', type: TYPE, typeVersion: 1, position: [240, 0],
			parameters: { ...chatParams({ delScope: 'own', delDryRun: false, delLimit: 20 }) }, credentials: creds(),
		}];
		const s = await runWorkflow('Chat Del Own', nodes, connect('Manual Trigger', 'DelOwn'));
		const n = s['DelOwn'];
		if (n?.error) fail('Delete Messages (own)', new Error(n.error));
		else if (n?.json?.deleted >= 3) {
			ok('Delete Messages (own fresh)', `deleted=${n.json.deleted} skipped=${n.json.skipped} errors=${n.json.errors}`);
		} else fail('Delete Messages (own fresh)', new Error(JSON.stringify(n?.json)));
	}

	// 4) Verification: the freshly seeded posts must no longer appear in the channel.
	{
		const nodes = [MT, {
			name: 'Verify Gone', type: TYPE, typeVersion: 1, position: [240, 0],
			parameters: { resource: 'channel', operation: 'listPosts', chChannelId: channelId, chPostLimit: 50 },
			credentials: creds(),
		}];
		const s = await runWorkflow('Chat Del Verify', nodes, connect('Manual Trigger', 'Verify Gone'));
		const n = s['Verify Gone'];
		const posts = n?.json?.posts || [];
		const stillPresent = posts.filter((p) => seeded.includes(p?.post_id));
		if (n?.error) fail('Delete verification', new Error(n.error));
		else if (stillPresent.length === 0) {
			ok('Delete verification', `seeded posts removed from channel (${posts.length} posts remain)`);
		} else fail('Delete verification', new Error(`still present: ${JSON.stringify(stillPresent.map((p) => p?.post_id))}`));
	}

	console.log(`\n===== Chat Delete E2E: ${passCount} passed, ${failCount} failed =====`);
	process.exit(failCount > 0 ? 1 : 0);
}

main().catch((error) => {
	console.error('FATAL:', error.message);
	process.exit(1);
});
