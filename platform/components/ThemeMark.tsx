"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { applyTheme, type Theme } from "@/lib/theme";
import s from "./ThemeMark.module.css";

/**
 * The brand mark in the bar, made into the light/dark switch.
 *
 * It used to be a decorative span INSIDE the home link, which is why this is
 * a restructure and not just an onClick: a button cannot nest inside an
 * anchor, and a logo that silently navigates AND changes the theme is the
 * worst of both. So the mark is its own control now and the words
 * "House of Videos" keep the link to the library — two targets, one each.
 *
 * THE COOKIE HAS THREE VALUES AND THIS BUTTON HAS TWO. On "Follow device"
 * there is no honest "the other one", so the click is defined by what is ON
 * SCREEN rather than by what is stored: it flips to the opposite of what the
 * device is currently showing, which leaves "system" for good. That is the
 * right trade for a one-tap control — a click must always change what you
 * see — and /admin/customize keeps all three, including the way back.
 *
 * The device is unknown until mount (matchMedia is client-only), so on a
 * "system" page the first render assumes light and the effect corrects it a
 * tick later. It only ever moves the LABEL; the mark is drawn the same in
 * both themes because its two halves are `--accent` and `--ink`, which flip
 * with the tokens by themselves.
 */
export default function ThemeMark({ initial }: { initial: Theme }) {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>(initial);
  const [deviceDark, setDeviceDark] = useState<boolean | null>(null);

  /* The server is the source of truth: a refresh triggered by the OTHER
     control (the segmented picker on Customize) re-renders the layout with a
     new `initial`, and without this the bar would keep showing the old one.
     Two controls for one setting have to agree — see lessons-site.md. */
  useEffect(() => setTheme(initial), [initial]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => setDeviceDark(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  const dark = theme === "dark" || (theme === "system" && deviceDark === true);
  const next: Theme = dark ? "light" : "dark";
  const label = dark ? "Switch to the light theme" : "Switch to the dark theme";

  /* Paint (the attribute), make it stick (the cookie), then refresh the
     server tree so <meta theme-color> and the Customize picker follow. The
     same three steps, in the same order, as ThemePicker. */
  const flip = () => {
    setTheme(next);
    applyTheme(next);
    router.refresh();
  };

  return (
    <button type="button" className={s.mark} onClick={flip} aria-label={label} title={label}>
      <span className={s.disc} aria-hidden="true" />
    </button>
  );
}
