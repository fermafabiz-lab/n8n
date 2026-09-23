import { cookies } from "next/headers";
import SettingsShell from "@/components/SettingsShell";
import ThemePicker from "@/components/ThemePicker";
import LibraryOrderPicker from "@/components/LibraryOrderPicker";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { LIBRARY_ORDER_COOKIE, parseLibraryOrder } from "@/lib/library-order";

// The controls must open on what the cookies say, never on a cached copy.
export const dynamic = "force-dynamic";

export default async function CustomizePage() {
  const jar = await cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const libraryOrder = parseLibraryOrder(jar.get(LIBRARY_ORDER_COOKIE)?.value);
  return (
    <SettingsShell title="Customize" intro="How the site looks on this device.">
      <section className="srow">
        <div className="srow-text">
          <h3>Appearance</h3>
          <p>Dark mode turns the whole interface — every page, the review room, the brief — to a near-black ground. Your films are unaffected.</p>
        </div>
        <ThemePicker initial={theme} />
      </section>
      <section className="srow" style={{ marginTop: 14 }}>
        <div className="srow-text">
          <h3>Library order</h3>
          <p>How the projects page lists your films — everywhere in the library, playlists and tabs included. Only this device changes; everyone else keeps their own choice.</p>
        </div>
        <LibraryOrderPicker initial={libraryOrder} />
      </section>
    </SettingsShell>
  );
}
