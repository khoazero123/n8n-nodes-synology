import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { MAIN_CONNECTION_TYPE } from '../shared/connectionTypes';
import { DownloadStationClient } from '../../apps/downloadStation/DownloadStationClient';
import { ADDITIONAL_FIELDS } from '../../apps/downloadStation/constants';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

const taskOperations = [
	{ name: 'Create Torrent', value: 'createTorrent', action: 'Create download task from a binary torrent file' },
	{ name: 'Create URL', value: 'createUrl', action: 'Create download task from URL or magnet link' },
	{ name: 'Delete', value: 'delete', action: 'Delete a download task' },
	{ name: 'Download Source', value: 'downloadSource', action: 'Download the original torrent file of a BT task' },
	{ name: 'Edit', value: 'edit', action: 'Edit a download task (destination or priority)' },
	{ name: 'Get', value: 'get', action: 'Get a download task' },
	{ name: 'Get Many', value: 'getMany', action: 'Get many download tasks' },
	{ name: 'Pause', value: 'pause', action: 'Pause a download task' },
	{ name: 'Resume', value: 'resume', action: 'Resume a download task' },
];

const statisticsOperations = [
	{ name: 'Get', value: 'get', action: 'Get download statistics and speeds' },
];

const infoOperations = [
	{ name: 'Get', value: 'get', action: 'Get Download Station information' },
	{ name: 'Get Config', value: 'getConfig', action: 'Get Download Station server configuration' },
];

const btSearchOperations = [
	{ name: 'Search', value: 'search', action: 'Search BT search modules for a keyword' },
];

const taskListOperations = [
	{ name: 'Get Files', value: 'getFiles', action: 'Get the file list of a pending task list' },
	{ name: 'Confirm Download', value: 'confirmDownload', action: 'Confirm a task list and create the real download tasks' },
	{ name: 'Get Download Status', value: 'getDownloadStatus', action: 'Check whether a task list download finished' },
	{ name: 'Stop Download', value: 'stopDownload', action: 'Stop polling a task list download' },
	{ name: 'Delete', value: 'delete', action: 'Delete a pending task list' },
];

