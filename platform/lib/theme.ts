/**
 * The one owner of "which theme": the cookie's name, its three values and
 * the two directions it travels — server → <html data-theme> in layout.tsx,
 * and client → cookie + attribute in applyTheme().
 *
 * Why a cookie and not localStorage: the server renders the attribute, so a
 * dark page arrives dark. A localStorage flag can only be read after the
 * first paint, which is a white flash on every load — the one thing a dark
 * mode must never do. Why a cookie and not the database: the site has one
 * shared password and no user, so "my" theme can only mean this browser's.
 *
 * THE DEFAULT IS LIGHT, not the device. No cookie — a new browser, a cleared
 * one — means Daylight, whatever the phone or laptop is set to; the site
 * follows the device only when "Follow device" was chosen, and that choice
 * is stored as "system" like the other two. The producer asked for exactly
 * this on 2026-09-15, so a colleague opening the site for the first time
 * sees the one look everybody knows.
 */
export type Theme = "light" | "dark" | "system";

export const THEME_COOKIE = "hov-theme";

export const THEMES: readonly Theme[] = ["light", "dark", "system"];

export function parseTheme(value: unknown): Theme {
  return value === "dark" || value === "system" ? value : "light";
}

/**
 * The `data-theme` value for <html>. Always stamped: globals.css maps
 * "light" and the missing attribute to `color-scheme: light`, "dark" to
 * `dark`, and "system" to `light dark`, which is the device.
 */
export function themeAttribute(theme: Theme): Theme {
  return theme;
}

/** The page ground each choice paints, for the browser's own chrome. */
export const THEME_COLOR = { light: "#ececed", dark: "#121216" } as const;

/**
 * Client only. Flips the page immediately (the attribute) and makes it stick
 * (the cookie) — a year, whole site, Lax. `Secure` only where it can be
 * honoured: a Secure cookie set over plain http is silently dropped, which
 * would make the toggle work everywhere except `next dev`.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = themeAttribute(theme);
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
}
