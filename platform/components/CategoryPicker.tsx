"use client";

import { useEffect, useState } from "react";
import { CATEGORIES, DEFAULT_CATEGORY, getCategory } from "@/lib/categories";
import CastPicker from "@/components/CastPicker";
import VoicePicker from "@/components/VoicePicker";

/** What the live call sheet needs to know about this picker's state. */
export interface CategoryMeta {
  category: string;
  categoryLabel: string;
  /** "silent" for no-narration categories, else the multi_voice mode. */
  voiceMode: string;
  ready: boolean;
}

/**
 * One card in the multi-voice chooser. The hint text in categories.ts is a
 * paragraph covering all three modes at once — right for a dropdown's help
 * text, far too long for a card — so each mode gets its own line here.
 */
const MODE_BLURB: Record<string, string> = {
  off: "One voice reads the whole film.",
  characters: "The script becomes dialogue between the story's characters.",
  chapters: "Each chapter is read by a different narrator from your cast.",
};

/**
 * Category rows + the selected category's own options + the voice setup. The
 * choice and every option value are submitted with the form as hidden/named
 * inputs (`category`, `cat_<option>`); the server action packs them into the
 * payload for n8n — nothing about that contract changes with the styling.
 *
 * `part` splits the render across two cards on the brief — "what kind of film"
 * belongs with the subject, "who says it" with the voices — while the state
 * that both halves read stays in ONE place: the page owns it and passes it
 * down, because two independent instances would each keep their own selection
 * and the halves would disagree the moment either changed.
 */
