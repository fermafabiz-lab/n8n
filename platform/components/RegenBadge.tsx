"use client";

/**
 * The "a regeneration is in flight" state, shown in place of the
 * Approve/Regenerate buttons.
 *
 * Every regeneration path works the same way: the site sets a flag in
 * Airtable, an n8n loop picks it up within ~15s and clears it when the new
 * asset lands OR when the request is rejected. So a set flag means "in
 * flight", and the flag clearing is what brings the buttons back — including
 * after a failure, with the reason shown underneath.
 */
export default function RegenBadge({
  label = "Regenerating…",
  note,
}: {
  label?: string;
  note?: string | null;
}) {
  // n8n writes rejections into the same notes field the reviewer writes
  // feedback into; only the rejection half is worth surfacing here.
  const rejection =
    note && /REJECTED|failed|error/i.test(note) ? note.replace(/\s+/g, " ").trim() : null;

  return (
    <div style={{ marginTop: 12 }}>
      <span
        className="chip run"
        style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
      >
        <span className="regenspin" aria-hidden />
        {label}
      </span>
      {rejection && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            lineHeight: 1.5,
            color: "#f5a8a2",
          }}
        >
          Last attempt failed: {rejection.slice(0, 260)}
        </p>
      )}
      <style>{`
        .regenspin {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          border: 1.5px solid currentColor;
          border-top-color: transparent;
          animation: regenspin 0.7s linear infinite;
        }
        @keyframes regenspin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .regenspin { animation: none; opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
