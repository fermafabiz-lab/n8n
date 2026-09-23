import { getPlaylists, getProjects, isConfigured, type StatusKind } from "@/lib/data";
import AutoRefresh from "@/components/AutoRefresh";
import OpsPanel from "@/components/OpsPanel";
import StageChime from "@/components/StageChime";
import { GATE_STEP, projectHref } from "@/lib/deep-link";
import ProjectsGrid from "@/components/ProjectsGrid";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  // Playlists are an organisation layered ON the library, never a condition
  // for seeing it: a failure to read them (a database that has not had
  // db/013 yet, a bad moment) costs the playlist row and nothing else, and
  // the grid says so rather than dropping the row without a word.
  const [projects, playlists] = await Promise.all([
    getProjects(),
    getPlaylists().catch((e) => {
      console.error("[projects] playlists could not be read:", e);
      return null;
    }),
  ]);
  const waiting = projects.filter((p) => p.statusKind === "wait");

  /**
   * Every project lands in exactly one bucket, and the buckets are counted
   * from the same list the grid shows — so the tiles always add up to the
   * total. They did not before: only running, waiting and finished had a
   * tile, so anything whose status the map does not recognise (a half-created
   * row, a status written by hand, a project abandoned before it started)
   * was counted in the total and shown nowhere. On the real base that was 47
   * of 98 projects, which read as the numbers being wrong.
   */
  const byKind: Record<StatusKind, number> = { run: 0, wait: 0, done: 0, err: 0, idle: 0 };
  for (const p of projects) byKind[p.statusKind] += 1;

  /** Shown only when they have something in them — an empty tile is noise. */
  const extraTiles: Array<{ label: string; n: number }> = [
    { label: "Needs a fix", n: byKind.err },
    // Deliberately vague, because it is: the grid's "Other" tab lists them
    // and every card there carries its own status text, which is the only
    // way to find out what these actually are.
    { label: "Other", n: byKind.idle },
  ].filter((t) => t.n > 0);

  const running = byKind.run;
  const finished = byKind.done;

  /**
   * The film the producer should open next — and it is the one that has been
   * waiting LONGEST, not the newest.
   *
   * The list arrives newest-first, so `waiting[0]` is the film they made
   * twenty minutes ago and are already thinking about. The one nobody is
   * thinking about is the one at the other end, and it is also the one
   * holding up the line. Taking it first is what turns this button into a
   * queue: clear it, come back, and it names the next one by itself.
   *
   * An undated project sorts LAST rather than first — `updatedAt` is null on
   * a row the cutover never dated, and treating that as "waiting since the
   * epoch" would park the button on it forever.
   */
  const waitedSince = (p: (typeof projects)[number]) => {
    const t = p.updatedAt ? new Date(p.updatedAt).getTime() : NaN;
    return Number.isFinite(t) ? t : Infinity;
  };
  const nextUp =
    waiting.length > 0
      ? waiting.reduce((oldest, p) => (waitedSince(p) < waitedSince(oldest) ? p : oldest))
      : null;

  // Titles come from a free-text field and people paste whole prompts into it
  // (a ~3000-char master prompt has been seen in production). The hero sets
  // this in display type, so it has to be cut before it becomes the page.
  const short = (s: string, n = 42) =>
    s.length > n ? s.slice(0, n).trimEnd() + "…" : s;

  const heroLine =
    waiting.length === 1
      ? `${short(waiting[0].name)} is waiting on you.`
      : waiting.length > 1
        ? `${waiting.length} videos are waiting on you.`
        : running > 0
          ? "Everything is running on its own."
          : "All quiet on the production floor.";

  /**
   * "On the floor now" — the live panel. Real running projects, newest first,
   * capped at three because the panel is a glance, not a list; the toolbar
   * below is where you go through everything. `progress` is the same 0..1 the
   * cards use, so the two can never disagree.
   */
  const onFloor = projects.filter((p) => p.statusKind === "run").slice(0, 3);

  return (
    <main className="page pj">
      <AutoRefresh seconds={15} />
      {/* From the library a notification can only mean "this project" — the
          bucket is all this page knows. `finished` still earns a step, since
          the one thing to do with a finished film is watch it; `error` and
          `needs-review` deliberately do not, because the bare page lands on
          whatever is actually live and guessing a step here would send the
          producer to the wrong one with confidence. */}
      <StageChime
        items={projects.map((p) => {
          const stage =
            p.statusKind === "done"
              ? "finished"
              : p.statusKind === "err"
                ? "error"
                : p.statusKind === "wait"
                  ? "needs-review"
                  : "working";
          return {
            key: p.id,
            label: p.name,
            stage,
            href: projectHref(p.id, GATE_STEP[stage]),
          };
        })}
      />
      <div className="pj-shell">
        <div className="arc" aria-hidden="true" />

        <div className="pj-hero">
          <div className="pj-welcome">
            <h1>Welcome back.</h1>
            <p className="lead">{heroLine}</p>
            <p className="sub">
              {waiting.length > 0
                ? "Review takes you straight into the one that has been waiting longest. Everything else keeps moving without you."
                : "Start a new video or check on a finished one."}
            </p>
            <span className="pj-gap" />
            <div className="pj-ctas">
              <Link href="/new" className="pj-cta">
                Start a video
              </Link>
              {/*
                This used to read "Everything waiting on me" and go to
                `/projects?filter=wait` — the page it was already on, with a
                param nothing read. It now OPENS the work: the film that has
                waited longest, at whatever step is waiting (the bare project
                page lands on the live one, which is the only honest answer
                from here — the library does not load scenes, so it cannot
                know which gate it is).

                Naming the film is the point. A button that says what it will
                open is checkable before you press it, and once the film is
                cleared the label moves to the next one on its own.
              */}
              {nextUp ? (
                <>
                  <Link
                    href={projectHref(nextUp.id)}
                    className="pj-ghost"
                    title={`Waiting since ${nextUp.updatedAt ? new Date(nextUp.updatedAt).toLocaleString() : "an unknown date"}`}
                  >
                    {/* With one film waiting the lead line above has just
                        named it, so naming it again is noise; with several,
                        the lead line only counts them and WHICH one this
                        opens is the thing worth saying. */}
                    {waiting.length === 1 ? "Review it" : `Review “${short(nextUp.name, 22)}”`}
                  </Link>
                  {waiting.length > 1 && (
                    <Link href="/projects?filter=wait" className="pj-ghost">
                      See all {waiting.length}
                    </Link>
                  )}
                </>
              ) : finished > 0 ? (
                // Nothing is waiting, so the second door is the one the line
                // under it already offers — and it, too, now actually filters.
                <Link href="/projects?filter=done" className="pj-ghost">
                  Check a finished one
                </Link>
              ) : null}
            </div>
          </div>

          <aside className="pj-live">
            <span className="lhead">
              <span className="k">On the floor now</span>
              <span className="auto">auto 15s</span>
            </span>
            {onFloor.length === 0 ? (
              <span className="lnote lempty">
                Nothing is rendering right now. Start a video and it will show
                up here while it runs.
              </span>
            ) : (
              onFloor.map((p) => (
                <div className="lrow" key={p.id}>
                  <span className="ltop">
                    <span className="lname">{short(p.name, 34)}</span>
                    <span className="lpct">{Math.round(p.progress * 100)}%</span>
                  </span>
                  <span className="lbar">
                    <i style={{ width: `${Math.round(p.progress * 100)}%` }} />
                    <i className="sheen" />
                  </span>
                  <span className="lstep">{p.status}</span>
                </div>
              ))
            )}
            <span className="lnote">
              {waiting.length > 0
                ? `${waiting.length} ${waiting.length === 1 ? "film needs" : "films need"} your review. The rest keeps moving while this tab is closed.`
                : "Nothing here needs you. The queue keeps moving while this tab is closed."}
            </span>
          </aside>
        </div>

        <div className="stats">
          <div className="stat">
            <small>In production</small>
            <b>{running}</b>
            <span className="note">
              {running > 0 ? "moving without you" : "nothing running"}
            </span>
          </div>
          <div className="stat">
            <small>Awaiting your review</small>
            {/* A zero here is good news, so it is set in the muted ink rather
                than full weight — the eye should not stop on it. */}
            <b className={waiting.length === 0 ? "zero" : ""}>{waiting.length}</b>
            <span className="note">
              {waiting.length === 0 ? "nothing is blocked on you" : "waiting on a decision"}
            </span>
          </div>
          <div className="stat">
            <small>Finished</small>
            <b className={finished === 0 ? "zero" : ""}>{finished}</b>
            <span className="note">delivered</span>
          </div>
          {extraTiles.map((t) => (
            <div className="stat" key={t.label}>
              <small>{t.label}</small>
              <b className={t.n === 0 ? "zero" : ""}>{t.n}</b>
              <span className="note">
                {t.label === "Needs a fix" ? "stopped mid-run" : "status unrecognised"}
              </span>
            </div>
          ))}
          <div className="stat">
            <small>Total projects</small>
            <b>{projects.length}</b>
            <span className="note">all time</span>
          </div>
        </div>
      </div>

      {!isConfigured && (
        <div className="setupnote">
          <b>Demo data.</b> Set <code>AIRTABLE_API_KEY</code> and{" "}
          <code>AIRTABLE_BASE_ID</code> in the environment to connect the real
          production base — the page will switch over automatically.
        </div>
      )}

      <OpsPanel />

      {projects.length === 0 ? (
        <>
          <div className="eyebrow">
            <span>Projects</span>
            <span className="n">(00)</span>
          </div>
          <div className="empty">
            <h3>No projects yet</h3>
            <p>Projects created through the n8n form will appear here.</p>
          </div>
        </>
      ) : (
        <ProjectsGrid projects={projects} playlists={playlists} />
      )}

      <footer className="pj-foot">
        <span className="brandline">
          <span className="bmark" aria-hidden="true" />
          House of Videos
        </span>
        <span>
          {projects.length} {projects.length === 1 ? "project" : "projects"} · one house
        </span>
      </footer>
    </main>
  );
}
