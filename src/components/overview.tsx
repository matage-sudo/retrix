"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Package, ShieldAlert, Database, Users, FileText, Activity } from "lucide-react";

export default function Overview() {
  const supabase = useMemo(() => createClient(), []);
  const [stats, setStats] = useState({
    products: 0,
    customers: 0,
    issues: 0,
    assets: 0,
    policies: 0,
    members: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: member } = await supabase.from("organization_members").select("organization_id").eq("user_id", user.id).limit(1).maybeSingle();
      if (!member) return;
      const orgId = member.organization_id;

      const [
        { count: products },
        { count: customers },
        { count: issues },
        { count: assets },
        { count: policies },
        { count: members }
      ] = await Promise.all([
        supabase.from("retail_products").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase.from("retail_customers").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase.from("governance_issues").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "Open"),
        supabase.from("data_assets").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase.from("policies").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase.from("organization_members").select("*", { count: "exact", head: true }).eq("organization_id", orgId)
      ]);

      setStats({
        products: products || 0,
        customers: customers || 0,
        issues: issues || 0,
        assets: assets || 0,
        policies: policies || 0,
        members: members || 0
      });
      setLoading(false);
    }
    void loadStats();
  }, [supabase]);

  const cards = [
    { title: "Retail Products", value: stats.products, icon: Package, color: "var(--blue)" },
    { title: "Registered Customers", value: stats.customers, icon: Users, color: "var(--green)" },
    { title: "Open Data Issues", value: stats.issues, icon: ShieldAlert, color: "var(--red)" },
    { title: "Data Assets", value: stats.assets, icon: Database, color: "var(--orange)" },
    { title: "Governance Policies", value: stats.policies, icon: FileText, color: "var(--text)" },
    { title: "Team Members", value: stats.members, icon: Activity, color: "var(--muted)" },
  ];

  return (
    <div className="feature-workspace">
      <div className="feature-stat-grid">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div className="feature-stat-card" key={i} style={{ borderTop: `3px solid ${card.color}` }}>
              <div className="feature-stat-top">
                <span>{card.title}</span>
                <span className="feature-stat-icon" style={{ color: card.color }}><Icon size={18} /></span>
              </div>
              <strong>{loading ? "..." : card.value}</strong>
              <small>Total records in workspace</small>
            </div>
          );
        })}
      </div>

      <div className="feature-content-grid" style={{ gridTemplateColumns: "1fr" }}>
        <section className="feature-panel">
          <div className="feature-panel-heading">
            <div>
              <h2>Welcome to Retrix</h2>
              <p>Your centralized governance workspace is ready.</p>
            </div>
          </div>
          <div style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>
            <Activity size={48} style={{ opacity: 0.2, marginBottom: "16px" }} />
            <h3 style={{ margin: "0 0 8px", color: "var(--text)" }}>System Overview</h3>
            <p style={{ maxWidth: "400px", margin: "0 auto", fontSize: "13px" }}>
              Use the sidebar to navigate through Retail Data, Data Quality, Governance, and Integrations. 
              Your data is securely scoped to your organization using Row Level Security.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
