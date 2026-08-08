'use strict';

/**
 * Shared SMTP helper for MailPlus trigger E2E fixtures.
 *
 * Host resolution order: SYNO_SMTP_HOST → hostname of SYNO_BASE_URL → 192.168.1.100
 * Mail domain: SYNO_MAIL_DOMAIN → registrable domain from SYNO_BASE_URL hostname
 * Mailbox user: SYNO_MAIL_USER → SYNO_ACCOUNT (only nas/khoa/fgc have MailPlus; other
 * addresses are catch-all to the nas mailbox)
 * Port: SYNO_SMTP_PORT (default 25).
 */
const { execFile } = require('child_process');

function resolveSmtp() {
	let host = (process.env.SYNO_SMTP_HOST || '').trim();
	if (!host && process.env.SYNO_BASE_URL) {
		try {
			host = new URL(process.env.SYNO_BASE_URL).hostname;
		} catch {
			/* ignore */
		}
	}
	if (!host) host = '192.168.1.100';
	const port = Number(process.env.SYNO_SMTP_PORT || 25);
	return { host, port };
}

/**
 * Registrable mail domain for fixture From/To addresses.
 * nas.megavn.net → megavn.net; override with SYNO_MAIL_DOMAIN.
 */
function resolveMailDomain() {
	const override = (process.env.SYNO_MAIL_DOMAIN || '').trim();
	if (override) return override;
	const base = (process.env.SYNO_BASE_URL || '').trim();
	if (!base) return 'example.com';
	try {
		const hostname = new URL(base).hostname.toLowerCase();
		if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname === 'localhost') {
			return 'local.test';
		}
		const parts = hostname.split('.').filter(Boolean);
		if (parts.length >= 3 && parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3) {
			return parts.slice(-3).join('.');
		}
		if (parts.length >= 2) return parts.slice(-2).join('.');
		return hostname;
	} catch {
		return 'example.com';
	}
}

/** DSM account that owns the MailPlus inbox under test (SYNO_MAIL_USER → SYNO_ACCOUNT). */
function resolveMailUser() {
	const override = (process.env.SYNO_MAIL_USER || '').trim();
	if (override) return override;
	const account = (process.env.SYNO_ACCOUNT || '').trim();
	return account || 'user';
}

/** Inbox address for the account under test (e.g. khoa@megavn.net). */
function mailboxAddress() {
	return `${resolveMailUser()}@${resolveMailDomain()}`;
}

/**
 * Build a fixture address. `user` / omitted local part → mailbox under test; any other
 * local part is used as-is (external senders, fgc@…, etc.).
 */
function mailAddress(localPart = 'user') {
	const user = (localPart || 'user').trim();
	if (user === 'user') return mailboxAddress();
	return `${user}@${resolveMailDomain()}`;
}

/**
 * @param {{ from: string, to?: string, subject: string, body?: string }} opts
 * @returns {Promise<string>}
 */
function sendTestEmail(opts) {
	const { host, port } = resolveSmtp();
	const from = opts.from;
	const to = opts.to || mailboxAddress();
	const subject = opts.subject;
	const body = opts.body || 'MailPlus E2E test body';
	const script = `
import smtplib
from email.mime.text import MIMEText
msg = MIMEText(${JSON.stringify(body)})
msg["Subject"] = ${JSON.stringify(subject)}
msg["From"] = ${JSON.stringify(from)}
msg["To"] = ${JSON.stringify(to)}
s = smtplib.SMTP(${JSON.stringify(host)}, ${port}, timeout=10)
s.sendmail(${JSON.stringify(from)}, [${JSON.stringify(to)}], msg.as_string())
s.quit()
print("sent")
`;
	return new Promise((resolve, reject) => {
		execFile('python3', ['-c', script], { timeout: 20000 }, (err, stdout, stderr) => {
			if (err) reject(new Error(`smtp ${host}:${port}: ${stderr || err.message}`));
			else resolve(stdout.trim());
		});
	});
}

module.exports = {
	resolveSmtp,
	resolveMailDomain,
	resolveMailUser,
	mailboxAddress,
	mailAddress,
	sendTestEmail,
};
