import type { IDataObject } from 'n8n-workflow';
import {
	CHAT_BOT_API,
	CHAT_BOT_API_VERSION,
	CHAT_CHANNEL_ANONYMOUS_API,
	CHAT_CHANNEL_ANONYMOUS_API_VERSION,
	CHAT_CHANNEL_API,
	CHAT_CHANNEL_API_VERSION,
	CHAT_CHANNEL_NAMED_API,
	CHAT_CHATBOT_API,
	CHAT_CHATBOT_API_VERSION,
	CHAT_POST_API,
	CHAT_POST_API_VERSION,
	CHAT_SESSION,
	CHAT_WEBHOOK_API_VERSION,
	CHAT_WEBHOOK_INCOMING_API,
	CHAT_WEBHOOK_OUTGOING_API,
} from './constants';
import type {
	Chatbot,
	ChatChannel,
	ChatPost,
	ChatUser,
	CreateChatbotInput,
	CreateWebhookInput,
	IncomingWebhook,
	ListPostsInput,
} from './types';
import { CHAT_POST_TYPE_NORMAL } from './types';
import type { SynologyClient } from '../../transport/SynologyClient';

/**
 * Synology Chat wrapper. Verified live on DSM 7 / Chat 2.4.6-22200
 * (2026-08-06).
 *
 * Session APIs log in with session=Chat and send _sid + X-SYNO-TOKEN.
 */
export class ChatClient {
	constructor(private readonly synology: SynologyClient) {}

	/**
	 * Create an incoming webhook and bind it to a channel.
	 * Required sequence (verified): create -> set channel -> Bot.set nickname
	 * (without a nickname the bot is "not legal" and cannot send) -> enable.
	 */
	async createWebhook(input: CreateWebhookInput): Promise<{ token: string; user_id: number }> {
		const created = await this.synology.request<IDataObject>({
			api: CHAT_WEBHOOK_INCOMING_API,
			version: CHAT_WEBHOOK_API_VERSION,
			method: 'create',
			session: CHAT_SESSION,
			params: {},
		}) as unknown as { token: string; user_id: number };

		await this.synology.request({
			api: CHAT_WEBHOOK_INCOMING_API,
			version: CHAT_WEBHOOK_API_VERSION,
			method: 'set',
			session: CHAT_SESSION,
			params: { user_id: created.user_id, channel_id: input.channelId },
		});

		await this.setBotProfile(created.user_id, input.nickname);
		await this.enableBot(created.user_id);

		return created;
	}

	/** Set an incoming webhook's channel + nickname. */
	async setWebhook(userId: number, channelId?: number, nickname?: string): Promise<IDataObject> {
		const params: IDataObject = { user_id: userId };
		if (channelId !== undefined) params.channel_id = channelId;
		if (nickname !== undefined) params.nickname = nickname;
		return await this.synology.request({
			api: CHAT_WEBHOOK_INCOMING_API,
			version: CHAT_WEBHOOK_API_VERSION,
			method: 'set',
			session: CHAT_SESSION,
			params,
		});
	}

	/**
	 * Create an outgoing webhook (bound later via setOutgoingWebhook).
	 * Returns {token, user_id}.
	 */
	async createOutgoingWebhook(): Promise<{ token: string; user_id: number }> {
		return await this.synology.request<IDataObject>({
			api: CHAT_WEBHOOK_OUTGOING_API,
			version: CHAT_WEBHOOK_API_VERSION,
			method: 'create',
			session: CHAT_SESSION,
			params: {},
		}) as unknown as { token: string; user_id: number };
	}

	/** Configure an outgoing webhook: channel (0 = any), trigger word, destination URL. */
	async setOutgoingWebhook(userId: number, channelId: number, triggerWord: string, url: string, nickname?: string): Promise<IDataObject> {
		await this.synology.request({
			api: CHAT_WEBHOOK_OUTGOING_API,
			version: CHAT_WEBHOOK_API_VERSION,
			method: 'set',
			session: CHAT_SESSION,
			params: { user_id: userId, channel_id: channelId, trigger_word: triggerWord, url },
		});
		if (nickname) {
			await this.setBotProfile(userId, nickname);
		}
		await this.enableBot(userId);
		return { success: true };
	}

	/** List outgoing webhooks (session required). */
	async listOutgoingWebhooks(): Promise<IDataObject[]> {
		const data = await this.synology.request<IDataObject>({
			api: CHAT_WEBHOOK_OUTGOING_API,
			version: CHAT_WEBHOOK_API_VERSION,
			method: 'list',
			session: CHAT_SESSION,
			params: {},
		}) as unknown as { webhook_outgoings: IDataObject[] };
		return data.webhook_outgoings ?? [];
	}

