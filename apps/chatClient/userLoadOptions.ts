import type { INodePropertyOptions } from 'n8n-workflow';
import type { ChatUser } from './types';

export function buildUserOptions(users: ChatUser[]): INodePropertyOptions[] {
	const returnData: INodePropertyOptions[] = [];
	for (const user of users) {
		if (user.type && user.type !== 'human') continue;
		const id = Number(user.user_id);
		const label = user.nickname?.trim() || user.username?.trim() || (user.user_props?.email ?? '');
		returnData.push({ name: label ? `${label} (${id})` : `User ${id}`, value: id });
	}
	return returnData;
}
