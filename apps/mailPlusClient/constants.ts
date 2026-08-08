/** DSM login session name for MailPlus user APIs (not the legacy Synology Mail app). */
export const MAIL_PLUS_CLIENT_SESSION = 'MailClient';

// MailPlus user APIs (official SYNO.MailClient.* paths, verified live 2026-08-06)
export const MAIL_PLUS_INFO_API = 'SYNO.MailClient.Info';
export const MAIL_PLUS_INFO_API_VERSION = 5;
export const MAIL_PLUS_THREAD_API = 'SYNO.MailClient.Thread';
export const MAIL_PLUS_THREAD_API_VERSION = 10;
export const MAIL_PLUS_MESSAGE_API = 'SYNO.MailClient.Message';
export const MAIL_PLUS_MESSAGE_API_VERSION = 10;
export const MAIL_PLUS_MAILBOX_API = 'SYNO.MailClient.Mailbox';
export const MAIL_PLUS_MAILBOX_API_VERSION = 7;
export const MAIL_PLUS_DRAFT_API = 'SYNO.MailClient.Draft';
export const MAIL_PLUS_DRAFT_API_VERSION = 6;
export const MAIL_PLUS_ATTACHMENT_API = 'SYNO.MailClient.Attachment';
export const MAIL_PLUS_ATTACHMENT_API_VERSION = 8;
export const MAIL_PLUS_LABEL_API = 'SYNO.MailClient.Label';
export const MAIL_PLUS_LABEL_API_VERSION = 3;

// Built-in MailPlus mailbox ids (-1=inbox, -2=archived, -3=drafts, -4=sent, -5=spam, -6=trash, -7=scheduled)
export const MAIL_PLUS_MAILBOX_ID_MAP: Record<string, number> = {
	inbox: -1,
	archived: -2,
	drafts: -3,
	sent: -4,
	spam: -5,
	trash: -6,
	scheduled: -7,
};
