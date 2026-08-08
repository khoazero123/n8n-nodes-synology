import { NodeOperationError } from 'n8n-workflow';
import { MAIN_CONNECTION_TYPE } from '../shared/connectionTypes';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NoteStationClient } from '../../apps/noteStation/NoteStationClient';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

const notebookOperations = [
	{ name: 'Create', value: 'create', action: 'Create a notebook' },
	{ name: 'Delete', value: 'delete', action: 'Delete a notebook' },
	{ name: 'Get', value: 'get', action: 'Get a notebook' },
	{ name: 'Get Many', value: 'getMany', action: 'Get many notebooks' },
	{ name: 'Update', value: 'update', action: 'Update a notebook' },
];

const noteOperations = [
	{ name: 'Append Content', value: 'append', action: 'Append note content' },
	{ name: 'Create', value: 'create', action: 'Create a note' },
	{ name: 'Delete', value: 'delete', action: 'Delete a note' },
	{ name: 'Get', value: 'get', action: 'Get a note' },
	{ name: 'Get Many', value: 'getMany', action: 'Get many notes' },
	{ name: 'Prepend Content', value: 'prepend', action: 'Prepend note content' },
	{ name: 'Restore', value: 'restore', action: 'Restore a note from recycle bin' },
	{ name: 'Update', value: 'update', action: 'Update a note' },
];

const versionOperations = [
	{ name: 'Get', value: 'get', action: 'Get a note version' },
	{ name: 'Get Many', value: 'getMany', action: 'Get many note versions' },
	{ name: 'Restore', value: 'restore', action: 'Restore a note version' },
];

const shelfOperations = [
	{ name: 'Create', value: 'create', action: 'Create a shelf stack' },
	{ name: 'Delete', value: 'delete', action: 'Delete a shelf stack' },
	{ name: 'Rename', value: 'rename', action: 'Rename a shelf stack' },
];

const shareOperations = [
	{ name: 'Delete Public Share', value: 'deletePublic', action: 'Delete public share' },
	{ name: 'Get Public Link', value: 'getPublicLink', action: 'Get public share link' },
	{ name: 'List Share Principals', value: 'listPrincipals', action: 'List users and groups' },
	{ name: 'Remove Group Share', value: 'removeGroup', action: 'Remove group share' },
	{ name: 'Remove User Share', value: 'removeUser', action: 'Remove user share' },
	{ name: 'Share with Group', value: 'setGroup', action: 'Share with group' },
	{ name: 'Set Public Share', value: 'setPublic', action: 'Set public share' },
	{ name: 'Share with User', value: 'setUser', action: 'Share with user' },
];

const tagOperations = [
	{ name: 'Get Many', value: 'getMany', action: 'Get many tags' },
];

const infoOperations = [
	{ name: 'Get', value: 'get', action: 'Get Note Station information' },
];

const encryptionOperations = [
	{ name: 'Create Token', value: 'create', action: 'Create an encryption token' },
	{ name: 'Check Token', value: 'check', action: 'Check an encryption token' },
	{ name: 'Delete Token', value: 'delete', action: 'Delete an encryption token' },
];

const exportOperations = [
	{ name: 'Start', value: 'start', action: 'Start an export task' },
	{ name: 'Status', value: 'status', action: 'Get export task status' },
	{ name: 'Download', value: 'download', action: 'Download a completed export' },
];

const importOperations = [
	{ name: 'Import ENEX', value: 'enex', action: 'Import an ENEX file' },
	{ name: 'Import Notebook', value: 'notebook', action: 'Import a Note Station notebook export' },
];

const attachmentOperations = [
	{ name: 'List', value: 'list', action: 'List note attachments' },
	{ name: 'Upload', value: 'upload', action: 'Upload a note attachment' },
	{ name: 'Download', value: 'download', action: 'Download a note attachment' },
	{ name: 'Delete', value: 'delete', action: 'Delete a note attachment' },
];

