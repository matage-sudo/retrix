"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Building2, ArrowRight, Loader2, ShieldCheck } from "lucide-react";

export default function SetupOrganizationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [industry, setIndustry] = useState("Retail");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function checkUser() {
      const supabase = createClient();

      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (!active) return;

      if (authError || !user) {
        router.replace("/login");
        return;
      }

      const { data: memberships, error: membershipError } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .limit(1);

      if (!active) return;

      if (membershipError) {
        setError("We could not check your organization membership. Please refresh and try again.");
        setLoading(false);
        return;
      }

      if (memberships && memberships.length > 0) {
        router.replace("/");
        return;
      }

      setLoading(false);
    }

    checkUser();

    return () => {
      active = false;
    };
  }, [router]);

  function updateName(value: string) {
    setName(value);
    setSlug(
      value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60)
    );
  }

  async function createOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (name.trim().length < 2) {
      setError("Organization name must contain at least 2 characters.");
      return;
    }

    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      setError("Use lowercase letters, numbers and hyphens for the organization URL.");
      return;
    }

    setSaving(true);

    try {
      const supabase = createClient();

      const { data, error: rpcError } = await supabase.rpc(
        "create_organization",
        {
          p_name: name.trim(),
          p_slug: slug.trim(),
          p_industry: industry,
        }
      );

      if (rpcError) {
        throw rpcError;
      }

      if (!data?.success) {
        throw new Error("Organization creation could not be completed.");
      }

      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="setup-page">
        <div className="setup-loading">
          <Loader2 className="setup-spinner" size={27} />
          <p>Preparing your workspace...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="setup-page">
      <section className="setup-card">
        <div className="setup-brand">
          <div className="setup-logo"><Building2 size={22} /></div>
          <span>RETRIX</span>
        </div>

        <div className="setup-icon"><Building2 size={25} /></div>

        <div className="setup-heading">
          <span className="setup-eyebrow">WORKSPACE SETUP</span>
          <h1>Create your organization</h1>
          <p>
            Set up your organization to start managing retail data,
            governance and quality in Retrix.
          </p>
        </div>

        <form onSubmit={createOrganization} className="setup-form">
          <label htmlFor="org-name">Organization name</label>
          <input
            id="org-name"
            value={name}
            onChange={(e) => updateName(e.target.value)}
            placeholder="e.g. Acme Retail Group"
            required
            minLength={2}
            maxLength={100}
          />

          <label htmlFor="org-slug">Organization URL identifier</label>
          <div className="setup-slug">
            <span>retrix.app/</span>
            <input
              id="org-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="acme-retail"
              required
              maxLength={60}
            />
          </div>
          <small>Lowercase letters, numbers and hyphens only.</small>

          <label htmlFor="org-industry">Industry</label>
          <select
            id="org-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          >
            <option value="Retail">Retail</option>
            <option value="Wholesale">Wholesale</option>
            <option value="Supermarket">Supermarket</option>
            <option value="E-commerce">E-commerce</option>
            <option value="Distribution">Distribution</option>
            <option value="Other">Other</option>
          </select>

          {error && <div className="setup-error">{error}</div>}

          <button type="submit" disabled={saving} className="setup-submit">
            {saving ? (
              <><Loader2 className="setup-spinner" size={17} /> Creating organization...</>
            ) : (
              <>Create organization <ArrowRight size={17} /></>
            )}
          </button>
        </form>

        <div className="setup-security">
          <ShieldCheck size={15} />
          Your organization is protected by Retrix access controls.
        </div>
      </section>
    </main>
  );
}
