// Range-capable proxy for Google Drive assets — scene voiceovers and final
// videos — with a local cache in front of it.
//
// The point of this route used to be the `Range` header alone. The player
// needs three things to let the user scrub: a real Content-Type (Drive's
// download links answer text/html), `Accept-Ranges: bytes`, and a 206 with
// `Content-Range` when a range is asked for.
//
// THE SECOND POINT, since 2026-09-20, is not paying Drive for it every time.
// Measured on the box: a byte range from the local media store answers in
// ~25 ms, the same range from Drive in 593-1383 ms, and this route marked
// every 206 `no-store`, so a second play re-bought the whole thing. Scene
// review was the casualty — the picture is local and fast, the overlaid
// voiceover is not, and the player's drift correction turned every stall into
// another seek (see MediaPlayer). Now the first request pays Drive once, the
// bytes land in `_drive/` and everything after that is served from disk.
//
// Drive-only by construction: the id is interpolated into a Drive URL, so this
// cannot be pointed at an arbitrary host, and `MediaQuery` restricts it to
// `[\w-]{10,}` so it is also safe as a filename.

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { safeFilename } from "@/lib/media";
import {
	MAX_CACHE_BYTES,
	parseRange,
	readCached,
	writeCached,
	type CachedMedia,
} from "@/lib/media-cache";
import { MediaQuery, ValidationError, parseQuery } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const driveUrl = (id: string) =>
	`https://drive.google.com/uc?export=download&id=${id}`;

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: {"Content-Type": "application/json"},
	});

/**
 * Headers every answer carries.
 *
 * `immutable` is true by construction and is the half of this fix that costs
 * nothing: a Drive file id names one fixed set of bytes, so a copy the
 * browser already holds can never be stale. 206 stays `private` — a shared
 * cache keying on URL alone could serve one range's bytes for another, which
 * corrupts playback in a way that looks like a bad file — but `private` still
 * lets the browser keep it, which is what stops a re-watch going back out.
 */
function baseHeaders(contentType: string, partial: boolean, etag?: string) {
	const h = new Headers({
		"Content-Type": contentType || "application/octet-stream",
		// Advertised even on a plain 200: without it the browser assumes the
		// resource cannot be seeked and never tries.
		"Accept-Ranges": "bytes",
		"Cache-Control": `${partial ? "private" : "public"}, max-age=31536000, immutable`,
		Vary: "Range",
	});
	if (etag) h.set("ETag", etag);
	return h;
}

/** Serve a byte range straight off the disk cache. */
function fromDisk(hit: CachedMedia, rangeHeader: string | null, download: string) {
	const range = parseRange(rangeHeader, hit.bytes);
	if (rangeHeader && !range) {
		return new Response(null, {
			status: 416,
			headers: {"Content-Range": `bytes */${hit.bytes}`, "Accept-Ranges": "bytes"},
		});
	}
	const {start, end} = range ?? {start: 0, end: hit.bytes - 1};
	const headers = baseHeaders(hit.contentType, !!range, hit.etag);
	headers.set("Content-Length", String(end - start + 1));
	if (range) headers.set("Content-Range", `bytes ${start}-${end}/${hit.bytes}`);
	if (download) headers.set("Content-Disposition", `attachment; filename="${download}"`);
	const stream = Readable.toWeb(
		createReadStream(hit.abs, {start, end}),
	) as unknown as ReadableStream;
	return new Response(stream, {status: range ? 206 : 200, headers});
}

/** Serve a byte range out of bytes we are holding anyway. */
function fromBuffer(
	buf: Buffer,
	contentType: string,
	rangeHeader: string | null,
	download: string,
) {
	const range = parseRange(rangeHeader, buf.length);
	const {start, end} = range ?? {start: 0, end: buf.length - 1};
	const headers = baseHeaders(contentType, !!range);
	headers.set("Content-Length", String(end - start + 1));
	if (range) headers.set("Content-Range", `bytes ${start}-${end}/${buf.length}`);
	if (download) headers.set("Content-Disposition", `attachment; filename="${download}"`);
	const slice = buf.subarray(start, end + 1);
	return new Response(new Uint8Array(slice), {status: range ? 206 : 200, headers});
}

