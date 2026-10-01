import { useState } from "react";
import { auth } from "../lib/api";
import { syncNow } from "../lib/sync";

/** Sign this device in so it syncs with your other devices. */
export function Login({ onDone, onSkip }: { onDone: () => void; onSkip?: () => void }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      await auth.login(password);
      setPassword("");
      onDone();
      void syncNow();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 401
          ? "That password isn't right."
          : status === 429
            ? "Too many wrong tries. Wait 15 minutes and try again."
            : "Can't reach the server. Check your internet, or keep using this device and sign in later.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <h1>Xoba Big Idea</h1>
      <p className="tagline">Speak it. Save it. Come back to it.</p>
      <form onSubmit={submit} className="login-card">
        <label htmlFor="password">Password</label>
        <div className="row nowrap">
          <input
            id="password"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
          <button type="button" className="secondary" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
            {show ? "Hide" : "Show"}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary wide" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="muted small">Sign in once on each device (phone, laptop) and your ideas and recordings appear on all of them.</p>
      </form>
      {onSkip && (
        <button type="button" className="link" onClick={onSkip}>
          Not now, keep ideas on this device only
        </button>
      )}
    </div>
  );
}
