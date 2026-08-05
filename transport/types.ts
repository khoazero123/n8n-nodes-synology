import type { IDataObject } from 'n8n-workflow';

export interface SynologyCredentials {
	baseUrl: string;
	username: string;
	password: string;
	allowUnauthorizedCerts?: boolean;
}

export interface SynologyApiResponse<T = IDataObject> {
	success: boolean;
	data?: T;
	error?: {
		code?: number;
		details?: string;
		[key: string]: unknown;
	};
}

export interface SynologyRequestParams {
	api: string;
	version: number;
	method: string;
	session?: string;
	params?: IDataObject;
	/** Optional path prefix for multipart endpoints, e.g. entry.cgi/<api>. */
	multipartPath?: string;
}
