"use client";

import { useEffect, useRef, useState } from "react";
import { resolveLanguage } from "@/lib/languages";

interface Voice {
  voice_id: string;
  name: string;
  gender: string | null;
  language: string | null;
  accent: string | null;
  description: string | null;
  preview_url: string | null;
}

/**
 * Voice picker with inline audio previews. The chosen prefixed voice_id is
 * submitted with the form and flows n8n -> ElevenLabs TTS unchanged.
 *
 * There is NO provider selector any more, and its removal is a correction
 * rather than a simplification. ai33 was an aggregator, so the picker offered
 * ElevenLabs / Minimax / Edge / Kokoro; going direct left exactly one
 * provider, and `/api/voices` stopped reading the `provider` parameter
 * altogether. The control therefore did nothing at all — pick Minimax and the
 * list that came back was still ElevenLabs — which is worse than inert: the
 * label claimed the voice was something it was not, and that claim followed
 * the id into the film. Same rule as the Captions toggle a cinematic project
 * no longer shows: a control that cannot change the outcome reads as a
 * decision, and this one read as a wrong one.
 */
export default function VoicePicker({
  name = "voice_id",
  label = "Narrator voice — press ▶ to listen",
  /** Controlled mode: the parent owns the choice (used outside forms, e.g.
   *  swapping the narrator of a project that already exists). */
  value,
  onChange,
  /** Multi mode: pick a cast of voices instead of one. */
  multi = false,
  selectedIds,
  onToggle,
  chipLabel = "cast",
  language = "",
}: {
  name?: string;
  label?: string;
  value?: string;
  onChange?: (voiceId: string) => void;
  multi?: boolean;
  selectedIds?: string[];
  onToggle?: (voiceId: string) => void;
  /** Chip prefix in multi mode: "cast" (default) or "narrator". */
  chipLabel?: string;
  /**
   * The film's language — an ISO code ("ro") from the form, or a name as
   * Airtable stored it ("Romanian"); both resolve. The list is narrowed to
   * voices that speak it: picking Română and being offered Roger is the whole
   * problem this solves. Empty = no narrowing, which is what a caller with no
   * language to offer gets.
   */
  language?: string;
}) {
  const [q, setQ] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [internal, setInternal] = useState("elevenlabs_hpp4J3VqNfWAUOO0d1Us");
  const controlled = onChange !== undefined;
  const selected = controlled ? (value ?? "") : internal;
  const setSelected = (id: string) => {
    if (multi) return onToggle?.(id);
    return controlled ? onChange!(id) : setInternal(id);
  };
  const isSelected = (id: string) =>
    multi ? (selectedIds ?? []).includes(id) : selected === id;
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The film's language decides what this list shows; the ONLY control here
  // is whether to widen past it. A selector of its own would be a second
  // language control on the page — and a third, on a multi-voice project
  // that renders two of these.
  //
  // Widening still matters: a producer may deliberately want an English
  // narrator over a Romanian script, and the metadata is the provider's, so
  // it can be wrong on a perfectly good voice.
  const filmLang = resolveLanguage(language);
  const [wide, setWide] = useState(false);
  // Sent whenever the producer has NOT asked to see every language — including
  // for English, which the route does not narrow on. It needs to know the film
  // speaks English anyway, to keep a Romanian voice out of an English picker:
  // using a shared voice copies it into the account, so the account's own list
  // grows a language every time the pipeline speaks a new one. Empty means
  // "widened on purpose", which is the one case that filters nothing.
  //
  // `narrowsUsefully` is not consulted here any more — the route applies it,
  // and it is the route that has to tell the two cases apart.
  const lang = wide || !filmLang ? "" : filmLang.code;
  const [langState, setLangState] = useState<{
    applied: boolean;
    label: string;
    confirmed: number;
    total: number;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/voices?q=${encodeURIComponent(q)}` +
            (lang ? `&lang=${encodeURIComponent(lang)}` : ""),
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setVoices(data.voices ?? []);
        setLangState(data.language ?? null);
      } catch (e) {
        setError(String((e as Error).message ?? e));
        setVoices([]);
        setLangState(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, lang]);

  /**
   * Keep the selection inside the language on screen.
   *
   * Switching to Romanian used to leave the English default selected and
   * invisible — nothing in the list was highlighted, and the form quietly
   * posted an English narrator for a Romanian film.
   *
   * Deliberately narrow: only the form's own single picker (a controlled one
   * belongs to a project that already has a voice, and choosing for it would
   * silently change a setting), and only on a genuinely language-filtered
   * list — the unfiltered English list keeps its historical default voice
   * rather than being reassigned to whatever happens to sort first.
   */
  useEffect(() => {
    if (controlled || multi || loading) return;
    if (!langState?.applied || voices.length === 0) return;
    if (voices.some((v) => v.voice_id === selected)) return;
    setInternal(voices[0].voice_id);
  }, [voices, loading, langState, controlled, multi, selected]);

  const togglePreview = (v: Voice) => {
    if (!v.preview_url) return;
    if (playing === v.voice_id) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    if (!audioRef.current) audioRef.current = new Audio();
    const a = audioRef.current;
    a.pause();
    a.src = v.preview_url;
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    setPlaying(v.voice_id);
  };

  return (
    <div className="field">
      <label>{label}</label>
      {!controlled && !multi && <input type="hidden" name={name} value={selected} />}
      {/* The search box had 54% of this row; with the provider selector gone
          it takes the whole width, which is the better half anyway — this is
          the control that actually narrows a library of hundreds. */}
      <div style={{ marginBottom: 10 }}>
        <input
          placeholder="Search: warm, deep, narration, british…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* What the list is currently showing. Never a silent filter: an
          unexplained short list reads as a broken library, which is exactly
          how the first version of this looked. */}
      {wide && filmLang && !loading && (
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--soft)" }}>
          Every language.{" "}
          <button type="button" className="linkish" onClick={() => setWide(false)}>
            Back to {filmLang.name} only
          </button>
        </p>
      )}
      {lang && langState && !loading && (
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--soft)" }}>
          {langState.applied ? (
            <>
              {langState.total} voice{langState.total === 1 ? "" : "s"} for{" "}
              <b>{langState.label}</b>
              {langState.confirmed < langState.total && (
                <>
                  {" "}
                  — {langState.confirmed} labelled with the language, the rest matched
                  by name or description
                </>
              )}
              .{" "}
              <button type="button" className="linkish" onClick={() => setWide(true)}>
                Show every language
              </button>
            </>
          ) : (
            <>
              Nothing in this library mentions <b>{langState.label}</b>, so every voice
              is shown. Multilingual voices read it anyway — what you lose is the
              native accent, not the language.
            </>
          )}
        </p>
      )}

      {error && <p className="formmsg err">{error}</p>}
      {loading && (
        <p style={{ fontSize: 13, color: "var(--soft)" }}>
          Loading voices{filmLang && !wide ? ` for ${filmLang.name}` : ""}…
        </p>
      )}

      {/* Frozen while a new list is on its way. What is on screen during
          that moment belongs to the PREVIOUS language, and clicking it would
          pick a voice that does not speak the film's language — silently,
          because the row looks exactly like a valid choice. Dimmed rather
          than emptied so the box does not jump. */}
      <div
        aria-busy={loading}
        style={{
          maxHeight: 320,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: 10,
          background: "var(--card)",
          opacity: loading ? 0.4 : 1,
          pointerEvents: loading ? "none" : undefined,
          transition: "opacity 0.15s ease",
        }}
      >
        {voices.map((v) => {
          const isSel = isSelected(v.voice_id);
          return (
            <div
              key={v.voice_id}
              onClick={() => !loading && setSelected(v.voice_id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 10,
                cursor: "pointer",
                background: isSel ? "var(--accent-a08)" : "var(--card2)",
                border: `1px solid ${isSel ? "rgba(122, 79, 214,0.45)" : "var(--line)"}`,
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePreview(v);
                }}
                disabled={!v.preview_url || loading}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  flex: "none",
                  border: "1px solid var(--line2)",
                  background: playing === v.voice_id ? "var(--accent)" : "var(--bg2)",
                  color: playing === v.voice_id ? "#f7f7f8" : "var(--ink)",
                  fontSize: 14,
                  cursor: v.preview_url ? "pointer" : "default",
                  opacity: v.preview_url ? 1 : 0.35,
                }}
              >
                {playing === v.voice_id ? "■" : "▶"}
              </button>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {v.name}
                  {isSel && (
                    <span className="chip ok" style={{ marginLeft: 10 }}>
                      {multi
                        ? `${chipLabel} #${(selectedIds ?? []).indexOf(v.voice_id) + 1}`
                        : "selected"}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--soft)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {[v.gender, v.accent, v.language].filter(Boolean).join(" · ")}
                  {v.description ? ` — ${v.description}` : ""}
                </div>
              </div>
            </div>
          );
        })}
        {!loading && voices.length === 0 && !error && (
          <p style={{ fontSize: 13, color: "var(--soft)", margin: 8 }}>
            No voices found for this search.
            {lang && " Clear the search box, or widen the language above."}
          </p>
        )}
      </div>
    </div>
  );
}
