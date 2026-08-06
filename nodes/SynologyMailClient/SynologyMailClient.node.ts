import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';
import { MailClientClient } from '../../apps/mailClient/MailClientClient';
import { MAILBOX_ID_MAP } from '../../apps/mailClient/constants';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

const mailOperations = [
	{ name: 'Get Info', value: 'getInfo', action: 'Get MailPlus client information' },
];

const threadOperations = [
	{ name: 'List', value: 'list', action: 'List threads in a mailbox' },
];

const messageOperations = [
	{ name: 'Get', value: 'get', action: 'Get a full message' },
	{ name: 'Download Original', value: 'downloadOriginal', action: 'Download the raw original email (RFC822)' },
	{ name: 'Download Attachment', value: 'downloadAttachment', action: 'Download a message attachment' },
];

const mailboxOperations = [
	{ name: 'List', value: 'list', action: 'List mailboxes' },
];

const labelOperations = [
	{ name: 'List', value: 'list', action: 'List labels' },
];

const draftOperations = [
	{ name: 'Create', value: 'create', action: 'Create a draft message' },
	{ name: 'Send', value: 'send', action: 'Send a draft message' },
];

export class SynologyMailClient implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology MailPlus',
		name: 'synologyMailClient',
		icon: { light: 'file:SynologyMailClient.svg', dark: 'file:SynologyMailClient-dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Work with Synology MailPlus email: list threads and messages, read mail, manage drafts, download attachments',
		defaults: { name: 'Synology MailPlus' },
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
					{ name: 'Mail', value: 'mail' },
					{ name: 'Thread', value: 'thread' },
					{ name: 'Message', value: 'message' },
					{ name: 'Mailbox', value: 'mailbox' },
					{ name: 'Label', value: 'label' },
					{ name: 'Draft', value: 'draft' },
				],
				default: 'thread',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['mail'] } },
				options: mailOperations,
				default: 'getInfo',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['thread'] } },
				options: threadOperations,
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				options: messageOperations,
				default: 'get',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['mailbox'] } },
				options: mailboxOperations,
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['label'] } },
				options: labelOperations,
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['draft'] } },
				options: draftOperations,
				default: 'create',
			},
			// --- Thread list params ---
			{
				displayName: 'Mailbox',
				name: 'mailbox',
				type: 'options',
				options: [
					{ name: 'Inbox', value: 'inbox' },
					{ name: 'Archived', value: 'archived' },
					{ name: 'Drafts', value: 'drafts' },
					{ name: 'Sent', value: 'sent' },
					{ name: 'Spam', value: 'spam' },
					{ name: 'Trash', value: 'trash' },
					{ name: 'Scheduled', value: 'scheduled' },
				],
				default: 'inbox',
				displayOptions: { show: { resource: ['thread'], operation: ['list'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: { show: { resource: ['thread'], operation: ['list'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['thread'], operation: ['list'] } },
			},
			{
				displayName: 'Search Keyword',
				name: 'keyword',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['thread'], operation: ['list'] } },
				description: 'Optional keyword to filter threads',
			},
			// --- Message params ---
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['message'], operation: ['get', 'downloadOriginal'] } },
			},
			{
				displayName: 'Attachment ID',
				name: 'attachmentId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['downloadAttachment'] } },
			},
			// --- Draft params ---
			{
				displayName: 'From',
				name: 'from',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['draft'], operation: ['create'] } },
				description: 'Sender email address (required)',
			},
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['draft'], operation: ['create'] } },
				description: 'Recipient email address(es), comma-separated',
			},
			{
				displayName: 'CC',
				name: 'cc',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['draft'], operation: ['create'] } },
			},
			{
				displayName: 'BCC',
				name: 'bcc',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['draft'], operation: ['create'] } },
			},
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['draft'], operation: ['create'] } },
			},
			{
				displayName: 'Body',
				name: 'body',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				displayOptions: { show: { resource: ['draft'], operation: ['create'] } },
			},
			{
				displayName: 'Draft ID',
				name: 'draftId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['draft'], operation: ['send'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
		const mc = new MailClientClient(new SynologyClient(this, credentials));
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;
			let data: IDataObject | undefined;

			if (resource === 'mail' && operation === 'getInfo') {
				data = await mc.getInfo() as unknown as IDataObject;
			} else if (resource === 'thread' && operation === 'list') {
				data = await mc.listThreads({
					mailboxId: MAILBOX_ID_MAP[this.getNodeParameter('mailbox', i) as string],
					offset: this.getNodeParameter('offset', i, 0) as number,
					limit: this.getNodeParameter('limit', i, 200) as number,
					keyword: (this.getNodeParameter('keyword', i, '') as string) || undefined,
				}) as unknown as IDataObject;
			} else if (resource === 'message') {
				if (operation === 'get') {
					data = await mc.getMessage({ messageId: this.getNodeParameter('messageId', i) as number }) as unknown as IDataObject;
				} else if (operation === 'downloadOriginal') {
					const response = await mc.downloadOriginal(this.getNodeParameter('messageId', i) as number);
					const buffer = Buffer.isBuffer(response.body) ? response.body : Buffer.from((response.body as ArrayBuffer | undefined) ?? new ArrayBuffer(0));
					const fileName = `message-${this.getNodeParameter('messageId', i)}.eml`;
					returnData.push({
						json: { messageId: this.getNodeParameter('messageId', i), fileName, size: buffer.length },
						binary: {
							data: await this.helpers.prepareBinaryData(buffer, fileName, 'message/rfc822'),
						},
						pairedItem: { item: i },
					});
					continue;
				} else if (operation === 'downloadAttachment') {
					const response = await mc.downloadAttachment(this.getNodeParameter('attachmentId', i) as string);
					const buffer = Buffer.isBuffer(response.body) ? response.body : Buffer.from((response.body as ArrayBuffer | undefined) ?? new ArrayBuffer(0));
					const contentDisposition = response.headers?.['content-disposition'] as string | undefined;
					const fileName = contentDisposition?.match(/filename="?([^";]+)/i)?.[1] ?? `attachment-${this.getNodeParameter('attachmentId', i)}`;
					returnData.push({
						json: { attachmentId: this.getNodeParameter('attachmentId', i), fileName, size: buffer.length },
						binary: {
							data: await this.helpers.prepareBinaryData(buffer, fileName),
						},
						pairedItem: { item: i },
					});
					continue;
				}
			} else if (resource === 'mailbox' && operation === 'list') {
				data = await mc.listMailboxes() as unknown as IDataObject;
			} else if (resource === 'label' && operation === 'list') {
				data = await mc.listLabels() as unknown as IDataObject;
			} else if (resource === 'draft') {
				if (operation === 'create') {
					const toRaw = this.getNodeParameter('to', i, '') as string;
					const ccRaw = this.getNodeParameter('cc', i, '') as string;
					const bccRaw = this.getNodeParameter('bcc', i, '') as string;
					const split = (s: string) => s.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
					data = await mc.createDraft({
						from: (this.getNodeParameter('from', i, '') as string) || undefined,
						to: split(toRaw).length ? split(toRaw) : undefined,
						cc: split(ccRaw).length ? split(ccRaw) : undefined,
						bcc: split(bccRaw).length ? split(bccRaw) : undefined,
						subject: (this.getNodeParameter('subject', i, '') as string) || undefined,
						body: (this.getNodeParameter('body', i, '') as string) || undefined,
					}) as unknown as IDataObject;
				} else if (operation === 'send') {
					data = await mc.sendDraft({ draftId: this.getNodeParameter('draftId', i) as number }) as unknown as IDataObject;
				}
			}

			returnData.push({ json: (data ?? { message: `Operation ${resource}.${operation} completed` }) as IDataObject, pairedItem: { item: i } });
		}

		return [returnData];
	}
}
