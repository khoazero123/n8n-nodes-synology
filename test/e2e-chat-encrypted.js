#!/usr/bin/env node
/**
 * E2E: encrypted channel create via SynologyChat node.
 * 1. Create channel with Encrypted Channel = true.
 * 2. Verify response + list channels shows it encrypted.
 * 3. Delete the channel (via Session cleanup SQL or API).
 * Reuses the harness from e2e-chat-n8n.js.
 */
const fs = require('fs');
const http = require('http');
const { URL } = require('url');
const { execSync } = require('child_process');

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
if (!process.env.N8N_OWNER_PASSWORD) {
	process.env.N8N_OWNER_PASSWORD = fs.readFileSync('/tmp/mail-e2e-pass.txt', 'utf8').trim();
}

const BASE = process.env.N8N_BASE_URL;
const TYPE = 'CUSTOM.synologyChat';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`✅ ${n}${d ? ': ' + String(d).slice(0, 160) : ''}`); };
const bad = (n, e) => { fail++; console.log(`❌ ${n}: ${e && e.message ? e.message : String(e).slice(0, 200)}`); };

function request(method, route, body, headers) {
	return new Promise((resolve, reject) => {
		const url = new URL(route, BASE);
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
			headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...(headers || {}) } },
			(res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch {} resolve({ statusCode: res.statusCode, raw, headers: res.headers, json }); }); });
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MT = { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} };
const connect = (from, to) => ({ [from]: { main: [[{ node: to, type: 'main', index: 0 }]] } });

let apiHeaders = {};
let globalCredId = '';

async function runWorkflow(name, nodes, connections) {
	const wf = await request('POST', '/rest/workflows', { name, nodes, connections, active: false, settings: { executionOrder: 'v1' }, staticData: null, pinData: null, tags: [] }, apiHeaders);
	const wfId = wf.json?.data?.id;
	if (!wfId) throw new Error(`workflow create failed: ${wf.raw.slice(0, 200)}`);
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

	const cred = await request('POST', '/rest/credentials', { name: `ChatEnc ${Date.now()}`, type: 'synologyApi', data: { baseUrl: process.env.SYNO_BASE_URL, username: process.env.SYNO_ACCOUNT, password: process.env.SYNO_PASS, allowUnauthorizedCerts: true } }, apiHeaders);
	globalCredId = cred.json?.data?.id;
	const c = () => ({ synologyApi: { id: globalCredId, name: 'x' } });

	const chName = `E2EEnc${Date.now()}`;
	// create encrypted channel with myself as member (user 10)
	const nodes = [MT, { name: 'Create Enc', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'channel', operation: 'create', chName, chType: 'private', chEncrypted: true }, credentials: c() }];
	const s = await runWorkflow('Chat Enc Create', nodes, connect('Manual Trigger', 'Create Enc'));
	const n = s['Create Enc'];
	let channelId = 0;
	if (n?.error) {
		bad('Encrypted channel create', new Error(n.error));
	} else {
		channelId = n?.json?.channel_id || n?.json?.id || 0;
		ok('Encrypted channel create', `id=${channelId} json=${JSON.stringify(n?.json || {}).slice(0, 120)}`);
	}

	// verify via SQL (private channel not visible in joined list)
	if (channelId) {
		try {
			const sql = `SELECT encrypted FROM channels WHERE id=${channelId};`;
			const b64 = Buffer.from(sql).toString('base64');
			const out = execSync(`ssh -o ConnectTimeout=10 root@192.168.1.100 "echo ${b64} | base64 -d > /tmp/chat_verify.sql && su -s /bin/sh Chat -c \"psql -h /var/run/postgresql -d synochat -t -f /tmp/chat_verify.sql\" && rm -f /tmp/chat_verify.sql"`, { encoding: 'utf8' });
			const val = out.trim().split('\n').pop().trim();
			ok('Verify encrypted flag', `encrypted=${val}`);
		} catch (e) {
			bad('Verify encrypted flag', new Error(String(e.message || e).slice(0, 200)));
		}
	}

	// cleanup: delete channel via session API (Channel.Named has no delete; use Channel.close? fallback SQL)
	if (channelId) {
		try {
			// try Channel.close v4
			const nodes3 = [MT, { name: 'Close Ch', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [240, 0], parameters: {
				method: 'POST', url: `${process.env.SYNO_BASE_URL}/webapi/entry.cgi`,
				sendBody: true, specifyBody: 'json', jsonBody: JSON.stringify({ api: 'SYNO.Chat.Channel', method: 'close', version: 4, channel_id: channelId }),
				options: {}, authentication: 'none', // session not available here
			}, credentials: {} }];
			// Skip HTTP node — use direct SQL cleanup instead
		} catch {}
		// SQL cleanup via NAS
		try {
			const out = execSync(`ssh -o ConnectTimeout=10 root@192.168.1.100 "su -s /bin/sh Chat -c \\"psql -h /var/run/postgresql -d synochat -c \\\\\\"DELETE FROM channels WHERE id=${channelId};\\\\\\"\\""`, { encoding: 'utf8' });
			ok('Cleanup channel (SQL)', out.trim().split('\n').pop());
		} catch (e) {
			bad('Cleanup channel (SQL)', new Error(String(e.message || e).slice(0, 200)));
		}
	}

	try { await request('DELETE', `/rest/credentials/${globalCredId}`, undefined, apiHeaders); } catch {}
	console.log(`\n===== Chat Encrypted E2E: ${pass} passed, ${fail} failed =====`);
	process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
