// Thin wrapper around the official @remotion/lambda SDK.
// Exports two functions n8n needs: start a render, and poll its progress.
// Works both as a local CLI (for manual testing) and as the core logic
// for a Lambda-behind-API-Gateway handler (see README "Exposing this to n8n").
import {renderMediaOnLambda, getRenderProgress} from '@remotion/lambda/client';

const REGION = process.env.REMOTION_AWS_REGION || 'us-east-1';
const FUNCTION_NAME = process.env.REMOTION_LAMBDA_FUNCTION_NAME;
const SERVE_URL = process.env.REMOTION_SERVE_URL;

export async function triggerRender(inputProps) {
	if (!FUNCTION_NAME || !SERVE_URL) {
		throw new Error(
			'Set REMOTION_LAMBDA_FUNCTION_NAME and REMOTION_SERVE_URL (from the deploy step) before triggering a render.'
		);
	}
	const {renderId, bucketName} = await renderMediaOnLambda({
		region: REGION,
		functionName: FUNCTION_NAME,
		serveUrl: SERVE_URL,
		composition: 'FinalVideo',
		inputProps,
		codec: 'h264',
		imageFormat: 'jpeg',
		maxRetries: 1,
		privacy: 'public',
	});
	return {renderId, bucketName};
}

export async function checkProgress(renderId, bucketName) {
	const progress = await getRenderProgress({
		renderId,
		bucketName,
		functionName: FUNCTION_NAME,
		region: REGION,
	});
	return {
		done: progress.done,
		fatalErrorEncountered: progress.fatalErrorEncountered,
		errors: progress.errors,
		overallProgress: progress.overallProgress,
		outputFile: progress.outputFile || null,
	};
}

// CLI usage: node render.mjs props.json
// Polls every 5s and prints the final output URL — useful to validate the
// deploy before wiring the n8n HTTP nodes.
if (import.meta.url === `file://${process.argv[1]}`) {
	const fs = await import('node:fs/promises');
	const propsPath = process.argv[2];
	if (!propsPath) {
		console.error('Usage: node render.mjs <path-to-props.json>');
		process.exit(1);
	}
	const inputProps = JSON.parse(await fs.readFile(propsPath, 'utf8'));
	const {renderId, bucketName} = await triggerRender(inputProps);
	console.log('Render started:', renderId);

	while (true) {
		await new Promise((r) => setTimeout(r, 5000));
		const p = await checkProgress(renderId, bucketName);
		console.log(`progress: ${Math.round(p.overallProgress * 100)}%`);
		if (p.fatalErrorEncountered) {
			console.error('Render failed:', p.errors);
			process.exit(1);
		}
		if (p.done) {
			console.log('Done:', p.outputFile);
			break;
		}
	}
}
