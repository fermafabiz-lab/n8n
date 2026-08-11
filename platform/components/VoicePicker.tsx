"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGES, normLang, resolveLanguage } from "@/lib/languages";

interface Voice {
  voice_id: string;
  name: string;
  gender: string | null;
  language: string | null;
  accent: string | null;
  description: string | null;
  preview_url: string | null;
}

const PROVIDERS = [
  { id: "elevenlabs", label: "ElevenLabs (best quality)" },
  { id: "minimax", label: "Minimax" },
  { id: "edge", label: "Edge (free)" },
  { id: "kokoro", label: "Kokoro" },
];

/**
 * Voice picker with inline audio previews. The chosen prefixed voice_id is
 * submitted with the form and flows n8n -> ai33 TTS unchanged.
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
   * The film's language, as the producer typed it. The list is narrowed to
   * voices that speak it — picking Română and being offered Roger is the
   * whole problem this solves. Empty = no narrowing, which is what every
   * caller that has no language to offer gets.
   */
  language?: string;
}) {
  const [provider, setProvider] = useState("elevenlabs");
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
  // The language the list is narrowed to, as an ISO code ("ro", "it", "en").
  // Seeded from the film's language, then owned by the picker — a producer
  // may deliberately want an English narrator over a Romanian script, and the
  // metadata is the provider's, so it can be wrong on a perfectly good voice.
  // "" means every language.
  const [lang, setLang] = useState(() => resolveLanguage(language)?.code ?? "");
  const [langOpen, setLangOpen] = useState(false);
  const [langQuery, setLangQuery] = useState("");
  const [langState, setLangState] = useState<{
    applied: boolean;
    label: string;
    confirmed: number;
    total: number;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Follow the form's Language field while the producer is still editing it,
  // but never fight a choice made here.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    setLang(resolveLanguage(language)?.code ?? "");
  }, [language, touched]);

  const current = LANGUAGES.find((l) => l.code === lang) ?? null;
  const langMatches = useMemo(() => {
    const n = normLang(langQuery);
    if (!n) return LANGUAGES;
    return LANGUAGES.filter(
      (l) =>
        l.code.startsWith(n) ||
        normLang(l.name).includes(n) ||
        normLang(l.endonym).includes(n) ||
        (l.extra ?? []).some((e) => normLang(e).includes(n)),
    );
  }, [langQuery]);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/voices?provider=${provider}&q=${encodeURIComponent(q)}` +
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
  }, [provider, q, lang]);

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
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          style={{ flex: "0 0 46%" }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          placeholder="Search: warm, deep, narration, british…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* Language, as a searchable list rather than a select: 32 entries is
          past the point where scrolling one beats typing two letters, and
          the codes are what ElevenLabs itself thinks in, so "ro" should get
          you there. */}
      <div style={{ position: "relative", marginBottom: 10 }}>
        <button
          type="button"
          className="langbtn"
          onClick={() => {
            setLangOpen((o) => !o);
            setLangQuery("");
          }}
          aria-expanded={langOpen}
        >
          <span>
            {current ? (
              <>
                <b>{current.name}</b>
                <span style={{ color: "var(--dim)" }}> · {current.endonym}</span>
                <code className="langcode">{current.code}</code>
              </>
            ) : (
              "All languages"
            )}
          </span>
          <span style={{ color: "var(--dim)" }}>{langOpen ? "▲" : "▼"}</span>
        </button>

        {langOpen && (
          <div className="langpop">
            <input
              autoFocus
              placeholder="Type a language or its code — ro, it, en…"
              value={langQuery}
              onChange={(e) => setLangQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setLangOpen(false);
                // Enter picks the only remaining match, so two letters and
                // Enter is the whole interaction.
                if (e.key === "Enter" && langMatches.length > 0) {
                  e.preventDefault();
                  setTouched(true);
                  setLang(langMatches[0].code);
                  setLangOpen(false);
                }
              }}
              style={{ marginBottom: 8 }}
            />
            <div className="langlist">
              <button
                type="button"
                className={`langrow ${lang === "" ? "on" : ""}`}
                onClick={() => {
                  setTouched(true);
                  setLang("");
                  setLangOpen(false);
                }}
              >
                All languages
              </button>
              {langMatches.map((l) => (
                <button
                  type="button"
                  key={l.code}
                  className={`langrow ${lang === l.code ? "on" : ""}`}
                  onClick={() => {
                    setTouched(true);
                    setLang(l.code);
                    setLangOpen(false);
                  }}
                >
                  <span>
                    {l.name}
                    <span style={{ color: "var(--dim)" }}> · {l.endonym}</span>
                  </span>
                  <code className="langcode">{l.code}</code>
                </button>
              ))}
              {langMatches.length === 0 && (
                <p style={{ fontSize: 12.5, color: "var(--soft)", margin: "6px 8px" }}>
                  No language matches “{langQuery}”.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* What the list is currently showing. Never a silent filter: an
          unexplained short list reads as a broken library, which is exactly
          how the first version of this looked. */}
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
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setTouched(true);
                  setLang("");
                }}
              >
                Show all languages
              </button>
            </>
          ) : (
            <>
              Nothing in this library mentions <b>{langState.label}</b>, so every voice
              is shown. Multilingual voices read it anyway — what you lose is the
              native accent, not the language. Another provider above may have a
              native one.
            </>
          )}
        </p>
      )}

      {error && <p className="formmsg err">{error}</p>}
      {loading && <p style={{ fontSize: 13, color: "var(--soft)" }}>Loading voices…</p>}

      <div
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
        }}
      >
        {voices.map((v) => {
          const isSel = isSelected(v.voice_id);
          return (
            <div
              key={v.voice_id}
              onClick={() => setSelected(v.voice_id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 10,
                cursor: "pointer",
                background: isSel ? "rgba(245,184,65,0.08)" : "var(--card2)",
                border: `1px solid ${isSel ? "rgba(245,184,65,0.45)" : "var(--line)"}`,
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePreview(v);
                }}
                disabled={!v.preview_url}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  flex: "none",
                  border: "1px solid var(--line2)",
                  background: playing === v.voice_id ? "var(--amber)" : "var(--bg2)",
                  color: playing === v.voice_id ? "#171004" : "var(--ink)",
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
