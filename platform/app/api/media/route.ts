// Range-capable proxy for Google Drive assets — final videos and voiceovers.
//
// The point of this route is the `Range` header. The player needs three things
// to let the user scrub: a real Content-Type (Drive's download links answer
// text/html), `Accept-Ranges: bytes`, and a 206 with `Content-Range` when a
// range is asked for. The previous proxy provided only the first, so playback
// worked and seeking silently did nothing.
//
// Drive-only by construction: the id is interpolated into a Drive URL, so this
// cannot be pointed at an arbitrary host.

import { safeFilename } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const driveUrl = (id: string) =>
	`https://drive.google.com/uc?export=download&id=${id}`;

export async function GET(req: Request) {
	const params = new URL(req.url).searchParams;
	const id = params.get("id") ?? "";
	// `dl` turns the same proxied bytes into a download. Opt-in by query, not
	// by default: the players use this route too, and an attachment header
	// would make every scene clip download instead of play.
	const download = safeFilename(params.get("dl") ?? "");
	if (!/^[\w-]{10,}$/.test(id)) {
		return new Response(JSON.stringify({error: "invalid id"}), {
			status: 400,
			headers: {"Content-Type": "application/json"},
		});
	}

	const range = req.headers.get("range");
	let upstream: Response;
	try {
		upstream = await fetch(driveUrl(id), {
			// Forwarding the range is the whole fix. Drive redirects to
			// usercontent.google.com, which honours it and answers 206.
			headers: range ? {Range: range} : {},
			redirect: "follow",
			cache: "no-store",
		});
	} catch (err) {
		return new Response(
			JSON.stringify({error: String((err as Error)?.message ?? err)}),
			{status: 502, headers: {"Content-Type": "application/json"}},
		);
	}

	if (!upstream.ok && upstream.status !== 206) {
		return new Response(JSON.stringify({error: `drive: HTTP ${upstream.status}`}), {
			status: 502,
			headers: {"Content-Type": "application/json"},
		});
	}

	// Drive serves an HTML interstitial instead of the file when it wants a
	// confirmation click. Handing that to a <video> makes it fail with no
	// explanation, so say what happened instead.
	const upstreamType = upstream.headers.get("content-type") ?? "";
	if (upstreamType.includes("html")) {
		return new Response(
			JSON.stringify({error: "drive returned an HTML page, not media"}),
			{status: 502, headers: {"Content-Type": "application/json"}},
		);
	}

	const headers = new Headers({
		"Content-Type": upstreamType || "application/octet-stream",
		// Advertised even on a plain 200: without it the browser assumes the
		// resource cannot be seeked and never tries.
		"Accept-Ranges": "bytes",
		// Only a full response is safely shareable. A cache that keys on URL
		// alone would happily serve one partial response for a different
		// Range, which corrupts playback in a way that looks like a bad file.
		"Cache-Control":
			upstream.status === 206 ? "private, no-store" : "public, max-age=3600",
		Vary: "Range",
	});
	for (const h of ["content-length", "content-range", "etag", "last-modified"]) {
		const v = upstream.headers.get(h);
		if (v) headers.set(h, v);
	}
	if (download) {
		headers.set("Content-Disposition", `attachment; filename="${download}"`);
	}

	// Streamed, not buffered: the old proxy read the entire file into memory
	// before sending a byte, which delayed the first frame and made every seek
	// re-download the whole thing.
	return new Response(upstream.body, {status: upstream.status, headers});
}
