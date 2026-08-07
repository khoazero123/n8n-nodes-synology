import type { IDataObject, INodeExecutionData, INodeType, INodeTypeDescription, IPollFunctions } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { MailClientClient } from '../../apps/mailClient/MailClientClient';
import { MAILBOX_ID_MAP } from '../../apps/mailClient/constants';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

export class SynologyMailTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology MailPlus Trigger',
		name: 'synologyMailTrigger',
		icon: { light: 'file:SynologyMailClient.svg', dark: 'file:SynologyMailClient-dark.svg' },
		group: ['trigger'],
		version: 1,
		description: 'Triggers when new mail arrives in a Synology MailPlus mailbox',
		defaults: { name: 'Synology MailPlus Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'synologyApi', required: true }],
		polling: true,
		properties: [
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
		const mailbox = this.getNodeParameter('mailbox', 'inbox') as string;
		const keyword = this.getNodeParameter('keyword', '') as string;
		const from = this.getNodeParameter('from', '') as string;
		const label = this.getNodeParameter('label', '') as string;
		const unreadOnly = this.getNodeParameter('unreadOnly', false) as boolean;
		const readStatus = this.getNodeParameter('readStatus', 'both') as string;
		const starredOnly = this.getNodeParameter('starredOnly', false) as boolean;
		const hasAttachmentOnly = this.getNodeParameter('hasAttachmentOnly', false) as boolean;
		const maxThreads = this.getNodeParameter('maxThreads', 50) as number;
		const mailboxId = MAILBOX_ID_MAP[mailbox];
		const threads = await mc.listThreads({ mailboxId, offset: 0, limit: maxThreads, keyword: keyword || undefined, from: from || undefined, label: label || undefined });
		const staticData = this.getWorkflowStaticData('global');
		const seenKey = `mailSeen_${mailbox}`;
		const seenIds = new Set<number>(Array.isArray(staticData[seenKey]) ? staticData[seenKey] as number[] : []);
		const now = Date.now();
		const toBool = (v: unknown): boolean => v === 1 || v === true || v === '1' || v === 'true';
		const matchesRead = (unread: unknown) => {
			if (readStatus === 'both' && !unreadOnly) return true;
			const isUnread = toBool(unread);
			return (unreadOnly || readStatus === 'unread') ? isUnread : readStatus === 'read' ? !isUnread : true;
		};
		const newThreads = (threads.thread ?? [])
			.filter((t) => !seenIds.has(t.id))
			.filter((t) => matchesRead(t.unread))
			.filter((t) => !starredOnly || toBool(t.star) || toBool(t.starred))
			.filter((t) => !hasAttachmentOnly || toBool(t.has_attachment) || (t.message ?? []).some((m) => Array.isArray(m.attachment) && m.attachment.length > 0))
			.slice(0, maxThreads);
		staticData[seenKey] = [...new Set((threads.thread ?? []).map((t) => t.id))];
		staticData[`mailSeenAt_${mailbox}`] = now;
		if (newThreads.length === 0) return null;
		return [[...newThreads.map((thread) => ({ json: { mailbox, mailboxId, thread, message: thread.message ?? [], triggeredAt: now } as unknown as IDataObject }))]];
	}
}
