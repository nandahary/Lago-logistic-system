import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";

const demoAccounts = [
  { label: "Admin", username: "admin", password: "admin123" },
  { label: "Purchasing", username: "purchasing", password: "demo123" },
  { label: "Warehouse", username: "warehouse", password: "demo123" },
  { label: "Finance", username: "finance", password: "demo123" },
];

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const user = await login(username, password);
      toast.success(`Welcome, ${user.name}`);
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  const quickFill = (acc) => {
    setUsername(acc.username);
    setPassword(acc.password);
  };

  return (
    <div className="login-shell" data-testid="login-page">
      <div className="login-left">
        <div className="login-brand">
          <div className="brand-mark">L</div>
          <div>
            <strong>LAGO BALI</strong>
            <span>Inventory · F&amp;B OS</span>
          </div>
        </div>
        <div className="login-copy">
          <p className="eyebrow">Hotel operations control · F&amp;B</p>
          <h1>One system for orders, receiving, stock, and cost control.</h1>
          <p className="subtitle">
            Track every kilogram of raw material, every bottle of beverage, and every
            rupiah of daily cost across all Lago Bali outlets.
          </p>
          <ul className="login-highlights">
            <li>◇ Purchase order + approval workflow</li>
            <li>◇ Automatic weighted-average COGS on every receiving</li>
            <li>◇ Stock take & daily flash cost per outlet</li>
          </ul>
        </div>
        <div className="login-credit">Created by <strong>NANDA HARY</strong></div>
      </div>
      <div className="login-right">
        <form className="login-card" onSubmit={onSubmit}>
          <p className="eyebrow">Sign in to workspace</p>
          <h2>Welcome back</h2>
          <p className="subtitle">Use the demo accounts below for quick testing.</p>
          <label className="field">
            <span>Username</span>
            <input
              data-testid="login-username-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              type="text"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              data-testid="login-password-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <div className="login-error" data-testid="login-error">
              {error}
            </div>
          )}
          <button
            data-testid="login-submit-button"
            className="primary-button full"
            disabled={loading}
            type="submit"
          >
            {loading ? "Processing..." : "Sign in"}
          </button>
          <div className="login-demo">
            <span>Demo accounts:</span>
            <div className="demo-grid">
              {demoAccounts.map((a) => (
                <button
                  key={a.username}
                  type="button"
                  data-testid={`demo-account-${a.label.toLowerCase()}`}
                  className="chip"
                  onClick={() => quickFill(a)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
