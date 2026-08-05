/**
 * Where a media URL should actually be loaded from.
 *
 * Google Drive's `uc?export=download` links answer with redirects and an HTML
 * MIME type, so a native <video>/<audio> refuses them outright — they have to
 * be proxied. They used to go through the Railway render server's `/media`,
 * which buffers the whole file and answers with a plain 200: no `Accept-Ranges`
 * and the `Range` header ignored. A browser can still play such a response
 * progressively, but it cannot seek, which is why scrubbing the final video or
 * a voiceover did nothing. `/api/media` proxies the same files with byte ranges
 * intact.
 *
 * Everything not on Drive (fal.media clips, Airtable attachments) is served by
 * a CDN that already honours ranges, so it is passed through untouched — there
 * is no reason to push those bytes through our own function.
 */
export const driveId = (url: string): string | null => {
	const m = url.match(/[?&]id=([\w-]+)/) ?? url.match(/\/file\/d\/([\w-]+)/);
	return m ? m[1] : null;
};

export const mediaSrc = (url: string): string => {
	if (!url) return url;
	const id = url.includes("drive.google.com") ? driveId(url) : null;
	return id ? `/api/media?id=${id}` : url;
};
