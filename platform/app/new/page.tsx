"use client";

import { useActionState, useState } from "react";
import { createProject, type ActionResult } from "@/app/actions";
import VoicePicker from "@/components/VoicePicker";

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
          <label htmlFor="name">Tema / titlu</label>
          <input
            id="name"
            name="name"
            placeholder="History of Germany in WW2"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="length">
            Length (secunde) — ≈ {scenes} scene a câte 8s
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
          <label htmlFor="tone">Tonalitate</label>
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
          <label htmlFor="style">Style (opțional)</label>
          <input
            id="style"
            name="style"
            placeholder="Visual style preferences — ex. photorealistic, golden hour, 35mm"
          />
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
