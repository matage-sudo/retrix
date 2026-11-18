"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck, Eye, EyeOff, ArrowRight } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      // Safely get the ?next= parameter
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      
      router.replace(safeNext);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link href="/" className="auth-brand">
          <span className="auth-brand-icon"><ShieldCheck size={23} /></span>
          <span>Retrix<span className="auth-brand-dot">.</span></span>
        </Link>

        <div className="auth-heading">
          <span className="auth-eyebrow">WELCOME BACK</span>
          <h1>Sign in to your workspace</h1>
          <p>Access your retail data governance platform.</p>
        </div>

        <form className="auth-form" onSubmit={handleLogin}>
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label htmlFor="password">Password</label>
          <div className="auth-password">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in to Retrix"}
            {!loading && <ArrowRight size={17} />}
          </button>
        </form>

        <p className="auth-switch">
          Don't have an account? <Link href="/register">Create account</Link>
        </p>

        <div className="auth-security">
          <ShieldCheck size={15} />
          Secure access powered by Supabase authentication
        </div>
      </section>
    </main>
  );
}
