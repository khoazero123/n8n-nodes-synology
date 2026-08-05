#!/usr/bin/env node
/* Synology Download Station n8n workflow E2E smoke test. */
/* eslint-disable no-console */
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL;
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-ds-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nDsE2e-${crypto.randomBytes(12).toString('hex')}!`;
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
		lastName: 'DS E2E',
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

async function api(method, route, body, expected = [200]) {
	const response = await request(method, route, body);
	if (!expected.includes(response.statusCode)) throw new Error(`${method} ${route} -> ${response.statusCode}: ${response.raw}`);
	return response.json.data ?? response.json;
}

function parseExecutionData(execution) {
	let parse;
	try {
		({ parse } = require('flatted'));
	} catch {
		parse = JSON.parse;
	}
	return typeof execution.data === 'string' ? parse(execution.data) : execution.data;
}

async function getExecution(executionId) {
	for (let i = 0; i < 120; i++) {
		const execution = await api('GET', `/rest/executions/${executionId}?includeData=true`);
		if (execution.finished || ['success', 'error', 'crashed', 'canceled'].includes(execution.status)) return execution;
		await sleep(1000);
	}
	throw new Error(`Execution ${executionId} did not finish`);
}

async function main() {
	const missing = REQUIRED.filter((key) => !process.env[key]);
	if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

	await startN8n();
	await setupOwnerAndLogin();

	const unique = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
	let workflow;
	let credential;
	try {
		credential = await api('POST', '/rest/credentials', {
			name: `Synology DS E2E ${unique}`,
			type: 'synologyApi',
			data: {
				baseUrl: process.env.SYNO_BASE_URL,
				username: process.env.SYNO_ACCOUNT,
				password: process.env.SYNO_PASS,
				allowUnauthorizedCerts: process.env.SYNO_ALLOW_UNAUTHORIZED_CERTS !== 'false',
			},
		});
		const type = 'CUSTOM.synologyDownloadStation';
		const c = { synologyApi: { id: credential.id, name: credential.name } };
		const nodes = [
			{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ name: 'Get Info', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'info', operation: 'get' }, credentials: c },
			{ name: 'Get Config', type, typeVersion: 1, position: [480, 0], parameters: { resource: 'info', operation: 'getConfig' }, credentials: c },
			{ name: 'Get Statistics', type, typeVersion: 1, position: [720, 0], parameters: { resource: 'statistics', operation: 'get' }, credentials: c },
			{ name: 'Get Tasks', type, typeVersion: 1, position: [960, 0], parameters: { resource: 'task', operation: 'getMany', limit: 10 }, credentials: c },
			{ name: 'BT Search', type, typeVersion: 1, position: [1200, 0], parameters: { resource: 'btSearch', operation: 'search', keyword: 'ubuntu', limit: 5 }, credentials: c },
		];
		const connections = {};
		for (let i = 0; i < nodes.length - 1; i++) connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
		workflow = await api('POST', '/rest/workflows', {
			name: `Synology DS Node E2E ${unique}`,
			nodes,
			connections,
			active: false,
			settings: { executionOrder: 'v1' },
			staticData: null,
			pinData: { 'Manual Trigger': [{ json: {} }] },
			tags: [],
		});
		const run = await api('POST', `/rest/workflows/${workflow.id}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } });
		if (!run.executionId) throw new Error(`Manual run did not return executionId: ${JSON.stringify(run)}`);
		const execution = await getExecution(run.executionId);
		const data = parseExecutionData(execution);
		const summary = Object.fromEntries(Object.entries(data.resultData.runData).map(([node, runs]) => [node, runs.map((item) => ({ status: item.executionStatus || (item.error ? 'error' : 'success'), error: item.error?.message, json: item.data?.main?.[0]?.map((entry) => entry.json), }))]));
		console.log(JSON.stringify({ workflowId: workflow.id, executionId: run.executionId, status: execution.status, finished: execution.finished, lastNode: data.resultData.lastNodeExecuted, summary }, null, 2));

		// Verify info output
		const infoOutput = summary['Get Info']?.[0]?.json?.[0];
		if (!infoOutput || typeof infoOutput !== 'object') {
			console.warn('⚠️  Info output did not contain an object');
		} else {
			console.log('✅ Download Station info returned');
		}

		// Verify config output
		const configOutput = summary['Get Config']?.[0]?.json?.[0];
		if (!configOutput || typeof configOutput !== 'object') {
			throw new Error('Get Config output did not contain an object');
		}
		const configKeys = ['bt_max_download', 'bt_max_upload', 'default_destination', 'emule_enabled'];
		if (!configKeys.some((key) => Object.prototype.hasOwnProperty.call(configOutput, key))) {
			throw new Error(`Get Config output did not contain a documented config field: ${JSON.stringify(configOutput)}`);
		}
		console.log('✅ Download Station config returned');

		// Verify statistics output
		const statOutput = summary['Get Statistics']?.[0]?.json?.[0];
		if (!statOutput || statOutput.speed_download === undefined) {
			console.warn('⚠️  Statistics output did not contain speed_download field — may be expected if no active downloads');
		} else {
			console.log('✅ Statistics returned speed data');
		}

		// Verify task list output
		const taskOutput = summary['Get Tasks']?.[0]?.json?.[0];
		if (taskOutput && taskOutput.tasks) {
			console.log(`✅ Task list returned ${taskOutput.tasks.length} tasks`);
		} else if (taskOutput && taskOutput.total !== undefined) {
			console.log(`✅ Task list returned total=${taskOutput.total}`);
		} else {
			console.warn('⚠️  Task list did not return expected shape — may be empty which is OK');
		}

		// Verify BT search output
		const searchOutput = summary['BT Search']?.[0]?.json?.[0];
		if (searchOutput && typeof searchOutput === 'object' && Array.isArray(searchOutput.items) && typeof searchOutput.total === 'number') {
			console.log(`✅ BT search returned total=${searchOutput.total}`);
		} else if (searchOutput && typeof searchOutput === 'object') {
			console.warn(`⚠️  BT search output shape unexpected: ${JSON.stringify(searchOutput)}`);
		} else {
			throw new Error('BT Search output did not contain an object');
		}

		if (execution.status !== 'success') {
			console.error(`Execution status: ${execution.status}`);
			process.exitCode = 1;
		}
	} finally {
		if (workflow?.id) await request('DELETE', `/rest/workflows/${workflow.id}`);
		if (credential?.id) await request('DELETE', `/rest/credentials/${credential.id}`);
	}
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
