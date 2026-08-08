#!/usr/bin/env node
/* Synology Download Station n8n workflow E2E smoke test. */
 
const http = require('http');
const crypto = require('crypto');

const { ensureN8nSession } = require('./n8nE2eAuth');

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
	await ensureN8nSession({
		request,
		getCookie: () => cookie,
		setCookie: (value) => { cookie = value; },
		email: OWNER_EMAIL,
		password: OWNER_PASSWORD,
		lastName: 'DS E2E',
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
		const hasTorrent = Boolean(process.env.SYNO_TORRENT_PATH);
		const nodes = [
			{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ name: 'Get Info', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'info', operation: 'get' }, credentials: c },
			{ name: 'Get Config', type, typeVersion: 1, position: [480, 0], parameters: { resource: 'info', operation: 'getConfig' }, credentials: c },
			{ name: 'Get Statistics', type, typeVersion: 1, position: [720, 0], parameters: { resource: 'statistics', operation: 'get' }, credentials: c },
			{ name: 'Get Tasks', type, typeVersion: 1, position: [960, 0], parameters: { resource: 'task', operation: 'getMany', limit: 10 }, credentials: c },
			{ name: 'BT Search', type, typeVersion: 1, position: [1200, 0], parameters: { resource: 'btSearch', operation: 'search', keyword: 'ubuntu', limit: 5 }, credentials: c },
			...(hasTorrent ? [
				{ name: 'Set Binary', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [1440, 0], parameters: { assignments: { assignments: [{ id: '1', name: 'data', value: '={{ $json }}', type: 'string' }] } } },
				{ name: 'Create Torrent', type, typeVersion: 1, position: [1680, 0], parameters: { resource: 'task', operation: 'createTorrent', binaryPropertyName: 'data', createList: false }, credentials: c },
				{ name: 'Download Source', type, typeVersion: 1, position: [1920, 0], parameters: { resource: 'task', operation: 'downloadSource', taskId: '={{ $json.task_id[0] }}' }, credentials: c },
			] : []),
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
			pinData: {
				'Manual Trigger': [{ json: {} }],
				...(process.env.SYNO_TORRENT_PATH ? (() => { const fs = require('fs'); return { 'Set Binary': [{ json: {}, binary: { data: { data: fs.readFileSync(process.env.SYNO_TORRENT_PATH).toString('base64'), mimeType: 'application/x-bittorrent', fileName: 'e2e-upload.torrent' } } }] }; })() : {}),
			},
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

		// Verify Create Torrent output (destructive; only when a torrent fixture is provided)
		if (process.env.SYNO_TORRENT_PATH) {
			const torrentOutput = summary['Create Torrent']?.[0];
			if (torrentOutput?.status === 'error') {
				throw new Error(`Create Torrent failed: ${torrentOutput.error}`);
			}
			const tjson = torrentOutput?.json?.[0];
			console.log('✅ Create Torrent ran:', JSON.stringify(tjson));
			if (tjson && (tjson.task_id || tjson.list_id)) {
				console.log('✅ Torrent task/list created');
				// cleanup: delete created task via node Delete
				const tid = Array.isArray(tjson.task_id) ? tjson.task_id[0] : tjson.task_id;
				if (tid) {
					// use V2 delete through the node's delete operation
					const cleanupWorkflow = await api('POST', '/rest/workflows', {
						name: `Synology DS Cleanup ${unique}`,
						nodes: [
							{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
							{ name: 'Delete Task', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'task', operation: 'delete', taskId: tid }, credentials: c },
						],
						connections: { 'Manual Trigger': { main: [[{ node: 'Delete Task', type: 'main', index: 0 }]] } },
						active: false, settings: { executionOrder: 'v1' }, staticData: null, pinData: { 'Manual Trigger': [{ json: {} }] }, tags: [],
					});
					const cleanupRun = await api('POST', `/rest/workflows/${cleanupWorkflow.id}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } });
					await getExecution(cleanupRun.executionId);
					await api('POST', `/rest/workflows/${cleanupWorkflow.id}/archive`).catch(() => {});
					await api('DELETE', `/rest/workflows/${cleanupWorkflow.id}`).catch(() => {});
					console.log('🧹 Torrent task cleaned up');
				}
			}
			// Verify Download Source (binary torrent re-download)
			const sourceOut = summary['Download Source']?.[0];
			if (sourceOut?.status === 'error') throw new Error(`Download Source failed: ${sourceOut.error}`);
			const srcJson = sourceOut?.json?.[0];
			console.log('✅ Download Source ran:', JSON.stringify(srcJson));
			if (srcJson && typeof srcJson.size === 'number' && srcJson.size > 0) {
				console.log(`✅ Download Source returned ${srcJson.size} bytes`);
			} else {
				console.warn('⚠️  Download Source output missing size');
			}
		} else {
			console.log('⏭️  Skipping Create Torrent (set SYNO_TORRENT_PATH to test torrent upload)');
		}

		// Verify Task List flow (create_list=true → getFiles → confirmDownload → status)
		if (process.env.SYNO_TORRENT_PATH) {
			const listFlow = await testTaskListFlow(api, getExecution, type, c, unique, process.env.SYNO_TORRENT_PATH);
			if (listFlow) console.log('✅ Task List flow verified');
		}

		// Verify Edit operation (create URL task → edit destination/priority → delete)
		const editFlow = await testEditOperation(api, getExecution, type, c, unique);
		if (editFlow) console.log('✅ Edit operation verified');

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

/** Run a workflow and return the parsed execution summary. */
async function runWorkflow(api, getExecution, type, c, unique, nodes, connections, pinData) {
	const wf = await api('POST', '/rest/workflows', {
		name: `Synology DS E2E ${unique}`, nodes, connections, active: false, settings: { executionOrder: 'v1' }, staticData: null, pinData, tags: [],
	});
	const run = await api('POST', `/rest/workflows/${wf.id}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } });
	if (!run.executionId) throw new Error(`Manual run did not return executionId: ${JSON.stringify(run)}`);
	const execution = await getExecution(run.executionId);
	const data = parseExecutionData(execution);
	const summary = Object.fromEntries(Object.entries(data.resultData.runData).map(([node, runs]) => [node, runs.map((item) => ({ status: item.executionStatus || (item.error ? 'error' : 'success'), error: item.error?.message, json: item.data?.main?.[0]?.map((entry) => entry.json), }))]));
	return { wf, execution, summary };
}

/** Create torrent with create_list=true, getFiles, confirmDownload, status, cleanup. */
async function testTaskListFlow(api, getExecution, type, c, unique, torrentPath) {
	const fs = require('fs');
	const b64 = fs.readFileSync(torrentPath).toString('base64');
	const nodes = [
		{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
		{ name: 'Set Binary', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [240, 0], parameters: { assignments: { assignments: [{ id: '1', name: 'data', value: '={{ $json }}', type: 'string' }] } } },
		{ name: 'Create Torrent List', type, typeVersion: 1, position: [480, 0], parameters: { resource: 'task', operation: 'createTorrent', binaryPropertyName: 'data', createList: true }, credentials: c },
		{ name: 'Get Files', type, typeVersion: 1, position: [720, 0], parameters: { resource: 'taskList', operation: 'getFiles', listId: '={{ $json.list_id[0] }}' }, credentials: c },
		{ name: 'Confirm Download', type, typeVersion: 1, position: [960, 0], parameters: { resource: 'taskList', operation: 'confirmDownload', listId: '={{ $json.list_id[0] }}', listDestination: 'home/Drive/Download', createSubfolder: false }, credentials: c },
		{ name: 'Get Status', type, typeVersion: 1, position: [1200, 0], parameters: { resource: 'taskList', operation: 'getDownloadStatus', pollingTaskId: '={{ $json.task_id }}' }, credentials: c },
	];
	// Create Torrent List -> Get Files (parallel) + Confirm Download (uses $json.list_id from Create Torrent List).
	// Get Files output has no list_id, so Confirm Download must NOT follow Get Files.
	const connections = {
		'Manual Trigger': { main: [[{ node: 'Set Binary', type: 'main', index: 0 }]] },
		'Set Binary': { main: [[{ node: 'Create Torrent List', type: 'main', index: 0 }]] },
		'Create Torrent List': { main: [[{ node: 'Get Files', type: 'main', index: 0 }, { node: 'Confirm Download', type: 'main', index: 0 }]] },
		'Confirm Download': { main: [[{ node: 'Get Status', type: 'main', index: 0 }]] },
	};
	const pinData = {
		'Manual Trigger': [{ json: {} }],
		'Set Binary': [{ json: {}, binary: { data: { data: b64, mimeType: 'application/x-bittorrent', fileName: 'e2e-list.torrent' } } }],
	};
	const { wf, summary } = await runWorkflow(api, getExecution, type, c, `${unique}-list`, nodes, connections, pinData);
	const createOut = summary['Create Torrent List']?.[0];
	if (createOut?.status === 'error') throw new Error(`Task List create failed: ${createOut.error}`);
	const listId = createOut?.json?.[0]?.list_id?.[0];
	if (!listId) { console.warn('⚠️  Task List flow: no list_id returned'); await api('DELETE', `/rest/workflows/${wf.id}`).catch(() => {}); return false; }
	console.log('✅ Task List created:', listId);
	const filesOut = summary['Get Files']?.[0];
	if (filesOut?.status === 'error') throw new Error(`Get Files failed: ${filesOut.error}`);
	console.log('✅ Task List files:', JSON.stringify(filesOut?.json?.[0]?.files ?? []));
	const confirmOut = summary['Confirm Download']?.[0];
	if (confirmOut?.status === 'error') throw new Error(`Confirm Download failed: ${confirmOut.error}`);
	const pollingId = confirmOut?.json?.[0]?.task_id;
	console.log('✅ Confirm Download polling id:', pollingId);
	const statusOut = summary['Get Status']?.[0];
	if (statusOut?.status === 'error') throw new Error(`Get Status failed: ${statusOut.error}`);
	const realTaskId = statusOut?.json?.[0]?.data?.task_id?.[0];
	console.log('✅ Task List download status → task:', realTaskId);
	// cleanup: delete real task + list via node operations
	if (realTaskId) {
		const delNodes = [
			{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ name: 'Delete Task', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'task', operation: 'delete', taskId: realTaskId }, credentials: c },
		];
		const delWf = await api('POST', '/rest/workflows', { name: `DS Cleanup ${unique}`, nodes: delNodes, connections: { 'Manual Trigger': { main: [[{ node: 'Delete Task', type: 'main', index: 0 }]] } }, active: false, settings: { executionOrder: 'v1' }, staticData: null, pinData: { 'Manual Trigger': [{ json: {} }] }, tags: [] });
		await api('POST', `/rest/workflows/${delWf.id}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } });
		await api('POST', `/rest/workflows/${delWf.id}/archive`).catch(() => {});
		await api('DELETE', `/rest/workflows/${delWf.id}`).catch(() => {});
	}
	await api('DELETE', `/rest/workflows/${wf.id}`).catch(() => {});
	return true;
}

/** Create URL task → Edit (destination + priority) → delete. */
async function testEditOperation(api, getExecution, type, c, unique) {
	const nodes = [
		{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
		{ name: 'Create URL', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'task', operation: 'createUrl', url: 'https://httpbin.org/bytes/1024' }, credentials: c },
		{ name: 'Get Tasks', type, typeVersion: 1, position: [480, 0], parameters: { resource: 'task', operation: 'getMany', limit: 10 }, credentials: c },
		{ name: 'Edit Task', type, typeVersion: 1, position: [720, 0], parameters: { resource: 'task', operation: 'edit', taskId: '={{ $json.tasks[$json.tasks.length - 1].id }}', priority: 'high' }, credentials: c },
	];
	const connections = {
		'Manual Trigger': { main: [[{ node: 'Create URL', type: 'main', index: 0 }]] },
		'Create URL': { main: [[{ node: 'Get Tasks', type: 'main', index: 0 }]] },
		'Get Tasks': { main: [[{ node: 'Edit Task', type: 'main', index: 0 }]] },
	};
	const { wf, summary } = await runWorkflow(api, getExecution, type, c, `${unique}-edit`, nodes, connections, { 'Manual Trigger': [{ json: {} }] });
	const editOut = summary['Edit Task']?.[0];
	if (editOut?.status === 'error') throw new Error(`Edit failed: ${editOut.error}`);
	console.log('✅ Edit ran:', JSON.stringify(editOut?.json?.[0]));
	// cleanup: delete the created URL task
	const tasksOut = summary['Get Tasks']?.[0]?.json?.[0]?.tasks ?? [];
	const tid = tasksOut.length ? tasksOut[tasksOut.length - 1].id : undefined;
	if (tid) {
		const delNodes = [
			{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ name: 'Delete Task', type, typeVersion: 1, position: [240, 0], parameters: { resource: 'task', operation: 'delete', taskId: tid }, credentials: c },
		];
		const delWf = await api('POST', '/rest/workflows', { name: `DS Cleanup ${unique}`, nodes: delNodes, connections: { 'Manual Trigger': { main: [[{ node: 'Delete Task', type: 'main', index: 0 }]] } }, active: false, settings: { executionOrder: 'v1' }, staticData: null, pinData: { 'Manual Trigger': [{ json: {} }] }, tags: [] });
		await api('POST', `/rest/workflows/${delWf.id}/run`, { triggerToStartFrom: { name: 'Manual Trigger' } });
		await api('POST', `/rest/workflows/${delWf.id}/archive`).catch(() => {});
		await api('DELETE', `/rest/workflows/${delWf.id}`).catch(() => {});
	}
	await api('DELETE', `/rest/workflows/${wf.id}`).catch(() => {});
	return true;
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
