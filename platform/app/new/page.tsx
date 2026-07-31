"use client";

import { useActionState, useState } from "react";
import { createProject, type ActionResult } from "@/app/actions";
import VoicePicker from "@/components/VoicePicker";
import CategoryPicker from "@/components/CategoryPicker";

async function submit(_prev: ActionResult | null, formData: FormData) {
  return createProject(formData);
}

// Same option set as the n8n form — the site fully replaces it.
const TONES = [
  "Epic",
  "Educativ",
  "Cinematic",
  "Corporate",
  "Emotional",
  "Dark",
  "Conspiracy",
  "Horror",
  "Dramatic",
  "Documentary",
  "Motivational",
];

export default function NewVideo() {
  const [state, formAction, pending] = useActionState(submit, null);
  const [length, setLength] = useState(64);
  const scenes = Math.max(1, Math.round(length / 8));

  return (
    <main className="page">
      <div className="hero">
        <h1>
          Start a <em>new video</em>
        </h1>
        <p>
          Fill in the brief and the factory takes it from there. You&apos;ll be
          asked to review the script, then the images, then the videos.
        </p>
      </div>

      <form className="form" action={formAction}>
        <div className="field">
          <label htmlFor="name">Topic / title</label>
          <input
            id="name"
            name="name"
            placeholder="History of Germany in WW2"
            maxLength={140}
            required
          />
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dim)" }}>
            Keep it short — it becomes the title shown in the video. Style
            details go in the Style field, not here.
          </p>
        </div>

        <CategoryPicker />

        <div className="field">
          <label htmlFor="length">
            Length (seconds) — ≈ {scenes} scenes of 8s each
          </label>
          <input
            id="length"
            name="length"
            type="number"
            min={16}
            max={480}
            step={1}
            value={length}
            onChange={(e) => setLength(Number(e.target.value) || 0)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="aspect">Format</label>
          <select id="aspect" name="aspect" defaultValue="16:9">
            <option value="16:9">16:9 — horizontal (YouTube)</option>
            <option value="9:16">9:16 — vertical (Shorts / TikTok / Reels)</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="captions">Captions</label>
          <select id="captions" name="captions" defaultValue="yes">
            <option value="yes">Yes — on-screen captions per scene</option>
            <option value="no">No — visuals and narration only</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="hook_title">Opening title (typed-on hook text)</label>
          <select id="hook_title" name="hook_title" defaultValue="yes">
            <option value="yes">Yes — cinematic title over the first scene</option>
            <option value="no">No — clean opening</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="chapter_cards">Chapter cards</label>
          <select id="chapter_cards" name="chapter_cards" defaultValue="yes">
            <option value="yes">Yes — full-screen card at each chapter</option>
            <option value="no">No — straight cuts between chapters</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="end_screen">End screen</label>
          <select id="end_screen" name="end_screen" defaultValue="yes">
            <option value="yes">Yes — channel outro after the last scene</option>
            <option value="no">No — video ends on the last scene</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="tone">Tone</label>
          <select id="tone" name="tone" defaultValue="Dark">
            {TONES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="pace">Pace</label>
          <select id="pace" name="pace" defaultValue="Normal">
            <option>Slow</option>
            <option>Normal</option>
            <option>Fast</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="style">Style (optional)</label>
          <input
            id="style"
            name="style"
            placeholder="Visual style preferences — ex. photorealistic, golden hour, 35mm"
          />
        </div>

        <div className="field">
          <label htmlFor="lore">Lore / canon context (optional)</label>
          <textarea
            id="lore"
            name="lore"
            rows={4}
            maxLength={8000}
            placeholder="For niche topics (Backrooms levels, SCP, game/franchise lore): paste the actual wiki/canon details here. The script treats this as ground truth — names, entities and mechanics come from this text, not invented."
            style={{ resize: "vertical" }}
          />
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--dim)" }}>
            Leave empty for well-known topics — the AI&apos;s own knowledge is
            enough for history, science, brands etc.
          </p>
        </div>

        <VoicePicker />

        <div className="field">
          <label htmlFor="language">Language</label>
          <input
            id="language"
            name="language"
            list="langs"
            defaultValue="English"
            required
          />
          <datalist id="langs">
            <option value="English" />
            <option value="Română" />
            <option value="Deutsch" />
            <option value="Español" />
            <option value="Français" />
          </datalist>
        </div>

        {state && (
          <p className={`formmsg ${state.ok ? "ok" : "err"}`}>{state.message}</p>
        )}

        <div>
          <button className="btn gold" disabled={pending}>
            {pending ? "Starting…" : "Start production"}
          </button>
        </div>
      </form>
    </main>
  );
}
