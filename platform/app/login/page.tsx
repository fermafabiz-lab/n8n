/**
 * The way in — and the first thing the house tells you.
 *
 * Behind the password form the building stands at dusk with its windows lit
 * by what is actually happening: blue in production, amber waiting on you, red
 * failed. You can read the state of the factory from the street, before you
 * have typed anything.
 *
 * This is the one page the middleware lets through unauthenticated, so what it
 * discloses is a real decision and the answer is: counts only. How many films
 * are in production is about what the front of a building would tell you
 * anyway; which films they are is not, and never appears here.
 *
 * The counts are read here on the server rather than fetched by the browser
 * because /api/status is *not* exempt from the gate — a client fetch would be
 * redirected to /login and quietly parse an HTML page as JSON.
 */

import Facade from "@/components/Facade";
import { getStatusCounts } from "@/lib/data";

import LoginForm from "./LoginForm";

// The counts are live, so this page must not be cached at build time.
export const dynamic = "force-dynamic";

export default async function Login() {
  // The door has to open even when the database does not answer. A dark house
  // is the honest picture of "not known", and the form below it still works.
  let counts: { run: number; wait: number; err: number } | null = null;
  try {
    counts = await getStatusCounts();
  } catch {
    counts = null;
  }

  return (
    <main className="page login-page">
      <Facade counts={counts} />
      <div className="login">
        <LoginForm />
      </div>
    </main>
  );
}
