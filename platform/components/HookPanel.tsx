"use client";

/**
 * The cold open, as Scripting wrote it — and the door to rewrite it alone.
 *
 * Since 2026-09-11 the hook is a TEASER of several fast shots (chapter 0,
 * orders 1..99) in one of six styles, planned by Claude Scripting and stored
 * as `Editing Options.hookPlan`. The producer used to find out what the film
 * opened with by watching the render; this card shows the plan the moment the
 * script exists — the style, the beats one per shot, the card the style draws
 * — and offers a rewrite in another style that touches the hook and nothing
 * else (`hook-regen` in Claude Scripting).
 *
 * Shown twice on purpose: after the script (the moment a rewrite costs only
 * a model call) and beside Final touches (the producer's last look), where
 * a rewrite ALSO means new pictures and clips for the new shots on the next
 * production pass — the card says so before the button is pressed.
 *
 * A standalone self-saving card rather than a row in FinalSettings, for the
 * same reason MusicPicker is: that panel batches its choices into one confirm
 * that also STARTS the render.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelHookRegen, regenerateHook, type ActionResult } from "@/app/actions";
import { HOOK_STYLES, type HookPlan, type HookRegen, type HookStyleChoice } from "@/lib/data";
import styles from "./HookPanel.module.css";

/**
 * Which styles this film may use — the same rule `Voice Mode` applies in n8n:
 * a silent film only the silent styles, a kids film none of the two violent
 * ones. Kept in lockstep by hand; the guard in Scripting is what enforces it.
 */
function allowedFor(category: string | null): readonly (typeof HOOK_STYLES)[number][] {
  if (category === "cinematic") return HOOK_STYLES.filter((h) => h.silent);
  if (category === "kids") return HOOK_STYLES.filter((h) => ["teaser", "question", "slate"].includes(h.id));
  return HOOK_STYLES;
}

/** A rewrite older than this with nobody left to clear it is stranded. */
const STALE_AFTER_MS = 10 * 60 * 1000;

