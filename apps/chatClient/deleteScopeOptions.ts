import type { INodePropertyOptions } from 'n8n-workflow';
import type { DeleteScope } from './deleteMessageUtils';

/**
 * Build the options for the "Who to Delete" select scoped to the current
 * credential's permission.
 *
 * The Synology Chat API `Post.delete` (v8) only reliably permits deleting the
 * logged-in user's own posts (verified live 2026-08-11: `other users'` and even
 * own posts past a short age window return error 415). For a normal (non-admin)
 * credential only the `own` scope is feasible, so the other options are hidden.
 * When the credential maps to a DSM administrator we still surface the broader
 * scopes (their delete capability is not fully verified server-side, so any
 * non-deletable posts are skipped and reported at runtime).
 */
export function buildDeleteScopeOptions(isAdmin: boolean): INodePropertyOptions[] {
	const options: INodePropertyOptions[] = [
		{
			name: 'My Messages Only',
			value: 'own',
			description: 'Only posts sent by the logged-in user. This is the only scope the Chat API can actually delete.',
		},
	];

	if (isAdmin) {
		options.push(
			{
				name: 'Other Users Messages',
				value: 'others',
				description: 'Intended for other users messages. Note: the Chat API rejects deleting other users posts (error 415), so non-own posts are skipped and reported.',
			},
			{
				name: 'All Messages',
				value: 'all',
				description: 'Everything in the channel. Non-own posts are skipped and reported (API 415 for others).',
			},
		);
	}

	return options;
}

export type { DeleteScope };
