import type { IDataObject } from 'n8n-workflow';
import type { ChatClient } from './ChatClient';
import type { IncomingWebhook } from './types';

/** Whether an incoming webhook on Synology already matches the node settings. */
export function incomingWebhookConfigMatches(
	webhook: IncomingWebhook | IDataObject,
	channelId: number,
	nickname: string,
): boolean {
	return (
		Number(webhook.channel_id) === channelId
		&& String(webhook.nickname ?? '') === nickname
	);
}

/** True when Synology reports the incoming webhook bot as disabled. */
export function isIncomingWebhookDisabled(webhook: IncomingWebhook | IDataObject): boolean {
	return webhook.is_disabled === true || webhook.is_disabled === 1;
}

/**
 * Find or create an incoming webhook bound to a channel and return its token.
 * Persists bot user_id in workflow static data for subsequent runs.
 */
export async function ensureIncomingWebhookToken(
	chat: ChatClient,
	staticData: IDataObject,
	channelId: number,
	nickname: string,
): Promise<string> {
	const configuredId = staticData.synologyChatIncomingWebhookId as number | undefined;
	const webhooks = await chat.listWebhooks();

	let match: IncomingWebhook | undefined = configuredId !== undefined
		? webhooks.find((item) => Number(item.user_id) === configuredId)
		: undefined;
	if (!match) {
		match = webhooks.find((item) =>
			Number(item.channel_id) === channelId && String(item.nickname ?? '') === nickname,
		);
	}

	if (!match) {
		const created = await chat.createWebhook({ channelId, nickname });
		staticData.synologyChatIncomingWebhookId = created.user_id;
		return created.token;
	}

	const userId = Number(match.user_id);
	if (!incomingWebhookConfigMatches(match, channelId, nickname)) {
		await chat.setWebhook(userId, channelId, nickname);
		await chat.enableBot(userId);
	} else if (isIncomingWebhookDisabled(match)) {
		await chat.enableBot(userId);
	}

	staticData.synologyChatIncomingWebhookId = userId;

	if (match.token) return match.token;
	const full = await chat.getWebhook(userId);
	if (!full.token) throw new Error(`Incoming webhook ${userId} has no token`);
	return full.token;
}
