// Render one props file with either engine, on this machine, for comparing
// them frame by frame (scripts/compare-engines.mjs).
//
//   node scripts/render-local.mjs --engine hyperframes|remotion \
//        --props trigger/studio-props.json --montage film.mp4 --out out.mp4 [--scale 1.5]
//
// `--montage` stands in for the /assemble output that `finalVideoUrl` points at
// in production. Remotion's OffthreadVideo only fetches over HTTP, so for that
// engine the file is served from a throwaway local server; Hyperframes reads it
// from disk. Everything else is what server/index.mjs does, minus the job map.

import fs from 'fs';
import http from 'http';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const engine = args.engine || 'hyperframes';
const scale = Number(args.scale || 1);
const props = JSON.parse(fs.readFileSync(args.props, 'utf8'));
delete props._comment;
const montage = path.resolve(args.montage);
const out = path.resolve(args.out);

const t0 = Date.now();
let lastLog = 0;
const onProgress = (p) => {
	if (Date.now() - lastLog > 5000) {
		lastLog = Date.now();
		console.log(`${engine}: ${(p * 100).toFixed(0)}%`);
	}
};

if (engine === 'hyperframes') {
	const {renderWithHyperframes} = await import('../server/render-hf.mjs');
	await renderWithHyperframes({inputProps: {...props, finalVideoUrl: montage}, scale, outputLocation: out, onProgress});
} else {
	const {bundle} = await import('@remotion/bundler');
	const {renderMedia, selectComposition} = await import('@remotion/renderer');
	const server = http.createServer((req, res) => {
		const stat = fs.statSync(montage);
		const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
		if (range) {
			const start = Number(range[1]);
			const end = range[2] ? Number(range[2]) : stat.size - 1;
			res.writeHead(206, {
				'Content-Type': 'video/mp4',
				'Content-Range': `bytes ${start}-${end}/${stat.size}`,
				'Content-Length': end - start + 1,
				'Accept-Ranges': 'bytes',
			});
			fs.createReadStream(montage, {start, end}).pipe(res);
		} else {
			res.writeHead(200, {'Content-Type': 'video/mp4', 'Content-Length': stat.size, 'Accept-Ranges': 'bytes'});
			fs.createReadStream(montage).pipe(res);
		}
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const inputProps = {...props, finalVideoUrl: `http://127.0.0.1:${server.address().port}/montage.mp4`};
	try {
		const serveUrl = await bundle({entryPoint: path.join(__dirname, '..', 'src', 'index.ts'), onProgress: () => {}});
		const composition = await selectComposition({serveUrl, id: 'FinalVideo', inputProps});
		// The settings server/index.mjs renders with, so the comparison is fair.
		await renderMedia({
			composition,
			serveUrl,
			codec: 'h264',
			scale,
			outputLocation: out,
			inputProps,
			concurrency: Number(args.concurrency || 1),
			timeoutInMilliseconds: 120000,
			offthreadVideoCacheSizeInBytes: 1024 * 1024 * 1024,
			chromiumOptions: {gl: 'swangle', disableWebSecurity: false},
			onProgress: ({progress}) => onProgress(progress),
		});
	} finally {
		server.close();
	}
}

console.log(`${engine}: done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${out}`);
