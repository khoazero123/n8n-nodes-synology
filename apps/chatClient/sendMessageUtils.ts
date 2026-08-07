import type { IDataObject } from 'n8n-workflow';
import type { ChatClient } from './ChatClient';

/** Send a message as the credential DSM user to a channel or direct message. */
export async function sendMessageAsUser(
	chat: ChatClient,
	sendTo: 'channel' | 'user',
	targetId: number,
	text: string,
): Promise<IDataObject> {
	if (sendTo === 'channel') {
		return await chat.sendAsUser(targetId, text);
	}
	const channel = await chat.resolveDirectChannel(targetId);
	const channelId = Number((channel as unknown as IDataObject).channel_id);
	return await chat.sendAsUser(channelId, text);
}
