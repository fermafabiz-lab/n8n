import SettingsShell, { NothingHereYet } from "@/components/SettingsShell";

export default function AccountPage() {
  return (
    <SettingsShell title="Account" intro="Who you are on this site.">
      <NothingHereYet what="The site has one shared password and no accounts yet. When it gets them, this is where yours will live." />
    </SettingsShell>
  );
}
