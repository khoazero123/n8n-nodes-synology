import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { MailClientClient } from '../../apps/mailClient/MailClientClient';
import { MAILBOX_ID_MAP } from '../../apps/mailClient/constants';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

const mailOperations = [
	{ name: 'Get Info', value: 'getInfo', action: 'Get MailPlus client information' },
];



const messageOperations = [
	{ name: 'Get', value: 'get', action: 'Get a full message' },
	{ name: 'Download Original', value: 'downloadOriginal', action: 'Download the raw original email (RFC822)' },
	{ name: 'Download Attachment', value: 'downloadAttachment', action: 'Download a message attachment' },
	{ name: 'Mark Read', value: 'setRead', action: 'Mark message(s) as read' },
	{ name: 'Mark Unread', value: 'setUnread', action: 'Mark message(s) as unread' },
	{ name: 'Star', value: 'setStar', action: 'Star or unstar message(s)' },
	{ name: 'Move', value: 'move', action: 'Move message(s) to another mailbox' },
];

const mailboxOperations = [
	{ name: 'List', value: 'list', action: 'List mailboxes' },
	{ name: 'Create', value: 'create', action: 'Create a mailbox' },
	{ name: 'Rename', value: 'set', action: 'Rename a mailbox' },
	{ name: 'Delete', value: 'delete', action: 'Delete a mailbox' },
];

const labelOperations = [
	{ name: 'List', value: 'list', action: 'List labels' },
	{ name: 'Create', value: 'create', action: 'Create a label' },
	{ name: 'Update', value: 'set', action: 'Update a label' },
	{ name: 'Delete', value: 'delete', action: 'Delete label(s)' },
];

const draftOperations = [
	{ name: 'Create', value: 'create', action: 'Create a draft message' },
	{ name: 'Send', value: 'send', action: 'Send a draft message' },
	{ name: 'Reply', value: 'reply', action: 'Create a reply draft' },
	{ name: 'Forward', value: 'forward', action: 'Create a forward draft' },
	{ name: 'Upload Attachment', value: 'uploadAttachment', action: 'Upload an attachment to a draft' },
];

const threadOperations = [
	{ name: 'List', value: 'list', action: 'List threads in a mailbox' },
	{ name: 'Mark Read', value: 'setRead', action: 'Mark thread(s) as read' },
	{ name: 'Mark Unread', value: 'setUnread', action: 'Mark thread(s) as unread' },
	{ name: 'Add Label', value: 'addLabel', action: 'Add a label to thread(s)' },
	{ name: 'Remove Label', value: 'removeLabel', action: 'Remove a label from thread(s)' },
	{ name: 'Move', value: 'move', action: 'Move thread(s) to another mailbox' },
	{ name: 'Delete', value: 'delete', action: 'Delete thread(s)' },
];

const signatureOperations = [
	{ name: 'List', value: 'list', action: 'List signatures' },
	{ name: 'Create', value: 'create', action: 'Create a signature' },
	{ name: 'Delete', value: 'delete', action: 'Delete signature(s)' },
];

const filterOperations = [
	{ name: 'List', value: 'list', action: 'List email filter rules' },
];

const smtpOperations = [
	{ name: 'List', value: 'list', action: 'List SMTP accounts' },
];

const templateOperations = [
	{ name: 'List', value: 'list', action: 'List mail templates' },
];

const mailMergeOperations = [
	{ name: 'List', value: 'list', action: 'List mail merge tasks' },
];

