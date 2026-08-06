import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, IN8nHttpFullResponse, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { getSynologyAuthErrorMessage } from './SynologyError';
import type { SynologyApiResponse, SynologyCredentials, SynologyRequestParams } from './types';

export class SynologyClient {
	private sidBySession = new Map<string, string>();

	constructor(
		private readonly executeFunctions: IExecuteFunctions,
		private readonly credentials: SynologyCredentials,
	) {}

	async login(session: string): Promise<string> {
		return (await this.loginSession(session)).sid;
	}

	private async loginSession(session: string): Promise<{ sid: string; synotoken?: string }> {
		const existingSid = this.sidBySession.get(session);
		if (existingSid) {
			return { sid: existingSid };
		}

		const response = await this.rawRequest<{ sid: string; synotoken?: string }>({
			api: 'SYNO.API.Auth',
			version: 7,
			method: 'login',
			params: {
				account: this.credentials.username,
				passwd: this.credentials.password,
				session,
				format: 'sid',
				enable_syno_token: 'yes',
			},
		});

		if (!response.success || !response.data?.sid) {
			const code = response.error?.code ?? 0;
			throw new NodeApiError(this.executeFunctions.getNode(), response as unknown as JsonObject, {
				message: `Failed to login to Synology ${session}: ${getSynologyAuthErrorMessage(code)}`,
			});
		}

		this.sidBySession.set(session, response.data.sid);
		return { sid: response.data.sid, synotoken: response.data.synotoken };
	}

	async logout(session: string): Promise<void> {
		if (!this.sidBySession.has(session)) {
			return;
		}

		await this.rawRequest({
			api: 'SYNO.API.Auth',
			version: 7,
			method: 'logout',
			params: { session },
		});
		this.sidBySession.delete(session);
	}

	async requestBinary(request: SynologyRequestParams): Promise<IN8nHttpFullResponse> {
		const session = request.session;
		const sid = session ? await this.login(session) : undefined;
		const params: IDataObject = { api: request.api, version: request.version, method: request.method, ...(request.params ?? {}), ...(sid ? { _sid: sid } : {}) };
		const body = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
		return await this.executeFunctions.helpers.httpRequest({
			method: 'POST',
			url: `${this.credentials.baseUrl.replace(/\/$/, '')}/webapi/entry.cgi`,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
			encoding: 'arraybuffer',
			returnFullResponse: true,
			json: false,
			skipSslCertificateValidation: this.credentials.allowUnauthorizedCerts ?? false,
		}) as Promise<IN8nHttpFullResponse>;
	}

