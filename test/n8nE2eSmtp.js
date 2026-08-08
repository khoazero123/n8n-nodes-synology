'use strict';

/**
 * Shared SMTP helper for MailPlus trigger E2E fixtures.
 *
 * Host resolution order: SYNO_SMTP_HOST → hostname of SYNO_BASE_URL → 192.168.1.100
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
 * @param {{ from: string, to?: string, subject: string, body?: string }} opts
 * @returns {Promise<string>}
 */
function sendTestEmail(opts) {
	const { host, port } = resolveSmtp();
	const from = opts.from;
	const to = opts.to || 'user@example.com';
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
	sendTestEmail,
};
