"use client";

import { useActionState } from "react";
import { createProject, type ActionResult } from "@/app/actions";

async function submit(_prev: ActionResult | null, formData: FormData) {
  return createProject(formData);
}

export default function NewVideo() {
  const [state, formAction, pending] = useActionState(submit, null);

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
          <label htmlFor="name">Title / topic</label>
          <input
            id="name"
            name="name"
            placeholder="History of Germany in WW2"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="length">Length (seconds)</label>
          <select id="length" name="length" defaultValue="64">
            <option value="32">32 — 4 scenes</option>
            <option value="64">64 — 8 scenes</option>
            <option value="96">96 — 12 scenes</option>
            <option value="128">128 — 16 scenes</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="tone">Tone</label>
          <select id="tone" name="tone" defaultValue="Dark">
            <option>Dark</option>
            <option>Epic</option>
            <option>Mystery</option>
            <option>Inspirational</option>
            <option>Educational</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="language">Language</label>
          <select id="language" name="language" defaultValue="English">
            <option>English</option>
            <option>Română</option>
          </select>
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
