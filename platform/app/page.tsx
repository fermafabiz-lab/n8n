"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * The marketing landing — the handoff's first screen, recreated from
 * design/handoff-visual-refresh/landing.dc.html. It IS the site's root: the
 * first thing anyone sees, with the producer's dashboard one click away at
 * /projects. The brand mark in the app nav points here for the same reason.
 *
 * Everything factual on this page is PLACEHOLDER, deliberately kept close to
 * the prototype's own copy so the page can be judged as designed. Before this
 * goes public: the floor numbers, the cost figure, the "down 61%" line and
 * the testimonial all need real values — each is marked in place.
 *
 * The page carries its own nav (the app chrome is hidden via body:has(.mkt)
 * in globals.css), because the audience is a visitor, not the producer: its
 * links are anchors on this page, and its one action is /new.
 */

const STEPS = [
  {
    name: "Script & story",
    body: "One brief becomes an outline of chapters, then full narration, then a scene plan cut at roughly twenty-two words — eight seconds of finished film each.",
    chips: ["Chapter outline", "Narration pass", "Scene segmentation"],
  },
  {
    name: "Voice & sound",
    body: "Every scene's narration is spoken, timed and filed back against the scene it belongs to, so the cut never drifts from the script.",
    chips: ["Voice casting", "Per-scene timing", "Loudness match"],
  },
  {
    name: "Frames & motion",
    body: "An image per scene, then motion on top of it. Each scene's picture chains off the one before it, which is what keeps ten minutes of film looking like one film.",
    chips: ["Scene image", "Image-to-video", "Frame chaining"],
  },
  {
    name: "Assembly & delivery",
    body: "Clips, voiceover and music are stitched into the final cut, graded and delivered with the project's full scene history intact.",
    chips: ["Stitch & grade", "Final render", "Delivery link"],
  },
];

// PLACEHOLDER numbers — swap for live counts before this page goes public.
const FLOOR = [
  { label: "Films in production", n: "4" },
  { label: "Waiting on you", n: "3" },
  { label: "Delivered this month", n: "27" },
];

