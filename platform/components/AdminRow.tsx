"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { AdminResult } from "@/app/admin/actions";

export interface AdminField {
  key: string;
  label: string;
  kind?: "text" | "area" | "number" | "bool" | "list" | "select";
  /** For kind="select". */
  options?: string[];
  /** Sits under the input — say what the field DOES, not what it is called. */
  hint?: string;
  /** Rows for a textarea. */
  rows?: number;
  /** Full width in the grid. */
  wide?: boolean;
}

/**
 * One editable record, collapsed until opened.
 *
 * Collapsed by default because the point of this screen is scanning: eleven
 * genres with twelve fields each is four hundred inputs, and the question
 * someone actually arrives with is "which of these is on?".
 */
export default function AdminRow({
  title,
  subtitle,
  badges,
  fields,
  values,
  action,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  fields: AdminField[];
  values: Record<string, unknown>;
  action: (form: FormData) => Promise<AdminResult>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [result, setResult] = useState<AdminResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className={`adminrow${open ? " open" : ""}`}>
      <button type="button" className="adminhead" onClick={() => setOpen((v) => !v)}>
        <span className="chev" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        <span className="atitle">{title}</span>
        {subtitle ? <span className="asub">{subtitle}</span> : null}
        <span className="sp" />
        {badges}
      </button>

      {open ? (
        <form
          className="adminform"
          action={(form) =>
            start(async () => {
              setResult(await action(form));
            })
          }
        >
          {fields.map((f) => {
            const v = values[f.key];
            const id = `${title}-${f.key}`;
            return (
              <div
                key={f.key}
                className={`field${f.wide || f.kind === "area" ? " wide" : ""}`}
              >
                <label htmlFor={id}>{f.label}</label>
                {f.kind === "area" ? (
                  <textarea
                    id={id}
                    name={f.key}
                    rows={f.rows ?? 4}
                    defaultValue={(v as string) ?? ""}
                  />
                ) : f.kind === "bool" ? (
                  <label className="switchline">
                    <input
                      id={id}
                      type="checkbox"
                      name={f.key}
                      defaultChecked={v === true}
                    />
                    <span>{f.hint ?? "On"}</span>
                  </label>
                ) : f.kind === "select" ? (
                  <select id={id} name={f.key} defaultValue={String(v ?? "")}>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    name={f.key}
                    type={f.kind === "number" ? "number" : "text"}
                    defaultValue={
                      f.kind === "list"
                        ? (Array.isArray(v) ? v.join(", ") : "")
                        : ((v as string | number | null) ?? "") === null
                          ? ""
                          : String(v ?? "")
                    }
                  />
                )}
                {f.hint && f.kind !== "bool" ? <small>{f.hint}</small> : null}
              </div>
            );
          })}

          <div className="adminactions">
            <button className="btn gold" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
            {result ? (
              <span className={`adminmsg${result.ok ? " ok" : " err"}`}>
                {result.message}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
