import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, JsonObject } from 'n8n-workflow';
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
		const existingSid = this.sidBySession.get(session);
		if (existingSid) {
			return existingSid;
		}

		const response = await this.rawRequest<{ sid: string }>({
			api: 'SYNO.API.Auth',
			version: 7,
			method: 'login',
			params: {
				account: this.credentials.username,
				passwd: this.credentials.password,
				session,
				format: 'sid',
			},
		});

		if (!response.success || !response.data?.sid) {
			const code = response.error?.code ?? 0;
			throw new NodeApiError(this.executeFunctions.getNode(), response as unknown as JsonObject, {
				message: `Failed to login to Synology ${session}: ${getSynologyAuthErrorMessage(code)}`,
			});
		}

		this.sidBySession.set(session, response.data.sid);
		return response.data.sid;
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
