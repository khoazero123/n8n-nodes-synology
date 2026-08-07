import type { INodePropertyOptions } from 'n8n-workflow';
import type { ChatChannel } from './types';

type ChannelOptionMode = 'required' | 'withAny' | 'optional';

export function buildChannelOptions(channels: ChatChannel[], mode: ChannelOptionMode = 'required'): INodePropertyOptions[] {
	const returnData: INodePropertyOptions[] = [];
	if (mode === 'withAny') {
		returnData.push({ name: 'Any Channel', value: 0 });
	} else if (mode === 'optional') {
		returnData.push({ name: "Don't Change", value: 0 });
	}
	for (const channel of channels) {
		const id = Number(channel.channel_id);
		const label = channel.name?.trim() || 'Unnamed';
		returnData.push({ name: `${label} (${id})`, value: id });
	}
	return returnData;
}
