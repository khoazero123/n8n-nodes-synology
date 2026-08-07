import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { ChatClient } from '../../apps/chatClient/ChatClient';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

export class SynologyChatTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology Chat Trigger',
		name: 'synologyChatTrigger',
		icon: { light: 'file:SynologyChat.svg', dark: 'file:SynologyChat-dark.svg' },
		group: ['trigger'],
		version: 1,
		description: 'Triggers when a Synology Chat outgoing webhook receives a matching message',
		defaults: { name: 'Synology Chat Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'synologyApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Channel ID',
				name: 'channelId',
				type: 'number',
				default: 0,
				description: 'Synology Chat channel to listen on. Use 0 for any channel.',
			},
			{
				displayName: 'Trigger Word',
				name: 'triggerWord',
				type: 'string',
				default: '',
				description: 'Only messages starting with this word trigger the workflow. Leave empty for all messages in the selected channel.',
			},
			{
				displayName: 'Bot Nickname',
				name: 'nickname',
				type: 'string',
				default: 'n8n Synology Chat Trigger',
				description: 'Nickname shown for the registered Synology Chat outgoing webhook',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
				const chat = new ChatClient(new SynologyClient(this as never, credentials));
				const webhookUrl = this.getNodeWebhookUrl('default');
				const staticData = this.getWorkflowStaticData('node');
				const configuredId = staticData.synologyChatTriggerWebhookId as number | undefined;
				const webhooks = await chat.listOutgoingWebhooks();
				const match = webhooks.find((item) =>
					(configuredId !== undefined && Number(item.user_id) === configuredId) || item.url === webhookUrl,
				);
				if (!match || match.url !== webhookUrl) return false;
				staticData.synologyChatTriggerWebhookId = Number(match.user_id);
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
				const chat = new ChatClient(new SynologyClient(this as never, credentials));
				const created = await chat.createOutgoingWebhook();
				await chat.setOutgoingWebhook(
					created.user_id,
					this.getNodeParameter('channelId', 0) as number,
					(this.getNodeParameter('triggerWord', 0) as string) || '',
					this.getNodeWebhookUrl('default') as string,
					(this.getNodeParameter('nickname', 0) as string) || undefined,
				);
				this.getWorkflowStaticData('node').synologyChatTriggerWebhookId = created.user_id;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const userId = staticData.synologyChatTriggerWebhookId as number | undefined;
				if (userId === undefined) return true;
				const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
				const chat = new ChatClient(new SynologyClient(this as never, credentials));
				await chat.deleteBot(userId);
				delete staticData.synologyChatTriggerWebhookId;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData() as Record<string, unknown>;
		const channelId = this.getNodeParameter('channelId', 0) as number;
		const triggerWord = (this.getNodeParameter('triggerWord', 0) as string).trim();
		const incomingChannelId = Number(body.channel_id ?? body.channelId ?? (body.channel as Record<string, unknown> | undefined)?.id);
		const text = String(body.text ?? body.message ?? body.content ?? '');

		if (channelId > 0 && incomingChannelId !== channelId) return { workflowData: [] };
		if (triggerWord && !text.trimStart().startsWith(triggerWord)) return { workflowData: [] };
		return { workflowData: [this.helpers.returnJsonArray(body as IDataObject)] };
	}
}