export async function GET(req: Request) {
	const params = new URL(req.url).searchParams;
	let query: ReturnType<typeof MediaQuery.parse>;
	try {
		query = parseQuery(params, MediaQuery);
	} catch (e) {
		if (e instanceof ValidationError) return json(e.status, {error: e.message});
		throw e;
	}
	const {id} = query;
	// `dl` turns the same proxied bytes into a download. Opt-in by query, not
	// by default: the players use this route too, and an attachment header
	// would make every scene clip download instead of play.
	const download = safeFilename(query.dl);
	const range = req.headers.get("range");

	// The fast path, and after the first play the only path.
	const hit = await readCached(id);
	if (hit) return fromDisk(hit, range, download);

	// A miss asks for the WHOLE file, not the requested range: one round trip
	// buys every future range for free, and a range request would leave the
	// cache empty so the next seek pays Drive again. The exception is a file
	// too big to be worth keeping — see MAX_CACHE_BYTES — which falls back to
	// the streaming behaviour this route has always had.
	let upstream: Response;
	try {
		upstream = await fetch(driveUrl(id), {redirect: "follow", cache: "no-store"});
	} catch (err) {
		return json(502, {error: String((err as Error)?.message ?? err)});
	}
	if (!upstream.ok) return json(502, {error: `drive: HTTP ${upstream.status}`});

	// Drive serves an HTML interstitial instead of the file when it wants a
	// confirmation click. Handing that to a <video> makes it fail with no
	// explanation, so say what happened instead.
	const contentType = upstream.headers.get("content-type") ?? "";
	if (contentType.includes("html")) {
		await upstream.body?.cancel().catch(() => {});
		return json(502, {error: "drive returned an HTML page, not media"});
	}

	const declared = Number(upstream.headers.get("content-length") ?? "0");
	if (declared > MAX_CACHE_BYTES) {
		// Do not read it. Drop this response and re-ask with the caller's range
		// so a two-hundred-megabyte film still streams from the first byte the
		// player wants, exactly as before.
		await upstream.body?.cancel().catch(() => {});
		return streamThrough(id, range, download);
	}

	let buf: Buffer;
	try {
		buf = Buffer.from(await upstream.arrayBuffer());
	} catch (err) {
		return json(502, {error: `drive read failed: ${String((err as Error)?.message ?? err)}`});
	}
	if (!buf.length) return json(502, {error: "drive returned an empty body"});

	// Undeclared length is the case the check above cannot see; now that the
	// bytes are in hand, `writeCached` refuses anything oversized itself.
	const stored = await writeCached(id, buf, contentType || "application/octet-stream");
	// Serve from the bytes we already have either way — a cache write that
	// failed (full volume, read-only mount) must not cost the producer a play.
	return stored
		? fromDisk(stored, range, download)
		: fromBuffer(buf, contentType, range, download);
}

/** The pre-cache behaviour, kept for files too large to keep. */
async function streamThrough(id: string, range: string | null, download: string) {
	let upstream: Response;
	try {
		upstream = await fetch(driveUrl(id), {
			headers: range ? {Range: range} : {},
			redirect: "follow",
			cache: "no-store",
		});
	} catch (err) {
		return json(502, {error: String((err as Error)?.message ?? err)});
	}
	if (!upstream.ok && upstream.status !== 206) {
		return json(502, {error: `drive: HTTP ${upstream.status}`});
	}
	const contentType = upstream.headers.get("content-type") ?? "";
	if (contentType.includes("html")) {
		await upstream.body?.cancel().catch(() => {});
		return json(502, {error: "drive returned an HTML page, not media"});
	}
	const headers = baseHeaders(contentType, upstream.status === 206);
	// Nothing was kept, so nothing may be claimed immutable by us — let the
	// browser revalidate a big film rather than pin it.
	headers.set("Cache-Control", "private, max-age=600");
	for (const h of ["content-length", "content-range", "etag", "last-modified"]) {
		const v = upstream.headers.get(h);
		if (v) headers.set(h, v);
	}
	if (download) headers.set("Content-Disposition", `attachment; filename="${download}"`);
	return new Response(upstream.body, {status: upstream.status, headers});
}
