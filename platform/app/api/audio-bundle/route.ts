// One narration file out of many takes — the whole film, or one chapter.
//
// The pipeline stores narration one scene at a time (`Voiceover URL` per
// scene) and never keeps a combined track: the only place the takes are ever
// joined is inside the final video, muxed under the picture. So there was no
// way to get the narration on its own — to listen through it away from the
// site, to hand it to an editor, or to check a chapter reads well end to end.
//
// GET /api/audio-bundle?project=rec…&chapter=all|hook|1|2…
//   -> audio/mpeg, as a named attachment.
//
// A plain GET on purpose: this has to be reachable from `<a download>`, which
// cannot POST. The site's password middleware covers /api, so the route is no
// more open than the page that links to it.
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { getProject, getScenes } from "@/lib/data";
import { driveId, safeFilename } from "@/lib/media";
import { concatMp3 } from "@/lib/mp3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Far past any real film, and the reason a runaway request cannot pile up. */
const MAX_TAKES = 200;
/** Narration is ~128kbps mono; 200MB is minutes of audio per scene. */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

const bad = (status: number, error: string) =>
	new Response(JSON.stringify({ error }), {
		status,
		headers: { "Content-Type": "application/json" },
	});

const run = (cmd: string, args: string[], timeoutMs = 120_000) =>
	new Promise<void>((resolve, reject) => {
		execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, _out, stderr) => {
			if (err) reject(new Error(`${cmd}: ${err.message}\n${String(stderr).slice(-800)}`));
			else resolve();
		});
	});

/**
 * Is there an ffmpeg on this host?
 *
 * The site's own image installs one, but the same code also runs where none
 * exists — an old Vercel copy of this app, or a bare `next dev` — and there
 * the download answered 500 with nothing a producer could act on. Probed once
 * per process rather than per request, and never assumed: a missing binary is
 * a fallback, not an error.
 */
let ffmpegProbe: Promise<boolean> | null = null;
const hasFfmpeg = (): Promise<boolean> => {
	if (!ffmpegProbe) {
		ffmpegProbe = run("ffmpeg", ["-version"], 5_000).then(
			() => true,
			() => false,
		);
	}
	return ffmpegProbe;
};

/**
 * Scene order encodes the chapter — 101/102 are chapter 1, 201 chapter 2,
 * anything under 100 is the hook. Same rule as `AB Pick Voice` in n8n and
 * `chapterOf` in AudioReview; the three have to agree or a "Chapter 2"
 * download would hold different lines from the ones the panel labels Ch. 2.
 */
const chapterOf = (order: number): number =>
	Number.isFinite(order) ? Math.floor(order / 100) : 0;

export async function GET(req: Request) {
	const params = new URL(req.url).searchParams;
	const projectId = params.get("project") ?? "";
	const chapter = (params.get("chapter") ?? "all").trim();

	if (!/^rec[A-Za-z0-9]{14}$/.test(projectId)) return bad(400, "invalid project id");
	if (!/^(all|hook|\d{1,3})$/.test(chapter)) return bad(400, "invalid chapter");

	const [project, scenes] = await Promise.all([
		getProject(projectId),
		getScenes(projectId),
	]);
	if (!project) return bad(404, "project not found");

	// getScenes already sorts by "Ordine Scenă", which is the order the film
	// plays in — so the takes concatenate in the right sequence for free.
	const takes = scenes.filter((s) => {
		if (!s.voiceUrl || !driveId(s.voiceUrl)) return false;
		if (chapter === "all") return true;
		const ch = chapterOf(s.order);
		return chapter === "hook" ? ch === 0 : ch === Number(chapter);
	});

	if (takes.length === 0) {
		return bad(
			404,
			chapter === "all"
				? "This project has no narration yet."
				: `No narration in ${chapter === "hook" ? "the hook" : `chapter ${chapter}`} yet.`,
		);
	}
	if (takes.length > MAX_TAKES) return bad(413, `too many takes (${takes.length})`);

	const work = await fs.mkdtemp(path.join(os.tmpdir(), "narration-"));
	try {
		const parts: Buffer[] = [];
		let total = 0;
		for (const [i, s] of takes.entries()) {
			const id = driveId(s.voiceUrl as string) as string;
			const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, {
				redirect: "follow",
				cache: "no-store",
			});
			if (!res.ok) return bad(502, `scene ${i + 1}: drive HTTP ${res.status}`);
			// Drive answers an HTML interstitial instead of the file when it
			// wants a confirmation click. ffmpeg would fail on it with something
			// unreadable, so name the real problem here.
			if ((res.headers.get("content-type") ?? "").includes("html")) {
				return bad(502, `scene ${i + 1}: drive returned a page, not audio`);
			}
			const buf = Buffer.from(await res.arrayBuffer());
			total += buf.length;
			if (total > MAX_TOTAL_BYTES) return bad(413, "narration too large to bundle");
			parts.push(buf);
		}

		// No gap between takes, either way: this is the narration as the film
		// cuts it, and a bundle that drifts from the video is worse than none.
		let bytes: Buffer;
		if (await hasFfmpeg()) {
			// Preferred. Same graph as /tts-multi on the render server:
			// normalise every take to one sample rate and channel count before
			// concat, because concat refuses inputs that disagree and a
			// re-synthesized line can come back unlike its neighbours.
			const files: string[] = [];
			for (const [i, buf] of parts.entries()) {
				const f = path.join(work, `t${String(i).padStart(3, "0")}.mp3`);
				await fs.writeFile(f, buf);
				files.push(f);
			}
			const out = path.join(work, "out.mp3");
			const args = ["-y"];
			for (const f of files) args.push("-i", f);
			const graph = files.map(
				(_, i) => `[${i}:a]aformat=sample_rates=44100:channel_layouts=mono[s${i}]`,
			);
			graph.push(
				`${files.map((_, i) => `[s${i}]`).join("")}concat=n=${files.length}:v=0:a=1[out]`,
			);
			args.push("-filter_complex", graph.join(";"), "-map", "[out]", "-b:a", "128k", out);
			await run("ffmpeg", args);
			bytes = await fs.readFile(out);
		} else {
			// No ffmpeg on this host. Frame-level concatenation instead — see
			// lib/mp3.ts for why the tags and the Xing header have to go, and
			// for the one thing this path cannot do: it keeps each take's
			// encoder padding, so every join gains ~36ms of silence. Inaudible,
			// but not sample-exact, which is why it is the fallback.
			bytes = concatMp3(parts);
		}
		const label =
			chapter === "all"
				? "narration"
				: chapter === "hook"
					? "hook"
					: `chapter ${chapter}`;
		const name =
			safeFilename(`${project.name} - ${label}`) || `narration-${randomUUID().slice(0, 8)}`;
		return new Response(new Uint8Array(bytes), {
			headers: {
				"Content-Type": "audio/mpeg",
				"Content-Length": String(bytes.length),
				"Content-Disposition": `attachment; filename="${name}.mp3"`,
				// Takes change whenever a line is re-recorded, and the URL does
				// not — so this must never be cached.
				"Cache-Control": "private, no-store",
			},
		});
	} catch (err) {
		return bad(500, String((err as Error)?.message ?? err));
	} finally {
		await fs.rm(work, { recursive: true, force: true }).catch(() => {});
	}
}
