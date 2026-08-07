/** Types for the Synology Chat client. */

export interface IncomingWebhook {
	[prop: string]: unknown;
	app_id: number;
	bot_type: string;
	channel_id: number;
	create_at: number;
	creator_id: number;
	deleted: boolean;
	is_disabled: boolean;
	nickname: string;
	token?: string;
	type: string;
	user_id: number;
}

export interface Chatbot {
	[prop: string]: unknown;
	app_id: number;
	bot_type: string;
	chatbot_props?: {
		hide_from_user?: boolean;
		purpose?: string;
		welcome_note?: string;
	};
	create_at: number;
	creator_id: number;
	delete_at?: number;
	is_disabled: boolean;
	nickname: string;
	token?: string;
	user_id: number;
}

export interface ChatChannel {
	[prop: string]: unknown;
	channel_id: number;
	name?: string;
	type?: string;
	members?: unknown[];
}

export interface ChatUser {
	[prop: string]: unknown;
	user_id: number;
	username?: string;
	nickname?: string;
	type?: string;
	user_props?: {
		email?: string;
		description?: string;
	};
}

export interface ChatPost {
	[prop: string]: unknown;
	channel_id: number;
	comment_count: number;
	create_at: number;
	creator_id: number;
	id: number;
	message: string;
	post_id: number;
}

export interface SendMessageInput {
	token: string;
	text?: string;
	fileUrl?: string;
	userIds?: number[];
	channelIds?: number[];
	attachments?: unknown[];
}

export interface CreateWebhookInput {
	channelId: number;
	nickname: string;
}

export interface CreateChatbotInput {
	nickname: string;
	purpose?: string;
	welcomeNote?: string;
	hideFromUser?: boolean;
}

export interface ListPostsInput {
	channelId: number;
	offset?: number;
	limit?: number;
}

/** Post type for Post.create v5 (matches Chat UI POST_TYPE.normal). */
export const CHAT_POST_TYPE_NORMAL = 'normal';
