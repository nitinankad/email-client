import { useState } from "react";
import { api, ApiError } from "../api";
import { MailIcon } from "../icons";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.login(password);
      onLogin();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Incorrect password." : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="logo">
          <MailIcon style={{ width: 24, height: 24 }} />
        </div>
        <h1>Welcome back</h1>
        <p>Sign in to your mailbox</p>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input
            id="pw"
            className="input"
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <button className="btn-primary" type="submit" disabled={loading || !password}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <div className="error-text">{error}</div>
      </form>
    </div>
  );
}
