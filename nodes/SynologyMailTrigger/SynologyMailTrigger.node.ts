import type {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { MailClientClient } from '../../apps/mailClient/MailClientClient';
import { MAILBOX_ID_MAP } from '../../apps/mailClient/constants';
import { SynologyClient } from '../../transport/SynologyClient';
import type { SynologyCredentials } from '../../transport/types';

/**
 * Polls a MailPlus mailbox and emits new threads since the last poll.
 * Uses MailClient APIs (session=MailClient). Requires the DSM user to have
 * a MailPlus mail account enabled.
 */
export class SynologyMailTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Synology MailPlus Trigger',
		name: 'synologyMailTrigger',
		icon: { light: 'file:SynologyMailClient.svg', dark: 'file:SynologyMailClient-dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{ $parameter["mailbox"] + " mailbox" }}',
		description: 'Triggers when new email arrives in a Synology MailPlus mailbox',
		defaults: { name: 'Synology MailPlus Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'synologyApi', required: true }],
		polling: true,
		properties: [
			{
				displayName: 'Mailbox',
				name: 'mailbox',
				type: 'options',
				options: [
					{ name: 'Inbox', value: 'inbox' },
					{ name: 'Archived', value: 'archived' },
					{ name: 'Drafts', value: 'drafts' },
					{ name: 'Sent', value: 'sent' },
					{ name: 'Spam', value: 'spam' },
					{ name: 'Trash', value: 'trash' },
					{ name: 'Scheduled', value: 'scheduled' },
				],
				default: 'inbox',
			},
			{
				displayName: 'Search Keyword',
				name: 'keyword',
				type: 'string',
				default: '',
				description: 'Optional keyword filter — only emit threads matching it',
			},
			{
				displayName: 'Max Threads Per Poll',
				name: 'maxThreads',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of threads to check per poll',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const credentials = await this.getCredentials('synologyApi') as unknown as SynologyCredentials;
		const mc = new MailClientClient(new SynologyClient(this as never, credentials));

		const mailbox = this.getNodeParameter('mailbox', 'inbox') as string;
		const keyword = this.getNodeParameter('keyword', '') as string;
		const maxThreads = this.getNodeParameter('maxThreads', 50) as number;
		const mailboxId = MAILBOX_ID_MAP[mailbox];

		const threads = await mc.listThreads({
			mailboxId,
			offset: 0,
			limit: maxThreads,
			keyword: keyword || undefined,
		});

		const staticData = this.getWorkflowStaticData('global');
		const seenKey = `mailSeen_${mailbox}`;
		const seenIds = new Set<number>(Array.isArray(staticData[seenKey]) ? staticData[seenKey] as number[] : []);
		const now = Date.now();

		// New threads = not in seen set. Sort newest first, cap by limit.
		const newThreads = (threads.thread ?? [])
			.filter((t) => !seenIds.has(t.id))
			.slice(0, maxThreads);

		// Persist all current thread ids so they are not re-emitted next poll.
		staticData[seenKey] = [...new Set([...(threads.thread ?? []).map((t) => t.id)])];
		staticData[`mailSeenAt_${mailbox}`] = now;

		if (newThreads.length === 0) {
			return null;
		}

		const items: INodeExecutionData[] = newThreads.map((thread) => ({
			json: {
				mailbox,
				mailboxId,
				thread,
				message: thread.message ?? [],
				triggeredAt: now,
			} as unknown as IDataObject,
		}));

		return [items];
	}
}
