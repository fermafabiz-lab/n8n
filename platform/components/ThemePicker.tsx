"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { applyTheme, THEMES, type Theme } from "@/lib/theme";

/**
 * Light / Dark / Follow the device — the one control on the Customize panel.
 *
 * The initial value comes from the server (the page reads the cookie), so
 * the control and the page agree on first paint with nothing read after
 * mount. A click does three things in order: paints the page (the attribute
 * — instant, no round trip), makes it stick (the cookie), then refreshes
 * the server tree so the <meta theme-color> the layout renders follows.
 *
 * The "device" option says what it currently resolves to, because "follow
 * the device" is only a useful answer if you can see what the device says.
 * That is read from matchMedia after mount and null until then — rendering
 * it on the server would be a guess the client then contradicts.
 */
const OPTIONS: ReadonlyArray<{ value: Theme; label: string; blurb: string }> = [
  { value: "light", label: "Light", blurb: "Daylight — the grey ground and the purple accent, as the site has always been." },
  { value: "dark", label: "Dark", blurb: "The same interface on a near-black ground. Easier on the eyes at night and next to dark footage." },
  { value: "system", label: "Follow device", blurb: "Whatever this phone or laptop is set to, and it changes when that does." },
];

function Icon({ kind }: { kind: Theme }) {
  const common = { width: 16, height: 16, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "light") {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="3.4" />
        <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
      </svg>
    );
  }
  if (kind === "dark") {
    return (
      <svg {...common}>
        <path d="M16.5 12.2A6.8 6.8 0 0 1 7.8 3.5a6.8 6.8 0 1 0 8.7 8.7z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="2.5" y="4" width="15" height="10" rx="2" />
      <path d="M7 17h6M10 14v3" />
    </svg>
  );
}

export default function ThemePicker({ initial }: { initial: Theme }) {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>(initial);
  const [deviceDark, setDeviceDark] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => setDeviceDark(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  const choose = (next: Theme) => {
    if (next === theme) return;
    setTheme(next);
    applyTheme(next);
    router.refresh();
  };

  const current = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2];
  const deviceNote =
    theme === "system" && deviceDark !== null
      ? ` Right now that is ${deviceDark ? "dark" : "light"}.`
      : "";

  return (
    <div className="themepick">
      <div className="seg" role="radiogroup" aria-label="Appearance">
        {THEMES.map((t) => {
          const o = OPTIONS.find((x) => x.value === t)!;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              className={theme === t ? "on" : ""}
              onClick={() => choose(t)}
            >
              <Icon kind={t} />
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="themenote">
        {current.blurb}
        {deviceNote}
      </p>
    </div>
  );
}
