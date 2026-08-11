"use client";

import { useMemo, useState } from "react";
import { LANGUAGES, normLang } from "@/lib/languages";

/**
 * The film's language — one control, chosen by name, endonym or ISO code.
 *
 * It lives at form level rather than inside the voice picker, for two reasons
 * that are easy to miss: a silent film (`cinematic`) has no voice picker at
 * all and still needs a language for its script, and a multi-voice project
 * renders TWO voice pickers, so a selector inside one of them would appear
 * twice. One control, above everything that reads it.
 *
 * Searchable because 32 entries is past the point where scrolling a <select>
 * beats typing two letters — and the codes are what ElevenLabs itself thinks
 * in, so "ro" should get you there.
 */
export default function LanguagePicker({
  value,
  onChange,
  allowAll = false,
  placeholder = "All languages",
}: {
  /** ISO code, or "" for none/all. */
  value: string;
  onChange: (code: string) => void;
  /** Whether "All languages" is offerable — false when a film needs one. */
  allowAll?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = LANGUAGES.find((l) => l.code === value) ?? null;

  const matches = useMemo(() => {
    const n = normLang(query);
    if (!n) return LANGUAGES;
    return LANGUAGES.filter(
      (l) =>
        l.code.startsWith(n) ||
        normLang(l.name).includes(n) ||
        normLang(l.endonym).includes(n) ||
        (l.extra ?? []).some((e) => normLang(e).includes(n)),
    );
  }, [query]);

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery("");
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="langbtn"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        aria-expanded={open}
      >
        <span>
          {current ? (
            <>
              <b>{current.name}</b>
              <span style={{ color: "var(--dim)" }}> · {current.endonym}</span>
              <code className="langcode">{current.code}</code>
            </>
          ) : (
            placeholder
          )}
        </span>
        <span style={{ color: "var(--dim)" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="langpop">
          <input
            autoFocus
            placeholder="Type a language or its code — ro, it, en…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              // Enter takes the top match, so two letters and Enter is the
              // whole interaction. The form blocks Enter elsewhere, and this
              // handler runs before that guard can matter.
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                if (matches.length > 0) pick(matches[0].code);
              }
            }}
            style={{ marginBottom: 8 }}
          />
          <div className="langlist">
            {allowAll && (
              <button
                type="button"
                className={`langrow ${value === "" ? "on" : ""}`}
                onClick={() => pick("")}
              >
                {placeholder}
              </button>
            )}
            {matches.map((l) => (
              <button
                type="button"
                key={l.code}
                className={`langrow ${value === l.code ? "on" : ""}`}
                onClick={() => pick(l.code)}
              >
                <span>
                  {l.name}
                  <span style={{ color: "var(--dim)" }}> · {l.endonym}</span>
                </span>
                <code className="langcode">{l.code}</code>
              </button>
            ))}
            {matches.length === 0 && (
              <p style={{ fontSize: 12.5, color: "var(--soft)", margin: "6px 8px" }}>
                No language matches “{query}”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
