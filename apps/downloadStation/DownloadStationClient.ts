import type { IDataObject } from 'n8n-workflow';
import {
	DOWNLOAD_STATION_SESSION,
	DOWNLOAD_TASK_API,
	DOWNLOAD_TASK_API_VERSION,
	DOWNLOAD_INFO_API,
	DOWNLOAD_INFO_API_VERSION,
	DOWNLOAD_STATISTIC_API,
	DOWNLOAD_STATISTIC_API_VERSION,
} from './constants';
import type {
	CreateUrlTaskInput,
	DownloadStationStatistics,
	DownloadTask,
	ListTasksInput,
	TaskActionResult,
} from './types';
import type { SynologyClient } from '../../transport/SynologyClient';

export class DownloadStationClient {
	constructor(private readonly synology: SynologyClient) {}

	/**
	 * Create a download task from a URL or magnet link.
	 * Uses V1 API: SYNO.DownloadStation.Task v3 via DownloadStation/task.cgi.
	 */
	async createUrlTask(input: CreateUrlTaskInput): Promise<IDataObject> {
		const params: IDataObject = { uri: input.url };
		if (input.destination) params.destination = input.destination;
		if (input.username) params.username = input.username;
		if (input.password) params.password = input.password;

		return await this.synology.requestPath({
			api: DOWNLOAD_TASK_API,
			version: DOWNLOAD_TASK_API_VERSION,
			method: 'create',
			session: DOWNLOAD_STATION_SESSION,
			params,
		}, 'DownloadStation/task.cgi');
	}

	/**
	 * List download tasks with optional pagination and additional fields.
	 * Uses V1 API: SYNO.DownloadStation.Task v3 via DownloadStation/task.cgi.
	 */
	async listTasks(input: ListTasksInput = {}): Promise<{ total: number; offset: number; tasks: DownloadTask[] }> {
		const params: IDataObject = {};
		if (input.offset !== undefined) params.offset = input.offset;
		if (input.limit !== undefined) params.limit = input.limit;
		if (input.additional && input.additional.length > 0) {
			params.additional = input.additional.join(',');
		}

		return (await this.synology.requestPath({
			api: DOWNLOAD_TASK_API,
			version: DOWNLOAD_TASK_API_VERSION,
			method: 'list',
			session: DOWNLOAD_STATION_SESSION,
			params,
		}, 'DownloadStation/task.cgi')) as unknown as { total: number; offset: number; tasks: DownloadTask[] };
	}

	/**
	 * Get a specific download task by ID with optional additional fields.
	 * Uses V1 API: SYNO.DownloadStation.Task v3 via DownloadStation/task.cgi.
	 */
	async getTask(taskId: string, additional?: string[]): Promise<{ tasks: DownloadTask[] }> {
		const params: IDataObject = { id: taskId };
		if (additional && additional.length > 0) {
			params.additional = additional.join(',');
		}

		return (await this.synology.requestPath({
			api: DOWNLOAD_TASK_API,
			version: DOWNLOAD_TASK_API_VERSION,
			method: 'getinfo',
			session: DOWNLOAD_STATION_SESSION,
			params,
		}, 'DownloadStation/task.cgi')) as unknown as { tasks: DownloadTask[] };
	}

	/**
	 * Pause one or more download tasks.
	 * Uses V1 API: SYNO.DownloadStation.Task v3 via DownloadStation/task.cgi.
	 */
	async pauseTasks(taskIds: string): Promise<TaskActionResult[]> {
		const response = await this.synology.requestPath({
			api: DOWNLOAD_TASK_API,
			version: DOWNLOAD_TASK_API_VERSION,
			method: 'pause',
			session: DOWNLOAD_STATION_SESSION,
			params: { id: taskIds },
		}, 'DownloadStation/task.cgi');

		return (response as unknown as { task: TaskActionResult[] }).task ?? [];
	}

	/**
	 * Resume one or more download tasks.
	 * Uses V1 API: SYNO.DownloadStation.Task v3 via DownloadStation/task.cgi.
	 */
	async resumeTasks(taskIds: string): Promise<TaskActionResult[]> {
		const response = await this.synology.requestPath({
			api: DOWNLOAD_TASK_API,
			version: DOWNLOAD_TASK_API_VERSION,
			method: 'resume',
			session: DOWNLOAD_STATION_SESSION,
			params: { id: taskIds },
		}, 'DownloadStation/task.cgi');

		return (response as unknown as { task: TaskActionResult[] }).task ?? [];
	}

	/**
	 * Delete one or more download tasks.
	 * Uses V1 API: SYNO.DownloadStation.Task v3 via DownloadStation/task.cgi.
	 */
	async deleteTasks(taskIds: string, forceComplete?: boolean): Promise<TaskActionResult[]> {
		const params: IDataObject = { id: taskIds };
		if (forceComplete !== undefined) params.force_complete = forceComplete;

		const response = await this.synology.requestPath({
			api: DOWNLOAD_TASK_API,
			version: DOWNLOAD_TASK_API_VERSION,
			method: 'delete',
			session: DOWNLOAD_STATION_SESSION,
			params,
		}, 'DownloadStation/task.cgi');

		return (response as unknown as { task: TaskActionResult[] }).task ?? [];
	}

	/**
	 * Get Download Station statistics (download/upload speeds).
	 * Uses V1 API: SYNO.DownloadStation.Statistic v1 via DownloadStation/statistic.cgi.
	 */
	async getStatistics(): Promise<DownloadStationStatistics> {
		return (await this.synology.requestPath({
			api: DOWNLOAD_STATISTIC_API,
			version: DOWNLOAD_STATISTIC_API_VERSION,
			method: 'getinfo',
			session: DOWNLOAD_STATION_SESSION,
		}, 'DownloadStation/statistic.cgi')) as unknown as DownloadStationStatistics;
	}

	/**
	 * Get Download Station info (version, settings).
	 * Uses V1 API: SYNO.DownloadStation.Info v2 via DownloadStation/info.cgi.
	 */
	async getInfo(): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: DOWNLOAD_INFO_API,
			version: DOWNLOAD_INFO_API_VERSION,
			method: 'getinfo',
			session: DOWNLOAD_STATION_SESSION,
		}, 'DownloadStation/info.cgi');
	}
}
