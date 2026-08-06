import type { IDataObject, IN8nHttpFullResponse } from 'n8n-workflow';
import {
	MAIL_CLIENT_SESSION,
	MAIL_INFO_API,
	MAIL_INFO_API_VERSION,
	MAIL_THREAD_API,
	MAIL_THREAD_API_VERSION,
	MAIL_MESSAGE_API,
	MAIL_MESSAGE_API_VERSION,
	MAIL_MAILBOX_API,
	MAIL_MAILBOX_API_VERSION,
	MAIL_DRAFT_API,
	MAIL_DRAFT_API_VERSION,
	MAIL_ATTACHMENT_API,
	MAIL_ATTACHMENT_API_VERSION,
	MAIL_LABEL_API,
	MAIL_LABEL_API_VERSION,
} from './constants';
import type {
	MailClientInfo,
	Mailbox,
	ThreadSummary,
	MailMessage,
	ListThreadsInput,
	GetMessageInput,
	ListMailboxesInput,
	ListLabelsInput,
	CreateDraftInput,
	SendDraftInput,
} from './types';
import type { SynologyClient } from '../../transport/SynologyClient';

/**
 * MailClient wrapper. All APIs verified live on DSM 7 / MailPlus 3.x
 * (2026-08-06): session=MailClient, form-urlencoded + _sid + X-SYNO-TOKEN,
 * boolean/array/object params JSON-encoded as strings (like Note Station).
 */
export class MailClientClient {
	constructor(private readonly synology: SynologyClient) {}

	/** Get MailClient info (uid, database_ready). */
	async getInfo(): Promise<MailClientInfo> {
		return await this.synology.requestPath({
			api: MAIL_INFO_API,
			version: MAIL_INFO_API_VERSION,
			method: 'getinfo',
			session: MAIL_CLIENT_SESSION,
			params: {},
		}, 'entry.cgi') as unknown as MailClientInfo;
	}

	/** List threads in a mailbox. */
	async listThreads(input: ListThreadsInput): Promise<{ total: number; thread: ThreadSummary[] }> {
		const condition = [{ name: 'mailbox', value: String(input.mailboxId) }];
		const params: IDataObject = {
			condition: JSON.stringify(condition),
			offset: input.offset ?? 0,
			limit: input.limit ?? 200,
			additional: JSON.stringify(input.additional ?? []),
			conversation_view: true,
		};
		if (input.keyword) params.keyword = input.keyword;
		if (input.from) condition.push({ name: 'from', value: input.from });

		return await this.synology.requestPath({
			api: MAIL_THREAD_API,
			version: MAIL_THREAD_API_VERSION,
			method: 'list',
			session: MAIL_CLIENT_SESSION,
			params,
		}, 'entry.cgi') as unknown as { total: number; thread: ThreadSummary[] };
	}

	/** Get full message content by message id. */
	async getMessage(input: GetMessageInput): Promise<{ message: MailMessage[] }> {
		return await this.synology.requestPath({
			api: MAIL_MESSAGE_API,
			version: MAIL_MESSAGE_API_VERSION,
			method: 'get',
			session: MAIL_CLIENT_SESSION,
			params: {
				id: JSON.stringify([input.messageId]),
				additional: JSON.stringify(input.additional ?? ['blockquote', 'truncated']),
			},
		}, 'entry.cgi') as unknown as { message: MailMessage[] };
	}

	/** Download the raw original email (RFC822 source) as binary. */
	async downloadOriginal(messageId: number): Promise<IN8nHttpFullResponse> {
		return await this.synology.requestBinary({
			api: MAIL_MESSAGE_API,
			version: MAIL_MESSAGE_API_VERSION,
			method: 'download_original',
			session: MAIL_CLIENT_SESSION,
			params: { id: messageId },
		});
	}

	/** List mailboxes. */
	async listMailboxes(input: ListMailboxesInput = {}): Promise<{ mailbox: Mailbox[] }> {
		return await this.synology.requestPath({
			api: MAIL_MAILBOX_API,
			version: MAIL_MAILBOX_API_VERSION,
			method: 'list',
			session: MAIL_CLIENT_SESSION,
			params: {
				subscription: input.subscription ?? false,
				additional: JSON.stringify(input.additional ?? ['unread_count', 'draft_total_count']),
				conversation_view: true,
			},
		}, 'entry.cgi') as unknown as { mailbox: Mailbox[] };
	}

	/** List labels. */
	async listLabels(input: ListLabelsInput = {}): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_LABEL_API,
			version: MAIL_LABEL_API_VERSION,
			method: 'list',
			session: MAIL_CLIENT_SESSION,
			params: {
				additional: JSON.stringify(input.additional ?? ['unread_count']),
				conversation_view: true,
			},
		}, 'entry.cgi');
	}

	/** Create a draft message. */
	async createDraft(input: CreateDraftInput): Promise<IDataObject> {
		const params: IDataObject = {
			enable_read_request: false,
			enable_delivery_request: false,
		};
		if (input.from) params.from = input.from;
		if (input.to) params.to = JSON.stringify(input.to);
		if (input.cc) params.cc = JSON.stringify(input.cc);
		if (input.bcc) params.bcc = JSON.stringify(input.bcc);
		if (input.subject !== undefined) params.subject = input.subject;
		if (input.body !== undefined) params.body = input.body;
		if (input.mailbox_id !== undefined) params.mailbox_id = input.mailbox_id;
		if (input.attachments) params.attachments = JSON.stringify(input.attachments);

		return await this.synology.requestPath({
			api: MAIL_DRAFT_API,
			version: MAIL_DRAFT_API_VERSION,
			method: 'create',
			session: MAIL_CLIENT_SESSION,
			params,
		}, 'entry.cgi');
	}

	/** Send a draft message. */
	async sendDraft(input: SendDraftInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_DRAFT_API,
			version: MAIL_DRAFT_API_VERSION,
			method: 'send',
			session: MAIL_CLIENT_SESSION,
			params: { id: input.draftId },
		}, 'entry.cgi');
	}

	/** Download a message attachment by id. */
	async downloadAttachment(attachmentId: string): Promise<IN8nHttpFullResponse> {
		return await this.synology.requestBinary({
			api: MAIL_ATTACHMENT_API,
			version: MAIL_ATTACHMENT_API_VERSION,
			method: 'download',
			session: MAIL_CLIENT_SESSION,
			params: { id: attachmentId },
		});
	}
}
