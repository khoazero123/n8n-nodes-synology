import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { DownloadStationClient } from '../../apps/downloadStation/DownloadStationClient';
import { ADDITIONAL_FIELDS } from '../../apps/downloadStation/constants';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

const taskOperations = [
	{ name: 'Create URL', value: 'createUrl', action: 'Create download task from URL or magnet link' },
	{ name: 'Delete', value: 'delete', action: 'Delete a download task' },
	{ name: 'Get', value: 'get', action: 'Get a download task' },
	{ name: 'Get Many', value: 'getMany', action: 'Get many download tasks' },
	{ name: 'Pause', value: 'pause', action: 'Pause a download task' },
	{ name: 'Resume', value: 'resume', action: 'Resume a download task' },
];

const statisticsOperations = [
	{ name: 'Get', value: 'get', action: 'Get download statistics and speeds' },
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
					{ name: 'Statistic', value: 'statistics' },
					{ name: 'Task', value: 'task' },
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
						operation: ['get', 'pause', 'resume', 'delete'],
					},
				},
				description: 'Download task ID (e.g. dbid_123). Comma-separated for batch pause/resume/delete.',
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
				if (operation === 'createUrl') {
					data = await ds.createUrlTask({
						url: this.getNodeParameter('url', i) as string,
						destination: (this.getNodeParameter('destination', i, '') as string) || undefined,
						username: (this.getNodeParameter('downloadUsername', i, '') as string) || undefined,
						password: (this.getNodeParameter('downloadPassword', i, '') as string) || undefined,
					});
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
					data = await ds.pauseTasks(this.getNodeParameter('taskId', i) as string);
				} else if (operation === 'resume') {
					data = await ds.resumeTasks(this.getNodeParameter('taskId', i) as string);
				} else if (operation === 'delete') {
					data = await ds.deleteTasks(
						this.getNodeParameter('taskId', i) as string,
						this.getNodeParameter('forceComplete', i, false) as boolean,
					);
				}
			} else if (resource === 'statistics') {
				if (operation === 'get') {
					data = await ds.getStatistics();
				}
			}

			returnData.push({ json: (data ?? { message: `Operation ${resource}.${operation} completed` }) as IDataObject, pairedItem: { item: i } });
		}

		return [returnData];
	}
}