	/** Get an outgoing webhook by bot user id (returns token). */
	async getOutgoingWebhook(userId: number): Promise<IDataObject> {
		return await this.synology.request<IDataObject>({
			api: CHAT_WEBHOOK_OUTGOING_API,
			version: CHAT_WEBHOOK_API_VERSION,
			method: 'get',
			session: CHAT_SESSION,
			params: { user_id: userId },
		});
	}

	/** List incoming webhooks (session required). */
	async listWebhooks(): Promise<IncomingWebhook[]> {
		const data = await this.synology.request<IDataObject>({
			api: CHAT_WEBHOOK_INCOMING_API,
			version: CHAT_WEBHOOK_API_VERSION,
			method: 'list',
			session: CHAT_SESSION,
			params: {},
		}) as unknown as { webhook_incomings: IncomingWebhook[] };
		return data.webhook_incomings ?? [];
	}

	/** Get a single incoming webhook by bot user id (returns token). */
	async getWebhook(userId: number): Promise<IncomingWebhook> {
		return await this.synology.request<IDataObject>({
			api: CHAT_WEBHOOK_INCOMING_API,
			version: CHAT_WEBHOOK_API_VERSION,
			method: 'get',
			session: CHAT_SESSION,
			params: { user_id: userId },
		}) as unknown as IncomingWebhook;
	}

	/** Set a bot's profile (nickname/purpose/etc). Bots without a nickname are "not legal". */
	async setBotProfile(userId: number, nickname: string, extra?: Record<string, unknown>): Promise<IDataObject> {
		return await this.synology.request({
			api: CHAT_BOT_API,
			version: CHAT_BOT_API_VERSION,
			method: 'set',
			session: CHAT_SESSION,
			params: { user_id: userId, nickname, ...(extra ?? {}) },
		});
	}

	/** Enable a bot (required for sending). */
	async enableBot(userId: number): Promise<IDataObject> {
		return await this.synology.request({
			api: CHAT_BOT_API,
			version: CHAT_BOT_API_VERSION,
			method: 'enable',
			session: CHAT_SESSION,
			params: { user_id: userId },
		});
	}

	/** Disable a bot without deleting it (used when republishing workflows). */
	async disableBot(userId: number): Promise<IDataObject> {
		return await this.synology.request({
			api: CHAT_BOT_API,
			version: CHAT_BOT_API_VERSION,
			method: 'disable',
			session: CHAT_SESSION,
			params: { user_id: userId },
		});
	}

	/** Delete a bot (real_delete=true removes it permanently). */
	async deleteBot(userId: number): Promise<IDataObject> {
		return await this.synology.request({
			api: CHAT_BOT_API,
			version: CHAT_BOT_API_VERSION,
			method: 'delete',
			session: CHAT_SESSION,
			params: { user_id: userId, real_delete: true },
		});
	}

	/** Create a chatbot (max 5 per user). Returns token + user_id. */
	async createChatbot(input: CreateChatbotInput): Promise<{ token: string; user_id: number }> {
		const created = await this.synology.request<IDataObject>({
			api: CHAT_CHATBOT_API,
			version: CHAT_CHATBOT_API_VERSION,
			method: 'create',
			session: CHAT_SESSION,
			params: { nickname: input.nickname },
		}) as unknown as { token: string; user_id: number };

		const extra: Record<string, unknown> = {};
		if (input.purpose !== undefined) extra.purpose = input.purpose;
		if (input.welcomeNote !== undefined) extra.welcome_note = input.welcomeNote;
		if (input.hideFromUser !== undefined) extra.hide_from_user = input.hideFromUser;
		if (Object.keys(extra).length > 0) {
			await this.synology.request({
				api: CHAT_CHATBOT_API,
				version: CHAT_CHATBOT_API_VERSION,
				method: 'set',
				session: CHAT_SESSION,
				params: { user_id: created.user_id, ...extra },
			});
		}

		return created;
	}

	/** List chatbots (session required). */
	async listChatbots(): Promise<Chatbot[]> {
		const data = await this.synology.request<IDataObject>({
			api: CHAT_CHATBOT_API,
			version: CHAT_CHATBOT_API_VERSION,
			method: 'list',
			session: CHAT_SESSION,
			params: {},
		}) as unknown as { chatbots: Chatbot[] };
		return data.chatbots ?? [];
	}

	/** Get a chatbot by user id (returns token). */
	async getChatbot(userId: number): Promise<Chatbot> {
		return await this.synology.request<IDataObject>({
			api: CHAT_CHATBOT_API,
			version: CHAT_CHATBOT_API_VERSION,
			method: 'get',
			session: CHAT_SESSION,
			params: { user_id: userId },
		}) as unknown as Chatbot;
	}

