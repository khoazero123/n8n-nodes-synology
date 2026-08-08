#!/usr/bin/env node
 

const crypto = require('crypto');
const http = require('http');
const { ensureN8nSession } = require('./n8nE2eAuth');
const { logRun } = require('./n8nE2eLog');
const PORT = Number(process.env.N8N_PORT || 5681);
const HOST = process.env.N8N_HOST || '127.0.0.1';
const BASE_URL = process.env.N8N_BASE_URL;
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nE2e-${crypto.randomBytes(12).toString('hex')}!`;
const SYNologyRequiredEnv = ['SYNO_BASE_URL', 'SYNO_ACCOUNT', 'SYNO_PASS'];
let authCookie = '';

function requireEnv() {
	const missing = SYNologyRequiredEnv.filter((name) => !process.env[name]);
	if (missing.length) {
		throw new Error(`Missing required env vars: ${missing.join(', ')}`);
	}
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForN8n() {
	for (let i = 0; i < 90; i++) {
		try {
			const response = await request('GET', '/healthz', undefined, false);
			if (response.statusCode === 200) return;
		} catch {}
		await wait(1000);
	}
	throw new Error('Timed out waiting for n8n healthz');
}

function request(method, route, body, useAuth = true) {
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
				...(useAuth && authCookie ? { Cookie: authCookie } : {}),
			},
		}, (res) => {
			let raw = '';
			res.on('data', (chunk) => { raw += chunk; });
			res.on('end', () => {
				const setCookie = res.headers['set-cookie'];
				if (setCookie?.length) {
					authCookie = setCookie.map((cookie) => cookie.split(';')[0]).join('; ');
				}
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

async function api(method, route, body, ok = [200]) {
	const response = await request(method, route, body);
	if (!ok.includes(response.statusCode)) {
		throw new Error(`${method} ${route} failed with ${response.statusCode}: ${response.raw}`);
	}
	return response.json.data ?? response.json;
}

async function startN8n() {
	if (!BASE_URL) {
		throw new Error('Docker-only E2E: set N8N_BASE_URL to an existing n8n container');
	}
	await waitForN8n();
}

async function waitForRestApi() {
	for (let i = 0; i < 90; i++) {
		const response = await request('GET', '/rest/settings', undefined, false);
		if (response.statusCode === 200 && !response.raw.includes('n8n is starting up')) return;
		await wait(1000);
	}
	throw new Error('Timed out waiting for n8n REST API readiness');
}

async function setupOwnerAndLogin() {
	await waitForRestApi();
	await ensureN8nSession({
		request,
		getCookie: () => authCookie,
		setCookie: (value) => { authCookie = value; },
		email: OWNER_EMAIL,
		password: OWNER_PASSWORD,
	});
}

async function createSynologyCredential() {
	return await api('POST', '/rest/credentials', {
		name: `Synology E2E ${Date.now()}`,
		type: 'synologyApi',
		data: {
			baseUrl: process.env.SYNO_BASE_URL,
			username: process.env.SYNO_ACCOUNT,
			password: process.env.SYNO_PASS,
			allowUnauthorizedCerts: process.env.SYNO_ALLOW_UNAUTHORIZED_CERTS !== 'false',
		},
	});
}

async function createWorkflow(credential) {
	const unique = Date.now();
	const nodes = [
		{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
		{ name: 'Create Notebook', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [240, 0], parameters: { resource: 'notebook', operation: 'create', title: `n8n workflow E2E ${unique}` }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Update Notebook', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [480, 0], parameters: { resource: 'notebook', operation: 'update', objectId: "={{ $('Create Notebook').item.json.object_id }}", title: `n8n updated notebook E2E ${unique}` }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Create Note Full', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [720, 0], parameters: { resource: 'note', operation: 'create', parentId: "={{ $('Create Notebook').item.json.object_id }}", title: `n8n note E2E ${unique}`, content: `<div>n8n full note E2E ${unique}</div>`, brief: `n8n full note E2E ${unique}`, returnFullNote: true }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Append Note', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [960, 0], parameters: { resource: 'note', operation: 'append', objectId: "={{ $('Create Note Full').item.json.object_id }}", content: '<div> appended</div>' }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Get Note', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [1080, 0], parameters: { resource: 'note', operation: 'get', objectId: "={{ $('Create Note Full').item.json.object_id }}" }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Update Note', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [1200, 0], parameters: { resource: 'note', operation: 'update', objectId: "={{ $('Create Note Full').item.json.object_id }}", title: `n8n note updated E2E ${unique}` }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'List Notes', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [1320, 0], parameters: { resource: 'note', operation: 'getMany', parentId: "={{ $('Create Notebook').item.json.object_id }}", limit: 20, offset: 0 }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Get Notebook', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [1440, 0], parameters: { resource: 'notebook', operation: 'get', objectId: "={{ $('Create Notebook').item.json.object_id }}" }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		// Version get/restore need a healthy Synology Drive backend (error 114
		// synodrive=0 when Drive is down). Keep list-only coverage in CI smoke.
		{ name: 'List Note Versions', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [1320, 0], parameters: { resource: 'version', operation: 'getMany', objectId: "={{ $('Create Note Full').item.json.object_id }}" }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Share User', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [1680, 0], parameters: { resource: 'share', operation: 'setUser', shareObjectId: "={{ $('Create Note Full').item.json.object_id }}", principalName: process.env.SYNO_SHARE_USER || 'nas', permission: 'ro' }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Remove User Share', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [1800, 0], parameters: { resource: 'share', operation: 'removeUser', shareObjectId: "={{ $('Create Note Full').item.json.object_id }}", principalName: process.env.SYNO_SHARE_USER || 'nas' }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Share Group', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [1920, 0], parameters: { resource: 'share', operation: 'setGroup', shareObjectId: "={{ $('Create Note Full').item.json.object_id }}", principalName: process.env.SYNO_SHARE_GROUP || 'users', permission: 'ro' }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Remove Group Share', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [2040, 0], parameters: { resource: 'share', operation: 'removeGroup', shareObjectId: "={{ $('Create Note Full').item.json.object_id }}", principalName: process.env.SYNO_SHARE_GROUP || 'users' }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'List Principals', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [1440, 0], parameters: { resource: 'share', operation: 'listPrincipals', principalType: 'user', limit: 20, offset: 0 }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'List Tags', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [2520, 0], parameters: { resource: 'tag', operation: 'getMany', limit: 20, offset: 0 }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Get Note Station Info', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [2760, 0], parameters: { resource: 'info', operation: 'get' }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Set Public Share', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [3000, 0], parameters: { resource: 'share', operation: 'setPublic', shareObjectId: "={{ $('Create Note Full').item.json.object_id }}", permission: 'ro' }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Get Public Link', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [3240, 0], parameters: { resource: 'share', operation: 'getPublicLink', shareObjectId: "={{ $('Create Note Full').item.json.object_id }}" }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Delete Public Share', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [3480, 0], parameters: { resource: 'share', operation: 'deletePublic', shareObjectId: "={{ $('Create Note Full').item.json.object_id }}" }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
		{ name: 'Delete Notebook', type: 'CUSTOM.synologyNoteStation', typeVersion: 1, position: [3720, 0], parameters: { resource: 'notebook', operation: 'delete', objectId: "={{ $('Create Notebook').item.json.object_id }}", recursive: true }, credentials: { synologyApi: { id: credential.id, name: credential.name } } },
	];
	const connections = {};
	for (let i = 0; i < nodes.length - 1; i++) {
		connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
	}
	return await api('POST', '/rest/workflows', {
		name: `Synology Note Station Automated E2E ${unique}`,
		nodes,
		connections,
		active: false,
		settings: { executionOrder: 'v1' },
		staticData: null,
		pinData: {
			'Manual Trigger': [{ json: {} }],
		},
		tags: [],
	});
}

async function runWorkflow(workflowId) {
	const result = await api('POST', `/rest/workflows/${workflowId}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } });
	if (!result.executionId) {
		throw new Error(`Manual run did not return an executionId: ${JSON.stringify(result)}`);
	}
	return result.executionId;
}

