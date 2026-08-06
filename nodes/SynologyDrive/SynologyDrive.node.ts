import type {
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { randomBytes } from 'node:crypto';
import { generatePairedItemData } from './GenericFunctions';

interface DriveSession {
	sid: string;
	deviceId: string;
}

interface DriveCredentials {
	baseUrl?: string;
	username?: string;
	password?: string;
	allowUnauthorizedCerts?: boolean;
}

const driveSessions = new Map<string, DriveSession>();

async function driveLogin(this: IExecuteSingleFunctions, credentials: DriveCredentials): Promise<DriveSession> {
	const response = await this.helpers.httpRequest({
		method: 'POST',
		url: `${String(credentials.baseUrl).replace(/\/$/, '')}/api/SynologyDrive/default/v1/login`,
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: {
			format: 'sid',
			account: credentials.username,
			passwd: credentials.password,
		},
		json: true,
		skipSslCertificateValidation: Boolean(credentials.allowUnauthorizedCerts ?? false),
	}) as { success?: boolean; data?: { sid?: string; did?: string }; error?: { code?: number } };

	if (!response.success || !response.data?.sid || !response.data.did) {
		throw new NodeOperationError(this.getNode(), `Failed to login to Synology Drive (error ${response.error?.code ?? 0})`);
	}

	return { sid: response.data.sid, deviceId: response.data.did };
}

async function authenticateDriveRequest(this: IExecuteSingleFunctions, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions> {
	const executionId = this.getExecutionId();
	let session = driveSessions.get(executionId);
	const credentials = await this.getCredentials<DriveCredentials>('synologyApi');

	if (!session) {
		session = await driveLogin.call(this, credentials);
		driveSessions.set(executionId, session);
	}

	requestOptions.headers = {
		...requestOptions.headers,
		Cookie: `id=${session.sid}; did=${session.deviceId};`,
	};
	requestOptions.skipSslCertificateValidation = Boolean(credentials.allowUnauthorizedCerts ?? false);
	return requestOptions;
}

interface MultipartPart {
	fieldName: string;
	filename?: string;
	contentType?: string;
	data: Buffer;
}

function buildMultipartBody(fields: Record<string, string>, parts: MultipartPart[]): { body: Buffer; contentType: string; contentLength: number } {
	const boundary = `----n8nSynologyDrive${randomBytes(16).toString('hex')}`;
	const crlf = '\r\n';
	const chunks: Buffer[] = [];

	for (const [key, value] of Object.entries(fields)) {
		chunks.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${key}"${crlf}${crlf}${value}${crlf}`, 'utf8'));
	}

	for (const part of parts) {
		const filenameHeader = part.filename ? `; filename="${part.filename.replace(/"/g, '\\"')}"` : '';
		const contentTypeHeader = part.contentType ? `${crlf}Content-Type: ${part.contentType}` : '';
		chunks.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${part.fieldName}"${filenameHeader}${contentTypeHeader}${crlf}${crlf}`, 'utf8'));
		chunks.push(part.data);
		chunks.push(Buffer.from(crlf, 'utf8'));
	}

	chunks.push(Buffer.from(`--${boundary}--${crlf}`, 'utf8'));
	const body = Buffer.concat(chunks);
	return {
		body,
		contentType: `multipart/form-data; boundary=${boundary}`,
		contentLength: body.length,
	};
}

export class SynologyDrive implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology Drive',
		name: 'synologyDrive',
		icon: { light: 'file:SynologyDrive.svg', dark: 'file:SynologyDrive-dark.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Synology Drive Node',
		defaults: {
			name: 'Synology Drive',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'synologyApi',
				required: true,
			}
		],
		usableAsTool: true,
		requestDefaults: {
			baseURL: '={{$credentials.baseUrl}}',
			json: true,
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'File',
						value: 'file',
					},
					{
						name: 'File and Folder Sharing',
						value: 'fileAndFolderSharing',
					},
					{
						name: 'Label',
						value: 'label',
					},
					{
						name: 'Team Folder',
						value: 'teamFolder',
					},
				],
				default: 'file',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['file'],
					},
				},
				options: [
					{
						name: 'Get Files',
						value: 'getFiles',
						action: 'Get files',
						routing: {
						send: { preSend: [authenticateDriveRequest] },
							request: {
								method: 'POST',
								url: '/api/SynologyDrive/default/v1/files/list',
								qs: {
									sort_direction: '={{$parameter["sortDirection"]}}', // asc, desc
									sort_by: '={{$parameter["sortBy"]}}', // modified_time ┃ size ┃ owner ┃ type ┃ name
									offset: '={{$parameter["offset"]}}',
									limit: '={{$parameter["limit"]}}',
									path: '={{$parameter["path"]}}',
								},
								body: {
									filter: '={{$parameter["filter"]}}', // object
								}
							},
						},
					},
					{
						name: 'Search',
						value: 'search',
						action: 'Search',
						routing: {
						send: { preSend: [authenticateDriveRequest] },
							request: {
								method: 'POST',
								url: '/api/SynologyDrive/default/v1/files/search',
								qs: {
									sort_direction: '={{$parameter["sortDirection"]}}', // asc, desc
									sort_by: '={{$parameter["sortBy"]}}', // modified_time ┃ size ┃ owner ┃ type ┃ name
									offset: '={{$parameter["offset"]}}',
									limit: '={{$parameter["limit"]}}',
								},
								body: {
									keyword: '={{$parameter["keyword"]}}', // object
								}
							},
						},
					},
					{
						name: 'List Items Recently Used',
						value: 'listItemsRecentlyUsed',
						action: 'List items recently used',
						routing: {
							send: { preSend: [authenticateDriveRequest] },
							request: {
								method: 'GET',
								url: '/api/SynologyDrive/default/v1/files/recent',
							},
						},
					},
					{
						name: 'Create File Or Folder',
						value: 'createFileOrFolder',
						action: 'Create file or folder',
						routing: {
							send: {
								preSend: [authenticateDriveRequest, async function (this: IExecuteSingleFunctions,
									requestOptions: IHttpRequestOptions,
								): Promise<IHttpRequestOptions> {
									requestOptions.headers = {
										...requestOptions.headers,
									};
									const type = this.getNodeParameter('createFileOrFolderType') as string;
									if (type === 'file') {
										const fileContent = this.getNodeParameter('createFileOrFolderFileContent') as string;
										requestOptions.body = {
											file_content: Buffer.from(fileContent).toString('base64'),
										};
									}
									return requestOptions;
								}],
							},
							request: {
								method: 'POST',
								url: '/api/SynologyDrive/default/v1/files',
								qs: {
									type: '={{$parameter["createFileOrFolderType"]}}', // file, folder
									path: '={{$parameter["path"]}}',
								},
								body: {
									modified_time: new Date().getTime(),
								}
							},
						},
					},
					{
						name: 'Upload',
						value: 'upload',
						action: 'Upload',
						routing: {
							send: {
								preSend: [authenticateDriveRequest, async function (this: IExecuteSingleFunctions,
									requestOptions: IHttpRequestOptions,
								): Promise<IHttpRequestOptions> {
									requestOptions.headers = {
										...requestOptions.headers,
									};

									const binaryPropertyName = this.getNodeParameter('binaryPropertyName') as string;
									if (!binaryPropertyName) {
										throw new NodeOperationError(this.getNode(), 'Binary property name is required');
									}
									const binaryData = this.helpers.assertBinaryData(binaryPropertyName);
									if (!binaryData) {
										throw new NodeOperationError(this.getNode(), 'Binary data is required');
									}
									const fileName = binaryData.fileName?.toString();
									if (!fileName) {
										throw new NodeOperationError(this.getNode(), `File name is needed to upload image. Make sure the property that holds the binary data has the file name property set.`);
									}
									const binaryDataBuffer = await this.helpers.getBinaryDataBuffer(binaryPropertyName);

									const filePath = this.getNodeParameter('path') as string;
									const path = filePath.endsWith('/') ? filePath + fileName : filePath;
									const conflictAction = this.getNodeParameter('uploadConflictAction') as string;

									this.logger.debug(`Upload path: ${path}`);

									const multipart = buildMultipartBody(
										{
											conflict_action: conflictAction,
											path,
											type: 'file',
										},
										[
											{
												fieldName: 'file',
												filename: fileName,
												contentType: binaryData.mimeType ?? 'application/octet-stream',
												data: binaryDataBuffer,
											},
										],
									);
									requestOptions.body = multipart.body;
									requestOptions.headers['Content-Type'] = multipart.contentType;
									requestOptions.headers['Content-Length'] = String(multipart.contentLength);
									return requestOptions;
								}],
							},
							request: {
								method: 'PUT',
								url: '/api/SynologyDrive/default/v1/files/upload',
							},
						},
					},
					{
						name: 'Delete File Or Folder',
						value: 'deleteFileOrFolder',
						action: 'Delete file or folder',
						routing: {
						send: { preSend: [authenticateDriveRequest] },
							request: {
								method: 'POST',
								url: '/api/SynologyDrive/default/v1/files/delete',
								body: {
									permanent: '={{$parameter["deleteFileOrFolderPermanent"]}}',
									files: ['={{$parameter["path"]}}'],
								}
							},
						},
					},
					{
						name: 'Download File',
						value: 'downloadFile',
						action: 'Download file',
						routing: {
							send: {
								preSend: [authenticateDriveRequest, async function (this: IExecuteSingleFunctions,
									requestOptions: IHttpRequestOptions,
								): Promise<IHttpRequestOptions> {
									requestOptions.headers = {
										...requestOptions.headers,
										Accept: '*/*',
									};
									requestOptions.encoding = 'arraybuffer';
									requestOptions.returnFullResponse = true;
									const filePath = this.getNodeParameter('path') as string;
									if (!filePath) {
										throw new NodeOperationError(this.getNode(), 'File paths are required');
									}

									requestOptions.body = {
										force_download: false, // to get correct mime type in response header
										files: [filePath],
									};
									return requestOptions;
								}],
							},
							request: {
								method: 'POST',
								url: '/api/SynologyDrive/default/v1/files/download',
								body: {
									// archive_name: 'download',
									files: ['={{$parameter["path"]}}'],
								}
							},
							output: {
								postReceive: [
									async function (
										this: IExecuteSingleFunctions,
										items,
										response: IN8nHttpFullResponse,
									): Promise<INodeExecutionData[]> {
										const pairedItem = generatePairedItemData(items.length);
										const headers = response.headers as Record<string, string>;
										// this.logger.debug(`Download response headers: ${JSON.stringify(headers)}`);
										const contentType = headers['content-type'] || 'application/octet-stream';
										const binaryDataBuffer = await this.helpers.binaryToBuffer(response.body as Buffer | import('stream').Readable);
										let mimeType = contentType.split(';')[0]?.trim();
										if (mimeType === 'application/json') {
											const bodyString = binaryDataBuffer.toString('utf-8');
											const bodyObject = JSON.parse(bodyString);
											return [
												{
													binary: {},
													json: {
														...bodyObject,
													},
													pairedItem: pairedItem,
												},
											];
										}
										const contentDisposition = headers['content-disposition'] || '';
										const fileName = /filename="([^"]+)"/.exec(contentDisposition)?.[1] || 'download.zip';
										if (mimeType === 'application/octet-stream') {
											mimeType = 'application/zip';
										}

										const binaryData = await this.helpers.prepareBinaryData(binaryDataBuffer, fileName, mimeType);
										return [
											{
												binary: {
													data: binaryData,
												},
												json: {},
												pairedItem: pairedItem,
											},
										];
									}
								],
							},
						},
					},
					{
						name: 'Get File or Folder Info',
						value: 'getFileOrFolderInfo',
						action: 'Get file or folder info',
						routing: {
							send: { preSend: [authenticateDriveRequest] },
							request: {
								method: 'POST',
								url: '/webapi/entry.cgi',
								qs: {
									api: 'SYNO.SynologyDrive.Files',
									version: 3,
									method: 'get',
									path: '={{$parameter["path"]}}',
								},
							},
						},
					},
					{
						name: 'Copy File or Folder',
						value: 'copyFileOrFolder',
						action: 'Copy file or folder',
						routing: {
							send: { preSend: [authenticateDriveRequest] },
							request: {
								method: 'PUT',
								url: '/webapi/entry.cgi',
								qs: {
									api: 'SYNO.Office.Node',
									version: 2,
									method: 'copy',
									to_parent_folder: '={{$parameter["destinationParent"]}}',
									name: '={{$parameter["destinationName"]}}',
									title: '={{$parameter["destinationName"]}}',
									files: '={{JSON.stringify([$parameter["path"]])}}',
									dry_run: false,
								},
							},
						},
					},
				],
				default: 'listItemsRecentlyUsed',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['label'] } },
				options: [
					{
						name: 'List Labels',
						value: 'listLabels',
						action: 'List labels',
						routing: { send: { preSend: [authenticateDriveRequest] }, request: { method: 'GET', url: '/webapi/entry.cgi', qs: { api: 'SYNO.SynologyDrive.Labels', version: 1, method: 'list' } } },
					},
					{
						name: 'Create Label',
						value: 'createLabel',
						action: 'Create label',
						routing: { send: { preSend: [authenticateDriveRequest] }, request: { method: 'PUT', url: '/webapi/entry.cgi', qs: { api: 'SYNO.SynologyDrive.Labels', version: 1, method: 'create', name: '={{$parameter["labelName"]}}', color: '={{$parameter["labelColor"]}}', position: '={{$parameter["labelPosition"]}}' } } },
					},
					{
						name: 'Delete Label',
						value: 'deleteLabel',
						action: 'Delete label',
						routing: { send: { preSend: [authenticateDriveRequest] }, request: { method: 'DELETE', url: '/webapi/entry.cgi', qs: { api: 'SYNO.SynologyDrive.Labels', version: 1, method: 'delete', label_id: '={{$parameter["labelId"]}}' } } },
					},
					{
						name: 'List Labelled Files',
						value: 'listLabelledFiles',
						action: 'List labelled files',
						routing: { send: { preSend: [authenticateDriveRequest] }, request: { method: 'POST', url: '/webapi/entry.cgi', qs: { api: 'SYNO.SynologyDrive.Files', version: 2, method: 'list_labelled', label_id: '={{$parameter["labelId"]}}', offset: '={{$parameter["offset"]}}', limit: '={{$parameter["limit"]}}', sort_by: 'name', sort_direction: 'desc', filter: '{}' } } },
					},
					{
						name: 'Manage File Labels',
						value: 'manageFileLabels',
						action: 'Manage file labels',
						routing: { send: { preSend: [authenticateDriveRequest] }, request: { method: 'POST', url: '/webapi/entry.cgi', qs: { api: 'SYNO.SynologyDrive.Files', version: 2, method: 'label', files: '={{JSON.stringify([$parameter["path"]])}}', labels: '={{$parameter["labels"]}}' } } },
					},
				],
				default: 'listLabels',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['teamFolder'] } },
				options: [
					{
						name: 'List Team Folders',
						value: 'listTeamFolders',
						action: 'List team folders',
						routing: { send: { preSend: [authenticateDriveRequest] }, request: { method: 'GET', url: '/webapi/entry.cgi', qs: { api: 'SYNO.SynologyDrive.TeamFolders', version: 1, method: 'list', filter: '{}', sort_direction: 'asc', sort_by: 'owner', offset: 0, limit: '={{$parameter["limit"]}}' } } },
					},
				],
				default: 'listTeamFolders',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['fileAndFolderSharing'] } },
				options: [
					{
						name: 'Create Public Link',
						value: 'createPublicLink',
						action: 'Create public link',
						routing: { send: { preSend: [authenticateDriveRequest] }, request: { method: 'POST', url: '/webapi/entry.cgi', qs: { api: 'SYNO.SynologyDrive.Sharing', version: 1, method: 'create_link', path: '={{$parameter["path"]}}' } } },
					},
					{
						name: 'Create Advanced Share',
						value: 'createAdvancedShare',
						action: 'Create advanced share',
						routing: { send: { preSend: [authenticateDriveRequest] }, request: { method: 'PUT', url: '/webapi/entry.cgi', qs: { api: 'SYNO.SynologyDrive.AdvanceSharing', version: 1, method: 'create', path: '={{$parameter["path"]}}', role: '={{$parameter["shareRole"]}}' } } },
					},
				],
				default: 'createPublicLink',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 50,
				displayOptions: {
					show: {
						operation: [
							'listItemsRecentlyUsed',
							'getFiles',
							'search',
						],
						resource: ['file'],
					},
				},
				description: 'Max number of results to return',
			},
			{
				displayName: 'Label Name',
				name: 'labelName',
				type: 'string',
				required: true,
				displayOptions: { show: { operation: ['createLabel'] } },
				default: '',
			},
			{
				displayName: 'Label ID',
				name: 'labelId',
				type: 'string',
				required: true,
				displayOptions: { show: { operation: ['deleteLabel', 'listLabelledFiles'] } },
				default: '',
			},
			{
				displayName: 'Label Color',
				name: 'labelColor',
				type: 'options',
				options: [
					{ name: 'Blue', value: 'blue' },
					{ name: 'Gray', value: 'gray' },
					{ name: 'Green', value: 'green' },
					{ name: 'Orange', value: 'orange' },
					{ name: 'Purple', value: 'purple' },
					{ name: 'Red', value: 'red' },
					{ name: 'Yellow', value: 'yellow' },
				],
				default: 'gray',
				displayOptions: { show: { operation: ['createLabel'] } },
			},
			{
				displayName: 'Label Position',
				name: 'labelPosition',
				type: 'number',
				default: 0,
				displayOptions: { show: { operation: ['createLabel'] } },
			},
			{
				displayName: 'Labels',
				name: 'labels',
				type: 'json',
				required: true,
				default: '[]',
				displayOptions: { show: { operation: ['manageFileLabels'] } },
				description: 'JSON array such as [{"action":"add","label_id":"15"}]',
			},
			{
				displayName: 'Share Role',
				name: 'shareRole',
				type: 'options',
				options: [
					{ name: 'Editor', value: 'editor' },
					{ name: 'Viewer', value: 'viewer' },
				],
				default: 'editor',
				displayOptions: { show: { operation: ['createAdvancedShare'] } },
			},
			{
				displayName: 'Type',
				name: 'createFileOrFolderType',
				type: 'options',
				required: true,
				displayOptions: {
					show: {
						operation: [
							'createFileOrFolder',
						],
					},
				},
				options: [
					{
						name: 'File',
						value: 'file',
					},
					{
						name: 'Folder',
						value: 'folder',
					},
				],
				default: 'folder',
			},
			{
				displayName: 'File Content',
				name: 'createFileOrFolderFileContent',
				type: 'string',
				required: true,
				placeholder: 'Text content',
				hint: 'Text content to be written to the file',
				displayOptions: {
					show: {
						operation: [
							'createFileOrFolder',
						],
						'createFileOrFolderType': ['file'],
					},
				},
				default: '',
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				required: true,
				placeholder: '/mydrive/...',
				// hint: `"link:permanent_link", "id:file_id", "id:file_id/basename", "/mydrive/{relative-path}", "/team-folders/{team-folder-name}/{relative-path}", "/views/{view_id}/{relative-path}", "/volumes/{absolute-path}"`,
				displayOptions: {
					show: {
						operation: [
							'createFileOrFolder',
							'getFiles',
							'upload',
							'downloadFile',
							'deleteFileOrFolder',
							'getFileOrFolderInfo',
							'copyFileOrFolder',
						],
					},
				},
				default: '',
			},
			{
				displayName: 'Destination Parent Folder',
				name: 'destinationParent',
				type: 'string',
				required: true,
				placeholder: '/mydrive/destination',
				displayOptions: {
					show: {
						operation: ['copyFileOrFolder'],
					},
				},
				default: '',
			},
			{
				displayName: 'Destination Name',
				name: 'destinationName',
				type: 'string',
				required: true,
				placeholder: 'copied-file.txt',
				displayOptions: {
					show: {
						operation: ['copyFileOrFolder'],
					},
				},
				default: '',
			},
			/* {
				displayName: 'Paths',
				name: 'filePaths',
				type: 'json',
				required: true,
				placeholder: '["/mydrive/abc", "/mydrive/def"]',
				displayOptions: {
					show: {
						operation: [
							'deleteFileOrFolder',
						],
					},
				},
				default: '[]',
			}, */
			{
				displayName: 'Delete Permanently',
				name: 'deleteFileOrFolderPermanent',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: [
							'deleteFileOrFolder',
						],
					},
				},
				default: false,
			},
			{
				displayName: 'Sort Direction',
				name: 'sortDirection',
				type: 'options',
				options: [
					{ name: 'Ascending', value: 'asc' },
					{ name: 'Descending', value: 'desc' },
				],
				default: 'asc',
				displayOptions: {
					show: {
						operation: [
							'getFiles', 'search',
						],
					},
				},
			},
			{
				displayName: 'Sort By',
				name: 'sortBy',
				type: 'options',
				options: [
					{ name: 'Modified Time', value: 'modified_time' },
					{ name: 'Name', value: 'name' },
					{ name: 'Owner', value: 'owner' },
					{ name: 'Size', value: 'size' },
					{ name: 'Type', value: 'type' },
				],
				default: 'modified_time',
				displayOptions: {
					show: {
						operation: [
							'getFiles',
							'search',
						],
					},
				},
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				default: 0,
				displayOptions: {
					show: {
						operation: [
							'getFiles', 'search',
						],
					},
				},
			},
			{
				displayName: 'Filter',
				name: 'filter',
				type: 'json',
				default: {},
				displayOptions: {
					show: {
						operation: [
							'getFiles',
						],
					},
				},
				placeholder: '{"extensions": ["jpg", "png"], "types": ["file", "folder", "image"], "label_id": "mylabel", "starred": true}',
			},
			{
				displayName: 'Keyword',
				name: 'keyword',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: [
							'search',
						],
					},
				},
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				hint: 'The name of the input binary field containing the file to be upload',
				displayOptions: {
					show: {
						operation: ['upload'],
					},
				},
				placeholder: 'data',
				description: 'Name of the binary property that contains the data to upload',
			},
			{
				displayName: 'Upload Conflict Action',
				name: 'uploadConflictAction',
				type: 'options',
				options: [
					{ name: 'Overwrite', value: 'overwrite' },
					{ name: 'Autorename', value: 'autorename' },
					{ name: 'Stop', value: 'stop' },
					{ name: 'Version', value: 'version' },
				],
				default: 'version',
				displayOptions: {
					show: {
						operation: [
							'upload',
						],
					},
				},
			},
		],
	};
}
