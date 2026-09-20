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
// another seek (see MediaPlayer).
//
// THE MISS MUST NOT WAIT FOR THE CACHE, which the first version of this got
// wrong and shipped. It made the missing request do the downloading — fetch
// the whole file, write it, then answer. Invisible on a 40 kB voiceover, and
// fatal on a film: the browser got nothing until the server held the last
// byte, so a player that used to start immediately simply never started. A
// cache is not allowed to be slower than no cache.
//
// So a miss streams straight through, exactly as this route always did, and
// the bytes are fetched again in the background for NEXT time. First play is
// no worse than before; every play after it is local.
//
// Note what is NOT fixable here: Drive answers a file too large to virus-scan
// (306 MB, on the film this was measured against) with an HTML interstitial
// no matter what range is asked for — verified with and without a `Range`
// header. This route has always answered 502 for those, and `MediaPlayer`
// has always fallen back to Drive's own embed player, which is what actually
// plays the big finals.
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
	scheduleFill,
	totalSizeOf,
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

	// A miss is served the way it always was: forward the caller's range and
	// stream. Nothing below blocks on the cache.
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

	// Drive serves an HTML interstitial instead of the file when it wants a
	// confirmation click — which is every file too large for it to virus-scan,
	// with or without a range. Handing that to a <video> makes it fail with no
	// explanation, so say what happened; the player's Drive-embed fallback is
	// what carries those.
	const contentType = upstream.headers.get("content-type") ?? "";
	if (contentType.includes("html")) {
		await upstream.body?.cancel().catch(() => {});
		return json(502, {error: "drive returned an HTML page, not media"});
	}

	// Worth keeping? Decided from the headers, which are already here, so the
	// body is never touched to find out.
	const total = totalSizeOf(upstream);
	if (total !== null && total <= MAX_CACHE_BYTES) scheduleFill(id, driveUrl(id));

	const headers = baseHeaders(contentType, upstream.status === 206);
	// Nothing is kept yet, so nothing may be claimed immutable — a short
	// private window is enough to cover a player's own re-requests, and the
	// fill above makes the next real play local anyway.
	headers.set("Cache-Control", "private, max-age=600");
	for (const h of ["content-length", "content-range", "etag", "last-modified"]) {
		const v = upstream.headers.get(h);
		if (v) headers.set(h, v);
	}
	if (download) headers.set("Content-Disposition", `attachment; filename="${download}"`);
	return new Response(upstream.body, {status: upstream.status, headers});
}
