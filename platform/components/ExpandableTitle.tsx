"use client";

import { useState } from "react";

/**
 * Long titles (people paste whole prompts into the Tema field) collapse to a
 * couple of lines with a "more" toggle instead of flooding the card/page.
 * The toggle swallows the click so it works inside <Link> cards.
 */
export default function ExpandableTitle({
  text,
  as: Tag = "h3",
  clampChars = 90,
  className,
  style,
}: {
  text: string;
  as?: "h1" | "h3";
  clampChars?: number;
  /** Lets the project page dress the title in the film's own typeface. */
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const isLong = text.length > clampChars;
  const shown = open || !isLong ? text : text.slice(0, clampChars).trimEnd() + "…";

  return (
    <Tag className={className} style={{ margin: 0, ...style }}>
      {shown}
      {isLong && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          style={{
            marginLeft: 8,
            background: "none",
            border: "none",
            padding: 0,
            font: "inherit",
            fontSize: "0.72em",
            fontWeight: 600,
            color: "var(--accent)",
            cursor: "pointer",
          }}
        >
          {open ? "less ↑" : "more ↓"}
        </button>
      )}
    </Tag>
  );
}
