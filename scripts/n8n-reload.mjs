#!/usr/bin/env node
/**
 * Start or restart n8n with WEBHOOK_URL for local Synology Chat trigger dev.
 * Usage: node scripts/n8n-reload.mjs start | reload
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://n8n-local.fgct.tech/';
const PID_FILE = path.join(os.tmpdir(), 'n8n-nodes-synology-n8n.pid');
const LOG_FILE = path.join(os.tmpdir(), 'n8n-nodes-synology-n8n.log');

function sleepMs(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readPid() {
	if (!fs.existsSync(PID_FILE)) return undefined;
	const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
	return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

function isRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function stopN8n() {
	const pid = readPid();
	if (pid !== undefined && isRunning(pid)) {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {
			// ignore
		}
		sleepMs(1500);
		if (isRunning(pid)) {
			try {
				process.kill(pid, 'SIGKILL');
			} catch {
				// ignore
			}
		}
	}
	if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
}

function startN8n() {
	const logFd = fs.openSync(LOG_FILE, 'a');
	fs.writeSync(logFd, `\n--- n8n start ${new Date().toISOString()} WEBHOOK_URL=${WEBHOOK_URL} ---\n`);
	const child = spawn('n8n', ['start'], {
		env: { ...process.env, WEBHOOK_URL },
		detached: true,
		stdio: ['ignore', logFd, logFd],
	});
	child.unref();
	fs.writeFileSync(PID_FILE, String(child.pid));
	console.log(`n8n started (pid ${child.pid}), log: ${LOG_FILE}`);
}

const mode = process.argv[2] || 'reload';

if (mode === 'start') {
	stopN8n();
	startN8n();
} else if (mode === 'reload') {
	if (!fs.existsSync(PID_FILE)) {
		console.log('n8n dev process not running (no pid file) — skip reload');
		process.exit(0);
	}
	console.log('Reloading n8n after build...');
	stopN8n();
	startN8n();
} else if (mode === 'stop') {
	stopN8n();
	console.log('n8n stopped');
} else {
	console.error(`Unknown mode: ${mode}`);
	process.exit(1);
}
