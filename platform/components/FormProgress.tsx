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
export default function FormProgress() {
  const [steps, setSteps] = useState<Array<{ id: string; label: string }>>([]);
  const [active, setActive] = useState(0);

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

  if (steps.length === 0) return null;

  return (
    <nav className="fprog" aria-label="Brief sections">
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
