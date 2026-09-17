"use client";

// The password form, unchanged — lifted out of page.tsx so that page can be a
// server component and read the production counts for the façade behind it.

import { useActionState } from "react";

import { login, type ActionResult } from "@/app/actions";

async function loginAction(_prev: ActionResult | null, formData: FormData) {
  return login(formData);
}

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, null);
  return (
    <form className="card" action={formAction}>
      <h1>House of Videos</h1>
      <p>Enter the team password to continue.</p>
      <div className="field">
        <input type="password" name="password" placeholder="Password" autoFocus required />
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
  );
}