	/** Update a chatbot's fields. */
	async setChatbot(userId: number, input: Partial<CreateChatbotInput>): Promise<IDataObject> {
		const params: IDataObject = { user_id: userId };
		if (input.nickname !== undefined) params.nickname = input.nickname;
		if (input.purpose !== undefined) params.purpose = input.purpose;
		if (input.welcomeNote !== undefined) params.welcome_note = input.welcomeNote;
		if (input.hideFromUser !== undefined) params.hide_from_user = input.hideFromUser;
		return await this.synology.request({
			api: CHAT_CHATBOT_API,
			version: CHAT_CHATBOT_API_VERSION,
			method: 'set',
			session: CHAT_SESSION,
			params,
		});
	}

	/** List channels (session required). */
	async listChannels(): Promise<ChatChannel[]> {
		const data = await this.synology.request<IDataObject>({
			api: CHAT_CHANNEL_API,
			version: CHAT_CHANNEL_API_VERSION,
			method: 'list',
			session: CHAT_SESSION,
			params: {},
		}) as unknown as { channels: ChatChannel[] };
		return data.channels ?? [];
	}

	/** Get a channel by id (session required). */
	async getChannel(channelId: number): Promise<ChatChannel> {
		const data = await this.synology.request<IDataObject>({
			api: CHAT_CHANNEL_API,
			version: 4,
			method: 'get',
			session: CHAT_SESSION,
			params: { channel_id: channelId },
		}) as unknown as { channel: ChatChannel };
		return data.channel as ChatChannel;
	}

	/**
	 * Create a named channel (session required).
	 * Note: only 'private' type works via API for encrypted channels —
	 * 'public' fails with 422 'public cannot encrypt' because the server
	 * tries to encrypt the channel key for every user, many of whom have
	 * no E2E keypair. Members are NOT passed here (server rejects
	 * member_ids with 119) — invite them separately afterwards.
	 */
	async createChannel(name: string, type: 'public' | 'private', encrypted?: boolean): Promise<IDataObject> {
		const params: IDataObject = { name, type, purpose: '' };
		if (encrypted) params.encrypted = true;
		return await this.synology.request({
			api: CHAT_CHANNEL_NAMED_API,
			version: CHAT_CHANNEL_API_VERSION,
			method: 'create',
			session: CHAT_SESSION,
			params,
		});
	}

	/** List posts in a channel (session required). */
	async listPosts(input: ListPostsInput): Promise<{ posts: ChatPost[]; total?: number }> {
		const params: IDataObject = {
			channel_id: input.channelId,
			offset: input.offset ?? 0,
			limit: input.limit ?? 50,
		};
		return await this.synology.request<IDataObject>({
			api: CHAT_POST_API,
			version: CHAT_POST_API_VERSION,
			method: 'list',
			session: CHAT_SESSION,
			params,
		}) as unknown as { posts: ChatPost[]; total?: number };
	}

	/**
	 * Send a message to a channel as the logged-in DSM user.
	 *
	 * Uses the session API SYNO.Chat.Post.create (v5) exactly like the web
	 * client does — no incoming webhook token and no bot are involved, so the
	 * post appears as a normal user message (verified live 2026-08-07).
	 */
	async sendAsUser(channelId: number, message: string): Promise<IDataObject> {
		return await this.synology.request<IDataObject>({
			api: CHAT_POST_API,
			version: CHAT_POST_API_VERSION,
			method: 'create',
			session: CHAT_SESSION,
			params: {
				channel_id: channelId,
				type: CHAT_POST_TYPE_NORMAL,
				message,
				conn_id: `n8n-${Date.now().toString(16)}`,
				is_thread: 'false',
			},
		});
	}

	/**
	 * Resolve the 1-to-1 (direct message) channel between the logged-in user
	 * and another user. Returns the existing anonymous channel when present,
	 * otherwise creates it via SYNO.Chat.Channel.Anonymous.initiate (v2) with
	 * the full member list, matching the web client behaviour.
	 */
	async resolveDirectChannel(targetUserId: number): Promise<ChatChannel> {
		const channels = await this.listChannels();
		const existing = channels.find((channel) => {
			const members = Array.isArray(channel.members) ? (channel.members as unknown[]).map(Number) : [];
			return channel.type === 'anonymous' && members.includes(targetUserId) && members.length === 2;
		});
		if (existing) return existing;

		const created = await this.synology.request<IDataObject>({
			api: CHAT_CHANNEL_ANONYMOUS_API,
			version: CHAT_CHANNEL_ANONYMOUS_API_VERSION,
			method: 'initiate',
			session: CHAT_SESSION,
			params: { user_ids: [targetUserId], encrypted: false },
		}) as unknown as ChatChannel;
		return created;
	}

	/** List users (session required). */
	async listUsers(): Promise<ChatUser[]> {
		const data = await this.synology.request<IDataObject>({
			api: 'SYNO.Chat.User',
			version: 2,
			method: 'list',
			session: CHAT_SESSION,
			params: {},
		}) as unknown as { users: ChatUser[] };
		return data.users ?? [];
	}
}