export class SynologyDownloadStation implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology Download Station',
		name: 'synologyDownloadStation',
		icon: { light: 'file:SynologyDownloadStation.svg', dark: 'file:SynologyDownloadStation-dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Manage Synology Download Station tasks: create, list, pause, resume, delete, and get statistics',
		defaults: { name: 'Synology Download Station' },
		 
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
					{ name: 'BT Search', value: 'btSearch' },
					{ name: 'Info', value: 'info' },
					{ name: 'Statistic', value: 'statistics' },
					{ name: 'Task', value: 'task' },
					{ name: 'Task List', value: 'taskList' },
				],
				default: 'task',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['task'] } },
				options: taskOperations,
				default: 'getMany',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['statistics'] } },
				options: statisticsOperations,
				default: 'get',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['info'] } },
				options: infoOperations,
				default: 'get',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['btSearch'] } },
				options: btSearchOperations,
				default: 'search',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['taskList'] } },
				options: taskListOperations,
				default: 'getFiles',
			},
			// --- BT Search keyword ---
			{
				displayName: 'Keyword',
				name: 'keyword',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['btSearch'],
						operation: ['search'],
					},
				},
				description: 'Keyword to search for in BT search modules',
			},
			{
				displayName: 'Module',
				name: 'module',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['btSearch'],
						operation: ['search'],
					},
				},
				description: 'Optional BT search module ID to restrict the search to',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: { show: { resource: ['btSearch'], operation: ['search'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['btSearch'], operation: ['search'] } },
				description: 'Number of results to skip',
			},
			// --- Task ID (used by get, pause, resume, delete) ---
			{
				displayName: 'Task ID',
				name: 'taskId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['get', 'pause', 'resume', 'delete', 'edit', 'downloadSource'],
					},
				},
				description: 'Download task ID (e.g. dbid_123). Comma-separated for batch pause/resume/delete.',
			},
			{
				displayName: 'New Destination Folder',
				name: 'editDestination',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['task'], operation: ['edit'] } },
				description: 'New destination folder path on the NAS',
			},
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				options: [
					{ name: 'Low', value: 'low' },
					{ name: 'Normal', value: 'normal' },
					{ name: 'High', value: 'high' },
				],
				default: 'normal',
				displayOptions: { show: { resource: ['task'], operation: ['edit'] } },
				description: 'New task priority',
			},
			// --- Create Torrent ---
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				required: true,
				default: 'data',
				displayOptions: { show: { resource: ['task'], operation: ['createTorrent'] } },
				description: 'Incoming binary property containing the torrent file',
			},
			{
				displayName: 'Destination Folder',
				name: 'torrentDestination',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['task'], operation: ['createTorrent'] } },
				description: 'Optional destination folder path on the NAS',
			},
			{
				displayName: 'Create File List',
				name: 'createList',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['task'], operation: ['createTorrent'] } },
				description: 'Whether Download Station should create a file list for the uploaded task',
			},
			// --- Task List ---
			{
				displayName: 'List ID',
				name: 'listId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['taskList'],
						operation: ['getFiles', 'confirmDownload', 'delete'],
					},
				},
				description: 'Task list ID (e.g. btdl_xxx) returned by Create Torrent with Create File List enabled',
			},
			{
				displayName: 'Polling Task ID',
				name: 'pollingTaskId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['taskList'],
						operation: ['getDownloadStatus', 'stopDownload'],
					},
				},
				description: 'Polling task ID returned by Confirm Download',
			},
			{
				displayName: 'Destination Folder',
				name: 'listDestination',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['taskList'], operation: ['confirmDownload'] } },
				description: 'Optional destination folder path on the NAS',
			},
			{
				displayName: 'Create Subfolder',
				name: 'createSubfolder',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['taskList'], operation: ['confirmDownload'] } },
				description: 'Whether to create a subfolder for the downloaded content',
			},
			{
				displayName: 'Selected File Indices',
				name: 'selectedFiles',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['taskList'], operation: ['confirmDownload'] } },
				description: 'Comma-separated file indices to download (e.g. 0,2). Empty downloads all files.',
			},
			// --- Create URL ---
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createUrl'],
					},
				},
				description: 'Download URL (HTTP, FTP) or magnet link',
			},
			{
				displayName: 'Destination Folder',
				name: 'destination',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createUrl'],
					},
				},
				description: 'Optional destination folder path on the NAS',
			},
			{
				displayName: 'Username',
				name: 'downloadUsername',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createUrl'],
					},
				},
				description: 'Optional username for authenticated downloads',
			},
			{
				displayName: 'Password',
				name: 'downloadPassword',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createUrl'],
					},
				},
				description: 'Optional password for authenticated downloads',
			},
			// --- Force Complete (delete) ---
			{
				displayName: 'Force Complete',
				name: 'forceComplete',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['delete'],
					},
				},
				description: 'Whether to force complete the task before deleting it',
			},
			// --- Additional fields ---
			{
				displayName: 'Additional Fields',
				name: 'additional',
				type: 'multiOptions',
				options: [
					{ name: 'Detail', value: 'detail' },
					{ name: 'File', value: 'file' },
					{ name: 'Peer', value: 'peer' },
					{ name: 'Tracker', value: 'tracker' },
					{ name: 'Transfer', value: 'transfer' },
				],
				default: [],
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['get', 'getMany'],
					},
				},
				description: 'Additional data to include in the response',
			},
			// --- Pagination (getMany) ---
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: { show: { resource: ['task'], operation: ['getMany'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['task'], operation: ['getMany'] } },
				description: 'Number of tasks to skip',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
		const ds = new DownloadStationClient(new SynologyClient(this, credentials));
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;
			let data;

			if (resource === 'task') {
				if (operation === 'createTorrent') {
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
					const binary = items[i].binary?.[binaryPropertyName];
					if (!binary) throw new NodeApiError(this.getNode(), { message: `Binary property "${binaryPropertyName}" is missing` });
					data = await ds.createTorrentTask({
						data: await this.helpers.getBinaryDataBuffer(i, binaryPropertyName),
						filename: binary.fileName ?? `${binaryPropertyName}.torrent`,
						contentType: binary.mimeType,
						destination: (this.getNodeParameter('torrentDestination', i, '') as string) || undefined,
						createList: this.getNodeParameter('createList', i, false) as boolean,
					});
				} else if (operation === 'createUrl') {
					data = await ds.createUrlTask({
						url: this.getNodeParameter('url', i) as string,
						destination: (this.getNodeParameter('destination', i, '') as string) || undefined,
						username: (this.getNodeParameter('downloadUsername', i, '') as string) || undefined,
						password: (this.getNodeParameter('downloadPassword', i, '') as string) || undefined,
					});
				} else if (operation === 'downloadSource') {
					const response = await ds.getTaskSource({ taskId: this.getNodeParameter('taskId', i) as string });
					const buffer = Buffer.isBuffer(response.body) ? response.body : Buffer.from((response.body as ArrayBuffer | undefined) ?? new ArrayBuffer(0));
					const contentDisposition = response.headers?.['content-disposition'] as string | undefined;
					const fileName = contentDisposition?.match(/filename="?([^";]+)/i)?.[1] ?? `task-${this.getNodeParameter('taskId', i)}.torrent`;
					returnData.push({
						json: { taskId: this.getNodeParameter('taskId', i) as string, fileName, size: buffer.length },
						binary: {
							data: await this.helpers.prepareBinaryData(buffer, fileName, 'application/x-bittorrent'),
						},
						pairedItem: { item: i },
					});
					continue;
				} else if (operation === 'getMany') {
					const additional = this.getNodeParameter('additional', i, []) as string[];
					data = await ds.listTasks({
						offset: this.getNodeParameter('offset', i, 0) as number,
						limit: this.getNodeParameter('limit', i, 50) as number,
						additional: additional.length > 0 ? additional as typeof ADDITIONAL_FIELDS[number][] : undefined,
					});
				} else if (operation === 'get') {
					const additional = this.getNodeParameter('additional', i, []) as string[];
					data = await ds.getTask(
						this.getNodeParameter('taskId', i) as string,
						additional.length > 0 ? additional : undefined,
					);
				} else if (operation === 'pause') {
					data = { task: await ds.pauseTasks(this.getNodeParameter('taskId', i) as string) };
				} else if (operation === 'resume') {
					data = { task: await ds.resumeTasks(this.getNodeParameter('taskId', i) as string) };
				} else if (operation === 'delete') {
					data = {
						task: await ds.deleteTasks(
							this.getNodeParameter('taskId', i) as string,
							this.getNodeParameter('forceComplete', i, false) as boolean,
						),
					};
				} else if (operation === 'edit') {
					data = {
						task: await ds.editTask({
							taskId: this.getNodeParameter('taskId', i) as string,
							destination: (this.getNodeParameter('editDestination', i, '') as string) || undefined,
							priority: this.getNodeParameter('priority', i, 'normal') as 'low' | 'normal' | 'high',
						}),
					};
				}
			} else if (resource === 'statistics') {
				if (operation === 'get') {
					data = await ds.getStatistics();
				}
			} else if (resource === 'info') {
				if (operation === 'get') {
					data = await ds.getInfo();
				} else if (operation === 'getConfig') {
					data = await ds.getConfig();
				}
			} else if (resource === 'btSearch') {
				if (operation === 'search') {
					data = await ds.btSearch({
						keyword: this.getNodeParameter('keyword', i) as string,
						module: (this.getNodeParameter('module', i, '') as string) || undefined,
						limit: this.getNodeParameter('limit', i, 50) as number,
						offset: this.getNodeParameter('offset', i, 0) as number,
					});
				}
			} else if (resource === 'taskList') {
				if (operation === 'getFiles') {
					data = await ds.getTaskList({ listId: this.getNodeParameter('listId', i) as string });
				} else if (operation === 'confirmDownload') {
					const selectedRaw = this.getNodeParameter('selectedFiles', i, '') as string;
					const selected = selectedRaw
						.split(',')
						.map((s) => s.trim())
						.filter((s) => s.length > 0)
						.map((s) => Number(s));
					data = await ds.downloadTaskList({
						listId: this.getNodeParameter('listId', i) as string,
						destination: (this.getNodeParameter('listDestination', i, '') as string) || undefined,
						createSubfolder: this.getNodeParameter('createSubfolder', i, true) as boolean,
						selected: selected.length > 0 ? selected : undefined,
					});
				} else if (operation === 'getDownloadStatus') {
					data = await ds.getTaskListDownloadStatus(this.getNodeParameter('pollingTaskId', i) as string);
				} else if (operation === 'stopDownload') {
					data = await ds.stopTaskListDownload(this.getNodeParameter('pollingTaskId', i) as string);
				} else if (operation === 'delete') {
					data = await ds.deleteTaskList({ listId: this.getNodeParameter('listId', i) as string });
				}
			}

			returnData.push({ json: (data ?? { message: `Operation ${resource}.${operation} completed` }) as IDataObject, pairedItem: { item: i } });
		}

		return [returnData];
	}
}
