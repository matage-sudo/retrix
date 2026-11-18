"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck, Eye, EyeOff, ArrowRight } from "lucide-react";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (password.length < 8) {
      setError("Your password must contain at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/setup-organization`,
        },
      });

      if (error) throw error;

      // If Supabase returns a user with zero identities, the email is already registered.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setError("An account with this email already exists. Try signing in instead.");
        return;
      }

      if (data.session) {
        window.location.href = "/setup-organization";
      } else {
        setSuccess("Your account has been created. Check your email to confirm your address before signing in.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
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
          <span className="auth-eyebrow">GET STARTED</span>
          <h1>Create your account</h1>
          <p>Set up your secure retail governance workspace.</p>
        </div>

        <form className="auth-form" onSubmit={handleRegister}>
          <label htmlFor="name">Full name</label>
          <input
            id="name"
            type="text"
            placeholder="Your full name"
            autoComplete="name"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label htmlFor="email">Work email address</label>
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
              placeholder="At least 8 characters"
              autoComplete="new-password"
              minLength={8}
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
          {success && <div className="auth-success">{success}</div>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? "Creating account..." : "Create account"}
            {!loading && <ArrowRight size={17} />}
          </button>
        </form>

        <p className="auth-switch">
          Already registered? <Link href="/login">Sign in</Link>
        </p>

        <div className="auth-security">
          <ShieldCheck size={15} />
          Your account is protected by secure authentication
        </div>
      </section>
    </main>
  );
}
