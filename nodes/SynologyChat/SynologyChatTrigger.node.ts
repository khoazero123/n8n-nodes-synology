import type {
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { ChatClient } from '../../apps/chatClient/ChatClient';
import { buildChannelOptions } from '../../apps/chatClient/channelLoadOptions';
import { isOutgoingWebhookDisabled, outgoingWebhookConfigMatches, assertTriggerWordForAnyChannel, mergeOutgoingWebhookPayload, normalizeOutgoingWebhookPayload, outgoingWebhookTextMatches } from '../../apps/chatClient/outgoingWebhookUtils';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

export class SynologyChatTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology Chat Trigger',
		name: 'synologyChatTrigger',
		icon: { light: 'file:SynologyChat.svg', dark: 'file:SynologyChat-dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["channelId"]}}',
		description: 'Triggers when a Synology Chat outgoing webhook receives a matching message',
		defaults: { name: 'Synology Chat Trigger' },
		usableAsTool: true,
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
				displayName: 'Channel Name or ID',
				name: 'channelId',
				type: 'options',
				default: 0,
				typeOptions: {
					loadOptionsMethod: 'getChannels',
				},
				description: 'Synology Chat channel to listen on. Choose "Any Channel" to listen on all channels. Use ⋯ → Refresh List to reload from the NAS. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Trigger Word',
				name: 'triggerWord',
				type: 'string',
				default: '',
				description: 'Required when Channel is Any Channel. Only messages starting with this word trigger the workflow (matched by Synology before calling n8n). Leave empty to accept all messages in a specific channel.',
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

	methods = {
		loadOptions: {
			async getChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
				const chat = new ChatClient(new SynologyClient(this as never, credentials));
				return buildChannelOptions(await chat.listChannels(), 'withAny');
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
				const chat = new ChatClient(new SynologyClient(this as never, credentials));
				const node = this.getNode();
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const staticData = this.getWorkflowStaticData('node');
				const configuredId = staticData.synologyChatTriggerWebhookId as number | undefined;
				const channelId = Number(this.getNodeParameter('channelId', 0));
				const triggerWord = (this.getNodeParameter('triggerWord', 0) as string) || '';
				const nickname = (this.getNodeParameter('nickname', 0) as string) || 'n8n Synology Chat Trigger';
				assertTriggerWordForAnyChannel(node, channelId, triggerWord);
				const webhooks = await chat.listOutgoingWebhooks();
				let match = configuredId !== undefined
					? webhooks.find((item) => Number(item.user_id) === configuredId)
					: undefined;
				if (!match) {
					match = webhooks.find((item) => item.url === webhookUrl);
				}
				if (!match) {
					delete staticData.synologyChatTriggerWebhookId;
					return false;
				}
				const userId = Number(match.user_id);
				if (!outgoingWebhookConfigMatches(match, channelId, triggerWord, webhookUrl)) {
					await chat.setOutgoingWebhook(userId, channelId, triggerWord, webhookUrl, nickname);
				} else if (isOutgoingWebhookDisabled(match)) {
					await chat.enableBot(userId);
				}
				staticData.synologyChatTriggerWebhookId = userId;
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
				const chat = new ChatClient(new SynologyClient(this as never, credentials));
				const node = this.getNode();
				const channelId = Number(this.getNodeParameter('channelId', 0));
				const triggerWord = (this.getNodeParameter('triggerWord', 0) as string) || '';
				assertTriggerWordForAnyChannel(node, channelId, triggerWord);
				const created = await chat.createOutgoingWebhook();
				const nickname = (this.getNodeParameter('nickname', 0) as string) || 'n8n Synology Chat Trigger';
				await chat.setOutgoingWebhook(
					created.user_id,
					channelId,
					triggerWord,
					this.getNodeWebhookUrl('default') as string,
					nickname,
				);
				this.getWorkflowStaticData('node').synologyChatTriggerWebhookId = created.user_id;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				// Publish/republish re-registers webhooks with activation mode "update".
				// Skip Synology calls so unchanged trigger settings do not spam the channel.
				if (this.getActivationMode() === 'update') return true;

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
		const raw = mergeOutgoingWebhookPayload(
			this.getBodyData(),
			this.getRequestObject().body,
			this.getQueryData(),
		);
		const body = normalizeOutgoingWebhookPayload(raw);
		const channelId = Number(this.getNodeParameter('channelId', 0));
		const triggerWord = (this.getNodeParameter('triggerWord', 0) as string).trim();
		const incomingChannelId = Number(body.channel_id ?? (body.channel as Record<string, unknown> | undefined)?.id);
		const text = String(body.text);

		if (channelId > 0 && incomingChannelId !== channelId) return { workflowData: [] };
		if (!outgoingWebhookTextMatches(triggerWord, text)) return { workflowData: [] };
		return { workflowData: [this.helpers.returnJsonArray(body)] };
	}
}
