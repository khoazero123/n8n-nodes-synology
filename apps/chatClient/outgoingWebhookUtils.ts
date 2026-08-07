import type { IDataObject, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** Whether an outgoing webhook on Synology already matches the trigger node settings. */
export function outgoingWebhookConfigMatches(
	webhook: IDataObject,
	channelId: number,
	triggerWord: string,
	url: string,
): boolean {
	return (
		webhook.url === url
		&& Number(webhook.channel_id) === channelId
		&& String(webhook.trigger_word ?? '') === triggerWord
	);
}

/** True when Synology reports the bot as disabled. */
export function isOutgoingWebhookDisabled(webhook: IDataObject): boolean {
	return webhook.is_disabled === true || webhook.is_disabled === 1;
}

/** Synology requires a trigger word when listening on any channel (channel_id 0). */
export function assertTriggerWordForAnyChannel(node: INode, channelId: number, triggerWord: string): void {
	if (channelId === 0 && !triggerWord.trim()) {
		throw new NodeOperationError(node, 'Trigger Word is required when Channel is set to Any Channel.');
	}
}

/** Merge Synology Chat outgoing-webhook payload fields from body, form, and query. */
export function mergeOutgoingWebhookPayload(...sources: unknown[]): IDataObject {
	const merged: IDataObject = {};
	for (const source of sources) {
		if (typeof source !== 'object' || source === null || Array.isArray(source)) continue;
		for (const [key, value] of Object.entries(source)) {
			if (merged[key] === undefined && value !== undefined) merged[key] = value;
		}
	}
	return merged;
}

/** Normalize Synology Chat outgoing-webhook POST (usually form-urlencoded). */
export function normalizeOutgoingWebhookPayload(raw: IDataObject): IDataObject {
	return {
		...raw,
		channel_id: raw.channel_id !== undefined && raw.channel_id !== '' ? Number(raw.channel_id) : raw.channel_id,
		user_id: raw.user_id !== undefined && raw.user_id !== '' ? Number(raw.user_id) : raw.user_id,
		text: String(raw.text ?? raw.message ?? raw.content ?? ''),
		trigger_word: String(raw.trigger_word ?? raw.triggerWord ?? ''),
	};
}

/** Whether the message text matches the configured trigger-word prefix filter. */
export function outgoingWebhookTextMatches(triggerWord: string, text: string): boolean {
	const prefix = triggerWord.trim();
	if (!prefix) return true;
	return text.trimStart().startsWith(prefix);
}
