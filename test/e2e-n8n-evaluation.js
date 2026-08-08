#!/usr/bin/env node
/* Official n8n Evaluation Trigger/Test Run E2E for Synology Note Station. */
 
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pass: e2ePass, logRun } = require('./n8nE2eLog');

const BASE_URL = process.env.N8N_BASE_URL || 'http://127.0.0.1:5680';
const REPO_ROOT = path.resolve(__dirname, '..');
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nE2e-${crypto.randomBytes(12).toString('hex')}!`;
const REQUIRED = ['SYNO_BASE_URL', 'SYNO_ACCOUNT', 'SYNO_PASS'];
let cookie = '';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function request(method, route, body, auth = true) {
	return new Promise((resolve, reject) => {
		const url = new URL(route, BASE_URL);
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const req = http.request({ hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method,
			headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...(auth && cookie ? { Cookie: cookie } : {}) },
		}, (res) => {
			let raw = '';
			res.on('data', (chunk) => { raw += chunk; });
			res.on('end', () => {
				if (res.headers['set-cookie']) cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
				let json; try { json = raw ? JSON.parse(raw) : {}; } catch { json = { raw }; }
				resolve({ statusCode: res.statusCode, json, raw });
			});
		});
		req.on('error', reject); if (payload) req.write(payload); req.end();
	});
}
async function api(method, route, body, expected = [200]) {
	const response = await request(method, route, body);
	if (!expected.includes(response.statusCode)) throw new Error(`${method} ${route} -> ${response.statusCode}: ${response.raw}`);
	return response.json.data ?? response.json;
}
async function main() {
	const missing = REQUIRED.filter((key) => !process.env[key]);
	if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);
	await api('POST', '/rest/owner/setup', { email: OWNER_EMAIL, firstName: 'Synology', lastName: 'Evaluation E2E', password: OWNER_PASSWORD }, [200, 400]);
	await api('POST', '/rest/login', { emailOrLdapLoginId: OWNER_EMAIL, password: OWNER_PASSWORD }, [200]);
	const project = await api('GET', '/rest/projects/personal');
	const projectId = project.id || project.projectId;
	const unique = Date.now();
	let table; let workflow; let credential;
	try {
		table = await api('POST', `/rest/projects/${projectId}/data-tables`, { name: `Synology Evaluation Dataset ${unique}`, columns: [{ name: 'caseTitle', type: 'string' }] }, [200, 201]);
		await api('POST', `/rest/projects/${projectId}/data-tables/${table.id}/insert`, { data: [{ caseTitle: `official evaluation ${unique}` }], returnType: 'count' }, [200, 201]);
		credential = await api('POST', '/rest/credentials', { name: `Synology Evaluation ${unique}`, type: 'synologyApi', data: { baseUrl: process.env.SYNO_BASE_URL, username: process.env.SYNO_ACCOUNT, password: process.env.SYNO_PASS, allowUnauthorizedCerts: true } });
		const type = 'CUSTOM.synologyNoteStation';
		const c = { synologyApi: { id: credential.id, name: credential.name } };
		const nodes = [
			{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
			{ name: 'Evaluation Trigger', type: 'n8n-nodes-base.evaluationTrigger', typeVersion: 4.7, position: [-220, 220], parameters: { source: 'dataTable', dataTableId: table.id, limitRows: true, maxRows: 10 } },
			{ name: 'Create Notebook', type, typeVersion: 1, position: [220, 0], parameters: { resource: 'notebook', operation: 'create', title: `={{ $('Manual Trigger').item.json.caseTitle || 'evaluation' }}` }, credentials: c },
			{ name: 'Create Note', type, typeVersion: 1, position: [440, 0], parameters: { resource: 'note', operation: 'create', parentId: "={{ $('Create Notebook').item.json.object_id }}", title: `evaluation note ${unique}`, content: `<div>official n8n evaluation ${unique}</div>`, returnFullNote: true }, credentials: c },
			{ name: 'Delete Notebook', type, typeVersion: 1, position: [660, 0], parameters: { resource: 'notebook', operation: 'delete', objectId: "={{ $('Create Notebook').item.json.object_id }}", recursive: true }, credentials: c },
		];
		workflow = await api('POST', '/rest/workflows', { name: `Synology Official Evaluation E2E ${unique}`, nodes, connections: { 'Manual Trigger': { main: [[{ node: 'Create Notebook', type: 'main', index: 0 }]] }, 'Evaluation Trigger': { main: [[{ node: 'Create Notebook', type: 'main', index: 0 }]] }, 'Create Notebook': { main: [[{ node: 'Create Note', type: 'main', index: 0 }]] }, 'Create Note': { main: [[{ node: 'Delete Notebook', type: 'main', index: 0 }]] } }, active: false, settings: { executionOrder: 'v1' }, staticData: null, tags: [] });
		const config = await api('POST', `/rest/workflows/${workflow.id}/evaluation-configs`, { name: `Synology Official Evaluation ${unique}`, datasetSource: 'data_table', datasetRef: { dataTableId: table.id }, startNodeName: 'Create Notebook', endNodeName: 'Delete Notebook', metrics: [{ id: `metric_${unique}`, name: 'WorkflowCompleted', type: 'expression', config: { expression: '={{ 1 }}', outputType: 'numeric' } }] }, [200, 201]);
		const run = await api('POST', `/rest/workflows/${workflow.id}/test-runs/new`, {}, [200, 201, 202]);
		let result;
		for (let i = 0; i < 90; i++) { result = await api('GET', `/rest/workflows/${workflow.id}/test-runs/${run.testRunId || run.id}`); if (['completed', 'error', 'cancelled'].includes(result.status)) break; await sleep(1000); }
		const cases = await api('GET', `/rest/workflows/${workflow.id}/test-runs/${run.testRunId || run.id}/test-cases`);
		logRun({ workflowId: workflow.id, evaluationConfigId: config.id, status: result?.status, finalResult: result?.finalResult, testCaseCount: Array.isArray(cases) ? cases.length : undefined });
		e2ePass('Official n8n evaluation');
		if (result.status !== 'completed' || result.finalResult !== 'success') throw new Error('Official evaluation failed');
	} finally {
		if (workflow?.id) await request('DELETE', `/rest/workflows/${workflow.id}`);
		if (table?.id) await request('DELETE', `/rest/projects/${projectId}/data-tables/${table.id}`);
		if (credential?.id) await request('DELETE', `/rest/credentials/${credential.id}`);
	}
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