	async requestMultipart(request: SynologyRequestParams, file: { fieldName: string; filename: string; data: Buffer; contentType?: string }, extraFields: Record<string, string>): Promise<IDataObject> {
		const session = request.session;
		const auth = session ? await this.loginSession(session) : undefined;
		const sid = auth?.sid;
		const boundary = `----n8nSynology${Date.now().toString(16)}`;
		const crlf = '\r\n';
		const chunks: Buffer[] = [];
		// Download Station's HTML5 uploader posts to entry.cgi/<api> and keeps
		// api/version/method in the URL path. Other multipart APIs (e.g. Note
		// Station) use entry.cgi with these values in the multipart form. Keep
		// the existing generic behavior by default; callers can opt into the
		// path form through `multipartPath`.
		const { multipartPath, ...requestParams } = request as SynologyRequestParams & { multipartPath?: string };
		const fields: Record<string, string> = {
			api: request.api,
			version: String(request.version),
			method: request.method,
			...(requestParams.params ? Object.fromEntries(Object.entries(requestParams.params).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])) : {}),
			...extraFields,
		};
		if (sid && request.authMode !== 'cookie') fields._sid = sid;
		for (const [key, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${key}"${crlf}${crlf}${value}${crlf}`));
		chunks.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename.replace(/"/g, '')}"${crlf}Content-Type: ${file.contentType ?? 'application/octet-stream'}${crlf}${crlf}`));
		chunks.push(file.data, Buffer.from(crlf), Buffer.from(`--${boundary}--${crlf}`));
		const url = `${this.credentials.baseUrl.replace(/\/$/, '')}/webapi/${multipartPath ? `${multipartPath.replace(/^\//, '')}/${request.api}` : 'entry.cgi'}`;
		const headers: Record<string, string> = { 'Content-Type': `multipart/form-data; boundary=${boundary}` };
		if (request.authMode === 'cookie' && sid) {
			headers.Cookie = `id=${sid}`;
			if (auth?.synotoken) headers['X-SYNO-TOKEN'] = auth.synotoken;
		}
		const response = await this.executeFunctions.helpers.httpRequest({ method: 'POST', url, headers, body: Buffer.concat(chunks), json: true, skipSslCertificateValidation: this.credentials.allowUnauthorizedCerts ?? false }) as SynologyApiResponse<IDataObject>;
		if (!response.success) {
			const detail = response.error ? `: ${JSON.stringify(response.error)}` : '';
			throw new NodeApiError(this.executeFunctions.getNode(), response as unknown as JsonObject, { message: `Synology API call failed: ${request.api}.${request.method}${detail}` });
		}
		return response.data ?? {};
	}

	async request<T extends IDataObject = IDataObject>(request: SynologyRequestParams): Promise<T> {
		const session = request.session;
		const sid = session ? await this.login(session) : undefined;
		const response = await this.rawRequest<T>({
			...request,
			params: {
				...(request.params ?? {}),
				...(sid ? { _sid: sid } : {}),
			},
		});

		if (!response.success) {
			throw new NodeApiError(this.executeFunctions.getNode(), response as unknown as JsonObject, {
				message: `Synology API call failed: ${request.api}.${request.method}`,
			});
		}

		return (response.data ?? {}) as T;
	}

	/**
	 * Send a request to an app-specific CGI path (e.g. DownloadStation/task.cgi).
	 * Preserves auth/session and error handling, but posts to the given path
	 * instead of webapi/entry.cgi.
	 */
	async requestPath<T extends IDataObject = IDataObject>(
		request: SynologyRequestParams,
		webapiPath: string,
	): Promise<T> {
		const session = request.session;
		const sid = session ? await this.login(session) : undefined;

		const body = new URLSearchParams();
		const params: IDataObject = {
			api: request.api,
			version: request.version,
			method: request.method,
			...(request.params ?? {}),
			...(sid ? { _sid: sid } : {}),
		};

		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null) continue;
			body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
		}

		const options: IHttpRequestOptions = {
			method: 'POST',
			url: `${this.credentials.baseUrl.replace(/\/$/, '')}/webapi/${webapiPath.replace(/^\//, '')}`,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
			json: true,
			skipSslCertificateValidation: this.credentials.allowUnauthorizedCerts ?? false,
		};

		const response = await this.executeFunctions.helpers.httpRequest(options) as SynologyApiResponse<T>;

		if (!response.success) {
			throw new NodeApiError(this.executeFunctions.getNode(), response as unknown as JsonObject, {
				message: `Synology API call failed: ${request.api}.${request.method} (path: ${webapiPath})`,
			});
		}

		return (response.data ?? {}) as T;
	}

	private async rawRequest<T extends IDataObject = IDataObject>(request: SynologyRequestParams): Promise<SynologyApiResponse<T>> {
		const body = new URLSearchParams();
		const params: IDataObject = {
			api: request.api,
			version: request.version,
			method: request.method,
			...(request.params ?? {}),
		};

		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null) {
				continue;
			}
			if (typeof value === 'object') {
				body.set(key, JSON.stringify(value));
			} else {
				body.set(key, String(value));
			}
		}

		const options: IHttpRequestOptions = {
			method: 'POST',
			url: `${this.credentials.baseUrl.replace(/\/$/, '')}/webapi/entry.cgi`,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: body.toString(),
			json: true,
			skipSslCertificateValidation: this.credentials.allowUnauthorizedCerts ?? false,
		};

		return await this.executeFunctions.helpers.httpRequest(options) as SynologyApiResponse<T>;
	}
}
