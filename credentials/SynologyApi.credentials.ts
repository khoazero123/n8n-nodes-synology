import type {
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class SynologyApi implements ICredentialType {
	name = 'synologyApi';

	displayName = 'Synology API';

	documentationUrl = 'https://kb.synology.com/en-global/DSM/help/DSM/AdminCenter/system_login_portal_advanced';

	icon: Icon = 'file:../nodes/SynologyNoteStation/SynologyNoteStation.svg';

	properties: INodeProperties[] = [
		{
			displayName: 'NAS URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://192.168.1.100:5001',
			required: true,
			description: 'Base URL of DSM or the application portal, without a trailing slash',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'DSM username',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			required: true,
			default: '',
			placeholder: 'DSM password',
		},
		{
			displayName: 'Allow Self-Signed Certificates',
			name: 'allowUnauthorizedCerts',
			type: 'boolean',
			default: true,
		},
	];
}
