import SettingsShell, { NothingHereYet } from "@/components/SettingsShell";

export default function NotificationsPage() {
  return (
    <SettingsShell title="Notifications" intro="When the factory should call you.">
      <NothingHereYet what="The tab title and the toasts already say when a film needs you. Alerts that reach you outside the site are not wired yet." />
    </SettingsShell>
  );
}
