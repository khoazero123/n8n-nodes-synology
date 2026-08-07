#!/usr/bin/env node
/* Synology Drive n8n workflow E2E smoke test. */
 
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const N8N_VERSION = process.env.N8N_VERSION || 'latest';
const PORT = Number(process.env.N8N_PORT || 5681);
const HOST = process.env.N8N_HOST || '127.0.0.1';
const BASE_URL = process.env.N8N_BASE_URL || `http://${HOST}:${PORT}`;
const USER_FOLDER = process.env.N8N_USER_FOLDER || path.join(os.tmpdir(), `n8n-synology-drive-e2e-${Date.now()}`);
const N8N_PROJECT = process.env.N8N_PROJECT || path.join(USER_FOLDER, 'project');
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-drive-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nDriveE2e-${crypto.randomBytes(12).toString('hex')}!`;
const REQUIRED = ['SYNO_BASE_URL', 'SYNO_ACCOUNT', 'SYNO_PASS'];
const startedByScript = !process.env.N8N_BASE_URL;
let cookie = '';
let n8nProcess;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: 'inherit', ...options });
	if (result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(' ')}`);
}

function portOpen() {
	return new Promise((resolve) => {
		const socket = net.connect(PORT, HOST);
		socket.once('connect', () => { socket.destroy(); resolve(true); });
		socket.once('error', () => resolve(false));
		socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
	});
}

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

function copyCustomNode() {
	const dest = path.join(USER_FOLDER, '.n8n', 'custom', 'n8n-nodes-synology');
	fs.rmSync(dest, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	run('npm', ['run', 'build'], { cwd: REPO_ROOT });
	run('cp', ['-a', REPO_ROOT, dest]);
	fs.rmSync(path.join(dest, 'node_modules'), { recursive: true, force: true });
	run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dest });
}

function ensureN8n() {
	fs.mkdirSync(N8N_PROJECT, { recursive: true });
	const pkg = path.join(N8N_PROJECT, 'package.json');
	if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, JSON.stringify({ private: true, dependencies: {} }, null, 2));
	const bin = path.join(N8N_PROJECT, 'node_modules', '.bin', 'n8n');
	if (!fs.existsSync(bin)) run('npm', ['install', `n8n@${N8N_VERSION}`], { cwd: N8N_PROJECT });
	return bin;
}

async function startN8n() {
	if (!startedByScript) {
		await waitForN8n();
		return;
	}
	if (await portOpen()) throw new Error(`Port ${PORT} is already in use. Set N8N_PORT or N8N_BASE_URL.`);
	copyCustomNode();
	const bin = ensureN8n();
	n8nProcess = spawn(bin, ['start'], {
		cwd: N8N_PROJECT,
		env: {
			...process.env,
			N8N_USER_FOLDER: USER_FOLDER,
			N8N_PORT: String(PORT),
			N8N_HOST: HOST,
			N8N_PROTOCOL: 'http',
			N8N_SECURE_COOKIE: 'false',
			N8N_DIAGNOSTICS_ENABLED: 'false',
			N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
			N8N_PERSONALIZATION_ENABLED: 'false',
			N8N_TEMPLATES_ENABLED: 'false',
			N8N_LOG_LEVEL: process.env.N8N_LOG_LEVEL || 'info',
			N8N_RUNNERS_ENABLED: 'false',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	n8nProcess.stdout.on('data', (data) => process.stdout.write(`[n8n] ${data}`));
	n8nProcess.stderr.on('data', (data) => process.stderr.write(`[n8n] ${data}`));
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
		lastName: 'Drive E2E',
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
	for (let i = 0; i < 90; i++) {
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
	const folder = `/mydrive/n8n-drive-node-e2e-${unique}`;
	const file = `${folder}/hello.txt`;
	const text = `Hello from Synology Drive n8n node E2E ${unique}`;
	let workflow;
	let credential;
	try {
		credential = await api('POST', '/rest/credentials', {
			name: `Synology Drive E2E ${unique}`,
			type: 'synologyApi',
			data: {
				baseUrl: process.env.SYNO_BASE_URL,
				username: process.env.SYNO_ACCOUNT,
				password: process.env.SYNO_PASS,
				allowUnauthorizedCerts: process.env.SYNO_ALLOW_UNAUTHORIZED_CERTS !== 'false',
			},
		});
		const type = 'CUSTOM.synologyDrive';
		const c = { synologyApi: { id: credential.id, name: credential.name } };
		const nodes = [
			{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ name: 'Create Folder', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'file', operation: 'createFileOrFolder', createFileOrFolderType: 'folder', path: folder }, credentials: c },
			{ name: 'Create File', type, typeVersion: 1, position: [480, 0], parameters: { resource: 'file', operation: 'createFileOrFolder', createFileOrFolderType: 'file', path: file, createFileOrFolderFileContent: text }, credentials: c },
			{ name: 'List Folder', type, typeVersion: 1, position: [720, 0], parameters: { resource: 'file', operation: 'getFiles', path: folder, limit: 20, offset: 0, sortBy: 'name', sortDirection: 'asc', filter: {} }, credentials: c },
			{ name: 'Download File', type, typeVersion: 1, position: [960, 0], parameters: { resource: 'file', operation: 'downloadFile', path: file }, credentials: c },
			{ name: 'Delete Folder', type, typeVersion: 1, position: [1200, 0], parameters: { resource: 'file', operation: 'deleteFileOrFolder', path: folder, deleteFileOrFolderPermanent: true }, credentials: c },
		];
		const connections = {};
		for (let i = 0; i < nodes.length - 1; i++) connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
		workflow = await api('POST', '/rest/workflows', {
			name: `Synology Drive Node E2E ${unique}`,
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
		const summary = Object.fromEntries(Object.entries(data.resultData.runData).map(([node, runs]) => [node, runs.map((item) => ({ status: item.executionStatus || (item.error ? 'error' : 'success'), error: item.error?.message, json: item.data?.main?.[0]?.map((entry) => entry.json), binaryKeys: item.data?.main?.[0]?.map((entry) => Object.keys(entry.binary || {})) }))]));
		console.log(JSON.stringify({ workflowId: workflow.id, executionId: run.executionId, status: execution.status, finished: execution.finished, lastNode: data.resultData.lastNodeExecuted, summary }, null, 2));
		if (execution.status !== 'success') throw new Error(`Execution failed: ${data.resultData.error?.message || execution.status}`);
		if (!JSON.stringify(summary['List Folder']).includes('hello.txt')) throw new Error('List Folder output did not include created hello.txt');
		if (!JSON.stringify(summary['Download File']).includes('success')) throw new Error('Download File node did not run successfully');
	} finally {
		if (workflow?.id) await request('DELETE', `/rest/workflows/${workflow.id}`);
		if (credential?.id) await request('DELETE', `/rest/credentials/${credential.id}`);
	}
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(() => {
	if (n8nProcess) n8nProcess.kill('SIGTERM');
});
