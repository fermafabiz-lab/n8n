import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getScenes, type Scene, type StatusKind } from "@/lib/data";

export const dynamic = "force-dynamic";

// Pipeline position derived from scene states: images → video → assembly.
function pipeline(scenes: Scene[], projectDone: boolean) {
  const imagesApproved = scenes.filter((s) => s.imageApproved).length;
  const videosDone = scenes.filter((s) => s.videoUrl).length;
  const total = scenes.length || 1;
  const imagesDone = imagesApproved === total && total > 0;
  const videoDone = videosDone === total && total > 0;
  return [
    { name: "Script", state: "done" },
    { name: "Scenes", state: "done" },
    {
      name: imagesDone ? "Images" : `Images · ${imagesApproved}/${total}`,
      state: imagesDone ? "done" : "act",
    },
    {
      name: videoDone ? "Video" : `Video · ${videosDone}/${total}`,
      state: videoDone ? "done" : imagesDone ? "act" : "next",
    },
    { name: "Assembly", state: projectDone ? "done" : videoDone ? "act" : "next" },
  ];
}

function frClass(kind: StatusKind): string {
  switch (kind) {
    case "done":
      return "done";
    case "run":
      return "act";
    case "err":
      return "err";
    default:
      return "q";
  }
}

export default async function ProductionRoom({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const scenes = await getScenes(id);
  const steps = pipeline(scenes, project.statusKind === "done");
  const active = scenes.find((s) => s.statusKind === "run") ?? scenes[0];

  return (
    <main className="page">
      <div className="room">
        <div className="crumb">
          <Link href="/">Projects</Link> / <b>{project.name}</b>
        </div>
        <div className="roomhead">
          <div>
            <h1>{project.name}</h1>
            <span className="sub">
              {project.lengthSeconds ? `${project.lengthSeconds} seconds · ` : ""}
              {scenes.length} scenes · {project.status}
            </span>
          </div>
        </div>

        <div className="pipe">
          {steps.map((s, i) => (
            <span key={s.name} style={{ display: "contents" }}>
              <span className={`ps ${s.state}`}>
                <span className="ic">{s.state === "done" ? "✓" : i + 1}</span>
                {s.name}
              </span>
              {i < steps.length - 1 && <span className="pl" />}
            </span>
          ))}
        </div>

        <div className="stage">
          <div>
            <div className="monitor">
              <div className="scr">
                <div
                  className={`art ${active?.imageUrl ? "" : "fallback1"}`}
                  style={
                    active?.imageUrl
                      ? { backgroundImage: `url(${active.imageUrl})` }
                      : undefined
                  }
                />
                <span className="tc">{active?.label ?? "—"}</span>
                <div className="cap">
                  <h4>{active?.narration?.slice(0, 60) ?? "No scene selected"}</h4>
                  <p>{active?.status}</p>
                </div>
              </div>
              <div className="filmstrip">
                {scenes.map((s, i) => (
                  <div className={`fr ${frClass(s.statusKind)}`} key={s.id}>
                    <div
                      className={`art ${s.imageUrl ? "" : `fallback${(i % 4) + 1}`}`}
                      style={
                        s.imageUrl
                          ? { backgroundImage: `url(${s.imageUrl})` }
                          : undefined
                      }
                    />
                    <span className="n">{s.label}</span>
                    <span className="dot" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="insp">
            <div className="card">
              <h5>{active ? `${active.label} · Inspector` : "Inspector"}</h5>
              <div className="kv">
                <span>Image</span>
                {active?.imageApproved ? (
                  <span className="chip ok">Approved</span>
                ) : (
                  <span className="chip wait">Awaiting review</span>
                )}
              </div>
              <div className="kv">
                <span>Video</span>
                {active?.videoUrl ? (
                  <span className="chip ok">Ready</span>
                ) : active?.statusKind === "run" ? (
                  <span className="chip run">Rendering</span>
                ) : (
                  <span className="chip wait">Queued</span>
                )}
              </div>
              <div className="kv">
                <span>Status</span>
                <b>{active?.status ?? "—"}</b>
              </div>
            </div>

            <div className="card">
              <h5>Scenes</h5>
              {scenes.map((s) => (
                <div className="kv" key={s.id}>
                  <span>
                    {s.label} · {s.narration?.slice(0, 28) ?? "—"}
                  </span>
                  <span
                    className={`chip ${
                      s.statusKind === "done"
                        ? "ok"
                        : s.statusKind === "run"
                          ? "run"
                          : s.statusKind === "err"
                            ? "err"
                            : "wait"
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