export default function Landing() {
  const [open, setOpen] = useState(0);

  return (
    <main className="mkt">
      <section className="mkt-hero">
        <div className="mkt-arc" />
        <div className="mkt-arc2" />
        <div className="mkt-spot" />

        <nav className="mkt-nav">
          <div className="in">
            <Link href="/" className="brandline">
              <span className="bmark" aria-hidden="true" />
              House of Videos
            </Link>
            <span className="links">
              <a href="#pipeline">Pipeline</a>
              <a href="#floor">Films</a>
              <a href="#pricing">Pricing</a>
              <a href="#contact">Contact</a>
            </span>
            <Link href="/new" className="mkt-cta-dark">
              Start a video
            </Link>
          </div>
        </nav>

        <div className="mkt-head">
          <span className="mkt-eyebrow">
            <i />
            Automated video production
          </span>
          <h1>
            House of Videos
            <span style={{ display: "block" }}>makes films while</span>
            <span style={{ display: "block" }}>
              you sleep
              <span className="mkt-caps" aria-hidden="true">
                <span className="cap" />
                <span className="tile t1">▶</span>
                <span className="tile t2">● REC</span>
                <span className="tile t3">✦</span>
              </span>
            </span>
          </h1>
          <p className="sub">
            One brief in. A finished, narrated film out — script, voice, frames
            and cut, produced by a pipeline that only stops to ask for your
            approval.
          </p>
          <div className="ctas">
            <Link href="/new" className="mkt-btn dark">
              Make your first film
            </Link>
            <a href="#pipeline" className="mkt-btn light">
              See how it works
            </a>
          </div>
        </div>

        <div className="mkt-scrolltab">
          Scroll for more
          <i>↓</i>
        </div>
      </section>

      <section className="mkt-pipe" id="pipeline">
        <div className="intro">
          <span className="mkt-pill">
            <i />
            The pipeline
          </span>
          <h2>
            Four steps,
            <br />
            no crew
          </h2>
          <p>
            Every stage runs on its own and hands the next one what it needs.
            You appear at the gates: the script, the images, the voices and the
            clips each wait for your approval.
          </p>

          <div className="mkt-floor" id="floor">
            <span className="cap">Today&apos;s floor</span>
            {FLOOR.map((f) => (
              <div className="row" key={f.label}>
                <span>{f.label}</span>
                <b>{f.n}</b>
              </div>
            ))}
            {/* PLACEHOLDER — wire to live counts, then delete this note. */}
            <span style={{ fontSize: 11, color: "var(--faint)" }}>
              Sample numbers — live counts coming
            </span>
          </div>
        </div>

        <div className="mkt-steps">
          {STEPS.map((s, i) => {
            const on = i === open;
            return (
              <button
                type="button"
                key={s.name}
                className={`mkt-step ${on ? "open" : ""}`}
                onClick={() => setOpen(i)}
                aria-expanded={on}
              >
                <span className="top">
                  <h3>{s.name}</h3>
                  <span className="no">(0{i + 1})</span>
                </span>
                {on && (
                  <span className="body" style={{ display: "block" }}>
                    <p>{s.body}</p>
                    <span className="chips">
                      {s.chips.map((c) => (
                        <span key={c}>{c}</span>
                      ))}
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mkt-band" id="pricing">
        <div className="mkt-dark">
          <span className="dpill">
            <i />
            Rendering right now
          </span>
          {/* PLACEHOLDER — swap for live production counts. */}
          <h3>
            34 clips in flight
            <br />
            <span className="lift">across 3 films</span>
          </h3>
          <Link
            href="/projects"
            className="mkt-btn ghost"
            style={{ marginTop: 22, padding: "13px 26px", fontSize: 14.5 }}
          >
            Open the floor
          </Link>
          <div className="dome" />
        </div>

        <div className="mkt-cards">
          <div className="mkt-quote">
            <p className="lead">
              A ten-minute documentary, scripted, voiced and cut — in about
              four hours, for the price of a lunch.
            </p>
            <div className="foot">
              <div className="k">
                {/* PLACEHOLDER figures — replace with real cost data. */}
                <span>Average cost per finished minute</span>
                <span className="live">
                  <i
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "var(--accent)",
                      display: "inline-block",
                    }}
                  />
                  Down 61% since March
                </span>
              </div>
              <span className="ghostfig">$2.32</span>
            </div>
          </div>

          <div className="mkt-testi">
            <div className="portrait">portrait</div>
            <div>
              <p>
                &ldquo;I stopped hiring editors for the back catalogue. The
                queue just empties itself overnight.&rdquo;
              </p>
              <span className="attr">
                Placeholder quote &nbsp;·&nbsp; swap for a real one
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="mkt-close" id="contact">
        <div>
          <h2>
            Give it a theme.
            <br />
            Come back to a film.
          </h2>
          <p>
            One form, one submission. The pipeline writes, voices, films and
            cuts — and waits for you at every approval.
          </p>
        </div>
        <div className="stack">
          <Link href="/new" className="mkt-btn light" style={{ textAlign: "center" }}>
            Start a video
          </Link>
          <a
            href="mailto:contact@house-of-videos.com"
            className="mkt-btn ghost"
            style={{ textAlign: "center" }}
          >
            Talk to us
          </a>
        </div>
      </section>

      <footer className="mkt-foot">
        <span className="brandline" style={{ fontSize: 15 }}>
          <span className="bmark" aria-hidden="true" />
          House of Videos
        </span>
        <span className="links">
          <a href="#pipeline">Pipeline</a>
          <a href="#pricing">Pricing</a>
          <a href="#contact">Contact</a>
        </span>
      </footer>
    </main>
  );
}
