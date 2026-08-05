import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
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
	{ name: 'Update', value: 'update', action: 'Update a note' },
];

const shelfOperations = [
	{ name: 'Create', value: 'create', action: 'Create a shelf stack' },
	{ name: 'Delete', value: 'delete', action: 'Delete a shelf stack' },
	{ name: 'Rename', value: 'rename', action: 'Rename a shelf stack' },
];

const shareOperations = [
	{ name: 'Delete Public Share', value: 'deletePublic', action: 'Delete public share' },
	{ name: 'Get Public Link', value: 'getPublicLink', action: 'Get public share link' },
	{ name: 'Set Public Share', value: 'setPublic', action: 'Set public share' },
];

export class SynologyNoteStation implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology Note Station',
		name: 'synologyNoteStation',
		icon: 'file:SynologyNoteStation.svg',
		group: ['input'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Automate Synology Note Station notebooks, notes, shelves, shares, and attachments',
		defaults: { name: 'Synology Note Station' },
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
					{ name: 'Notebook', value: 'notebook' },
					{ name: 'Note', value: 'note' },
							{ name: 'Shelf', value: 'shelf' },
					{ name: 'Share', value: 'share' },
					{ name: 'Attachment', value: 'attachment' },
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
						operation: ['get', 'update', 'delete', 'append', 'prepend'],
					},
				},
				description: 'Note object_id',
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
				displayOptions: { show: { resource: ['share'] } },
				description: 'Note, notebook, or smart note object_id to share',
			},
			{
				displayName: 'Permission',
				name: 'permission',
				type: 'options',
				default: 'ro',
				displayOptions: { show: { resource: ['share'], operation: ['setPublic'] } },
				options: [
					{ name: 'Read Only', value: 'ro' },
					{ name: 'Read Write', value: 'rw' },
				],
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
			} else if (resource === 'shelf') {
				if (operation === 'create') data = await noteStation.setStack({ name: this.getNodeParameter('name', i) as string });
				if (operation === 'rename') data = await noteStation.setStack({ stackId: this.getNodeParameter('stackId', i) as string, name: this.getNodeParameter('name', i) as string });
				if (operation === 'delete') data = await noteStation.deleteStack({ stackId: this.getNodeParameter('stackId', i) as string });
			} else if (resource === 'share') {
				const objectId = this.getNodeParameter('shareObjectId', i) as string;
				if (operation === 'setPublic') data = await noteStation.setPublicShare({ objectId, permission: this.getNodeParameter('permission', i) as 'ro' | 'rw' });
				if (operation === 'deletePublic') data = await noteStation.deletePublicShare({ objectId });
				if (operation === 'getPublicLink') data = await noteStation.getPublicShareLink({ objectId });
			}

			returnData.push({ json: data ?? { message: `Operation ${resource}.${operation} is planned but not implemented yet` }, pairedItem: { item: i } });
		}

		return [returnData];
	}
}
