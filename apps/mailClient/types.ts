export interface MailClientInfo {
	database_ready: boolean;
	uid: number;
	compatibility_version?: string;
}

export interface Mailbox {
	id: number;
	path: string;
	owner: string;
	subscribed: boolean;
	my_permission: string;
	has_expired?: boolean;
	is_own?: boolean;
	owner_valid?: boolean;
	additional?: {
		permission?: unknown[];
		unread_count?: number;
		total_count?: number;
		draft_total_count?: number;
	};
}

export interface ThreadSummary {
	id: number;
	from?: string;
	email?: string;
	subject?: string;
	body_preview?: string;
	arrival_time?: number;
	last_modified?: number;
	unread?: boolean;
	starred?: boolean;
	has_attachment?: boolean;
	label?: unknown[];
	message?: MessageSummary[];
	[key: string]: unknown;
}

export interface MessageSummary {
	id: number;
	from?: string;
	email?: string;
	subject?: string;
	body_preview?: string;
	arrival_time?: number;
	attachment?: unknown[];
	[label: string]: unknown;
}

export interface MailMessage {
	id: number;
	from?: string;
	email?: string;
	subject?: string;
	body?: {
		html?: string;
		plain?: string;
		truncated?: boolean;
	};
	to?: unknown[];
	cc?: unknown[];
	bcc?: unknown[];
	attachment?: unknown[];
	arrival_time?: number;
	starred?: boolean;
	unread?: boolean;
	[label: string]: unknown;
}

export interface ListThreadsInput {
	mailboxId: number;
	offset?: number;
	limit?: number;
	additional?: string[];
	keyword?: string;
	from?: string;
	label?: string;
}

export interface GetMessageInput {
	messageId: number;
	additional?: string[];
}

export interface ListMailboxesInput {
	subscription?: boolean;
	additional?: string[];
}

export interface ListLabelsInput {
	additional?: string[];
}

export interface CreateDraftInput {
	from?: string;
	to?: string[];
	cc?: string[];
	bcc?: string[];
	subject?: string;
	body?: string;
	mailbox_id?: number;
	attachments?: unknown[];
	/** Epoch seconds to schedule send (0 = send immediately). */
	scheduleTime?: number;
}

export interface SendDraftInput {
	draftId: number;
}

export interface SetMessageReadInput {
	messageIds: number[];
	read: boolean;
}

export interface SetMessageStarInput {
	messageIds: number[];
	star: boolean;
}

export interface MoveMessageInput {
	messageIds: number[];
	mailboxId: number;
}

export interface SetThreadReadInput {
	threadIds: number[];
	read: boolean;
}

export interface ThreadLabelInput {
	threadIds: number[];
	labelId: number;
}

export interface DeleteThreadInput {
	threadIds: number[];
	mailboxId: number;
}

export interface MoveThreadInput {
	threadIds: number[];
	mailboxId: number;
	operateMailboxId: number;
}

export interface CreateLabelInput {
	name: string;
	backgroundColor: string;
	textColor: string;
}

export interface UpdateLabelInput {
	labelId: number;
	name?: string;
	backgroundColor?: string;
	textColor?: string;
}

export interface CreateMailboxInput {
	name: string;
	conversationView?: boolean;
}

export interface UpdateMailboxInput {
	mailboxId: number;
	name?: string;
	conversationView?: boolean;
}

export interface CreateSignatureInput {
	name: string;
	content: string;
	isDefault?: boolean;
}

export interface CreateReplyDraftInput {
	from: string;
	to: string[];
	subject: string;
	body: string;
	referTo: number;
	draftType: 1 | 2; // 1=reply, 2=forward
	cc?: string[];
	bcc?: string[];
}
