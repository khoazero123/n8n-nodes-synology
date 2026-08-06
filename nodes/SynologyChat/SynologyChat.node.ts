import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { ChatClient } from '../../apps/chatClient/ChatClient';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

const messageOperations = [
	{ name: 'Send', value: 'send', action: 'Send a message via incoming webhook token' },
	{ name: 'List Channels', value: 'listChannels', action: 'List channels visible to a bot token' },
	{ name: 'List Users', value: 'listUsers', action: 'List users visible to a bot token' },
	{ name: 'List Posts', value: 'listPosts', action: 'List posts visible to a bot token' },
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
];

const postOperations = [
	{ name: 'List', value: 'list', action: 'List posts in a channel' },
];

export class SynologyChat implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology Chat',
		name: 'synologyChat',
		icon: { light: 'file:SynologyChat.svg', dark: 'file:SynologyChat-dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Work with Synology Chat: send messages via webhooks, manage bots and webhooks, list channels and posts',
		defaults: { name: 'Synology Chat' },
		inputs: [NodeConnectionTypes.Main],
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
					{ name: 'Post', value: 'post' },
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
				displayOptions: { show: { resource: ['post'] } },
				options: postOperations,
				default: 'list',
			},
			// --- Message: Send ---
			{
				displayName: 'Webhook Token',
				name: 'token',
				type: 'string',
				typeOptions: { password: true },
				required: true,
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['send', 'listChannels', 'listUsers', 'listPosts'] } },
				description: 'Incoming webhook or chatbot token (created in Chat → Profile → Integration)',
			},
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
				description: 'Message text. Supports &lt;https://example.com|link text&gt; for links.',
			},
			{
				displayName: 'File URL',
				name: 'fileUrl',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
				description: 'Optional URL of a file to attach (max 32 MB)',
			},
			{
				displayName: 'User IDs',
				name: 'userIds',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
				description: 'Comma-separated user IDs to send to (bot conversations). Empty sends to the webhook channel.',
			},
			{
				displayName: 'Channel ID',
				name: 'channelId',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['message'], operation: ['listPosts'] } },
				description: 'Channel to read posts from',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				description: 'Max number of results to return',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: { show: { resource: ['message'], operation: ['listPosts'] } },
			},
			// --- Webhook: Create ---
			{
				displayName: 'Channel ID',
				name: 'whChannelId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['webhook'], operation: ['create'] } },
				description: 'Channel the webhook will post into',
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
				displayName: 'Channel ID',
				name: 'whSetChannelId',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['webhook'], operation: ['set'] } },
				description: 'New channel for the webhook',
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
				displayName: 'Channel ID',
				name: 'chChannelId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['channel'], operation: ['get'] } },
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
				displayName: 'Member IDs',
				name: 'chMemberIds',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['channel'], operation: ['create'] } },
				description: 'Comma-separated user IDs to add to the channel (optional)',
			},
			{
				displayName: 'Encrypted Channel',
				name: 'chEncrypted',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['channel'], operation: ['create'] } },
				description: 'Create an end-to-end encrypted channel. Requires the user to have enabled Encryption in Chat (Profile → Settings) so a keypair exists (otherwise the NAS returns 408 keypair not exist)',
			},
			// --- Post: List ---
			{
				displayName: 'Channel ID',
				name: 'postChannelId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['post'], operation: ['list'] } },
			},
			{
				displayName: 'Limit',
				name: 'postLimit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: { show: { resource: ['post'], operation: ['list'] } },
			},
			{
				displayName: 'Offset',
				name: 'postOffset',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['post'], operation: ['list'] } },
			},
		],
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

			if (resource === 'message') {
				if (operation === 'send') {
					const userIdsRaw = this.getNodeParameter('userIds', i, '') as string;
					data = await chat.sendMessage({
						token: this.getNodeParameter('token', i) as string,
						text: (this.getNodeParameter('text', i, '') as string) || undefined,
						fileUrl: (this.getNodeParameter('fileUrl', i, '') as string) || undefined,
						userIds: userIdsRaw ? userIdsRaw.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) : undefined,
					});
				} else if (operation === 'listChannels') {
					data = await chat.listChannelsByToken(this.getNodeParameter('token', i) as string);
				} else if (operation === 'listUsers') {
					data = await chat.listUsersByToken(this.getNodeParameter('token', i) as string);
				} else if (operation === 'listPosts') {
					data = await chat.listPostsByToken(
						this.getNodeParameter('token', i) as string,
						this.getNodeParameter('channelId', i) as number,
						undefined,
						undefined,
					);
				}
			} else if (resource === 'webhook') {
				if (operation === 'create') {
					data = await chat.createWebhook({
						channelId: this.getNodeParameter('whChannelId', i) as number,
						nickname: this.getNodeParameter('whNickname', i) as string,
					});
				} else if (operation === 'list') {
					data = await chat.listWebhooks() as unknown as IDataObject;
				} else if (operation === 'get') {
					data = await chat.getWebhook(this.getNodeParameter('whUserId', i) as number) as unknown as IDataObject;
				} else if (operation === 'set') {
					data = await chat.setWebhook(
						this.getNodeParameter('whUserId', i) as number,
						this.getNodeParameter('whSetChannelId', i, 0) as number || undefined,
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
					data = await chat.getChannel(this.getNodeParameter('chChannelId', i) as number) as unknown as IDataObject;
				} else if (operation === 'create') {
					const memberIdsRaw = this.getNodeParameter('chMemberIds', i, '') as string;
					data = await chat.createChannel(
						this.getNodeParameter('chName', i) as string,
						memberIdsRaw ? memberIdsRaw.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) : undefined,
						this.getNodeParameter('chEncrypted', i, false) as boolean,
					);
				}
			} else if (resource === 'post' && operation === 'list') {
				data = await chat.listPosts({
					channelId: this.getNodeParameter('postChannelId', i) as number,
					limit: this.getNodeParameter('postLimit', i, 50) as number,
					offset: this.getNodeParameter('postOffset', i, 0) as number,
				}) as unknown as IDataObject;
			}

			returnData.push({ json: (data ?? { message: `Operation ${resource}.${operation} completed` }) as IDataObject, pairedItem: { item: i } });
		}

		return [returnData];
	}
}
