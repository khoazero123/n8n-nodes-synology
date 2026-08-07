import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { PhotoClient } from '../../apps/photoClient/PhotoClient';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

const albumOperations = [
	{ name: 'List', value: 'list', action: 'List all albums' },
	{ name: 'List Normal Albums', value: 'listNormal', action: 'List normal (manual) albums' },
	{ name: 'List Conditional Albums', value: 'listCondition', action: 'List conditional (smart) albums' },
];

const folderOperations = [
	{ name: 'List Personal Space', value: 'list', action: 'List folders in the personal space' },
	{ name: 'List Shared Space', value: 'listTeam', action: 'List folders in the shared space' },
];

const itemOperations = [
	{ name: 'List', value: 'list', action: 'List photos/videos in an album or folder' },
	{ name: 'Get Thumbnail', value: 'thumbnail', action: 'Get a thumbnail (binary)' },
	{ name: 'Download Original', value: 'download', action: 'Download the original file (binary)' },
];

export class SynologyPhotos implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology Photos',
		name: 'synologyPhotos',
		icon: { light: 'file:SynologyPhotos.svg', dark: 'file:SynologyPhotos-dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Work with Synology Photos: list albums and photos, download originals and thumbnails, search',
		defaults: { name: 'Synology Photos' },
		 
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
					{ name: 'Album', value: 'album' },
					{ name: 'Folder', value: 'folder' },
					{ name: 'Item', value: 'item' },
				],
				default: 'album',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['album'] } },
				options: albumOperations,
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['folder'] } },
				options: folderOperations,
				default: 'list',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['item'] } },
				options: itemOperations,
				default: 'list',
			},

			// --- shared list params ---
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				description: 'Max number of results to return',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: { show: { resource: ['album', 'folder', 'item'], operation: ['list', 'listNormal', 'listCondition', 'listTeam'] } },
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['album', 'folder', 'item'], operation: ['list', 'listNormal', 'listCondition', 'listTeam'] } },
			},
			// --- item list params ---
			{
				displayName: 'Album ID',
				name: 'itemAlbumId',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['item'], operation: ['list'] } },
				description: 'Album to list items from (set this or Folder ID)',
			},
			{
				displayName: 'Folder ID',
				name: 'itemFolderId',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['item'], operation: ['list'] } },
				description: 'Folder to list items from (set this or Album ID)',
			},
			{
				displayName: 'Type',
				name: 'itemType',
				type: 'options',
				options: [
					{ name: 'Photo', value: 'photo' },
					{ name: 'Video', value: 'video' },
					{ name: 'All', value: 'all' },
				],
				default: 'all',
				displayOptions: { show: { resource: ['item'], operation: ['list'] } },
			},
			{
				displayName: 'Include Thumbnail Info',
				name: 'itemThumbnail',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['item'], operation: ['list'] } },
				description: 'Whether to include thumbnail cache keys (needed for Get Thumbnail / Download Original)',
			},
			{
				displayName: 'Shared Space',
				name: 'itemTeam',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['item'], operation: ['list'] } },
				description: 'Whether to query the shared space instead of the personal space',
			},
			// --- item get/download params ---
			{
				displayName: 'Item ID',
				name: 'itemId',
				type: 'number',
				required: true,
				default: 0,
				displayOptions: { show: { resource: ['item'], operation: ['thumbnail', 'download'] } },
			},
			{
				displayName: 'Cache Key',
				name: 'cacheKey',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['item'], operation: ['thumbnail', 'download'] } },
				description: 'Thumbnail cache key from Item List (e.g. 45691_1767056435)',
			},
			{
				displayName: 'Thumbnail Size',
				name: 'thumbSize',
				type: 'options',
				options: [
					{ name: 'Small (240px)', value: 'sm' },
					{ name: 'Medium (320px)', value: 'm' },
					{ name: 'Large (1280px)', value: 'xl' },
				],
				default: 'xl',
				displayOptions: { show: { resource: ['item'], operation: ['thumbnail'] } },
			},

		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
		const synology = new SynologyClient(this, credentials);
		const photos = new PhotoClient(synology);
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;
			let data: IDataObject | IDataObject[] | Buffer | undefined;

			if (resource === 'album') {
				if (operation === 'list') {
					data = await photos.listAlbums({ offset: this.getNodeParameter('offset', i, 0) as number, limit: this.getNodeParameter('limit', i, 100) as number }) as unknown as IDataObject;
				} else if (operation === 'listNormal') {
					data = await photos.listNormalAlbums({ offset: this.getNodeParameter('offset', i, 0) as number, limit: this.getNodeParameter('limit', i, 100) as number }) as unknown as IDataObject;
				} else if (operation === 'listCondition') {
					data = await photos.listConditionAlbums({ offset: this.getNodeParameter('offset', i, 0) as number, limit: this.getNodeParameter('limit', i, 100) as number }) as unknown as IDataObject;
				}
			} else if (resource === 'folder') {
				if (operation === 'list') {
					data = await photos.listFolders({ offset: this.getNodeParameter('offset', i, 0) as number, limit: this.getNodeParameter('limit', i, 100) as number }) as unknown as IDataObject;
				} else if (operation === 'listTeam') {
					data = await photos.listTeamFolders({ offset: this.getNodeParameter('offset', i, 0) as number, limit: this.getNodeParameter('limit', i, 100) as number }) as unknown as IDataObject;
				}
			} else if (resource === 'item') {
				const additional = (this.getNodeParameter('itemThumbnail', i, true) as boolean) ? ['thumbnail', 'resolution', 'orientation'] : undefined;
				if (operation === 'list') {
					data = await photos.listItems({
						albumId: this.getNodeParameter('itemAlbumId', i, 0) as number || undefined,
						folderId: this.getNodeParameter('itemFolderId', i, 0) as number || undefined,
						type: this.getNodeParameter('itemType', i, 'all') as 'photo' | 'video' | 'all',
						offset: this.getNodeParameter('offset', i, 0) as number,
						limit: this.getNodeParameter('limit', i, 100) as number,
						additional,
						team: this.getNodeParameter('itemTeam', i, false) as boolean,
					}) as unknown as IDataObject;
				} else if (operation === 'thumbnail') {
					const buf = await photos.getThumbnail(
						this.getNodeParameter('itemId', i) as number,
						this.getNodeParameter('cacheKey', i) as string,
						this.getNodeParameter('thumbSize', i, 'xl') as 'sm' | 'm' | 'xl',
					);
					returnData.push({
						json: { itemId: this.getNodeParameter('itemId', i) as number, size: this.getNodeParameter('thumbSize', i, 'xl') as string },
						binary: { data: await this.helpers.prepareBinaryData(buf, `thumb-${this.getNodeParameter('itemId', i)}.jpg`, 'image/jpeg') },
						pairedItem: { item: i },
					});
					continue;
				} else if (operation === 'download') {
					const buf = await photos.downloadOriginal(
						this.getNodeParameter('itemId', i) as number,
						this.getNodeParameter('cacheKey', i) as string,
					);
					returnData.push({
						json: { itemId: this.getNodeParameter('itemId', i) as number, size: buf.length },
						binary: { data: await this.helpers.prepareBinaryData(buf, `download-${this.getNodeParameter('itemId', i)}.jpg`, 'image/jpeg') },
						pairedItem: { item: i },
					});
					continue;
				}
			}

			returnData.push({ json: (data ?? { message: `Operation ${resource}.${operation} completed` }) as IDataObject, pairedItem: { item: i } });
		}

		return [returnData];
	}
}
