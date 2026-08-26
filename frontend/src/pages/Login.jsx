import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";

const demoAccounts = [
  { label: "Admin", email: "admin@lagobali.com", password: "admin123" },
  { label: "Purchasing", email: "purchasing@lagobali.com", password: "demo123" },
  { label: "Gudang", email: "warehouse@lagobali.com", password: "demo123" },
  { label: "Finance", email: "finance@lagobali.com", password: "demo123" },
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("admin@lagobali.com");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const user = await login(email, password);
      toast.success(`Selamat datang, ${user.name}`);
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  const quickFill = (acc) => {
    setEmail(acc.email);
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
          <p className="eyebrow">Kontrol operasional hotel · F&amp;B</p>
          <h1>Satu sistem untuk order, penerimaan, stok, dan cost control.</h1>
          <p className="subtitle">
            Pantau setiap kilogram bahan baku, setiap botol minuman, dan setiap sen
            biaya harian dari seluruh outlet Lago Bali.
          </p>
          <ul className="login-highlights">
            <li>◇ Purchase order + approval workflow</li>
            <li>◇ HPP weighted average otomatis di setiap penerimaan</li>
            <li>◇ Stock opname & flash cost harian per outlet</li>
          </ul>
        </div>
        <div className="login-credit">Dibuat oleh <strong>NANDA HARY</strong></div>
      </div>
      <div className="login-right">
        <form className="login-card" onSubmit={onSubmit}>
          <p className="eyebrow">Masuk ke workspace</p>
          <h2>Selamat datang kembali</h2>
          <p className="subtitle">Gunakan akun demo di kanan bawah untuk pengujian cepat.</p>
          <label className="field">
            <span>Email</span>
            <input
              data-testid="login-email-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
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
            {loading ? "Memproses..." : "Masuk"}
          </button>
          <div className="login-demo">
            <span>Akun demo:</span>
            <div className="demo-grid">
              {demoAccounts.map((a) => (
                <button
                  key={a.email}
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
