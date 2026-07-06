"use client";

import { useActionState } from "react";
import { login, type ActionResult } from "@/app/actions";

async function loginAction(_prev: ActionResult | null, formData: FormData) {
  return login(formData);
}

export default function Login() {
  const [state, formAction, pending] = useActionState(loginAction, null);
  return (
    <main className="page">
      <div className="login">
        <form className="card" action={formAction}>
          <h1>Video Factory</h1>
          <p>Enter the team password to continue.</p>
          <div className="field">
            <input
              type="password"
              name="password"
              placeholder="Password"
              autoFocus
              required
            />
          </div>
          {state && !state.ok && (
            <p className="formmsg err" style={{ marginTop: 12 }}>
              {state.message}
            </p>
          )}
          <div style={{ marginTop: 16 }}>
            <button className="btn gold" disabled={pending} style={{ width: "100%" }}>
              {pending ? "Checking…" : "Enter"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
