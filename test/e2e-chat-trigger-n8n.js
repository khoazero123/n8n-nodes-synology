#!/usr/bin/env node
/* Synology Chat Trigger n8n E2E: activation registers webhook, filters, and emits. */
 
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.N8N_BASE_URL || 'http://127.0.0.1:5680';
const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'synology-chat-trigger-e2e@example.com';
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || `N8nChatTrg-${crypto.randomBytes(12).toString('hex')}!`;
const REQUIRED = ['SYNO_BASE_URL', 'SYNO_ACCOUNT', 'SYNO_PASS'];
let cookie = '';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function request(method, route, body, headers = {}) {
	return new Promise((resolve, reject) => {
		const url = new URL(route, BASE_URL);
		const payload = body === undefined ? undefined : JSON.stringify(body);
		const req = http.request({ hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method,
			headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, (res) => {
			let raw = '';
			res.on('data', (chunk) => { raw += chunk; });
			res.on('end', () => {
				if (res.headers['set-cookie']) cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
				let json; try { json = raw ? JSON.parse(raw) : {}; } catch { json = { raw }; }
				resolve({ statusCode: res.statusCode, json, raw });
			});
		});
		req.on('error', reject);
		if (payload) req.write(payload);
		req.end();
	});
}
async function listExecutions(wfId) {
	const r = await request('GET', `/rest/executions?workflowId=${wfId}&limit=20`, undefined, { Cookie: cookie });
	return Array.isArray(r.json?.data?.results) ? r.json.data.results : Array.isArray(r.json?.data) ? r.json.data : [];
}
async function waitForNewExecution(wfId, beforeIds) {
	for (let i = 0; i < 20; i++) {
		const executions = await listExecutions(wfId);
		const found = executions.find((item) => !beforeIds.has(String(item.id)));
		if (found) return found;
		await sleep(500);
	}
	return null;
}
async function executionRunData(executionId) {
	const r = await request('GET', `/rest/executions/${executionId}?includeData=true`, undefined, { Cookie: cookie });
	let raw = r.json?.data?.data ?? r.json?.data;
	if (typeof raw === 'string') raw = require('flatted').parse(raw);
	return raw?.resultData?.runData || {};
}
function outputJson(runData) {
	return Object.values(runData).flatMap((runs) => runs.flatMap((run) => (run.data?.main ?? []).flatMap((items) => items.map((item) => item.json))));
}

async function main() {
	const missing = REQUIRED.filter((k) => !process.env[k]);
	if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
	const setup = await request('POST', '/rest/owner/setup', { email: OWNER_EMAIL, firstName: 'S', lastName: 'C', password: OWNER_PASSWORD });
	if (![200, 400, 404].includes(setup.statusCode)) throw new Error(`owner setup ${setup.statusCode}`);
	const login = await request('POST', '/rest/login', { emailOrLdapLoginId: OWNER_EMAIL, password: OWNER_PASSWORD });
	if (login.statusCode !== 200 || !cookie) throw new Error(`login ${login.statusCode}`);
	const auth = { Cookie: cookie };
	let credentialId; let wfId;
	try {
		const credential = await request('POST', '/rest/credentials', { name: `Chat Trigger E2E ${Date.now()}`, type: 'synologyApi', data: {
			baseUrl: process.env.SYNO_BASE_URL, username: process.env.SYNO_ACCOUNT, password: process.env.SYNO_PASS,
			allowUnauthorizedCerts: process.env.SYNO_ALLOW_UNAUTHORIZED_CERTS !== 'false',
		} }, auth);
		credentialId = credential.json?.data?.id;
		if (!credentialId) throw new Error(`credential create failed: ${credential.raw}`);
		const node = { name: 'Chat Trigger', type: 'CUSTOM.synologyChatTrigger', typeVersion: 1, position: [0, 0], parameters: {
			channelId: 2, triggerWord: 'ping', nickname: 'n8n Chat Trigger E2E',
		}, credentials: { synologyApi: { id: credentialId, name: 'x' } } };
		const created = await request('POST', '/rest/workflows', { name: `Chat Trigger E2E ${Date.now()}`, nodes: [node], connections: {}, active: false, settings: { executionOrder: 'v1' }, staticData: null, pinData: {}, tags: [] }, auth);
		wfId = created.json?.data?.id;
		if (!wfId) throw new Error(`workflow create failed: ${created.raw}`);

		const draft = await request('GET', `/rest/workflows/${wfId}`, undefined, auth);
		const versionId = draft.json?.data?.versionId || draft.json?.data?.versionCounter;
		if (!versionId || typeof versionId !== 'string') throw new Error(`workflow draft has no versionId: ${draft.raw.slice(0, 300)}`);
		const activated = await request('POST', `/rest/workflows/${wfId}/activate`, { versionId }, auth);
		if (activated.statusCode >= 300) throw new Error(`activation failed ${activated.statusCode}: ${activated.raw}`);
		console.log('activation response:', activated.statusCode, activated.json?.data?.active ?? activated.json?.active);
		console.log('✅ Chat trigger activated and webhook registration completed');

		const details = await request('GET', `/rest/workflows/${wfId}`, undefined, auth);
		const savedNode = details.json?.data?.nodes?.find((item) => item.name === 'Chat Trigger');
		const webhookId = savedNode?.webhookId;
		const webhookCandidates = [webhookId && `/webhook/${webhookId}/webhook`, `/webhook/${wfId}/chat-trigger/webhook`, '/webhook/webhook'].filter(Boolean);
		let webhook;
		for (const candidate of webhookCandidates) {
			const probe = await request('POST', candidate, { channel_id: 99, text: 'ping ignored' });
			if (probe.statusCode !== 404) { webhook = candidate; break; }
		}
		if (!webhook) throw new Error(`could not resolve active webhook URL (${webhookCandidates.join(', ')}); workflow=${JSON.stringify(details.json?.data || details.json).slice(0, 500)}`);
		console.log(`webhook URL: ${webhook}`);
		let beforeIds = new Set((await listExecutions(wfId)).map((item) => String(item.id)));
		const wrongChannel = await request('POST', webhook, { channel_id: 99, text: 'ping ignored' });
		if (wrongChannel.statusCode >= 300) throw new Error(`wrong-channel webhook ${wrongChannel.statusCode}`);
		const wrongChannelExecution = await waitForNewExecution(wfId, beforeIds);
		if (!wrongChannelExecution) throw new Error('wrong-channel webhook did not finish');
		if (outputJson(await executionRunData(wrongChannelExecution.id)).length !== 0) throw new Error('wrong channel produced trigger output');
		console.log('✅ Channel filter rejected non-matching channel');

		beforeIds = new Set((await listExecutions(wfId)).map((item) => String(item.id)));
		const wrongWord = await request('POST', webhook, { channel_id: 2, text: 'hello ignored' });
		if (wrongWord.statusCode >= 300) throw new Error(`wrong-word webhook ${wrongWord.statusCode}`);
		const wrongWordExecution = await waitForNewExecution(wfId, beforeIds);
		if (!wrongWordExecution) throw new Error('wrong-word webhook did not finish');
		if (outputJson(await executionRunData(wrongWordExecution.id)).length !== 0) throw new Error('wrong trigger word produced trigger output');
		console.log('✅ Trigger-word filter rejected non-matching message');

		beforeIds = new Set((await listExecutions(wfId)).map((item) => String(item.id)));
		const accepted = await request('POST', webhook, { channel_id: 2, text: 'ping accepted', user_id: 123, username: 'e2e' });
		if (accepted.statusCode >= 300) throw new Error(`accepted webhook ${accepted.statusCode}`);
		const acceptedExecution = await waitForNewExecution(wfId, beforeIds);
		if (!acceptedExecution) throw new Error('matching webhook did not execute workflow');
		const acceptedOutput = outputJson(await executionRunData(acceptedExecution.id));
		if (!acceptedOutput.some((item) => item.text === 'ping accepted')) throw new Error('matching payload was not found in trigger output');
		console.log('✅ Matching Chat webhook emitted the expected payload');
	} finally {
		if (wfId) {
			await request('POST', `/rest/workflows/${wfId}/deactivate`, {}, auth).catch(() => {});
			await request('POST', `/rest/workflows/${wfId}/archive`, undefined, auth).catch(() => {});
			await request('DELETE', `/rest/workflows/${wfId}`, undefined, auth).catch(() => {});
		}
		if (credentialId) await request('DELETE', `/rest/credentials/${credentialId}`, undefined, auth).catch(() => {});
	}
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
