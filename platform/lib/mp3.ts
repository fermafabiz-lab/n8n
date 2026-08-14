/**
 * Joining mp3 takes without ffmpeg.
 *
 * The narration bundle prefers ffmpeg — it re-encodes to one uniform stream
 * and is what the site's own image ships. But the same code also runs where
 * no ffmpeg binary exists (a Vercel copy of this app, a bare `next dev`), and
 * there the download used to answer 500 with nothing a producer could act on.
 *
 * An mp3 is a sequence of self-contained frames, so joining files really is
 * concatenation — but only AFTER the parts that are not frames are removed,
 * and that is the whole content of this file:
 *
 *  - ID3v2 tags at the head and ID3v1 at the tail are metadata. Left in the
 *    middle of a stream most players skip them, some click.
 *  - The Xing/Info frame is worse. It is a real frame carrying the file's
 *    duration and frame count, and a player trusts it over the actual bytes.
 *    Leave the first part's header in and the player reports the first take's
 *    length for the whole bundle — a 4-second file that is really 3 minutes.
 *    So it is dropped from EVERY part, and the player then derives duration
 *    from bitrate and size, which is exact for the constant-bitrate mp3s the
 *    TTS provider returns.
 *
 * This is the FALLBACK, not the preferred path, and the reason is measured
 * rather than assumed. Every mp3 carries encoder delay and padding frames at
 * its two ends; a decoder trims them using the gapless info in the very header
 * this file has to remove. So a frame concat keeps them, and each join gains
 * about 36ms of silence — three takes decoded to 4.2006s through ffmpeg and
 * 4.3106s through here. Nothing is lost and nobody hears 36ms, but it is not
 * sample-exact, and on a fifteen-scene film it adds up to about half a second
 * against the cut. Where ffmpeg exists, it wins.
 */

/** Bitrate table, kbps, for MPEG1/2 Layer III. Index by the header's 4 bits. */
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const RATES_V1 = [44100, 48000, 32000, 0];
const RATES_V2 = [22050, 24000, 16000, 0];
const RATES_V25 = [11025, 12000, 8000, 0];

type Frame = { length: number; mpeg1: boolean; mono: boolean };

/** Reads a frame header at `i`, or null if there is not a valid one there. */
function frameAt(buf: Buffer, i: number): Frame | null {
	if (i + 4 > buf.length) return null;
	// Sync word: eleven 1 bits.
	if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return null;
	const versionBits = (buf[i + 1] >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
	const layerBits = (buf[i + 1] >> 1) & 0x03; // 1 = Layer III
	if (versionBits === 1 || layerBits !== 1) return null;
	const bitrateIndex = (buf[i + 2] >> 4) & 0x0f;
	const rateIndex = (buf[i + 2] >> 2) & 0x03;
	if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;

	const mpeg1 = versionBits === 3;
	const kbps = (mpeg1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex];
	const rate = (mpeg1 ? RATES_V1 : versionBits === 2 ? RATES_V2 : RATES_V25)[rateIndex];
	if (!kbps || !rate) return null;

	const padding = (buf[i + 2] >> 1) & 0x01;
	// Layer III carries 1152 samples per frame on MPEG1 and 576 on MPEG2/2.5.
	const samples = mpeg1 ? 1152 : 576;
	const length = Math.floor((samples / 8) * ((kbps * 1000) / rate)) + padding;
	if (length < 4) return null;
	return { length, mpeg1, mono: ((buf[i + 3] >> 6) & 0x03) === 3 };
}

/** Drop ID3v2 at the head and ID3v1 at the tail. */
function stripTags(buf: Buffer): Buffer {
	let start = 0;
	if (buf.length > 10 && buf.toString("latin1", 0, 3) === "ID3") {
		// Size is four syncsafe bytes: seven significant bits each.
		const size =
			((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
		start = 10 + size + (buf[5] & 0x10 ? 10 : 0); // flag bit 4 = footer present
	}
	let end = buf.length;
	if (end - start >= 128 && buf.toString("latin1", end - 128, end - 125) === "TAG") {
		end -= 128;
	}
	return buf.subarray(start, Math.max(start, end));
}

/**
 * Drop a leading Xing/Info frame. Its offset inside the frame is fixed by the
 * MPEG version and whether the stream is mono — there is no field pointing at
 * it, which is why the header has to be decoded first.
 */
function dropVbrHeader(buf: Buffer): Buffer {
	const f = frameAt(buf, 0);
	if (!f) return buf;
	const offset = f.mpeg1 ? (f.mono ? 21 : 36) : f.mono ? 13 : 21;
	if (offset + 4 > buf.length) return buf;
	const tag = buf.toString("latin1", offset, offset + 4);
	if (tag !== "Xing" && tag !== "Info") return buf;
	return f.length < buf.length ? buf.subarray(f.length) : buf;
}

/**
 * Seek to the first real frame. A take can carry junk between its tag and its
 * audio, and starting mid-garbage makes the first fraction of a second click.
 */
function firstFrame(buf: Buffer): Buffer {
	// Bounded: past a few KB with no sync word this is not an mp3 at all, and
	// scanning the whole file would only find a false positive further in.
	const limit = Math.min(buf.length, 8192);
	for (let i = 0; i < limit; i++) {
		if (frameAt(buf, i)) return buf.subarray(i);
	}
	return buf;
}

/**
 * One mp3 out of many, by concatenating audio frames only.
 *
 * Throws when a part has no decodable frame — better a named failure than a
 * bundle that is silently short.
 */
export function concatMp3(parts: Buffer[]): Buffer {
	const clean = parts.map((p, i) => {
		const body = dropVbrHeader(firstFrame(stripTags(p)));
		if (!frameAt(body, 0)) throw new Error(`take ${i + 1} is not a readable mp3`);
		return body;
	});
	return Buffer.concat(clean);
}
