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
 * "system" is stored explicitly rather than by deleting the cookie, so a
 * producer who chose to follow the device is distinguishable from one who
 * never opened the panel — the same behaviour today, but the record is
 * honest. The attribute is simply absent for it, and globals.css falls
 * through to `color-scheme: light dark`, which is the device.
 */
export type Theme = "light" | "dark" | "system";

export const THEME_COOKIE = "hov-theme";

export const THEMES: readonly Theme[] = ["light", "dark", "system"];

export function parseTheme(value: unknown): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

/** The `data-theme` value for <html>: undefined means "follow the device". */
export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
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
  const root = document.documentElement;
  const attr = themeAttribute(theme);
  if (attr) root.dataset.theme = attr;
  else delete root.dataset.theme;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
}
