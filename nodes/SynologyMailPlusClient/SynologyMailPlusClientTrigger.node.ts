import type { IDataObject, INodeExecutionData, INodeType, INodeTypeDescription, IPollFunctions } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { MailClientClient } from '../../apps/mailClient/MailClientClient';
import { MAILBOX_ID_MAP } from '../../apps/mailClient/constants';
import { pollNewMailThreads } from '../../apps/mailClient/mailPollUtils';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

export class SynologyMailPlusClientTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology MailPlus Trigger',
		name: 'synologyMailPlusClientTrigger',
		icon: { light: 'file:SynologyMailPlusClient.svg', dark: 'file:SynologyMailPlusClient-dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["mailbox"]}}',
		description: 'Triggers when new mail arrives in a Synology MailPlus mailbox',
		defaults: { name: 'Synology MailPlus Trigger' },
		usableAsTool: false,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'synologyApi', required: true }],
		polling: true,
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				default: 'newEmail',
				options: [
					{
						name: 'New Email',
						value: 'newEmail',
						description: 'Triggers when a new email thread appears in the selected mailbox',
					},
				],
			},
			{
				displayName: 'Mailbox', name: 'mailbox', type: 'options', default: 'inbox',
				options: Object.keys(MAILBOX_ID_MAP).map((name) => ({ name: name[0].toUpperCase() + name.slice(1), value: name })),
			},
			{ displayName: 'Search Keyword', name: 'keyword', type: 'string', default: '', description: 'Optional server-side keyword filter' },
			{ displayName: 'From (Sender)', name: 'from', type: 'string', default: '', description: 'Optional sender filter' },
			{ displayName: 'Unread Only', name: 'unreadOnly', type: 'boolean', default: false },
			{
				displayName: 'Read Status', name: 'readStatus', type: 'options', default: 'both',
				options: [{ name: 'Both', value: 'both' }, { name: 'Unread', value: 'unread' }, { name: 'Read', value: 'read' }],
			},
			{ displayName: 'Starred Only', name: 'starredOnly', type: 'boolean', default: false },
			{ displayName: 'Has Attachment Only', name: 'hasAttachmentOnly', type: 'boolean', default: false },
			{ displayName: 'Label', name: 'label', type: 'string', default: '', description: 'Optional label name or numeric ID' },
			{ displayName: 'Max Threads Per Poll', name: 'maxThreads', type: 'number', typeOptions: { minValue: 1 }, default: 50 },
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
		const mc = new MailClientClient(new SynologyClient(this as never, credentials));
		const staticData = this.getWorkflowStaticData('global') as IDataObject;
		const items = await pollNewMailThreads(mc, staticData, {
			mailbox: this.getNodeParameter('mailbox', 'inbox') as string,
			keyword: (this.getNodeParameter('keyword', '') as string) || undefined,
			from: (this.getNodeParameter('from', '') as string) || undefined,
			label: (this.getNodeParameter('label', '') as string) || undefined,
			unreadOnly: this.getNodeParameter('unreadOnly', false) as boolean,
			readStatus: this.getNodeParameter('readStatus', 'both') as string,
			starredOnly: this.getNodeParameter('starredOnly', false) as boolean,
			hasAttachmentOnly: this.getNodeParameter('hasAttachmentOnly', false) as boolean,
			maxThreads: this.getNodeParameter('maxThreads', 50) as number,
		});
		return items ? [items] : null;
	}
}
