import { cookies } from "next/headers";
import SettingsShell from "@/components/SettingsShell";
import ThemePicker from "@/components/ThemePicker";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

// The control must open on what the cookie says, never on a cached copy.
export const dynamic = "force-dynamic";

export default async function CustomizePage() {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <SettingsShell title="Customize" intro="How the site looks on this device.">
      <section className="srow">
        <div className="srow-text">
          <h3>Appearance</h3>
          <p>Dark mode turns the whole interface — every page, the review room, the brief — to a near-black ground. Your films are unaffected.</p>
        </div>
        <ThemePicker initial={theme} />
      </section>
    </SettingsShell>
  );
}
