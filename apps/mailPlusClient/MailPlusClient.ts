import type { IDataObject, IN8nHttpFullResponse } from 'n8n-workflow';
import {
	MAIL_PLUS_CLIENT_SESSION,
	MAIL_PLUS_INFO_API,
	MAIL_PLUS_INFO_API_VERSION,
	MAIL_PLUS_THREAD_API,
	MAIL_PLUS_THREAD_API_VERSION,
	MAIL_PLUS_MESSAGE_API,
	MAIL_PLUS_MESSAGE_API_VERSION,
	MAIL_PLUS_MAILBOX_API,
	MAIL_PLUS_MAILBOX_API_VERSION,
	MAIL_PLUS_DRAFT_API,
	MAIL_PLUS_DRAFT_API_VERSION,
	MAIL_PLUS_ATTACHMENT_API,
	MAIL_PLUS_ATTACHMENT_API_VERSION,
	MAIL_PLUS_LABEL_API,
	MAIL_PLUS_LABEL_API_VERSION,
} from './constants';
import type {
	MailPlusClientInfo,
	Mailbox,
	ThreadSummary,
	MailMessage,
	ListThreadsInput,
	GetMessageInput,
	ListMailboxesInput,
	ListLabelsInput,
	CreateDraftInput,
	SendDraftInput,
	SetMessageReadInput,
	SetMessageStarInput,
	MoveMessageInput,
	SetThreadReadInput,
	ThreadLabelInput,
	DeleteThreadInput,
	MoveThreadInput,
	CreateLabelInput,
	UpdateLabelInput,
	CreateMailboxInput,
	UpdateMailboxInput,
	CreateSignatureInput,
	CreateReplyDraftInput,
} from './types';
import type { SynologyClient } from '../../transport/SynologyClient';

/**
 * MailPlus client wrapper. All APIs verified live on DSM 7 / MailPlus 3.x
 * (2026-08-06): session=MailClient, form-urlencoded + _sid + X-SYNO-TOKEN,
 * boolean/array/object params JSON-encoded as strings (like Note Station).
 */
export class MailPlusClient {
	constructor(private readonly synology: SynologyClient) {}

