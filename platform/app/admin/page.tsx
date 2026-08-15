import AdminRow, { type AdminField } from "@/components/AdminRow";
import AddGenre from "@/components/AddGenre";
import {
  getGenreProfiles,
  getLibraryScripts,
  getScriptExamples,
  isConfigured,
} from "@/lib/data";
import { updateExample, updateGenre, updateLibrary } from "./actions";

// These rows are edited by hand and read by the next film that starts, so the
// page must never serve a cached copy of what someone just changed.
export const dynamic = "force-dynamic";

const GENRE_FIELDS: AdminField[] = [
  { key: "tone", label: "Tone", hint: "Must match the creation form's option, case aside — this is how scripting finds the row." },
  { key: "format", label: "Format", hint: "What the film calls itself in every prompt: “documentary”, “horror story”." },
  { key: "wpm", label: "WPM", kind: "number", hint: "Target narration pace." },
  { key: "montageIntensity", label: "Montage", kind: "number", hint: "0 calm · 1 default · 2 aggressive. Read by the Remotion planner." },
  { key: "research", label: "Research", kind: "bool", hint: "Run the web-research step before writing" },
  { key: "active", label: "Active", kind: "bool", hint: "Off = scripting ignores this row and uses its built-in fallback" },
  { key: "hookRule", label: "Hook rule", kind: "area", rows: 3 },
  { key: "voice", label: "Voice", kind: "area", rows: 3, hint: "Person, tense and sentence rules for the narration." },
  { key: "structure", label: "Structure", kind: "area", rows: 4, hint: "The five-beat shape the outline must follow." },
  { key: "invention", label: "Invention", kind: "area", rows: 3, hint: "Forbidden, required, or attributed-claims-only." },
  { key: "researchBrief", label: "Research brief", kind: "area", rows: 3, hint: "What the research step looks for. Only used when Research is on." },
  { key: "factSheetFraming", label: "Fact sheet framing", kind: "area", rows: 3, hint: "Ground truth for factual genres; setting texture only for fiction." },
  { key: "visual", label: "Visual", kind: "area", rows: 4, hint: "The genre's visual language, fed into the Story Bible." },
];

const LIBRARY_FIELDS: AdminField[] = [
  { key: "title", label: "Title" },
  { key: "category", label: "Category" },
  { key: "tone", label: "Tone" },
  { key: "sourceUrl", label: "Source URL", wide: true },
  { key: "pacingWpm", label: "Pacing WPM", kind: "number" },
  { key: "hookWpm", label: "Hook WPM", kind: "number" },
  { key: "durationSeconds", label: "Duration (s)", kind: "number" },
  { key: "active", label: "Active", kind: "bool", hint: "Used as a style reference" },
  { key: "styleCard", label: "Style card", kind: "area", rows: 6 },
  { key: "notes", label: "Notes", kind: "area", rows: 3 },
];

const EXAMPLE_FIELDS: AdminField[] = [
  { key: "name", label: "Name" },
  { key: "usageUrl", label: "Usage link" },
  { key: "style", label: "Style", kind: "list", hint: "Comma-separated." },
  { key: "tags", label: "Tags", kind: "list", hint: "Comma-separated." },
  { key: "content", label: "Script", kind: "area", rows: 10 },
  { key: "notes", label: "Notes", kind: "area", rows: 3 },
];

export default async function AdminPage() {
  const [genres, library, examples] = await Promise.all([
    getGenreProfiles(),
    getLibraryScripts(),
    getScriptExamples(),
  ]);

  const backend = process.env.DATA_BACKEND === "postgres" ? "Postgres" : "Airtable";
  const activeGenres = genres.filter((g) => g.active).length;

  return (
    <main className="page admin">
      <div className="sechead">
        <h2>Settings</h2>
        <p>
          The three tables nobody had a screen for, because Airtable&rsquo;s grid was
          the screen. Editing a genre here changes the next film that starts — no
          workflow change, no deploy.
        </p>
        {/* Which store is answering is not a detail while two of them exist:
            an edit that lands in the one nothing reads looks identical to an
            edit that worked. */}
        <p className="backendnote">
          Reading and writing <b>{backend}</b>
          {isConfigured ? null : " · demo mode, nothing will be saved"}
        </p>
      </div>

      <section className="adminsec">
        <div className="sechead sub">
          <h3>Genre profiles</h3>
          <p>
            Claude Scripting fetches the row matching the chosen tone at the start of
            every run and injects each column into its prompts. {activeGenres} of{" "}
            {genres.length} active — an inactive row is ignored and the workflow falls
            back to its own built-in copy.
          </p>
        </div>
        <AddGenre />
        <div className="adminlist">
          {genres.map((g) => (
            <AdminRow
              key={g.id}
              title={g.tone || "(no tone)"}
              subtitle={g.format ?? undefined}
              badges={
                <>
                  {g.research ? <span className="tag">research</span> : null}
                  {g.wpm ? <span className="tag">{g.wpm} wpm</span> : null}
                  <span className={`tag ${g.active ? "on" : "off"}`}>
                    {g.active ? "active" : "off"}
                  </span>
                </>
              }
              fields={GENRE_FIELDS}
              values={g as unknown as Record<string, unknown>}
              action={updateGenre.bind(null, g.id)}
            />
          ))}
          {genres.length === 0 ? <p className="empty">No genre profiles.</p> : null}
        </div>
      </section>

      <section className="adminsec">
        <div className="sechead sub">
          <h3>Script library</h3>
          <p>
            Reference transcripts and the style cards derived from them.
            The transcript itself is not editable here — it is far too long for a
            form and nothing reads it by hand.
          </p>
        </div>
        <div className="adminlist">
          {library.map((s) => (
            <AdminRow
              key={s.id}
              title={s.title || "(untitled)"}
              subtitle={[s.category, s.tone].filter(Boolean).join(" · ") || undefined}
              badges={
                <>
                  {s.transcriptChars ? (
                    <span className="tag">
                      {(s.transcriptChars / 1000).toFixed(1)}k chars
                    </span>
                  ) : null}
                  <span className={`tag ${s.active ? "on" : "off"}`}>
                    {s.active ? "active" : "off"}
                  </span>
                </>
              }
              fields={LIBRARY_FIELDS}
              values={s as unknown as Record<string, unknown>}
              action={updateLibrary.bind(null, s.id)}
            />
          ))}
          {library.length === 0 ? <p className="empty">Nothing in the library.</p> : null}
        </div>
      </section>

      <section className="adminsec">
        <div className="sechead sub">
          <h3>Script examples</h3>
          <p>Hand-kept examples and templates, for inspiration and reuse.</p>
        </div>
        <div className="adminlist">
          {examples.map((e) => (
            <AdminRow
              key={e.id}
              title={e.name || "(unnamed)"}
              subtitle={e.style.join(" · ") || undefined}
              badges={
                e.tags.length ? <span className="tag">{e.tags.length} tags</span> : null
              }
              fields={EXAMPLE_FIELDS}
              values={e as unknown as Record<string, unknown>}
              action={updateExample.bind(null, e.id)}
            />
          ))}
          {examples.length === 0 ? <p className="empty">No examples.</p> : null}
        </div>
      </section>
    </main>
  );
}
