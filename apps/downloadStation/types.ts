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
