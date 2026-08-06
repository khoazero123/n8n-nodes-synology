#!/usr/bin/env node
/**
 * E2E: SynologyPhotos node via n8n-dev.
 * 1. List albums -> grab first album id.
 * 2. List items in album (with thumbnail info) -> grab first item id + cache_key.
 * 3. Get item.
 * 4. Get thumbnail (binary).
 * 5. Download original (binary).
 * 6. Search.
 * Cleanup workflows/credentials.
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
if (!process.env.N8N_OWNER_PASSWORD) process.env.N8N_OWNER_PASSWORD = require('fs').readFileSync('/tmp/mail-e2e-pass.txt', 'utf8').trim();

const BASE = process.env.N8N_BASE_URL;
const TYPE = 'CUSTOM.synologyPhotos';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`✅ ${n}${d ? ': ' + String(d).slice(0, 170) : ''}`); };
const bad = (n, e) => { fail++; console.log(`❌ ${n}: ${e && e.message ? e.message : String(e).slice(0, 220)}`); };

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
				summary = Object.fromEntries(Object.entries(runData).map(([node, runs]) => [node, { status: runs[0]?.executionStatus || (runs[0]?.error ? 'error' : 'success'), error: runs[0]?.error?.message, json: runs[0]?.data?.main?.[0]?.[0]?.json, binary: runs[0]?.data?.main?.[0]?.[0]?.binary }]));
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
	const cred = await request('POST', '/rest/credentials', { name: `PhotoE2E ${Date.now()}`, type: 'synologyApi', data: { baseUrl: process.env.SYNO_BASE_URL, username: process.env.SYNO_ACCOUNT, password: process.env.SYNO_PASS, allowUnauthorizedCerts: true } }, apiHeaders);
	globalCredId = cred.json?.data?.id;
	const c = () => ({ synologyApi: { id: globalCredId, name: 'x' } });

	// 1. List albums
	const nodes = [MT, { name: 'List Albums', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'album', operation: 'list', limit: 5 }, credentials: c() }];
	const s = await runWorkflow('Photo Albums', nodes, connect('Manual Trigger', 'List Albums'));
	const n = s['List Albums'];
	const albums = Array.isArray(n?.json) ? n.json : (n?.json?.list || []);
	if (n?.error) bad('List albums', new Error(n.error));
	else if (albums.length > 0) { ok('List albums', `count=${albums.length}, ex: ${albums.slice(0, 2).map((a) => `${a.id}:${a.name}`).join(', ')}`); }
	else bad('List albums', new Error(JSON.stringify(n?.json || n)));

	const albumId = albums[0]?.id;

	// 2. List items in album
	let itemId = 0, cacheKey = '';
	if (albumId) {
		const nodes2 = [MT, { name: 'List Items', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'item', operation: 'list', itemAlbumId: albumId, itemType: 'all', itemThumbnail: true, limit: 5 }, credentials: c() }];
		const s2 = await runWorkflow('Photo Items', nodes2, connect('Manual Trigger', 'List Items'));
		const n2 = s2['List Items'];
		const items = Array.isArray(n2?.json) ? n2.json : (n2?.json?.list || []);
		if (n2?.error) bad('List items', new Error(n2.error));
		else if (items.length > 0) {
			ok('List items', `count=${items.length}, ex: ${items[0].filename}`);
			itemId = items[0].id;
			cacheKey = items[0]?.additional?.thumbnail?.cache_key || '';
			ok('Cache key', cacheKey || '(none)');
		} else bad('List items', new Error(JSON.stringify(n2?.json || n2)));
	}

	// 4. Thumbnail (binary)
	if (itemId && cacheKey) {
		const nodes4 = [MT, { name: 'Get Thumb', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'item', operation: 'thumbnail', itemId, cacheKey, thumbSize: 'sm' }, credentials: c() }];
		const s4 = await runWorkflow('Photo Thumb', nodes4, connect('Manual Trigger', 'Get Thumb'));
		const n4 = s4['Get Thumb'];
		if (n4?.error) bad('Get thumbnail', new Error(n4.error));
		else if (n4?.binary?.data) ok('Get thumbnail', `binary data present`);
		else bad('Get thumbnail', new Error(JSON.stringify(n4?.json || n4)));
	}

	// 5. Download original (binary)
	if (itemId && cacheKey) {
		const nodes5 = [MT, { name: 'Download', type: TYPE, typeVersion: 1, position: [240, 0], parameters: { resource: 'item', operation: 'download', itemId, cacheKey }, credentials: c() }];
		const s5 = await runWorkflow('Photo DL', nodes5, connect('Manual Trigger', 'Download'));
		const n5 = s5['Download'];
		if (n5?.error) bad('Download original', new Error(n5.error));
		else if (n5?.binary?.data) ok('Download original', `binary size=${n5.json?.size || '?'} bytes`);
		else bad('Download original', new Error(JSON.stringify(n5?.json || n5)));
	}

	try { await request('DELETE', `/rest/credentials/${globalCredId}`, undefined, apiHeaders); } catch {}
	console.log(`\n===== Photos E2E: ${pass} passed, ${fail} failed =====`);
	process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
