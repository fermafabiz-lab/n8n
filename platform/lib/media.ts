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

/**
 * A filename safe to put in a Content-Disposition header.
 *
 * Quotes and control characters would let the caller inject header syntax,
 * and a browser given a name with a newline in it does unpredictable things.
 * Empty after cleaning => the caller must omit the header rather than send a
 * download called "".
 */
export const safeFilename = (raw: string): string =>
	raw
		.replace(/[^\w .\-()]+/g, "-")
		.replace(/-+/g, "-")
		.slice(0, 80)
		.replace(/^[-. ]+|[-. ]+$/g, "");

/**
 * The same bytes, but arriving as a named file rather than as playback.
 *
 * `<a download>` is only honoured on a SAME-ORIGIN link, which is exactly what
 * `/api/media` makes a Drive asset — so a proxied file also gets `?dl=`, and
 * the proxy answers with a Content-Disposition. Anything already on a CDN is
 * returned untouched: the attribute is ignored cross-origin either way, so a
 * `dl` query would only be noise.
 */
export const downloadSrc = (url: string, filename: string): string => {
	const src = mediaSrc(url);
	if (!src.startsWith("/api/media")) return src;
	const name = safeFilename(filename);
	return name ? `${src}&dl=${encodeURIComponent(name)}` : src;
};