export default function CategoryPicker({
  onMeta,
  language = "",
  part = "all",
  selected,
  onSelected,
  values,
  onValues,
}: {
  /** Reports selection changes upward so the estimate can mirror them. */
  onMeta?: (meta: CategoryMeta) => void;
  /**
   * The film's language, forwarded to both voice pickers so the narrator and
   * the cast are drawn from voices that actually speak it. Lives on the page
   * rather than here because the Language field is in another section.
   */
  language?: string;
  /** Which half to draw. "all" keeps the original single-block behaviour. */
  part?: "all" | "category" | "voices";
  selected: string;
  onSelected: (id: string) => void;
  values: Record<string, string | boolean>;
  onValues: (next: Record<string, string | boolean>) => void;
}) {
  const cat = getCategory(selected);

  const val = (name: string, def: string | boolean) =>
    values[`${selected}:${name}`] ?? def;
  const setVal = (name: string, v: string | boolean) =>
    onValues({ ...values, [`${selected}:${name}`]: v });

  const mv = cat.options.find((o) => o.name === "multi_voice");
  const mode = mv ? String(val("multi_voice", mv.default)) : "off";
  const narr = String(val("narration", "with"));
  const withNarrator = mode === "characters" && narr !== "none";

  useEffect(() => {
    onMeta?.({
      category: selected,
      categoryLabel: cat.label,
      voiceMode: cat.noNarration ? "silent" : mode,
      ready: cat.ready,
    });
    // onMeta is a stable setter from the form page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, mode]);

  const showCategory = part === "all" || part === "category";
  const showVoices = part === "all" || part === "voices";

  return (
    <div className="field">
      {/* The hidden input rides with the CATEGORY half, so the value is
          submitted exactly once however the two halves are placed. */}
      {showCategory && <input type="hidden" name="category" value={selected} />}
      {showCategory && (
      <>
      <div className="catrows">
        {CATEGORIES.map((c) => {
          const isSel = c.id === selected;
          return (
            <button
              type="button"
              key={c.id}
              className={`catrow ${isSel ? "on" : ""}`}
              onClick={() => onSelected(c.id)}
            >
              <h4>
                <span className="dotmk">●</span>
                {c.label}
              </h4>
              <span className="tag">{c.ready ? "" : "in development"}</span>
              <p>{c.description}</p>
            </button>
          );
        })}
      </div>

      {!cat.ready && (
        <p className="formmsg" style={{ marginTop: 12 }}>
          This category is being built. You can start a project with it — for
          now it produces a video the same way as Story, and its special
          options below switch on as they&apos;re finished.
        </p>
      )}

      {cat.options.filter((o) => o.name !== "multi_voice").length > 0 && (
        <div style={{ marginTop: 6 }}>
          {cat.options.filter((o) => o.name !== "multi_voice").map((o) => {
            const v = val(o.name, o.default);
            const on = v === true || v === "true";
            return (
              <div key={o.name} className="optrow" style={{ opacity: o.comingSoon ? 0.6 : 1 }}>
                <div className="txt">
                  <h5>
                    {o.label}
                    {o.comingSoon && (
                      <span className="tag" style={{ marginLeft: 10 }}>
                        coming soon
                      </span>
                    )}
                  </h5>
                  <p>{o.hint}</p>
                </div>
                {o.type === "toggle" ? (
                  // Kept as a native checkbox on purpose: it submits "on"
                  // exactly like the old form did, so the n8n payload shape
                  // doesn't change under the redesign.
                  <input
                    type="checkbox"
                    name={`cat_${o.name}`}
                    checked={on}
                    disabled={o.comingSoon}
                    onChange={(e) => setVal(o.name, e.target.checked)}
                    style={{ width: 17, height: 17, accentColor: "var(--accent)", flex: "none" }}
                  />
                ) : (
                  <select
                    name={`cat_${o.name}`}
                    value={String(v)}
                    disabled={o.comingSoon}
                    onChange={(e) => setVal(o.name, e.target.value)}
                    style={{ width: "auto", flex: "none" }}
                  >
                    {o.choices?.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}

      </>
      )}

      {showVoices && (
      <>
      {/* The multi-voice mode, as selectable cards rather than a dropdown
          buried in the option rows: it decides the shape of the whole
          soundtrack, so it gets the same control the voices themselves get.
          The submitted name and values are unchanged — cat_multi_voice, with
          off / characters / chapters. */}
      {mv && !cat.noNarration && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 9 }}>{mv.label}</label>
          <input type="hidden" name="cat_multi_voice" value={mode} />
          <div className="optcards">
            {mv.choices?.map((c) => (
              <button
                type="button"
                key={c.value}
                className={`optcard ${mode === c.value ? "on" : ""}`}
                onClick={() => setVal("multi_voice", c.value)}
                aria-pressed={mode === c.value}
              >
                <span className="wave" />
                <b>{c.label}</b>
                <span>{MODE_BLURB[c.value] ?? ""}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Voice setup — ONE place, shaped by the multi-voice choice above:
          off       -> the classic single narrator picker
          chapters  -> only the cast (they ARE the narrators)
          characters-> narrator yes/no, then narrator picker + cast
          noNarration categories skip all of it — nobody speaks. */}
      {cat.noNarration ? (
        <p className="csnote" style={{ padding: "12px 2px", borderBottom: "1px solid var(--line)", margin: 0 }}>
          No voices in this category — there is no narrator to pick and nothing
          is synthesized. The finished film carries only each scene&apos;s own
          sound (engines, weather, impacts…), and captions are off since there
          are no spoken words to caption.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          {mode === "characters" && (
            <div className="optrow">
              <div className="txt">
                <h5>Narration between dialogue</h5>
                <p>
                  With a narrator, the story keeps [NARRATOR] beats between the
                  characters&apos; lines. Without one, the characters carry
                  everything themselves.
                </p>
              </div>
              <select
                name="cat_narration"
                value={narr}
                onChange={(e) => setVal("narration", e.target.value)}
                style={{ width: "auto", flex: "none" }}
              >
                <option value="with">With narrator</option>
                <option value="none">No narrator</option>
              </select>
            </div>
          )}
          {(mode === "off" || withNarrator) && (
            <VoicePicker
              language={language}
              label={
                mode === "off"
                  ? "Narrator voice — press ▶ to listen"
                  : "Narrator voice — reads the parts between the characters' lines"
              }
            />
          )}
          {mode !== "off" && (
            <CastPicker mode={mode} hasNarrator={withNarrator} language={language} />
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
