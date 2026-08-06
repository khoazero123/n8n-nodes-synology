import type { IDataObject, IN8nHttpFullResponse } from 'n8n-workflow';
import {
	DOWNLOAD_BT_SEARCH_API,
	DOWNLOAD_BT_SEARCH_API_VERSION,
	DOWNLOAD_STATION_SESSION,
	DOWNLOAD_TASK_API,
	DOWNLOAD_TASK_API_VERSION,
	DOWNLOAD_TASK_V2_API,
	DOWNLOAD_TASK_V2_API_VERSION,
	DOWNLOAD_TASK_LIST_V2_API,
	DOWNLOAD_TASK_LIST_POLLING_V2_API,
	DOWNLOAD_TASK_LIST_V2_API_VERSION,
	DOWNLOAD_INFO_API,
	DOWNLOAD_INFO_API_VERSION,
	DOWNLOAD_STATISTIC_API,
	DOWNLOAD_STATISTIC_API_VERSION,
} from './constants';
import type {
	BTSearchInput,
	BTSearchResult,
	CreateUrlTaskInput,
	CreateTorrentTaskInput,
	DownloadStationStatistics,
	DownloadStationConfig,
	DownloadTask,
	ListTasksInput,
	TaskActionResult,
	TaskListInfo,
	GetTaskListInput,
	DownloadTaskListInput,
	DeleteTaskListInput,
	EditTaskInput,
	GetTaskSourceInput,
} from './types';
import type { SynologyClient } from '../../transport/SynologyClient';

export class DownloadStationClient {
	constructor(private readonly synology: SynologyClient) {}

	/**
	 * Create a download task from a URL or magnet link.
	 * Tries V1 API first (SYNO.DownloadStation.Task v3). On failure (e.g.
	 * DSM versions where V1 create is restricted) falls back to the V2
	 * frontend contract (SYNO.DownloadStation2.Task v2, type=url) which was
	 * verified live on DSM 7 / Download Station 4.1.2.
	 */
	async createUrlTask(input: CreateUrlTaskInput): Promise<IDataObject> {
		const params: IDataObject = { uri: input.url };
		if (input.destination) params.destination = input.destination;
		if (input.username) params.username = input.username;
		if (input.password) params.password = input.password;

		try {
			const v1 = await this.synology.requestPath({
				api: DOWNLOAD_TASK_API,
				version: DOWNLOAD_TASK_API_VERSION,
				method: 'create',
				session: DOWNLOAD_STATION_SESSION,
				params,
			}, 'DownloadStation/task.cgi');
			return { ...v1, method: 'v1' };
		} catch {
			// V1 create is unreliable on some DSM 7 installs; use the V2
			// frontend contract (type=url) which we verified live.
			const v2Params: IDataObject = { type: 'url', url: input.url, create_list: false };
			if (input.destination) v2Params.destination = input.destination;

			const v2 = await this.synology.requestPath({
				api: DOWNLOAD_TASK_V2_API,
				version: DOWNLOAD_TASK_V2_API_VERSION,
				method: 'create',
				session: DOWNLOAD_STATION_SESSION,
				params: v2Params,
			}, 'DownloadStation/entry.cgi');
			return { ...v2, method: 'v2' };
		}
	}

	/** Create a task using Download Station 4.1.2's verified V2 multipart contract. */
	async createTorrentTask(input: CreateTorrentTaskInput): Promise<IDataObject> {
		return await this.synology.requestMultipart(
			{
				api: DOWNLOAD_TASK_V2_API,
				version: DOWNLOAD_TASK_V2_API_VERSION,
				method: 'create',
				session: DOWNLOAD_STATION_SESSION,
				multipartPath: 'entry.cgi',
				authMode: 'cookie',
				params: {
					// The frontend hidden field is Ext.encode('file'), so the
					// multipart scalar includes JSON string quotes.
					type: JSON.stringify('file'),
					file: ['torrent'],
					destination: JSON.stringify(input.destination ?? ''),
					size: input.data.length,
					mtime: Date.now(),
					create_list: input.createList ?? false,
				},
			},
			{ fieldName: 'torrent', filename: input.filename, data: input.data, contentType: input.contentType ?? 'application/x-bittorrent' },
			{},
		);
	}

	/**
	 * Get the file list of a pending task list (result of a create with
	 * create_list=true). Uses V2 API: SYNO.DownloadStation2.Task.List v2 get.
	 */
	async getTaskList(input: GetTaskListInput): Promise<TaskListInfo> {
		return await this.synology.requestPath({
			api: DOWNLOAD_TASK_LIST_V2_API,
			version: DOWNLOAD_TASK_LIST_V2_API_VERSION,
			method: 'get',
			session: DOWNLOAD_STATION_SESSION,
			params: { list_id: input.listId },
		}, 'DownloadStation/entry.cgi') as unknown as TaskListInfo;
	}

