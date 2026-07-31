"use client";

import { useState } from "react";
import { CATEGORIES, DEFAULT_CATEGORY, getCategory } from "@/lib/categories";

/**
 * Category cards + the selected category's own options. The choice and every
 * option value are submitted with the form as hidden/named inputs
 * (`category`, `cat_<option>`); the server action packs them into the
 * payload for n8n.
 */
export default function CategoryPicker() {
  const [selected, setSelected] = useState(DEFAULT_CATEGORY);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const cat = getCategory(selected);

  const val = (name: string, def: string | boolean) =>
    values[`${selected}:${name}`] ?? def;
  const setVal = (name: string, v: string | boolean) =>
    setValues((p) => ({ ...p, [`${selected}:${name}`]: v }));

  return (
    <div className="field">
      <label>Category — what kind of video this is</label>
      <input type="hidden" name="category" value={selected} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 10,
        }}
      >
        {CATEGORIES.map((c) => {
          const isSel = c.id === selected;
          return (
            <div
              key={c.id}
              onClick={() => setSelected(c.id)}
              style={{
                padding: "13px 14px",
                borderRadius: 12,
                cursor: "pointer",
                background: isSel ? "rgba(245,184,65,0.08)" : "var(--card2)",
                border: `1px solid ${isSel ? "rgba(245,184,65,0.45)" : "var(--line)"}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13.5,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 16 }}>{c.icon}</span>
                {c.label}
                {!c.ready && (
                  <span className="chip wait" style={{ marginLeft: "auto" }}>
                    in development
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--soft)", lineHeight: 1.5 }}>
                {c.description}
              </div>
            </div>
          );
        })}
      </div>

      {!cat.ready && (
        <p className="formmsg" style={{ marginTop: 10 }}>
          This category is being built. You can start a project with it — for
          now it produces a video the same way as Story, and its special
          options below switch on as they&apos;re finished.
        </p>
      )}

      {cat.options.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {cat.options.map((o) => {
            const v = val(o.name, o.default);
            return (
              <div
                key={o.name}
                className="card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 14px",
                  opacity: o.comingSoon ? 0.75 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                    {o.label}
                    {o.comingSoon && (
                      <span className="chip wait" style={{ marginLeft: 8 }}>
                        coming soon
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--soft)" }}>{o.hint}</div>
                </div>
                {o.type === "toggle" ? (
                  <input
                    type="checkbox"
                    name={`cat_${o.name}`}
                    checked={v === true || v === "true"}
                    disabled={o.comingSoon}
                    onChange={(e) => setVal(o.name, e.target.checked)}
                    style={{ width: 17, height: 17, accentColor: "var(--amber)", flex: "none" }}
                  />
                ) : (
                  <select
                    name={`cat_${o.name}`}
                    value={String(v)}
                    disabled={o.comingSoon}
                    onChange={(e) => setVal(o.name, e.target.value)}
                    style={{ width: "auto", flex: "none" }}
                  >
                    {o.choices?.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
