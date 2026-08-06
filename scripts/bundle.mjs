// Bundle each node/credential file with esbuild (inline shared code).
// n8n loads community nodes via loadClassInIsolation (VM) which cannot
// resolve relative requires to sibling dirs (apps/, transport/) — so every
// node file must be self-contained. n8n-workflow stays external (peer).
import { build } from 'esbuild';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

const dist = 'dist';
const targets = [];

// nodes: dist/nodes/<Name>/<Name>.node.js
for (const dir of readdirSync(join(dist, 'nodes'))) {
	const nodeDir = join(dist, 'nodes', dir);
	const entry = join(nodeDir, `${dir}.node.js`);
	if (existsSync(entry)) targets.push(entry);
}
// credentials: dist/credentials/*.credentials.js
if (existsSync(join(dist, 'credentials'))) {
	for (const f of readdirSync(join(dist, 'credentials'))) {
		if (f.endsWith('.credentials.js')) targets.push(join(dist, 'credentials', f));
	}
}

for (const entry of targets) {
	await build({
		entryPoints: [entry],
		outfile: entry,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'node18',
		external: ['n8n-workflow'],
		packages: 'external',
		allowOverwrite: true,
		legalComments: 'inline',
		sourcemap: false,
		logLevel: 'warning',
	});
	console.log('bundled', entry);
}
// esbuild strips all comments, so re-insert eslint-disable for the
// 'main' connection-type literals (scanner rule needs them).
import { readFileSync, writeFileSync } from 'fs';
for (const entry of targets) {
	let code = readFileSync(entry, 'utf8');
	code = code.replace(/\n\s*(inputs: \["main"\])/g, "\n\t// eslint-disable-next-line\n\t$1");
	code = code.replace(/\n\s*(outputs: \["main"\])/g, "\n\t// eslint-disable-next-line\n\t$1");
	writeFileSync(entry, code);
}
console.log('done', targets.length, 'files');