	/** Get MailPlus client info (uid, database_ready). */
	async getInfo(): Promise<MailPlusClientInfo> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_INFO_API,
			version: MAIL_PLUS_INFO_API_VERSION,
			method: 'getinfo',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: {},
		}, 'entry.cgi') as unknown as MailPlusClientInfo;
	}

	/** List threads in a mailbox. */
	async listThreads(input: ListThreadsInput): Promise<{ total: number; thread: ThreadSummary[] }> {
		const condition = [{ name: 'mailbox', value: String(input.mailboxId) }];
		if (input.from) condition.push({ name: 'from', value: input.from });
		if (input.label) condition.push({ name: 'label', value: input.label });
		const params: IDataObject = {
			condition: JSON.stringify(condition),
			offset: input.offset ?? 0,
			limit: input.limit ?? 200,
			additional: JSON.stringify(input.additional ?? []),
			conversation_view: true,
		};
		if (input.keyword) params.keyword = input.keyword;

		return await this.synology.requestPath({
			api: MAIL_PLUS_THREAD_API,
			version: MAIL_PLUS_THREAD_API_VERSION,
			method: 'list',
			session: MAIL_PLUS_CLIENT_SESSION,
			params,
		}, 'entry.cgi') as unknown as { total: number; thread: ThreadSummary[] };
	}

	/** Get full message content by message id. */
	async getMessage(input: GetMessageInput): Promise<{ message: MailMessage[] }> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_MESSAGE_API,
			version: MAIL_PLUS_MESSAGE_API_VERSION,
			method: 'get',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: {
				id: JSON.stringify([input.messageId]),
				additional: JSON.stringify(input.additional ?? ['blockquote', 'truncated']),
			},
		}, 'entry.cgi') as unknown as { message: MailMessage[] };
	}

	/** Download the raw original email (RFC822 source) as binary. */
	async downloadOriginal(messageId: number): Promise<IN8nHttpFullResponse> {
		return await this.synology.requestBinary({
			api: MAIL_PLUS_MESSAGE_API,
			version: MAIL_PLUS_MESSAGE_API_VERSION,
			method: 'download_original',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: messageId },
		});
	}

	/** List mailboxes. */
	async listMailboxes(input: ListMailboxesInput = {}): Promise<{ mailbox: Mailbox[] }> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_MAILBOX_API,
			version: MAIL_PLUS_MAILBOX_API_VERSION,
			method: 'list',
			session: MAIL_PLUS_CLIENT_SESSION,
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
			api: MAIL_PLUS_LABEL_API,
			version: MAIL_PLUS_LABEL_API_VERSION,
			method: 'list',
			session: MAIL_PLUS_CLIENT_SESSION,
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
		if (input.scheduleTime !== undefined && input.scheduleTime > 0) params.schedule_time = input.scheduleTime;

		return await this.synology.requestPath({
			api: MAIL_PLUS_DRAFT_API,
			version: MAIL_PLUS_DRAFT_API_VERSION,
			method: 'create',
			session: MAIL_PLUS_CLIENT_SESSION,
			params,
		}, 'entry.cgi');
	}

	/** Send a draft message. */
	async sendDraft(input: SendDraftInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_DRAFT_API,
			version: MAIL_PLUS_DRAFT_API_VERSION,
			method: 'send',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: input.draftId },
		}, 'entry.cgi');
	}

	/** Download a message attachment by id. */
	async downloadAttachment(attachmentId: string): Promise<IN8nHttpFullResponse> {
		return await this.synology.requestBinary({
			api: MAIL_PLUS_ATTACHMENT_API,
			version: MAIL_PLUS_ATTACHMENT_API_VERSION,
			method: 'download',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: attachmentId },
		});
	}

	/** Upload an attachment to a draft (multipart). Returns attachment id. */
	async uploadAttachment(draftId: number, filename: string, data: Buffer): Promise<IDataObject> {
		return await this.synology.requestMultipart(
			{
				api: MAIL_PLUS_ATTACHMENT_API,
				version: MAIL_PLUS_ATTACHMENT_API_VERSION,
				method: 'upload',
				session: MAIL_PLUS_CLIENT_SESSION,
				multipartPath: 'entry.cgi',
				authMode: 'cookie',
				params: {
					id: draftId,
					filename: JSON.stringify(filename),
				},
			},
			{ fieldName: 'file', filename, data, contentType: 'application/octet-stream' },
			{},
		);
	}

	/** Mark messages read/unread. */
	async setMessageRead(input: SetMessageReadInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_MESSAGE_API,
			version: MAIL_PLUS_MESSAGE_API_VERSION,
			method: 'set_read',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: JSON.stringify(input.messageIds), read: input.read },
		}, 'entry.cgi');
	}

	/** Star/unstar messages. */
	async setMessageStar(input: SetMessageStarInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_MESSAGE_API,
			version: MAIL_PLUS_MESSAGE_API_VERSION,
			method: 'set_star',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: JSON.stringify(input.messageIds), star: input.star ? 1 : 0 },
		}, 'entry.cgi');
	}

	/** Move messages to another mailbox. */
	async moveMessage(input: MoveMessageInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_MESSAGE_API,
			version: MAIL_PLUS_MESSAGE_API_VERSION,
			method: 'set_mailbox',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: JSON.stringify(input.messageIds), mailbox_id: input.mailboxId },
		}, 'entry.cgi');
	}

	/** Mark threads read/unread. */
	async setThreadRead(input: SetThreadReadInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_THREAD_API,
			version: MAIL_PLUS_THREAD_API_VERSION,
			method: 'set_read',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: JSON.stringify(input.threadIds), read: input.read, conversation_view: true },
		}, 'entry.cgi');
	}

	/** Add a label to threads. */
	async addThreadLabel(input: ThreadLabelInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_THREAD_API,
			version: MAIL_PLUS_THREAD_API_VERSION,
			method: 'add_label',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: JSON.stringify(input.threadIds), label_id: JSON.stringify([input.labelId]), conversation_view: true },
		}, 'entry.cgi');
	}

	/** Remove a label from threads. */
	async removeThreadLabel(input: ThreadLabelInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_THREAD_API,
			version: MAIL_PLUS_THREAD_API_VERSION,
			method: 'remove_label',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: JSON.stringify(input.threadIds), label_id: JSON.stringify([input.labelId]), conversation_view: true },
		}, 'entry.cgi');
	}

	/** Delete threads (move to trash of the given mailbox). */
	async deleteThread(input: DeleteThreadInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_THREAD_API,
			version: MAIL_PLUS_THREAD_API_VERSION,
			method: 'delete',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: JSON.stringify(input.threadIds), mailbox_id: input.mailboxId, conversation_view: true },
		}, 'entry.cgi');
	}

	/** Move threads between mailboxes. */
	async moveThread(input: MoveThreadInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_THREAD_API,
			version: MAIL_PLUS_THREAD_API_VERSION,
			method: 'set_mailbox',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: JSON.stringify(input.threadIds), mailbox_id: input.mailboxId, operate_mailbox_id: input.operateMailboxId, conversation_view: true },
		}, 'entry.cgi');
	}

	/** Create a label. Colors are hex WITHOUT '#' (e.g. ff0000). */
	async createLabel(input: CreateLabelInput): Promise<IDataObject> {
		const strip = (c: string) => c.replace(/^#/, '');
		return await this.synology.requestPath({
			api: MAIL_PLUS_LABEL_API,
			version: MAIL_PLUS_LABEL_API_VERSION,
			method: 'create',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { name: input.name, background_color: strip(input.backgroundColor), text_color: strip(input.textColor) },
		}, 'entry.cgi');
	}

	/** Update a label. */
	async updateLabel(input: UpdateLabelInput): Promise<IDataObject> {
		const strip = (c: string) => c.replace(/^#/, '');
		const params: IDataObject = { id: input.labelId };
		if (input.name !== undefined) params.name = input.name;
		if (input.backgroundColor !== undefined) params.background_color = strip(input.backgroundColor);
		if (input.textColor !== undefined) params.text_color = strip(input.textColor);
		return await this.synology.requestPath({
			api: MAIL_PLUS_LABEL_API,
			version: MAIL_PLUS_LABEL_API_VERSION,
			method: 'set',
			session: MAIL_PLUS_CLIENT_SESSION,
			params,
		}, 'entry.cgi');
	}

	/** Delete labels. */
	async deleteLabels(labelIds: number[]): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_LABEL_API,
			version: MAIL_PLUS_LABEL_API_VERSION,
			method: 'delete',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: JSON.stringify(labelIds) },
		}, 'entry.cgi');
	}

	/** Create a mailbox. */
	async createMailbox(input: CreateMailboxInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_MAILBOX_API,
			version: MAIL_PLUS_MAILBOX_API_VERSION,
			method: 'create',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { path: input.name, name: input.name },
		}, 'entry.cgi');
	}

	/** Rename a mailbox. */
	async updateMailbox(input: UpdateMailboxInput): Promise<IDataObject> {
		const params: IDataObject = { id: input.mailboxId, conversation_view: input.conversationView ?? true };
		if (input.name !== undefined) params.path = input.name;
		return await this.synology.requestPath({
			api: MAIL_PLUS_MAILBOX_API,
			version: MAIL_PLUS_MAILBOX_API_VERSION,
			method: 'set',
			session: MAIL_PLUS_CLIENT_SESSION,
			params,
		}, 'entry.cgi');
	}

	/** Delete a mailbox. */
	async deleteMailbox(mailboxId: number): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: MAIL_PLUS_MAILBOX_API,
			version: MAIL_PLUS_MAILBOX_API_VERSION,
			method: 'delete',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: JSON.stringify([mailboxId]), conversation_view: true },
		}, 'entry.cgi');
	}

	/** List signatures. */
	async listSignatures(): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: 'SYNO.MailClient.Signature',
			version: 1,
			method: 'list',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: {},
		}, 'entry.cgi');
	}

	/** Create a signature. */
	async createSignature(input: CreateSignatureInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: 'SYNO.MailClient.Signature',
			version: 1,
			method: 'create',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { name: input.name, content: input.content, is_default: JSON.stringify(input.isDefault ?? false) },
		}, 'entry.cgi');
	}

	/** Delete signatures. */
	async deleteSignatures(signatureIds: number[]): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: 'SYNO.MailClient.Signature',
			version: 1,
			method: 'delete',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: { id: JSON.stringify(signatureIds) },
		}, 'entry.cgi');
	}

	/** Create a reply or forward draft. draftType: 1=reply, 2=forward. */
	async createReplyDraft(input: CreateReplyDraftInput): Promise<IDataObject> {
		const params: IDataObject = {
			from: input.from,
			to: JSON.stringify(input.to),
			subject: input.subject,
			body: input.body,
			refer_to: input.referTo,
			draft_type: input.draftType,
			enable_read_request: false,
			enable_delivery_request: false,
		};
		if (input.cc) params.cc = JSON.stringify(input.cc);
		if (input.bcc) params.bcc = JSON.stringify(input.bcc);
		return await this.synology.requestPath({
			api: MAIL_PLUS_DRAFT_API,
			version: MAIL_PLUS_DRAFT_API_VERSION,
			method: 'create',
			session: MAIL_PLUS_CLIENT_SESSION,
			params,
		}, 'entry.cgi');
	}

	/** List email filters (rules). */
	async listFilters(): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: 'SYNO.MailClient.Filter',
			version: 3,
			method: 'list',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: {},
		}, 'entry.cgi');
	}

	/** List SMTP accounts. */
	async listSmtpAccounts(): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: 'SYNO.MailClient.Setting.SMTP',
			version: 2,
			method: 'list',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: {},
		}, 'entry.cgi');
	}

	/** List mail templates. */
	async listMailTemplates(): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: 'SYNO.MailClient.MailTemplate',
			version: 1,
			method: 'list',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: {},
		}, 'entry.cgi');
	}

	/** List mail merge tasks. */
	async listMailMerges(): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: 'SYNO.MailClient.MailMerge',
			version: 1,
			method: 'list',
			session: MAIL_PLUS_CLIENT_SESSION,
			params: {},
		}, 'entry.cgi');
	}
}
