export type TaskType = 'bt' | 'nzb' | 'http' | 'ftp' | 'emule';

export type TaskStatus =
	| 'waiting'
	| 'downloading'
	| 'paused'
	| 'finishing'
	| 'finished'
	| 'hash_checking'
	| 'seeding'
	| 'filehosting_waiting'
	| 'extracting'
	| 'error';

export type TaskPriority = 'auto' | 'low' | 'normal' | 'high';

export type AdditionalField = 'detail' | 'transfer' | 'file' | 'tracker' | 'peer';

export interface TaskDetail {
	destination: string;
	uri: string;
	create_time: string;
	priority: TaskPriority;
	total_peers: number;
	connected_seeders: number;
	connected_leechers: number;
}

export interface TaskTransfer {
	size_downloaded: string;
	size_uploaded: string;
	speed_download: number;
	speed_upload: number;
}

export interface TaskFile {
	filename: string;
	size: string;
	size_downloaded: string;
	priority: TaskPriority;
}

export interface DownloadTaskBase {
	id: string;
	type: TaskType;
	username: string;
	title: string;
	size: string;
	status: TaskStatus;
	status_extra?: Record<string, unknown>;
}

export interface DownloadTask extends DownloadTaskBase {
	additional?: {
		detail?: TaskDetail;
		transfer?: TaskTransfer;
		file?: TaskFile[];
		tracker?: Record<string, unknown>[];
		peer?: Record<string, unknown>[];
	};
}

export interface ListTasksInput {
	offset?: number;
	limit?: number;
	additional?: AdditionalField[];
}

export interface GetTaskInput {
	taskId: string;
	additional?: AdditionalField[];
}

export interface CreateUrlTaskInput {
	url: string;
	destination?: string;
	username?: string;
	password?: string;
}

export interface CreateTorrentTaskInput {
	data: Buffer;
	filename: string;
	contentType?: string;
	destination?: string;
	createList?: boolean;
}

export interface DeleteTaskInput {
	taskId: string;
	forceComplete?: boolean;
}

export interface TaskActionResult {
	id: string;
	error?: number;
}

export interface DownloadStationStatistics {
	speed_download: number;
	speed_upload: number;
	emule_speed_download?: number;
	emule_speed_upload?: number;
}

/** Configuration returned by SYNO.DownloadStation.Info v2 getconfig. */
export interface DownloadStationConfig {
	bt_max_download?: number;
	bt_max_upload?: number;
	default_destination?: string;
	emule_enabled?: boolean;
	[key: string]: unknown;
}

/** Input for SYNO.DownloadStation.BTSearch v1 list (search). */
export interface BTSearchInput {
	/** Search keyword. */
	keyword: string;
	/** Optional BT search module id (from a configured search module). */
	module?: string;
	/** Max number of results to return. */
	limit?: number;
	/** Number of results to skip. */
	offset?: number;
}

/** A single BT search result item (shape verified on NAS). */
export interface BTSearchItem {
	title?: string;
	size?: number;
	category?: string;
	count?: number;
	date?: number;
	seeder?: number;
	leecher?: number;
	site?: string;
	module?: string;
	download?: string;
	[key: string]: unknown;
}

/** Response of SYNO.DownloadStation.BTSearch v1 list. */
export interface BTSearchResult {
	total: number;
	offset: number;
	items: BTSearchItem[];
}