const toIdArray = (v: unknown): number[] => {
	if (typeof v === 'number') return [v];
	if (typeof v === 'string') return v.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
	if (Array.isArray(v)) return v.map((n) => Number(n)).filter((n) => !Number.isNaN(n));
	return [];
};

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
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'synologyApi', required: true }],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Draft', value: 'draft' },
					{ name: 'Filter', value: 'filter' },
					{ name: 'Label', value: 'label' },
					{ name: 'Mail', value: 'mail' },
					{ name: 'Mail Merge', value: 'mailMerge' },
					{ name: 'Mail Template', value: 'template' },
					{ name: 'Mailbox', value: 'mailbox' },
					{ name: 'Message', value: 'message' },
					{ name: 'Signature', value: 'signature' },
					{ name: 'SMTP Account', value: 'smtp' },
					{ name: 'Thread', value: 'thread' },
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
				displayOptions: { show: { resource: ['signature'] } },
				options: signatureOperations,
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['filter'] } },
				options: filterOperations,
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['smtp'] } },
				options: smtpOperations,
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['template'] } },
				options: templateOperations,
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['mailMerge'] } },
				options: mailMergeOperations,
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
					{ name: 'Archived', value: 'archived' },
					{ name: 'Drafts', value: 'drafts' },
					{ name: 'Inbox', value: 'inbox' },
					{ name: 'Scheduled', value: 'scheduled' },
					{ name: 'Sent', value: 'sent' },
					{ name: 'Spam', value: 'spam' },
					{ name: 'Trash', value: 'trash' },
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
				displayName: 'Send At (Unix Timestamp Seconds)',
				name: 'scheduleTime',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['draft'], operation: ['create'] } },
				description: 'Schedule the email to be sent at this time (epoch seconds). 0 or empty sends immediately.',
			},
			{
				displayName: 'Draft ID',
				name: 'draftId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['draft'], operation: ['send'] } },
			},
			// --- Message/Thread action params ---
			{
				displayName: 'Message IDs',
				name: 'messageIds',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['setRead', 'setUnread', 'setStar', 'move'] } },
				description: 'Comma-separated message IDs',
			},
			{
				displayName: 'Star',
				name: 'star',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['message'], operation: ['setStar'] } },
			},
			{
				displayName: 'Mailbox',
				name: 'msgMailbox',
				type: 'options',
				options: [
					{ name: 'Archived', value: -2 },
					{ name: 'Drafts', value: -3 },
					{ name: 'Inbox', value: -1 },
					{ name: 'Scheduled', value: -7 },
					{ name: 'Sent', value: -4 },
					{ name: 'Spam', value: -5 },
					{ name: 'Trash', value: -6 },
				],
				default: -6,
				displayOptions: { show: { resource: ['message'], operation: ['move'] } },
			},
			{
				displayName: 'Thread IDs',
				name: 'threadIds',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['thread'], operation: ['setRead', 'setUnread', 'addLabel', 'removeLabel', 'move', 'delete'] } },
				description: 'Comma-separated thread IDs',
			},
			{
				displayName: 'Label ID',
				name: 'labelId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['thread'], operation: ['addLabel', 'removeLabel'] } },
			},
			{
				displayName: 'Source Mailbox',
				name: 'threadSrcMailbox',
				type: 'options',
				options: [
					{ name: 'Archived', value: -2 },
					{ name: 'Drafts', value: -3 },
					{ name: 'Inbox', value: -1 },
					{ name: 'Sent', value: -4 },
					{ name: 'Spam', value: -5 },
					{ name: 'Trash', value: -6 },
				],
				default: -1,
				displayOptions: { show: { resource: ['thread'], operation: ['move', 'delete'] } },
			},
			{
				displayName: 'Destination Mailbox',
				name: 'threadDestMailbox',
				type: 'options',
				options: [
					{ name: 'Archived', value: -2 },
					{ name: 'Drafts', value: -3 },
					{ name: 'Inbox', value: -1 },
					{ name: 'Sent', value: -4 },
					{ name: 'Spam', value: -5 },
					{ name: 'Trash', value: -6 },
				],
				default: -6,
				displayOptions: { show: { resource: ['thread'], operation: ['move'] } },
			},
			// --- Label CRUD ---
			{
				displayName: 'Label Name',
				name: 'labelName',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['label'], operation: ['create', 'set'] } },
			},
			{
				displayName: 'Background Color',
				name: 'backgroundColor',
				type: 'options',
				options: [
					{ name: 'Blue', value: '008FBF' },
					{ name: 'Blue (Dark)', value: '1470CC' },
					{ name: 'Blue (Light)', value: 'C8EDFA' },
					{ name: 'Cyan (Light)', value: 'C2F2F2' },
					{ name: 'Gold', value: 'CCAA00' },
					{ name: 'Gray', value: 'DCE1E6' },
					{ name: 'Gray (Dark)', value: '64696E' },
					{ name: 'Green', value: '739900' },
					{ name: 'Green (Dark)', value: '009933' },
					{ name: 'Green (Light)', value: 'DDF29D' },
					{ name: 'Magenta', value: 'E67EC3' },
					{ name: 'Mint', value: 'C4F5D4' },
					{ name: 'Orange', value: 'E67300' },
					{ name: 'Orange (Light)', value: 'FFD9B2' },
					{ name: 'Pink (Light)', value: 'FFD9F2' },
					{ name: 'Purple', value: 'A18AE6' },
					{ name: 'Purple (Light)', value: 'E2D9FF' },
					{ name: 'Red', value: 'E04343' },
					{ name: 'Red (Dark)', value: 'F56496' },
					{ name: 'Red (Light)', value: 'FFCCCC' },
					{ name: 'Rose', value: 'FFC0D2' },
					{ name: 'Sky', value: 'CCE6FF' },
					{ name: 'Teal', value: '009999' },
					{ name: 'Yellow', value: 'FFEC8C' },
				],
				default: 'FFCCCC',
				displayOptions: { show: { resource: ['label'], operation: ['create', 'set'] } },
			},
			{
				displayName: 'Text Color',
				name: 'textColor',
				type: 'options',
				options: [
					{ name: 'Blue', value: '007399' },
					{ name: 'Dark Blue', value: '0059B3' },
					{ name: 'Dark Gray', value: '50555A' },
					{ name: 'Dark Green', value: '007326' },
					{ name: 'Dark Yellow', value: '997F00' },
					{ name: 'Green', value: '567300' },
					{ name: 'Magenta', value: 'B32483' },
					{ name: 'Orange', value: 'BF6000' },
					{ name: 'Purple', value: '5536B3' },
					{ name: 'Red', value: 'C73232' },
					{ name: 'Rose', value: 'A12A62' },
					{ name: 'Teal', value: '007373' },
					{ name: 'White', value: 'FFFFFF' },
				],
				default: 'FFFFFF',
				displayOptions: { show: { resource: ['label'], operation: ['create', 'set'] } },
			},
			{
				displayName: 'Label ID',
				name: 'labelId2',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['label'], operation: ['set', 'delete'] } },
			},
			{
				displayName: 'Label IDs',
				name: 'labelIds',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['label'], operation: ['delete'] } },
				description: 'Comma-separated label IDs',
			},
			// --- Mailbox CRUD ---
			{
				displayName: 'Mailbox Name',
				name: 'mailboxName',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['mailbox'], operation: ['create', 'set'] } },
			},
			{
				displayName: 'Mailbox ID',
				name: 'mailboxId2',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['mailbox'], operation: ['set', 'delete'] } },
			},
			// --- Signature ---
			{
				displayName: 'Signature Name',
				name: 'sigName',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['signature'], operation: ['create'] } },
			},
			{
				displayName: 'Signature Content',
				name: 'sigContent',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				displayOptions: { show: { resource: ['signature'], operation: ['create'] } },
			},
			{
				displayName: 'Signature IDs',
				name: 'sigIds',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['signature'], operation: ['delete'] } },
				description: 'Comma-separated signature IDs',
			},
			// --- Reply/Forward ---
			{
				displayName: 'Message ID to Reply/Forward',
				name: 'referTo',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['draft'], operation: ['reply', 'forward'] } },
			},
			{
				displayName: 'Upload Attachment: Draft ID',
				name: 'uploadDraftId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['draft'], operation: ['uploadAttachment'] } },
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				displayOptions: { show: { resource: ['draft'], operation: ['uploadAttachment'] } },
				description: 'Incoming binary property containing the attachment file',
			},
			{
				displayName: 'Attachment Filename',
				name: 'uploadFilename',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['draft'], operation: ['uploadAttachment'] } },
				description: 'Filename for the uploaded attachment (defaults to binary filename)',
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
						scheduleTime: this.getNodeParameter('scheduleTime', i, 0) as number,
					}) as unknown as IDataObject;
				} else if (operation === 'send') {
					data = await mc.sendDraft({ draftId: this.getNodeParameter('draftId', i) as number }) as unknown as IDataObject;
				} else if (operation === 'reply' || operation === 'forward') {
					const toRaw = this.getNodeParameter('to', i, '') as string;
					const split = (s: string) => s.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
					data = await mc.createReplyDraft({
						from: (this.getNodeParameter('from', i, '') as string) || 'khoa@megavn.net',
						to: split(toRaw).length ? split(toRaw) : [],
						subject: (this.getNodeParameter('subject', i, '') as string) || '',
						body: (this.getNodeParameter('body', i, '') as string) || '',
						referTo: this.getNodeParameter('referTo', i) as number,
						draftType: operation === 'reply' ? 1 : 2,
					}) as unknown as IDataObject;
				} else if (operation === 'uploadAttachment') {
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					const binary = items[i].binary?.[binaryPropertyName];
					if (!binary) throw new NodeApiError(this.getNode(), { message: `Binary property "${binaryPropertyName}" is missing` });
					const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
					const filename = (this.getNodeParameter('uploadFilename', i, '') as string) || binary.fileName || 'attachment.bin';
					data = await mc.uploadAttachment(this.getNodeParameter('uploadDraftId', i) as number, filename, buffer) as unknown as IDataObject;
				}
			} else if (resource === 'message') {
				if (operation === 'setRead' || operation === 'setUnread') {
					const ids = toIdArray(this.getNodeParameter('messageIds', i));
					data = await mc.setMessageRead({ messageIds: ids, read: operation === 'setRead' }) as unknown as IDataObject;
				} else if (operation === 'setStar') {
					const ids = toIdArray(this.getNodeParameter('messageIds', i));
					data = await mc.setMessageStar({ messageIds: ids, star: this.getNodeParameter('star', i, true) as boolean }) as unknown as IDataObject;
				} else if (operation === 'move') {
					const ids = toIdArray(this.getNodeParameter('messageIds', i));
					data = await mc.moveMessage({ messageIds: ids, mailboxId: this.getNodeParameter('msgMailbox', i, -6) as number }) as unknown as IDataObject;
				}
			} else if (resource === 'thread') {
				if (operation === 'setRead' || operation === 'setUnread') {
					const ids = toIdArray(this.getNodeParameter('threadIds', i));
					data = await mc.setThreadRead({ threadIds: ids, read: operation === 'setRead' }) as unknown as IDataObject;
				} else if (operation === 'addLabel' || operation === 'removeLabel') {
					const ids = toIdArray(this.getNodeParameter('threadIds', i));
					const labelId = this.getNodeParameter('labelId', i) as number;
					data = operation === 'addLabel'
						? await mc.addThreadLabel({ threadIds: ids, labelId }) as unknown as IDataObject
						: await mc.removeThreadLabel({ threadIds: ids, labelId }) as unknown as IDataObject;
				} else if (operation === 'move') {
					const ids = toIdArray(this.getNodeParameter('threadIds', i));
					data = await mc.moveThread({
						threadIds: ids,
						mailboxId: this.getNodeParameter('threadDestMailbox', i, -6) as number,
						operateMailboxId: this.getNodeParameter('threadSrcMailbox', i, -1) as number,
					}) as unknown as IDataObject;
				} else if (operation === 'delete') {
					const ids = toIdArray(this.getNodeParameter('threadIds', i));
					data = await mc.deleteThread({ threadIds: ids, mailboxId: this.getNodeParameter('threadSrcMailbox', i, -1) as number }) as unknown as IDataObject;
				}
			} else if (resource === 'label') {
				if (operation === 'create') {
					data = await mc.createLabel({
						name: this.getNodeParameter('labelName', i) as string,
						backgroundColor: this.getNodeParameter('backgroundColor', i, 'FFCCCC') as string,
						textColor: this.getNodeParameter('textColor', i, 'FFFFFF') as string,
					}) as unknown as IDataObject;
				} else if (operation === 'set') {
					data = await mc.updateLabel({
						labelId: this.getNodeParameter('labelId2', i) as number,
						name: (this.getNodeParameter('labelName', i, '') as string) || undefined,
						backgroundColor: (this.getNodeParameter('backgroundColor', i, '') as string) || undefined,
						textColor: (this.getNodeParameter('textColor', i, '') as string) || undefined,
					}) as unknown as IDataObject;
				} else if (operation === 'delete') {
					const ids = toIdArray(this.getNodeParameter('labelIds', i));
					data = await mc.deleteLabels(ids) as unknown as IDataObject;
				}
			} else if (resource === 'mailbox') {
				if (operation === 'create') {
					data = await mc.createMailbox({ name: this.getNodeParameter('mailboxName', i) as string }) as unknown as IDataObject;
				} else if (operation === 'set') {
					data = await mc.updateMailbox({
						mailboxId: this.getNodeParameter('mailboxId2', i) as number,
						name: (this.getNodeParameter('mailboxName', i, '') as string) || undefined,
					}) as unknown as IDataObject;
				} else if (operation === 'delete') {
					data = await mc.deleteMailbox(this.getNodeParameter('mailboxId2', i) as number) as unknown as IDataObject;
				}
			} else if (resource === 'signature') {
				if (operation === 'list') {
					data = await mc.listSignatures() as unknown as IDataObject;
				} else if (operation === 'create') {
					data = await mc.createSignature({
						name: this.getNodeParameter('sigName', i) as string,
						content: this.getNodeParameter('sigContent', i, '') as string,
					}) as unknown as IDataObject;
				} else if (operation === 'delete') {
					const ids = toIdArray(this.getNodeParameter('sigIds', i));
					data = await mc.deleteSignatures(ids) as unknown as IDataObject;
				}
			} else if (resource === 'filter' && operation === 'list') {
				data = await mc.listFilters() as unknown as IDataObject;
			} else if (resource === 'smtp' && operation === 'list') {
				data = await mc.listSmtpAccounts() as unknown as IDataObject;
			} else if (resource === 'template' && operation === 'list') {
				data = await mc.listMailTemplates() as unknown as IDataObject;
			} else if (resource === 'mailMerge' && operation === 'list') {
				data = await mc.listMailMerges() as unknown as IDataObject;
			}

			returnData.push({ json: (data ?? { message: `Operation ${resource}.${operation} completed` }) as IDataObject, pairedItem: { item: i } });
		}

		return [returnData];
	}
}
