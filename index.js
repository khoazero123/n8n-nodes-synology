// Entry point required by n8n's community package loader.
// Node and credential registrations are declared in package.json under the "n8n" key.
// Classes are exported here so n8n can resolve them by name.
module.exports = {
	SynologyApi: require('./dist/credentials/SynologyApi.credentials.js').SynologyApi,
	SynologyNoteStation: require('./dist/nodes/SynologyNoteStation/SynologyNoteStation.node.js').SynologyNoteStation,
	SynologyDrive: require('./dist/nodes/SynologyDrive/SynologyDrive.node.js').SynologyDrive,
	SynologyDownloadStation: require('./dist/nodes/SynologyDownloadStation/SynologyDownloadStation.node.js').SynologyDownloadStation,
	SynologyMailClient: require('./dist/nodes/SynologyMailClient/SynologyMailClient.node.js').SynologyMailClient,
	SynologyChat: require('./dist/nodes/SynologyChat/SynologyChat.node.js').SynologyChat,
	SynologyChatTrigger: require('./dist/nodes/SynologyChat/SynologyChatTrigger.node.js').SynologyChatTrigger,
	SynologyMailTrigger: require('./dist/nodes/SynologyMailTrigger/SynologyMailTrigger.node.js').SynologyMailTrigger,
};