	/**
	 * Confirm a pending task list and create the real download task(s).
	 * Uses V2 API: SYNO.DownloadStation2.Task.List.Polling v2 download.
	 * Returns a polling task id; call getTaskListDownloadStatus to obtain the
	 * final task_id, then stop polling.
	 */
	async downloadTaskList(input: DownloadTaskListInput): Promise<IDataObject> {
		const params: IDataObject = { list_id: input.listId };
		if (input.destination) params.destination = input.destination;
		if (input.createSubfolder !== undefined) params.create_subfolder = input.createSubfolder;
		if (input.selected && input.selected.length > 0) params.selected = input.selected;

		return await this.synology.requestPath({
			api: DOWNLOAD_TASK_LIST_POLLING_V2_API,
			version: DOWNLOAD_TASK_LIST_V2_API_VERSION,
			method: 'download',
			session: DOWNLOAD_STATION_SESSION,
			params,
		}, 'DownloadStation/entry.cgi');
	}

	/** Check whether a task list download has finished. */
	async getTaskListDownloadStatus(pollingTaskId: string): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: DOWNLOAD_TASK_LIST_POLLING_V2_API,
			version: DOWNLOAD_TASK_LIST_V2_API_VERSION,
			method: 'download_status',
			session: DOWNLOAD_STATION_SESSION,
			params: { task_id: pollingTaskId },
		}, 'DownloadStation/entry.cgi');
	}

	/** Stop polling a task list download (call after status finished). */
	async stopTaskListDownload(pollingTaskId: string): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: DOWNLOAD_TASK_LIST_POLLING_V2_API,
			version: DOWNLOAD_TASK_LIST_V2_API_VERSION,
			method: 'download_stop',
			session: DOWNLOAD_STATION_SESSION,
			params: { task_id: pollingTaskId },
		}, 'DownloadStation/entry.cgi');
	}

	/** Delete a pending task list (cleanup after confirm or cancel). */
	async deleteTaskList(input: DeleteTaskListInput): Promise<IDataObject> {
		return await this.synology.requestPath({
			api: DOWNLOAD_TASK_LIST_V2_API,
			version: DOWNLOAD_TASK_LIST_V2_API_VERSION,
			method: 'delete',
			session: DOWNLOAD_STATION_SESSION,
			params: { list_id: input.listId },
		}, 'DownloadStation/entry.cgi');
	}

	/**
	 * Download the original torrent file of a BT task.
	 * Uses V2 API: SYNO.DownloadStation2.Task.Source v2 download (binary).
	 */
	async getTaskSource(input: GetTaskSourceInput): Promise<IN8nHttpFullResponse> {
		return await this.synology.requestBinary({
			api: 'SYNO.DownloadStation2.Task.Source',
			version: 2,
			method: 'download',
			session: DOWNLOAD_STATION_SESSION,
			params: { id: input.taskId },
		});
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
	 * Edit a download task (change destination or priority).
	 * Uses V1 API: SYNO.DownloadStation.Task v3 via DownloadStation/task.cgi.
	 */
	async editTask(input: EditTaskInput): Promise<TaskActionResult[]> {
		const params: IDataObject = { id: input.taskId };
		if (input.destination !== undefined) params.destination = input.destination;
		if (input.priority !== undefined) params.priority = input.priority;

		const response = await this.synology.requestPath({
			api: DOWNLOAD_TASK_API,
			version: DOWNLOAD_TASK_API_VERSION,
			method: 'edit',
			session: DOWNLOAD_STATION_SESSION,
			params,
		}, 'DownloadStation/task.cgi');

		// V1 edit returns either { task: [...] } or { data: [...] } depending on DSM version.
		return (response as unknown as { task?: TaskActionResult[] }).task ?? (response as unknown as { data?: TaskActionResult[] }).data ?? [];
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
	 * Search BT search modules for a keyword (read-only).
	 * Uses V1 API: SYNO.DownloadStation.BTSearch v1 via DownloadStation/btsearch.cgi.
	 */
	async btSearch(input: BTSearchInput): Promise<BTSearchResult> {
		const params: IDataObject = { keyword: input.keyword };
		if (input.module) params.module = input.module;
		if (input.limit !== undefined) params.limit = input.limit;
		if (input.offset !== undefined) params.offset = input.offset;

		return (await this.synology.requestPath({
			api: DOWNLOAD_BT_SEARCH_API,
			version: DOWNLOAD_BT_SEARCH_API_VERSION,
			method: 'list',
			session: DOWNLOAD_STATION_SESSION,
			params,
		}, 'DownloadStation/btsearch.cgi')) as unknown as BTSearchResult;
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

	/**
	 * Get Download Station server configuration without changing it.
	 * Uses V1 API: SYNO.DownloadStation.Info v2 via DownloadStation/info.cgi.
	 */
	async getConfig(): Promise<DownloadStationConfig> {
		return (await this.synology.requestPath({
			api: DOWNLOAD_INFO_API,
			version: DOWNLOAD_INFO_API_VERSION,
			method: 'getconfig',
			session: DOWNLOAD_STATION_SESSION,
		}, 'DownloadStation/info.cgi')) as unknown as DownloadStationConfig;
	}
}