function parseExecutionData(execution) {
	const { parse } = require('flatted');
	return typeof execution.data === 'string' ? parse(execution.data) : execution.data;
}

async function getExecution(executionId) {
	for (let i = 0; i < 60; i++) {
		const execution = await api('GET', `/rest/executions/${executionId}?includeData=true`);
		if (execution.finished || ['success', 'error', 'crashed', 'canceled'].includes(execution.status)) return execution;
		await wait(1000);
	}
	throw new Error(`Execution ${executionId} did not finish`);
}

async function main() {
	requireEnv();
	await startN8n();
	await setupOwnerAndLogin();
	const credential = await createSynologyCredential();
	const workflow = await createWorkflow(credential);
	const executionId = await runWorkflow(workflow.id);
	const execution = await getExecution(executionId);
	const data = parseExecutionData(execution);
	const summary = Object.fromEntries(Object.entries(data.resultData.runData).map(([node, runs]) => [node, runs.map((run) => ({
		status: run.executionStatus || (run.error ? 'error' : 'success'),
		error: run.error?.message,
		json: run.data?.main?.[0]?.map((item) => item.json),
	}))]));
	logRun({ workflowId: workflow.id, executionId, status: execution.status, finished: execution.finished, lastNode: data.resultData.lastNodeExecuted, summary });
	if (execution.status !== 'success') {
		throw new Error(`Execution failed: ${data.resultData.error?.message || execution.status}`);
	}
}

main().catch((error) => {
	console.error(error.stack || error.message);
	process.exitCode = 1;
});
