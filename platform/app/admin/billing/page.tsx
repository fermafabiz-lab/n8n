import SettingsShell, { NothingHereYet } from "@/components/SettingsShell";

export default function BillingPage() {
  return (
    <SettingsShell title="Billing" intro="Plan, usage and what each film costs.">
      <NothingHereYet what="Nothing is billed through the site yet. Each project still shows its own cost breakdown on its page." />
    </SettingsShell>
  );
}
