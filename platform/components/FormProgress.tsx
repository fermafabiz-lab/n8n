"use client";

import { useEffect, useState } from "react";

/**
 * "You are here" for the brief.
 *
 * A long form with five headings gives no sense of how much is left, and
 * nothing on the page said which column was the one to fill in. This sits at
 * the top of the form and does both jobs: it names the work and shows it is
 * finite.
 *
 * Reads the sections out of the DOM rather than taking a prop list, so a
 * section added to the form can never leave the rail out of date.
 */
/** Must match `.fprog`'s `top` in globals.css — the rail's sticky line. */
const STICKY_TOP = 100;

export default function FormProgress() {
  const [steps, setSteps] = useState<Array<{ id: string; label: string }>>([]);
  const [active, setActive] = useState(0);
  /**
   * Whether the rail has reached its sticky line. It matters because the bar
   * grows upward to the top of the screen once it is stuck — that upward part
   * is what the form's text disappears into — and growing it while the rail
   * is still sitting in the page would hang a dark slab above the form.
   */
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>(".fsec"));
    // The outermost sections only — the finishes list reuses .fsec's number
    // styling for its rows, and those are not steps.
    const own = sections.filter((s) => s.parentElement?.classList.contains("form"));
    own.forEach((s, i) => {
      if (!s.id) s.id = `fsec-${i + 1}`;
    });
    setSteps(
      own.map((s) => ({
        id: s.id,
        label: s.querySelector("h2")?.textContent?.trim() ?? "",
      })),
    );

    // Track the section nearest the top of the viewport rather than whichever
    // happens to intersect — with five short sections several are on screen at
    // once, and "first intersecting" jumps around as you scroll.
    const onScroll = () => {
      const marker = window.innerHeight * 0.32;
      let current = 0;
      own.forEach((s, i) => {
        if (s.getBoundingClientRect().top <= marker) current = i;
      });
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The rail's own top edge against its sticky line. Measured from the element
  // rather than from a sentinel: a sentinel would have to be placed in the
  // form's markup and would drift the moment the rail's offset changes, while
  // the rail always knows where it actually is.
  useEffect(() => {
    if (steps.length === 0) return;
    const el = document.querySelector<HTMLElement>(".fprog");
    if (!el) return;
    const check = () => {
      const top = el.getBoundingClientRect().top;
      // A pixel of tolerance: sub-pixel layout means an exact comparison
      // flickers between stuck and not on every other frame.
      setStuck(top <= STICKY_TOP + 1);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [steps.length]);

  if (steps.length === 0) return null;

  return (
    <nav className={`fprog${stuck ? " stuck" : ""}`} aria-label="Brief sections">
      <span className="fprog-lead">Fill in</span>
      <ol>
        {steps.map((s, i) => (
          <li key={s.id} className={i === active ? "on" : i < active ? "past" : ""}>
            <a href={`#${s.id}`}>
              <span className="n">{String(i + 1).padStart(2, "0")}</span>
              <span className="l">{s.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
