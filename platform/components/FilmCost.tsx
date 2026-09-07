import type { Scene } from "@/lib/data";
import { filmCost, MONTHLY_CREDITS } from "@/lib/cost";
import styles from "./FilmCost.module.css";

/**
 * What this film consumed. A server component — pure arithmetic over rows the
 * page already has, so it costs no round-trip and no client JavaScript.
 *
 * Reported in the units the providers meter rather than in money: a price per
 * credit or per character is a commercial fact this repo does not hold, and a
 * dollar figure invented from a guess is worse than no figure. Credits are the
 * number that actually binds anyway — the allowance is fixed, does not roll
 * over, and the plan is three films a day.
 */
export default function FilmCost({
  scenes,
  videoModel,
  lengthSeconds,
}: {
  scenes: Scene[];
  videoModel?: string | null;
  lengthSeconds?: number | null;
}) {
  const c = filmCost(scenes, { videoModel, lengthSeconds });
  if (!c.clips && !c.images && !c.characters) return null;

  const share = Math.min(100, (c.credits / MONTHLY_CREDITS) * 100);

  return (
    <section className={styles.card}>
      <h4 className={styles.head}>What this film has used</h4>

      <div className={styles.credits}>
        <strong>{c.credits.toLocaleString()}</strong>
        <span>
          credits of {MONTHLY_CREDITS.toLocaleString()} this month
        </span>
        {/* Shown even at zero, because zero IS the story on the default model
            and a producer who cannot see that will assume every clip costs. */}
        <span className={styles.bar} aria-hidden>
          <i style={{ width: `${Math.max(share, c.credits > 0 ? 1.5 : 0)}%` }} />
        </span>
      </div>

      <dl className={styles.rows}>
        <div>
          <dt>Clips</dt>
          <dd>
            {c.clips}
            {c.clipRetries > 0 && (
              <em className={styles.retry}>{c.clipRetries} re-rolled</em>
            )}
          </dd>
        </div>
        <div>
          <dt>Images</dt>
          <dd>
            {c.images}
            {c.imageRetries > 0 && (
              <em className={styles.retry}>{c.imageRetries} re-rolled</em>
            )}
          </dd>
        </div>
        <div>
          <dt>Narration</dt>
          <dd>{c.characters.toLocaleString()} characters</dd>
        </div>
        {c.renderMinutes > 0 && (
          <div>
            <dt>Render</dt>
            <dd>~{c.renderMinutes} min</dd>
          </div>
        )}
      </dl>

      {/* The basis, so the numbers can be argued with rather than believed.
          Every one of them is a floor: the pipeline does not record which
          model each clip actually used, and takes are not versioned, so a line
          re-recorded three times is counted once. */}
      <p className={styles.basis}>
        Estimated from what is on file — the body on{" "}
        <code>{c.model.replace("veo-3.1-", "")}</code>, the hook on quality.
        Re-recorded takes are not counted; the real figures can only be higher.
      </p>
    </section>
  );
}
