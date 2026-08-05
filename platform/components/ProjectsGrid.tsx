"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteProjects, type ActionResult } from "@/app/actions";
import ExpandableTitle from "@/components/ExpandableTitle";
import type { Project } from "@/lib/data";

function badgeLabel(p: Project): string {
  switch (p.statusKind) {
    case "wait":
      return "Needs review";
    case "run":
      return "Rendering";
    case "done":
      return "Finished";
    case "err":
      return "Needs a fix";
    default:
      return p.status;
  }
}

/**
 * Dashboard project grid with a manage mode: Select turns cards into
 * checkboxes, then a two-step Delete removes every selected project
 * (scenes + scripts + project record; Drive media stays).
 */
export default function ProjectsGrid({ projects }: { projects: Project[] }) {
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitManage = () => {
    setManage(false);
    setSelected(new Set());
    setArmed(false);
  };

  return (
    <>
      <div className="eyebrow">
        <span>Projects</span>
        <span className="n">({String(projects.length).padStart(2, "0")})</span>
        <span className="sp" />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {msg && (
            <span className={`formmsg ${msg.ok ? "ok" : "err"}`} style={{ margin: 0 }}>
              {msg.message}
            </span>
          )}
          {manage ? (
            <>
              <span style={{ fontSize: 13, color: "var(--soft)" }}>
                {selected.size} selected
              </span>
              <button
                className="abtn"
                disabled={pending || selected.size === 0}
                style={{
                  borderColor: "rgba(240,101,91,0.45)",
                  color: armed ? "#fff" : "#f5a8a2",
                  background: armed ? "rgba(240,101,91,0.85)" : undefined,
                  fontSize: 12,
                  padding: "7px 14px",
                }}
                onClick={() => {
                  if (!armed) {
                    setArmed(true);
                    setTimeout(() => setArmed(false), 5000);
                    return;
                  }
                  startTransition(async () => {
                    const r = await deleteProjects([...selected]);
                    setMsg(r);
                    if (r.ok) exitManage();
                    else setArmed(false);
                  });
                }}
              >
                {pending
                  ? "Deleting…"
                  : armed
                    ? `Click again — delete ${selected.size} forever`
                    : `🗑 Delete selected`}
              </button>
              <button className="abtn" style={{ fontSize: 12, padding: "7px 14px" }} onClick={exitManage}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="abtn"
              style={{ fontSize: 12, padding: "7px 14px" }}
              onClick={() => {
                setMsg(null);
                setManage(true);
              }}
            >
              ☑ Select
            </button>
          )}
        </div>
      </div>

      <div className="projects">
        {projects.map((p, i) => {
          const isSel = selected.has(p.id);
          return (
            <Link
              href={`/projects/${p.id}`}
              className="proj"
              key={p.id}
              onClick={(e) => {
                if (manage) {
                  e.preventDefault();
                  toggle(p.id);
                }
              }}
              style={
                manage
                  ? {
                      outline: isSel ? "2px solid var(--red, #f0655b)" : "2px solid transparent",
                      opacity: isSel ? 1 : 0.75,
                      transition: "outline-color 0.15s, opacity 0.15s",
                    }
                  : undefined
              }
            >
              <div className="cover">
                <div
                  className={`art ${p.coverUrl ? "" : `fallback${(i % 4) + 1}`}`}
                  style={p.coverUrl ? { backgroundImage: `url(${p.coverUrl})` } : undefined}
                />
                <span className={`badge ${p.statusKind === "idle" ? "run" : p.statusKind}`}>
                  {badgeLabel(p)}
                </span>
                {manage && (
                  <span
                    style={{
                      position: "absolute",
                      top: 12,
                      left: 12,
                      width: 24,
                      height: 24,
                      borderRadius: 7,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 15,
                      fontWeight: 700,
                      background: isSel ? "#f0655b" : "rgba(0,0,0,0.55)",
                      color: "#fff",
                      border: "1px solid rgba(255,255,255,0.35)",
                    }}
                  >
                    {isSel ? "✓" : ""}
                  </span>
                )}
              </div>
              <div className="body">
                <ExpandableTitle text={p.name} as="h3" clampChars={80} />
                <div className="meta">
                  {p.lengthSeconds ? `${p.lengthSeconds}s` : "—"}
                  {p.tone ? ` · ${p.tone}` : ""}
                </div>
                <div className="track">
                  <i
                    className={p.statusKind === "idle" ? "" : p.statusKind}
                    style={{ width: `${Math.round(p.progress * 100)}%` }}
                  />
                </div>
                <div className="foot">
                  <span>{p.status}</span>
                  <span className="go">{manage ? (isSel ? "Selected" : "Tap to select") : "Open →"}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
