import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { ChatClient } from '../../apps/chatClient/ChatClient';
import { buildChannelOptions } from '../../apps/chatClient/channelLoadOptions';
import { buildUserOptions } from '../../apps/chatClient/userLoadOptions';
import { sendMessageAsUser } from '../../apps/chatClient/sendMessageUtils';
import { assertTriggerWordForAnyChannel } from '../../apps/chatClient/outgoingWebhookUtils';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

const messageOperations = [
	{ name: 'Send a Message', value: 'send', action: 'Send a message' },
];

const webhookOperations = [
	{ name: 'Create', value: 'create', action: 'Create an incoming webhook bound to a channel' },
	{ name: 'List', value: 'list', action: 'List incoming webhooks' },
	{ name: 'Get', value: 'get', action: 'Get an incoming webhook including its token' },
	{ name: 'Set', value: 'set', action: 'Update an incoming webhook channel or nickname' },
	{ name: 'Delete', value: 'delete', action: 'Delete an incoming webhook (bot)' },
];

const chatbotOperations = [
	{ name: 'Create', value: 'create', action: 'Create a chatbot' },
	{ name: 'List', value: 'list', action: 'List chatbots' },
	{ name: 'Get', value: 'get', action: 'Get a chatbot including its token' },
	{ name: 'Set', value: 'set', action: 'Update a chatbot' },
	{ name: 'Delete', value: 'delete', action: 'Delete a chatbot' },
];

const channelOperations = [
	{ name: 'List', value: 'list', action: 'List channels' },
	{ name: 'Get', value: 'get', action: 'Get a channel by id' },
	{ name: 'Create', value: 'create', action: 'Create a named channel' },
	{ name: 'List Posts', value: 'listPosts', action: 'List posts in a channel' },
	{ name: 'List Users', value: 'listUsers', action: 'List users' },
];

const outgoingWebhookOperations = [
	{ name: 'Create', value: 'create', action: 'Create an outgoing webhook' },
	{ name: 'List', value: 'list', action: 'List outgoing webhooks' },
	{ name: 'Get', value: 'get', action: 'Get an outgoing webhook including its token' },
	{ name: 'Set', value: 'set', action: 'Update an outgoing webhook' },
	{ name: 'Delete', value: 'delete', action: 'Delete an outgoing webhook (bot)' },
];

