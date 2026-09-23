"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { applyLibraryOrder, LIBRARY_ORDERS, type LibraryOrder } from "@/lib/library-order";

/**
 * Recently worked on / Newest first — how the projects page lists films on
 * this device (lib/library-order.ts). The producer asked for the switch when
 * the new order was designed: the same order for everyone by default, and a
 * way back to the old one.
 *
 * Built exactly like ThemePicker, and wears its classes: `.themepick` /
 * `.seg` / `.themenote` are the Settings row's segmented-control layout,
 * phone rules included, whatever the name says. The initial value comes from
 * the server (the page reads the cookie), so the control is right on first
 * paint; a click writes the cookie and refreshes, and the library reads it on
 * its next render.
 */
const OPTIONS: Record<LibraryOrder, { label: string; blurb: string }> = {
  activity: {
    label: "Recently worked on",
    blurb:
      "The film something last happened to comes first — your changes, the pipeline, hands-off, pause and resume. Marking a film for publishing, adding it to a playlist or just opening it never moves it.",
  },
  created: {
    label: "Newest first",
    blurb: "Films in the order they were created, newest first — the library as it always was.",
  },
};

export default function LibraryOrderPicker({ initial }: { initial: LibraryOrder }) {
  const router = useRouter();
  const [order, setOrder] = useState<LibraryOrder>(initial);

  const choose = (next: LibraryOrder) => {
    if (next === order) return;
    setOrder(next);
    applyLibraryOrder(next);
    router.refresh();
  };

  return (
    <div className="themepick">
      <div className="seg" role="radiogroup" aria-label="Library order">
        {LIBRARY_ORDERS.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={order === o}
            className={order === o ? "on" : ""}
            onClick={() => choose(o)}
          >
            {OPTIONS[o].label}
          </button>
        ))}
      </div>
      <p className="themenote">{OPTIONS[order].blurb}</p>
    </div>
  );
}