export default function HookPanel({
  projectId,
  plan,
  regen,
  hookStyle,
  category,
  hookShots,
  hookAssets,
}: {
  projectId: string;
  plan: HookPlan | null;
  regen: HookRegen | null;
  /** The film's stored choice (`auto` or a style). */
  hookStyle: HookStyleChoice;
  category: string | null;
  /** How many chapter-0 scenes exist right now. */
  hookShots: number;
  /** Whether any of them already has a picture or a clip. */
  hookAssets: boolean;
}) {
  const allowed = allowedFor(category);
  const [choice, setChoice] = useState<HookStyleChoice>(
    plan ? plan.style : hookStyle,
  );
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // The server's word wins once it arrives: a rewrite that landed changes the
  // plan's style, and the chips should follow it rather than a stale pick.
  useEffect(() => setChoice(plan ? plan.style : hookStyle), [plan, hookStyle]);

  const inFlight = regen !== null;
  const stale =
    inFlight && (!regen.at || Date.now() - new Date(regen.at).getTime() > STALE_AFTER_MS);
  const styleDef = plan ? HOOK_STYLES.find((h) => h.id === plan.style) : null;
  const chosenDef = HOOK_STYLES.find((h) => h.id === choice);
  // The same named style again is a no-op; "auto" is always a fresh roll.
  const unchanged = plan !== null && choice !== "auto" && choice === plan.style;

  const fire = () =>
    startTransition(async () => {
      const r = await regenerateHook(projectId, choice);
      setMsg(r);
      if (r.ok) router.refresh();
    });
  const cancel = () =>
    startTransition(async () => {
      const r = await cancelHookRegen(projectId);
      setMsg(r);
      if (r.ok) router.refresh();
    });

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <div>
          <div className={styles.title}>Cold open</div>
          <p className={styles.sub}>
            {plan
              ? plan.silent
                ? "Nothing is spoken over these shots — the film's first word is the story's."
                : "The first seconds of the film, one fast shot per line. Captions run over them."
              : hookShots > 0
                ? "This film opens with a single hook scene written before the teaser existed."
                : "Written with the script — it appears here as soon as the script exists."}
          </p>
        </div>
        {styleDef && (
          <span className={styles.styleChip}>
            {styleDef.label}
            <small>
              {plan?.chosenBy === "producer"
                ? "· your pick"
                : plan?.chosenBy === "ai"
                  ? "· AI's pick"
                  : ""}
            </small>
          </span>
        )}
      </div>

      {plan && plan.beats.length > 0 && (
        <ol className={styles.beats}>
          {plan.beats.map((b, i) => (
            <li key={i} className={styles.beat}>
              <span className={styles.beatNo}>{String(i + 1).padStart(2, "0")}</span>
              <span className={plan.silent ? styles.beatSilent : undefined}>{b}</span>
            </li>
          ))}
        </ol>
      )}
      {plan && plan.card.line1 && (
        <div className={styles.cardLine}>
          <b>{plan.card.line1}</b>
          {plan.card.line2 && <span>{plan.card.line2}</span>}
          {plan.style === "question" && !plan.card.line2 && <span>set large over the opening shots</span>}
        </div>
      )}
      {!plan && hookShots === 0 && (
        <p className={styles.empty}>No hook yet.</p>
      )}

      <div className={styles.regen}>
        {inFlight ? (
          <>
            <div className={styles.busy}>
              <span className={styles.dot} />
              <span>
                Rewriting the hook
                {regen.style !== "auto" ? ` as ${HOOK_STYLES.find((h) => h.id === regen.style)?.label ?? regen.style}` : ""}…
                new shots land in about a minute.
              </span>
            </div>
            {/* The in-flight state is cleared by the n8n run, and a run that
                dies leaves it set with nothing left to clear it — the stranded
                flag every regeneration here can strand. A local exit, always. */}
            <div className={styles.actions}>
              <button type="button" className={styles.quiet} onClick={fire} disabled={pending}>
                ⟳ Send the rewrite again
              </button>
              <button type="button" className={styles.quiet} onClick={cancel} disabled={pending}>
                Cancel — keep this hook
              </button>
              {stale && (
                <span className={styles.warn}>
                  This has been running for over ten minutes — it probably died. Send it again or keep what is stored.
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className={styles.sub}>
              {plan ? "Rewrite the hook in another style — only the hook, the script stays." : "Choose how the film should open."}
            </div>
            <div className={styles.styles} role="group" aria-label="Hook style">
              <button
                type="button"
                className={`${styles.styleBtn} ${choice === "auto" ? styles.styleBtnOn : ""}`}
                onClick={() => setChoice("auto")}
                disabled={pending}
              >
                Let the AI choose
              </button>
              {allowed.map((h) => (
                <button
                  type="button"
                  key={h.id}
                  className={`${styles.styleBtn} ${choice === h.id ? styles.styleBtnOn : ""}`}
                  onClick={() => setChoice(h.id)}
                  disabled={pending}
                >
                  {h.label}
                </button>
              ))}
            </div>
            <p className={styles.blurb}>
              {choice === "auto"
                ? "Scripting reads the story and picks the style that fits it."
                : chosenDef?.blurb}
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.go} onClick={fire} disabled={pending || unchanged}>
                {pending ? "Sending…" : plan ? "⟳ Rewrite the hook" : "Write the hook"}
              </button>
              {unchanged && (
                <span className={styles.sub}>Pick a different style to rewrite it — or re-roll the same one via “Let the AI choose”.</span>
              )}
              {hookAssets && (
                <span className={styles.warn}>
                  The hook's pictures and clips already exist; a rewrite replaces those shots, and the new ones are generated on the next production pass.
                </span>
              )}
            </div>
          </>
        )}
        {msg && <p className={`${styles.msg} ${msg.ok ? "" : styles.msgErr}`}>{msg.message}</p>}
      </div>
    </div>
  );
}
