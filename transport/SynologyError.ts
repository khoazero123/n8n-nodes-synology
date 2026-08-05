export function getSynologyAuthErrorMessage(error: number): string {
	switch (error) {
		case 400:
			return `${error} - No such account or incorrect password.`;
		case 401:
			return `${error} - Disabled account.`;
		case 402:
			return `${error} - Denied permission.`;
		case 403:
			return `${error} - 2-factor authentication code required.`;
		case 404:
			return `${error} - Failed to authenticate 2-factor authentication code.`;
		case 406:
			return `${error} - Enforced 2-factor authentication required.`;
		case 407:
			return `${error} - Blocked IP source.`;
		case 409:
			return `${error} - Expired password.`;
		case 410:
			return `${error} - Password must be changed.`;
		default:
			return error ? `${error} - Unknown Synology API error.` : 'Unknown Synology API error.';
	}
}
