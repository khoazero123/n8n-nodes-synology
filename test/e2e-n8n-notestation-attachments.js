#!/usr/bin/env node
/* Synology Note Station attachment binary n8n workflow E2E. */
 
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { URLSearchParams } = require('url');
const { ensureN8nSession } = require('./n8nE2eAuth');

const REPO_ROOT = path.resolve(__dirname, '..');
const N8N_VERSION = process.env.N8N_VERSION || 'latest';
const PORT = Number(process.env.N8N_PORT || 5681);
const HOST = process.env.N8N_HOST || '127.0.0.1';
const BASE_URL = process.env.N8N_BASE_URL || `http://${HOST}:${PORT}`;
const USER_FOLDER = process.env.N8N_USER_FOLDER || path.join(os.tmpdir(), `n8n-synology-notestation-attachments-e2e-${Date.now()}`);
const N8N_PROJECT = process.env.N8N_PROJECT || path.join(USER_FOLDER, 'project');
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-notestation-attachments-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nNoteAttachmentE2e-${crypto.randomBytes(12).toString('hex')}!`;
const REQUIRED = ['SYNO_BASE_URL', 'SYNO_ACCOUNT', 'SYNO_PASS'];
const startedByScript = !process.env.N8N_BASE_URL;
const ATTACHMENT_BYTES = `Synology Note Station attachment binary E2E ${Date.now()} ${crypto.randomBytes(16).toString('hex')}\n`;
let cookie = '';
let n8nProcess;
let synologySid;
let workflow;
let credential;
let createdNotebookId;
let createdNoteId;
let createdAttachmentFileId;
let createdAttachmentVersion;

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
	if (startedByScript) {
		try { fs.unlinkSync(process.env.N8N_E2E_COOKIE_FILE || '/tmp/n8n-nodes-synology-e2e.cookie'); } catch {}
	}
	await ensureN8nSession({
		request,
		getCookie: () => cookie,
		setCookie: (value) => { cookie = value; },
		email: OWNER_EMAIL,
		password: OWNER_PASSWORD,
		lastName: 'Note Attachments E2E',
	});
}

function parseExecutionData(execution) {
	let parse;
	try { ({ parse } = require('flatted')); } catch { parse = JSON.parse; }
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

function firstJson(data, nodeName) {
	return data?.resultData?.runData?.[nodeName]?.[0]?.data?.main?.[0]?.[0]?.json;
}

function findAttachment(listOutput, fileName) {
	const attachments = Array.isArray(listOutput?.attachment) ? listOutput.attachment : [];
	return attachments.find((attachment) => attachment.name === fileName || attachment.filename === fileName) || attachments[0];
}

function synologyPost(params) {
	return new Promise((resolve, reject) => {
		const body = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null) continue;
			body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
		}
		const base = new URL(process.env.SYNO_BASE_URL.replace(/\/$/, ''));
		const req = (base.protocol === 'https:' ? require('https') : require('http')).request({
			hostname: base.hostname,
			port: base.port,
			path: `${base.pathname.replace(/\/$/, '')}/webapi/entry.cgi`,
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body.toString()) },
			rejectUnauthorized: process.env.SYNO_ALLOW_UNAUTHORIZED_CERTS === 'false',
		}, (res) => {
			let raw = '';
			res.on('data', (chunk) => { raw += chunk; });
			res.on('end', () => {
				try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
			});
		});
		req.on('error', reject);
		req.write(body.toString());
		req.end();
	});
}

async function synologyApi(apiName, version, method, params = {}) {
	if (!synologySid) {
		const login = await synologyPost({ api: 'SYNO.API.Auth', version: 7, method: 'login', account: process.env.SYNO_ACCOUNT, passwd: process.env.SYNO_PASS, session: 'NoteStation', format: 'sid' });
		if (!login.success) throw new Error(`Synology cleanup login failed: ${JSON.stringify(login)}`);
		synologySid = login.data.sid;
	}
	return await synologyPost({ api: apiName, version, method, _sid: synologySid, ...params });
}

async function cleanupSynology() {
	try {
		if (createdNoteId && createdAttachmentFileId && createdAttachmentVersion) {
			await synologyApi('SYNO.NoteStation.Note', 3, 'set', { object_id: createdNoteId, ver: createdAttachmentVersion, attachment: [{ action: 'delete', file_id: createdAttachmentFileId }], commit_msg: { device: 'n8n-e2e-cleanup', listable: false } });
		}
	} catch (error) { console.error(`cleanup attachment error: ${error.message}`); }
	try {
		if (createdNoteId) await synologyApi('SYNO.NoteStation.Note', 3, 'delete', { object_id: createdNoteId, recycle: 'false' });
	} catch (error) { console.error(`cleanup note error: ${error.message}`); }
	try {
		if (createdNotebookId) await synologyApi('SYNO.NoteStation.Notebook', 2, 'delete', { object_id: createdNotebookId, recursive: 'true' });
	} catch (error) { console.error(`cleanup notebook error: ${error.message}`); }
	try {
		if (synologySid) await synologyPost({ api: 'SYNO.API.Auth', version: 7, method: 'logout', session: 'NoteStation', _sid: synologySid });
	} catch {}
}

async function main() {
	const missing = REQUIRED.filter((key) => !process.env[key]);
	if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

	await startN8n();
	await setupOwnerAndLogin();

	const unique = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
	const fileName = `attachment-${unique}.txt`;
	try {
		credential = await api('POST', '/rest/credentials', {
			name: `Synology Note Attachment E2E ${unique}`,
			type: 'synologyApi',
			data: {
				baseUrl: process.env.SYNO_BASE_URL,
				username: process.env.SYNO_ACCOUNT,
				password: process.env.SYNO_PASS,
				allowUnauthorizedCerts: process.env.SYNO_ALLOW_UNAUTHORIZED_CERTS !== 'false',
			},
		});
		const type = 'CUSTOM.synologyNoteStation';
		const c = { synologyApi: { id: credential.id, name: credential.name } };
		const nodes = [
			{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ name: 'Create Notebook', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'notebook', operation: 'create', title: `n8n attachment E2E ${unique}` }, credentials: c },
			{ name: 'Create Note Full', type, typeVersion: 1, position: [480, 0], parameters: { resource: 'note', operation: 'create', parentId: "={{ $('Create Notebook').item.json.object_id }}", title: `n8n attachment note E2E ${unique}`, content: `<div>attachment E2E ${unique}</div>`, brief: `attachment E2E ${unique}`, returnFullNote: true }, credentials: c },
			{ name: 'Create Attachment Binary', type: 'n8n-nodes-base.code', typeVersion: 2, position: [720, 0], parameters: { mode: 'runOnceForAllItems', jsCode: `const inputItems = $input.all();\nconst bytes = Buffer.from(${JSON.stringify(ATTACHMENT_BYTES)}, 'utf8');\nreturn [{ json: inputItems[0]?.json ?? {}, binary: { data: await this.helpers.prepareBinaryData(bytes, ${JSON.stringify(fileName)}, 'text/plain') } }];` } },
			{ name: 'Upload Attachment', type, typeVersion: 1, position: [960, 0], parameters: { resource: 'attachment', operation: 'upload', objectId: "={{ $('Create Note Full').item.json.object_id }}", attachmentVersion: "={{ $('Create Note Full').item.json.ver }}", binaryProperty: 'data' }, credentials: c },
			{ name: 'Get Note After Upload', type, typeVersion: 1, position: [1200, 0], parameters: { resource: 'note', operation: 'get', objectId: "={{ $('Create Note Full').item.json.object_id }}" }, credentials: c },
			{ name: 'List Attachments', type, typeVersion: 1, position: [1440, 0], parameters: { resource: 'attachment', operation: 'list', objectId: "={{ $('Create Note Full').item.json.object_id }}" }, credentials: c },
			{ name: 'Download Attachment', type, typeVersion: 1, position: [1680, 0], parameters: { resource: 'attachment', operation: 'download', objectId: "={{ $('Create Note Full').item.json.object_id }}", attachmentVersion: "={{ $('Get Note After Upload').item.json.ver }}", attachmentFileId: `={{ $('List Attachments').item.json.attachment[0].file_id }}` }, credentials: c },
			{ name: 'Verify Download Bytes', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1920, 0], parameters: { mode: 'runOnceForAllItems', jsCode: `const buffer = await this.helpers.getBinaryDataBuffer(0, 'data');\nconst expected = Buffer.from(${JSON.stringify(ATTACHMENT_BYTES)}, 'utf8');\nif (!buffer.equals(expected)) throw new Error('Downloaded attachment bytes did not match uploaded bytes');\nreturn [{ json: { length: buffer.length, text: buffer.toString('utf8'), bytesMatch: true } }];` } },
			{ name: 'Delete Attachment', type, typeVersion: 1, position: [2160, 0], parameters: { resource: 'attachment', operation: 'delete', objectId: "={{ $('Create Note Full').item.json.object_id }}", attachmentVersion: "={{ $('Get Note After Upload').item.json.ver }}", attachmentFileId: `={{ $('List Attachments').item.json.attachment[0].file_id }}` }, credentials: c },
			{ name: 'Delete Notebook', type, typeVersion: 1, position: [2400, 0], parameters: { resource: 'notebook', operation: 'delete', objectId: "={{ $('Create Notebook').item.json.object_id }}", recursive: true }, credentials: c },
		];
		const connections = {};
		for (let i = 0; i < nodes.length - 1; i++) connections[nodes[i].name] = { main: [[{ node: nodes[i + 1].name, type: 'main', index: 0 }]] };
		workflow = await api('POST', '/rest/workflows', {
			name: `Synology Note Attachment Binary E2E ${unique}`,
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
		createdNotebookId = firstJson(data, 'Create Notebook')?.object_id;
		createdNoteId = firstJson(data, 'Create Note Full')?.object_id;
		const listOutput = firstJson(data, 'List Attachments');
		const attachment = findAttachment(listOutput, fileName);
		createdAttachmentFileId = attachment?.file_id;
		createdAttachmentVersion = firstJson(data, 'Get Note After Upload')?.ver;
		const verification = firstJson(data, 'Verify Download Bytes');
		const summary = Object.fromEntries(Object.entries(data.resultData.runData).map(([node, runs]) => [node, runs.map((item) => ({ status: item.executionStatus || (item.error ? 'error' : 'success'), error: item.error?.message, json: item.data?.main?.[0]?.map((entry) => entry.json), binaryKeys: item.data?.main?.[0]?.map((entry) => Object.keys(entry.binary || {})) }))]));
		console.log(JSON.stringify({ workflowId: workflow.id, executionId: run.executionId, status: execution.status, finished: execution.finished, lastNode: data.resultData.lastNodeExecuted, createdNotebookId, createdNoteId, createdAttachmentFileId, verification, summary }, null, 2));
		if (execution.status !== 'success') throw new Error(`Execution failed: ${data.resultData.error?.message || execution.status}`);
		if (!createdAttachmentFileId) throw new Error(`List Attachments did not return a file_id: ${JSON.stringify(listOutput)}`);
		if (!verification?.bytesMatch || verification.text !== ATTACHMENT_BYTES) throw new Error(`Verify Download Bytes did not confirm expected bytes: ${JSON.stringify(verification)}`);
		createdAttachmentFileId = undefined;
		createdNoteId = undefined;
		createdNotebookId = undefined;
	} finally {
		if (workflow?.id) await request('DELETE', `/rest/workflows/${workflow.id}`);
		if (credential?.id) await request('DELETE', `/rest/credentials/${credential.id}`);
		await cleanupSynology();
	}
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(() => {
	if (n8nProcess) n8nProcess.kill('SIGTERM');
});
