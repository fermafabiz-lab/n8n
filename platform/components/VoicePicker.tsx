"use client";

import { useEffect, useRef, useState } from "react";

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
export default function VoicePicker({ name = "voice_id" }: { name?: string }) {
  const [provider, setProvider] = useState("elevenlabs");
  const [q, setQ] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selected, setSelected] = useState("elevenlabs_hpp4J3VqNfWAUOO0d1Us");
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/voices?provider=${provider}&q=${encodeURIComponent(q)}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setVoices(data.voices ?? []);
      } catch (e) {
        setError(String((e as Error).message ?? e));
        setVoices([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [provider, q]);

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
      <label>Narrator voice — press ▶ to listen</label>
      <input type="hidden" name={name} value={selected} />
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
          const isSel = selected === v.voice_id;
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
                      selected
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
          </p>
        )}
      </div>
    </div>
  );
}
