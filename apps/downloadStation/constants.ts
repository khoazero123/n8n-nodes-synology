export const DOWNLOAD_STATION_SESSION = 'DownloadStation';

// V1 API (documented, official)
export const DOWNLOAD_TASK_API = 'SYNO.DownloadStation.Task';
export const DOWNLOAD_TASK_API_VERSION = 3;
export const DOWNLOAD_INFO_API = 'SYNO.DownloadStation.Info';
export const DOWNLOAD_INFO_API_VERSION = 2;
export const DOWNLOAD_STATISTIC_API = 'SYNO.DownloadStation.Statistic';
export const DOWNLOAD_STATISTIC_API_VERSION = 1;
export const DOWNLOAD_BT_SEARCH_API = 'SYNO.DownloadStation.BTSearch';
export const DOWNLOAD_BT_SEARCH_API_VERSION = 1;

// V2 API (internal, undocumented — use only as fallback)
export const DOWNLOAD_TASK_V2_API = 'SYNO.DownloadStation2.Task';
export const DOWNLOAD_TASK_V2_API_VERSION = 2;
export const DOWNLOAD_TASK_LIST_V2_API = 'SYNO.DownloadStation2.Task.List';
export const DOWNLOAD_TASK_LIST_POLLING_V2_API = 'SYNO.DownloadStation2.Task.List.Polling';
export const DOWNLOAD_TASK_LIST_V2_API_VERSION = 2;

// Task status codes (from official DS Web API PDF, Appendix A)
export const TASK_STATUS_MAP: Record<number, string> = {
	1: 'waiting',
	2: 'downloading',
	3: 'paused',
	4: 'finishing',
	5: 'finished',
	6: 'hash_checking',
	7: 'seeding',
	8: 'filehosting_waiting',
	9: 'extracting',
	10: 'error',
};

export const ADDITIONAL_FIELDS = ['detail', 'transfer', 'file', 'tracker', 'peer'] as const;