export class SynologyChat implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology Chat',
		name: 'synologyChat',
		icon: { light: 'file:SynologyChat.svg', dark: 'file:SynologyChat-dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Work with Synology Chat: send messages, list channels and posts, manage bots and webhooks',
		defaults: { name: 'Synology Chat' },
		// eslint-disable-next-line
		inputs: [NodeConnectionTypes.Main],
		// eslint-disable-next-line
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'synologyApi', required: true }],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Channel', value: 'channel' },
					{ name: 'Chatbot', value: 'chatbot' },
					{ name: 'Message', value: 'message' },
					{ name: 'Outgoing Webhook', value: 'outgoingWebhook' },
					{ name: 'Webhook', value: 'webhook' },
				],
				default: 'message',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				options: messageOperations,
				default: 'send',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['webhook'] } },
				options: webhookOperations,
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['chatbot'] } },
				options: chatbotOperations,
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['channel'] } },
				options: channelOperations,
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['outgoingWebhook'] } },
				options: outgoingWebhookOperations,
				default: 'list',
			},
			// --- Message: Send ---
			{
				displayName: 'Send To',
				name: 'sendTo',
				type: 'options',
				options: [
					{ name: 'Channel', value: 'channel' },
					{ name: 'User', value: 'user' },
				],
				default: 'channel',
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
				description: 'Send to a channel or as a direct message to a user',
			},
			{
				displayName: 'Channel Name or ID',
				name: 'sendChannelId',
				type: 'options',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				required: true,
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getChannels',
				},
				displayOptions: { show: { resource: ['message'], operation: ['send'], sendTo: ['channel'] } },
			},
			{
				displayName: 'User Name or ID',
				name: 'sendUserId',
				type: 'options',
				required: true,
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getUsers',
				},
				displayOptions: { show: { resource: ['message'], operation: ['send'], sendTo: ['user'] } },
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
				description: 'Message text. Supports &lt;https://example.com|link text&gt; for links.',
			},
			// --- Webhook: Create ---
			{
				displayName: 'Channel Name or ID',
				name: 'whChannelId',
				type: 'options',
				required: true,
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getChannels',
				},
				displayOptions: { show: { resource: ['webhook'], operation: ['create'] } },
				description: 'Channel the webhook will post into. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Nickname',
				name: 'whNickname',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['webhook'], operation: ['create'] } },
				description: 'Bot nickname. Required — bots without a nickname cannot send.',
			},
			// --- Webhook: Get/Set/Delete ---
			{
				displayName: 'Bot User ID',
				name: 'whUserId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['webhook'], operation: ['get', 'set', 'delete'] } },
				description: 'Bot user ID of the webhook (from List)',
			},
			{
				displayName: 'Channel Name or ID',
				name: 'whSetChannelId',
				type: 'options',
				default: 0,
				typeOptions: {
					loadOptionsMethod: 'getChannelsOptional',
				},
				displayOptions: { show: { resource: ['webhook'], operation: ['set'] } },
				description: 'New channel for the webhook. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Nickname',
				name: 'whSetNickname',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['webhook'], operation: ['set'] } },
				description: 'New nickname for the webhook',
			},
			// --- Chatbot: Create ---
			{
				displayName: 'Nickname',
				name: 'cbNickname',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['chatbot'], operation: ['create'] } },
			},
			{
				displayName: 'Purpose',
				name: 'cbPurpose',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['chatbot'], operation: ['create', 'set'] } },
			},
			{
				displayName: 'Hide From Bot List',
				name: 'cbHideFromUser',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['chatbot'], operation: ['create', 'set'] } },
			},
			// --- Chatbot: Get/Set/Delete ---
			{
				displayName: 'Bot User ID',
				name: 'cbUserId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['chatbot'], operation: ['get', 'set', 'delete'] } },
				description: 'Bot user ID of the chatbot (from List)',
			},
			// --- Channel: Get/Create ---
			{
				displayName: 'Channel Name or ID',
				name: 'chChannelId',
				type: 'options',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				required: true,
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getChannels',
				},
				displayOptions: { show: { resource: ['channel'], operation: ['get', 'listPosts'] } },
			},
			{
				displayName: 'Limit',
				name: 'chPostLimit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: { show: { resource: ['channel'], operation: ['listPosts'] } },
			},
			{
				displayName: 'Offset',
				name: 'chPostOffset',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['channel'], operation: ['listPosts'] } },
			},
			{
				displayName: 'Name',
				name: 'chName',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['channel'], operation: ['create'] } },
			},
			{
				displayName: 'Type',
				name: 'chType',
				type: 'options',
				options: [
					{ name: 'Private', value: 'private' },
					{ name: 'Public', value: 'public' },
				],
				default: 'private',
				displayOptions: { show: { resource: ['channel'], operation: ['create'] } },
				description: 'Channel type. Use Private for encrypted channels (Public fails with 422 if some users lack encryption keys).',
			},
			{
				displayName: 'Encrypted Channel',
				name: 'chEncrypted',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['channel'], operation: ['create'] } },
				description: 'Whether to create an end-to-end encrypted channel. Requires the user to have enabled Encryption in Chat (Profile → Settings) so a keypair exists (otherwise the NAS returns 408 keypair not exist).',
			},
			// --- Outgoing Webhook: Create ---
			{
				displayName: 'Channel Name or ID',
				name: 'owChannelId',
				type: 'options',
				default: 0,
				typeOptions: {
					loadOptionsMethod: 'getChannelsWithAny',
				},
				displayOptions: { show: { resource: ['outgoingWebhook'], operation: ['create'] } },
				description: 'Channel the webhook listens on. Any Channel = listen on all channels (then trigger word is required). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Trigger Word',
				name: 'owTriggerWord',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['outgoingWebhook'], operation: ['create'] } },
				description: 'Required when Channel is Any Channel. Only messages starting with this word trigger the webhook. Leave empty for all messages in a specific channel.',
			},
			{
				displayName: 'Destination URL',
				name: 'owUrl',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['outgoingWebhook'], operation: ['create'] } },
				description: 'URL that Chat POSTs to when the webhook fires (e.g. your n8n Webhook Trigger URL)',
			},
			{
				displayName: 'Nickname',
				name: 'owNickname',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['outgoingWebhook'], operation: ['create'] } },
				description: 'Bot nickname shown in Chat',
			},
			// --- Outgoing Webhook: Get/Set/Delete ---
			{
				displayName: 'Bot User ID',
				name: 'owUserId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['outgoingWebhook'], operation: ['get', 'set', 'delete'] } },
				description: 'Bot user ID of the outgoing webhook (from List)',
			},
			{
				displayName: 'Channel Name or ID',
				name: 'owSetChannelId',
				type: 'options',
				default: 0,
				typeOptions: {
					loadOptionsMethod: 'getChannelsWithAny',
				},
				displayOptions: { show: { resource: ['outgoingWebhook'], operation: ['set'] } },
				description: 'New channel for the webhook (Any Channel = any channel). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Trigger Word',
				name: 'owSetTriggerWord',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['outgoingWebhook'], operation: ['set'] } },
				description: 'Required when Channel is Any Channel',
			},
			{
				displayName: 'Destination URL',
				name: 'owSetUrl',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['outgoingWebhook'], operation: ['set'] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async getChannels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
				const chat = new ChatClient(new SynologyClient(this as never, credentials));
				return buildChannelOptions(await chat.listChannels(), 'required');
			},
			async getChannelsWithAny(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
				const chat = new ChatClient(new SynologyClient(this as never, credentials));
				return buildChannelOptions(await chat.listChannels(), 'withAny');
			},
			async getChannelsOptional(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
				const chat = new ChatClient(new SynologyClient(this as never, credentials));
				return buildChannelOptions(await chat.listChannels(), 'optional');
			},
			async getUsers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
				const chat = new ChatClient(new SynologyClient(this as never, credentials));
				return buildUserOptions(await chat.listUsers());
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
		const synology = new SynologyClient(this, credentials);
		const chat = new ChatClient(synology);
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;
			let data: IDataObject | IDataObject[] | undefined;

			if (resource === 'message' && operation === 'send') {
				const sendTo = this.getNodeParameter('sendTo', i) as 'channel' | 'user';
				const targetId = sendTo === 'channel'
					? Number(this.getNodeParameter('sendChannelId', i))
					: Number(this.getNodeParameter('sendUserId', i));
				data = await sendMessageAsUser(
					chat,
					sendTo,
					targetId,
					this.getNodeParameter('text', i) as string,
				);
			} else if (resource === 'webhook') {
				if (operation === 'create') {
					data = await chat.createWebhook({
						channelId: Number(this.getNodeParameter('whChannelId', i)),
						nickname: this.getNodeParameter('whNickname', i) as string,
					});
				} else if (operation === 'list') {
					data = await chat.listWebhooks() as unknown as IDataObject;
				} else if (operation === 'get') {
					data = await chat.getWebhook(this.getNodeParameter('whUserId', i) as number) as unknown as IDataObject;
				} else if (operation === 'set') {
					data = await chat.setWebhook(
						this.getNodeParameter('whUserId', i) as number,
						Number(this.getNodeParameter('whSetChannelId', i, 0)) || undefined,
						(this.getNodeParameter('whSetNickname', i, '') as string) || undefined,
					);
				} else if (operation === 'delete') {
					data = await chat.deleteBot(this.getNodeParameter('whUserId', i) as number);
				}
			} else if (resource === 'chatbot') {
				if (operation === 'create') {
					data = await chat.createChatbot({
						nickname: this.getNodeParameter('cbNickname', i) as string,
						purpose: (this.getNodeParameter('cbPurpose', i, '') as string) || undefined,
						hideFromUser: this.getNodeParameter('cbHideFromUser', i, false) as boolean,
					});
				} else if (operation === 'list') {
					data = await chat.listChatbots() as unknown as IDataObject;
				} else if (operation === 'get') {
					data = await chat.getChatbot(this.getNodeParameter('cbUserId', i) as number) as unknown as IDataObject;
				} else if (operation === 'set') {
					data = await chat.setChatbot(this.getNodeParameter('cbUserId', i) as number, {
						purpose: (this.getNodeParameter('cbPurpose', i, '') as string) || undefined,
						hideFromUser: this.getNodeParameter('cbHideFromUser', i, false) as boolean,
					});
				} else if (operation === 'delete') {
					data = await chat.deleteBot(this.getNodeParameter('cbUserId', i) as number);
				}
			} else if (resource === 'channel') {
				if (operation === 'list') {
					data = await chat.listChannels() as unknown as IDataObject;
				} else if (operation === 'get') {
					data = await chat.getChannel(Number(this.getNodeParameter('chChannelId', i))) as unknown as IDataObject;
				} else if (operation === 'create') {
					data = await chat.createChannel(
						this.getNodeParameter('chName', i) as string,
						this.getNodeParameter('chType', i, 'private') as 'public' | 'private',
						this.getNodeParameter('chEncrypted', i, false) as boolean,
					);
				} else if (operation === 'listPosts') {
					data = await chat.listPosts({
						channelId: Number(this.getNodeParameter('chChannelId', i)),
						limit: this.getNodeParameter('chPostLimit', i, 50) as number,
						offset: this.getNodeParameter('chPostOffset', i, 0) as number,
					}) as unknown as IDataObject;
				} else if (operation === 'listUsers') {
					data = await chat.listUsers() as unknown as IDataObject[];
				}
			} else if (resource === 'outgoingWebhook') {
				if (operation === 'create') {
					const owChannelId = Number(this.getNodeParameter('owChannelId', i, 0));
					const owTriggerWord = (this.getNodeParameter('owTriggerWord', i, '') as string) || '';
					assertTriggerWordForAnyChannel(this.getNode(), owChannelId, owTriggerWord);
					const created = await chat.createOutgoingWebhook();
					await chat.setOutgoingWebhook(
						created.user_id,
						owChannelId,
						owTriggerWord,
						this.getNodeParameter('owUrl', i) as string,
						(this.getNodeParameter('owNickname', i, '') as string) || undefined,
					);
					data = created as unknown as IDataObject;
				} else if (operation === 'list') {
					data = await chat.listOutgoingWebhooks() as unknown as IDataObject;
				} else if (operation === 'get') {
					data = await chat.getOutgoingWebhook(this.getNodeParameter('owUserId', i) as number);
				} else if (operation === 'set') {
					const owSetChannelId = Number(this.getNodeParameter('owSetChannelId', i, 0));
					const owSetTriggerWord = this.getNodeParameter('owSetTriggerWord', i, '') as string;
					assertTriggerWordForAnyChannel(this.getNode(), owSetChannelId, owSetTriggerWord);
					data = await chat.setOutgoingWebhook(
						this.getNodeParameter('owUserId', i) as number,
						owSetChannelId,
						owSetTriggerWord,
						this.getNodeParameter('owSetUrl', i) as string,
					);
				} else if (operation === 'delete') {
					data = await chat.deleteBot(this.getNodeParameter('owUserId', i) as number);
				}
			}

			returnData.push({ json: (data ?? { message: `Operation ${resource}.${operation} completed` }) as IDataObject, pairedItem: { item: i } });
		}

		return [returnData];
	}
}