export class SynologyNoteStation implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology Note Station',
		name: 'synologyNoteStation',
		icon: { light: 'file:SynologyNoteStation.svg', dark: 'file:SynologyNoteStation-dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Automate Synology Note Station notebooks, notes, shelves, shares, and attachments',
		defaults: { name: 'Synology Note Station' },
		 
		inputs: [MAIN_CONNECTION_TYPE],
		 
		outputs: [MAIN_CONNECTION_TYPE],
		credentials: [{ name: 'synologyApi', required: true }],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Attachment', value: 'attachment' },
					{ name: 'Encryption', value: 'encryption' },
					{ name: 'Export', value: 'export' },
					{ name: 'Import', value: 'import' },
					{ name: 'Info', value: 'info' },
					{ name: 'Note', value: 'note' },
					{ name: 'Notebook', value: 'notebook' },
					{ name: 'Share', value: 'share' },
					{ name: 'Shelf', value: 'shelf' },
					{ name: 'Tag', value: 'tag' },
					{ name: 'Version', value: 'version' },
				],
				default: 'note',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['notebook'] } },
				options: notebookOperations,
				default: 'getMany',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['note'] } },
				options: noteOperations,
				default: 'getMany',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['shelf'] } },
				options: shelfOperations,
				default: 'create',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['share'] } },
				options: shareOperations,
				default: 'setPublic',
			},
			{
				displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
				displayOptions: { show: { resource: ['tag'] } }, options: tagOperations, default: 'getMany',
			},
			{
				displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
				displayOptions: { show: { resource: ['info'] } }, options: infoOperations, default: 'get',
			},
			{
				displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
				displayOptions: { show: { resource: ['version'] } }, options: versionOperations, default: 'getMany',
			},
			{
				displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
				displayOptions: { show: { resource: ['encryption'] } }, options: encryptionOperations, default: 'create',
			},
			{
				displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
				displayOptions: { show: { resource: ['export'] } }, options: exportOperations, default: 'start',
			},
			{
				displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
				displayOptions: { show: { resource: ['import'] } }, options: importOperations, default: 'enex',
			},
			{
				displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
				displayOptions: { show: { resource: ['attachment'] } }, options: attachmentOperations, default: 'download',
			},
			{
				displayName: 'Object ID',
				name: 'objectId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['notebook'],
						operation: ['get', 'update', 'delete'],
					},
				},
				description: 'Notebook object_id',
			},
			{
				displayName: 'Object ID',
				name: 'objectId',
				type: 'string',
				required: true,
				default: '',
					displayOptions: {
						show: {
							resource: ['note'],
							operation: ['get', 'update', 'delete', 'restore', 'append', 'prepend'],
						},
					},
				description: 'Note object_id',
			},
			{
				displayName: 'Object ID',
				name: 'objectId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['version'], operation: ['get', 'getMany', 'restore'] } },
				description: 'Note object_id',
			},
			{
				displayName: 'Version',
				name: 'version',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['version'], operation: ['get', 'restore'] } },
				description: 'Version hash. Leave empty on get to fetch the latest version metadata returned by the API.',
			},
			{
				displayName: 'Password', name: 'password', type: 'string', typeOptions: { password: true }, default: '',
				displayOptions: { show: { resource: ['encryption'], operation: ['create'] } },
			},
			{
				displayName: 'Token', name: 'token', type: 'string', typeOptions: { password: true }, default: '',
				displayOptions: { show: { resource: ['encryption'], operation: ['check', 'delete'] } },
			},
			{
				displayName: 'Export Object ID', name: 'exportObjectId', type: 'string', required: true, default: '',
				displayOptions: { show: { resource: ['export'], operation: ['start'] } },
			},
			{
				displayName: 'Export Format', name: 'exportFormat', type: 'options',
				options: [{ name: 'HTML', value: 'note' }, { name: 'Word', value: 'word' }, { name: 'Notebook', value: 'notebook' }], default: 'note',
				displayOptions: { show: { resource: ['export'] } },
			},
			{
				displayName: 'Task ID', name: 'taskId', type: 'string', default: '',
				displayOptions: { show: { resource: ['export'], operation: ['status', 'download'] } },
			},
			{
				displayName: 'Note Object ID', name: 'objectId', type: 'string', required: true, default: '',
				displayOptions: { show: { resource: ['attachment'] } },
				description: 'Note object_id',
			},
			{
				displayName: 'Attachment Version', name: 'attachmentVersion', type: 'string', required: true, default: '',
				displayOptions: { show: { resource: ['attachment'], operation: ['upload', 'download', 'delete'] } },
			},
			{
				displayName: 'Attachment File ID', name: 'attachmentFileId', type: 'string', required: true, default: '',
				displayOptions: { show: { resource: ['attachment'], operation: ['download', 'delete'] } },
			},
			{
				displayName: 'Binary Property', name: 'binaryProperty', type: 'string', default: 'data',
				displayOptions: { show: { resource: ['import', 'attachment'], operation: ['enex', 'notebook', 'upload'] } },
				description: 'Input binary property containing the ENEX, Notebook, or attachment file',
			},
			{
				displayName: 'Notebook ID',
				name: 'parentId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['note'], operation: ['create'] } },
				description: 'Parent notebook object_id',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['notebook'],
						operation: ['create', 'update'],
					},
				},
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['note'],
						operation: ['create', 'update'],
					},
				},
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 8 },
				default: '<div></div>',
				displayOptions: {
					show: {
						resource: ['note'],
						operation: ['create', 'update', 'append', 'prepend'],
					},
				},
				description: 'HTML content to write to the note',
			},
			{
				displayName: 'Brief',
				name: 'brief',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['note'], operation: ['create', 'update'] } },
				description: 'Plain summary for the note',
			},
			{
				displayName: 'Move to Notebook ID',
				name: 'newParentId',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['note'], operation: ['update'] } },
				description: 'Optional target notebook object_id',
			},
			{
				displayName: 'Return Full Note',
				name: 'returnFullNote',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['note'], operation: ['create', 'update'] } },
				description: 'Whether to fetch and return the full note after creating or updating it',
			},
			{
				displayName: 'Stack ID',
				name: 'stackId',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['shelf'], operation: ['rename', 'delete'] } },
				description: 'Shelf/stack ID',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['shelf'], operation: ['create', 'rename'] } },
				description: 'Shelf/stack name',
			},
			{
				displayName: 'Object ID',
				name: 'shareObjectId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['share'], operation: ['setPublic', 'deletePublic', 'getPublicLink', 'setUser', 'setGroup', 'removeUser', 'removeGroup'] } },
				description: 'Note, notebook, or smart note object_id to share',
			},
			{
				displayName: 'Permission',
				name: 'permission',
				type: 'options',
				default: 'ro',
				displayOptions: { show: { resource: ['share'], operation: ['setPublic', 'setUser', 'setGroup'] } },
				options: [
					{ name: 'Read Only', value: 'ro' },
					{ name: 'Read Write', value: 'rw' },
				],
			},
			{
				displayName: 'Principal Name', name: 'principalName', type: 'string', required: true, default: '',
				displayOptions: { show: { resource: ['share'], operation: ['setUser', 'setGroup', 'removeUser', 'removeGroup'] } },
				description: 'DSM username or group name',
			},
			{
				displayName: 'Principal Type', name: 'principalType', type: 'options', required: true,
				options: [{ name: 'Group', value: 'group' }, { name: 'User', value: 'user' }], default: 'user',
				displayOptions: { show: { resource: ['share'], operation: ['listPrincipals'] } },
			},
			{
				displayName: 'Recursive',
				name: 'recursive',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['notebook'], operation: ['delete'] } },
				description: 'Whether to delete child notes recursively',
			},
			{
				displayName: 'Move to Recycle Bin',
				name: 'recycle',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['note'], operation: ['delete'] } },
				description: 'Whether to move the note to the recycle bin instead of deleting it directly',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: { show: { operation: ['getMany'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				default: 0,
				displayOptions: { show: { operation: ['getMany'] } },
				description: 'Number of results to skip',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
		const noteStation = new NoteStationClient(new SynologyClient(this, credentials));
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;
			let data;

			if (resource === 'notebook') {
				if (operation === 'getMany') data = await noteStation.listNotebooks({ limit: this.getNodeParameter('limit', i) as number, offset: this.getNodeParameter('offset', i) as number });
				if (operation === 'get') data = await noteStation.getNotebook(this.getNodeParameter('objectId', i) as string);
				if (operation === 'create') data = await noteStation.createNotebook({ title: this.getNodeParameter('title', i) as string });
				if (operation === 'update') data = await noteStation.updateNotebook({ objectId: this.getNodeParameter('objectId', i) as string, title: this.getNodeParameter('title', i) as string });
				if (operation === 'delete') data = await noteStation.deleteNotebook({ objectId: this.getNodeParameter('objectId', i) as string, recursive: this.getNodeParameter('recursive', i) as boolean });
			} else if (resource === 'note') {
				if (operation === 'getMany') data = await noteStation.listNotes({ limit: this.getNodeParameter('limit', i) as number, offset: this.getNodeParameter('offset', i) as number });
				if (operation === 'get') data = await noteStation.getNote(this.getNodeParameter('objectId', i) as string);
				if (operation === 'create') {
					data = await noteStation.createNote({ title: this.getNodeParameter('title', i) as string, parentId: this.getNodeParameter('parentId', i) as string, content: this.getNodeParameter('content', i) as string, brief: this.getNodeParameter('brief', i) as string });
					if (this.getNodeParameter('returnFullNote', i) as boolean && data?.object_id) data = await noteStation.getNote(data.object_id as string);
				}
				if (operation === 'update') {
					const objectId = this.getNodeParameter('objectId', i) as string;
					data = await noteStation.updateNote({ objectId, title: this.getNodeParameter('title', i) as string || undefined, parentId: this.getNodeParameter('newParentId', i) as string || undefined, content: this.getNodeParameter('content', i) as string || undefined, brief: this.getNodeParameter('brief', i) as string || undefined });
					if (this.getNodeParameter('returnFullNote', i) as boolean) data = await noteStation.getNote(objectId);
				}
				if (operation === 'append') data = await noteStation.appendNoteContent(this.getNodeParameter('objectId', i) as string, this.getNodeParameter('content', i) as string, 'append');
				if (operation === 'prepend') data = await noteStation.appendNoteContent(this.getNodeParameter('objectId', i) as string, this.getNodeParameter('content', i) as string, 'prepend');
				if (operation === 'delete') data = await noteStation.deleteNote({ objectId: this.getNodeParameter('objectId', i) as string, recycle: this.getNodeParameter('recycle', i) as boolean });
				if (operation === 'restore') data = await noteStation.restoreNote(this.getNodeParameter('objectId', i) as string);
			} else if (resource === 'shelf') {
				if (operation === 'create') data = await noteStation.setStack({ name: this.getNodeParameter('name', i) as string });
				if (operation === 'rename') data = await noteStation.setStack({ stackId: this.getNodeParameter('stackId', i) as string, name: this.getNodeParameter('name', i) as string });
				if (operation === 'delete') data = await noteStation.deleteStack({ stackId: this.getNodeParameter('stackId', i) as string });
			} else if (resource === 'share') {
				const objectId = operation === 'listPrincipals' ? '' : this.getNodeParameter('shareObjectId', i) as string;
				if (operation === 'setPublic') data = await noteStation.setPublicShare({ objectId, permission: this.getNodeParameter('permission', i) as 'ro' | 'rw' });
				if (operation === 'deletePublic') data = await noteStation.deletePublicShare({ objectId });
				if (operation === 'getPublicLink') data = await noteStation.getPublicShareLink({ objectId });
				if (operation === 'listPrincipals') data = await noteStation.listShares();
				if (operation === 'setUser') data = await noteStation.setUserShare({ objectId, name: this.getNodeParameter('principalName', i) as string, permission: this.getNodeParameter('permission', i) as 'ro' | 'rw' });
				if (operation === 'setGroup') data = await noteStation.setGroupShare({ objectId, name: this.getNodeParameter('principalName', i) as string, permission: this.getNodeParameter('permission', i) as 'ro' | 'rw' });
				if (operation === 'removeUser') data = await noteStation.removeUserShare({ objectId, name: this.getNodeParameter('principalName', i) as string });
				if (operation === 'removeGroup') data = await noteStation.removeGroupShare({ objectId, name: this.getNodeParameter('principalName', i) as string });
			} else if (resource === 'tag') {
				if (operation === 'getMany') data = await noteStation.listTags({ limit: this.getNodeParameter('limit', i) as number, offset: this.getNodeParameter('offset', i) as number });
			} else if (resource === 'info') {
				if (operation === 'get') data = await noteStation.getInfo();
			} else if (resource === 'version') {
				const objectId = this.getNodeParameter('objectId', i) as string;
				if (operation === 'getMany') data = await noteStation.listVersions({ objectId });
				if (operation === 'get') data = await noteStation.getVersion({ objectId, version: this.getNodeParameter('version', i) as string || undefined });
				if (operation === 'restore') data = await noteStation.restoreVersion({ objectId, version: this.getNodeParameter('version', i) as string });
			} else if (resource === 'encryption') {
				const objectId = this.getNodeParameter('objectId', i) as string;
				if (operation === 'create') data = await noteStation.createEncryptToken({ objectId, password: this.getNodeParameter('password', i) as string });
				if (operation === 'check') data = await noteStation.checkEncryptToken({ objectId, token: this.getNodeParameter('token', i) as string });
				if (operation === 'delete') data = await noteStation.deleteEncryptToken({ objectId, token: this.getNodeParameter('token', i) as string });
			} else if (resource === 'export') {
				const format = this.getNodeParameter('exportFormat', i) as 'note' | 'word' | 'notebook';
				if (operation === 'start') data = await noteStation.startExport({ objectId: this.getNodeParameter('exportObjectId', i) as string }, format);
				if (operation === 'status') data = await noteStation.exportStatus(this.getNodeParameter('taskId', i) as string, format);
				if (operation === 'download') {
					const response = await noteStation.downloadExport(this.getNodeParameter('taskId', i) as string, format);
					const buffer = await this.helpers.binaryToBuffer(response.body as Buffer | import('stream').Readable);
					const headers = response.headers as Record<string, string>;
					const fileName = /filename="?([^";]+)"?/i.exec(headers['content-disposition'] ?? '')?.[1] ?? `notestation-${format}`;
					const mimeType = headers['content-type']?.split(';')[0] ?? 'application/octet-stream';
					const binary = await this.helpers.prepareBinaryData(buffer, fileName, mimeType);
					returnData.push({ json: {}, binary: { data: binary }, pairedItem: { item: i } });
					continue;
				}
			} else if (resource === 'attachment') {
				if (operation === 'list') { data = await noteStation.listAttachments(this.getNodeParameter('objectId', i) as string); }
				if (operation === 'upload') {
					const binaryProperty = this.getNodeParameter('binaryProperty', i) as string;
					const binary = items[i].binary?.[binaryProperty];
					if (!binary) throw new NodeOperationError(this.getNode(), `Binary property '${binaryProperty}' was not found`, { itemIndex: i });
					data = await noteStation.uploadAttachment({ objectId: this.getNodeParameter('objectId', i) as string, version: this.getNodeParameter('attachmentVersion', i) as string, fileId: '', filename: binary.fileName ?? 'attachment', data: await this.helpers.getBinaryDataBuffer(i, binaryProperty), contentType: binary.mimeType });
				}
				if (operation === 'delete') { data = await noteStation.deleteAttachment({ objectId: this.getNodeParameter('objectId', i) as string, version: this.getNodeParameter('attachmentVersion', i) as string, fileId: this.getNodeParameter('attachmentFileId', i) as string }); }
				if (operation !== 'download') { returnData.push({ json: data ?? {}, pairedItem: { item: i } }); continue; }
				const response = await noteStation.getAttachment({ objectId: this.getNodeParameter('objectId', i) as string, version: this.getNodeParameter('attachmentVersion', i) as string, fileId: this.getNodeParameter('attachmentFileId', i) as string });
				const buffer = await this.helpers.binaryToBuffer(response.body as Buffer | import('stream').Readable);
				const headers = response.headers as Record<string, string>;
				const fileName = /filename="?([^";]+)"?/i.exec(headers['content-disposition'] ?? '')?.[1] ?? this.getNodeParameter('attachmentFileId', i) as string;
				const binary = await this.helpers.prepareBinaryData(buffer, fileName, headers['content-type']?.split(';')[0] ?? 'application/octet-stream');
				returnData.push({ json: {}, binary: { data: binary }, pairedItem: { item: i } });
				continue;
			} else if (resource === 'import') {
				const binaryProperty = this.getNodeParameter('binaryProperty', i) as string;
				const binary = items[i].binary?.[binaryProperty];
				if (!binary) throw new NodeOperationError(this.getNode(), `Binary property '${binaryProperty}' was not found`, { itemIndex: i });
				const buffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);
				data = await noteStation.importFile({ filename: binary.fileName ?? `${operation}.bin`, data: buffer, contentType: binary.mimeType }, operation as 'enex' | 'notebook');
			}

			returnData.push({ json: data ?? { message: `Operation ${resource}.${operation} is planned but not implemented yet` }, pairedItem: { item: i } });
		}

		return [returnData];
	}
}
