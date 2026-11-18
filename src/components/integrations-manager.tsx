"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Plus, RefreshCw } from "lucide-react";
import Modal from "@/components/modal";
import { useOrg } from "@/lib/use-org";

type Integ = {
  id: string; name: string; type: string; status: string; api_endpoint: string | null;
  last_synced_at: string | null; last_error: string | null; created_at: string;
};
type Log = { id: string; integration_id: string; status: string; message: string | null; duration_ms: number | null; created_at: string };

// api_key is deliberately never selected: it stays server-side.
const COLS = "id,name,type,status,api_endpoint,last_synced_at,last_error,created_at";
const TYPES = ["API", "Database", "Storage", "Custom"];
const EMPTY = { name: "", type: "API", api_endpoint: "", api_key: "" };
const statusClass = (s: string) => (s === "Connected" ? "good" : s === "Error" ? "bad" : s === "Pending" ? "warning" : "neutral");

function host(url: string | null) {
  if (!url) return "\u2014";
  try { return new URL(url).host; } catch { return url; }
}
function ago(iso: string | null) {
  if (!iso) return "Never";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} d ago`;
}

export default function IntegrationsManager() {
  const { supabase, ctx, error: orgError } = useOrg();
  const [items, setItems] = useState<Integ[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editEndpoint, setEditEndpoint] = useState("");
  const [editKey, setEditKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    const org = ctx.organizationId;
    const [i, l] = await Promise.all([
      supabase.from("integrations").select(COLS).eq("organization_id", org).order("created_at", { ascending: false }),
      supabase.from("sync_logs").select("id, integration_id, status, message, duration_ms, created_at").eq("organization_id", org).order("created_at", { ascending: false }).limit(200),
    ]);
    if (i.error) setError(i.error.message); else { setError(""); setItems((i.data ?? []) as Integ[]); }
    setLogs((l.data ?? []) as Log[]);
    setLoading(false);
  }, [supabase, ctx]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setEditKey(""); setFormError("");
    setEditEndpoint(items.find((x) => x.id === selectedId)?.api_endpoint ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  async function test(id: string) {
    setTestingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/integrations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ integrationId: id }),
      });
      const out = await res.json();
      setNotice(out.ok ? `Connection OK (${out.message}, ${out.durationMs} ms).` : `Connection failed: ${out.message ?? "unknown error"}`);
    } catch {
      setNotice("Could not reach the test service.");
    }
    setTestingId(null);
    await load();
  }

  async function createIntegration() {
    if (!ctx) return;
    if (!form.name.trim()) { setFormError("Give the integration a name."); return; }
    if (!/^https:\/\//i.test(form.api_endpoint.trim())) { setFormError("The endpoint must be an https:// URL."); return; }
    setBusy(true); setFormError("");
    const { data, error: e } = await supabase.from("integrations").insert({
      organization_id: ctx.organizationId, name: form.name.trim(), type: form.type,
      api_endpoint: form.api_endpoint.trim(), api_key: form.api_key.trim() || null, status: "Pending",
    }).select("id").single();
    setBusy(false);
    if (e || !data) { setFormError(e?.message ?? "Could not save."); return; }
    setShowCreate(false); setForm(EMPTY);
    await load();
    void test(data.id);
  }

  async function saveSettings(i: Integ) {
    if (!/^https:\/\//i.test(editEndpoint.trim())) { setFormError("The endpoint must be an https:// URL."); return; }
    const patch: Record<string, unknown> = { api_endpoint: editEndpoint.trim(), status: "Pending" };
    if (editKey.trim()) patch.api_key = editKey.trim();
    const { error: e } = await supabase.from("integrations").update(patch).eq("id", i.id);
    if (e) { setFormError(e.message); return; }
    setEditKey(""); setNotice("Settings saved. Run a connection test to confirm."); await load();
  }

  async function setPaused(i: Integ, paused: boolean) {
    const { error: e } = await supabase.from("integrations").update({ status: paused ? "Paused" : "Pending" }).eq("id", i.id);
    if (e) { setFormError(e.message); return; }
    setNotice(paused ? "Integration paused." : "Integration resumed. Run a test to confirm."); await load();
  }

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const connected = items.filter((i) => i.status === "Connected").length;
  const failing = items.filter((i) => i.status === "Error").length;
  const lastOk = items.map((i) => i.last_synced_at).filter(Boolean).sort().pop() ?? null;
  const week = logs.filter((l) => Date.now() - new Date(l.created_at).getTime() < 7 * 86_400_000);
  const okRate = week.length ? Math.round((week.filter((l) => l.status === "success").length / week.length) * 100) : null;

  const stat = (label: string, value: string | number, note: string, tone?: string) => (
    <div className="feature-stat-card" key={label}>
      <div className="feature-stat-top"><span>{label}</span></div>
      <strong style={tone ? { color: tone } : undefined}>{loading ? "..." : value}</strong>
      <small>{note}</small>
    </div>
  );

  return (
    <div className="feature-workspace">
      {(error || orgError) && (
        <div className="feature-demo-notice" style={{ borderColor: "var(--red)", color: "var(--red)" }}>
          <AlertTriangle size={16} /><span>{error || orgError}</span>
        </div>
      )}
      <div className="feature-stat-grid">
        {stat("Connected", connected, `of ${items.length} integrations`, connected ? "var(--green)" : undefined)}
        {stat("Failing", failing, "Last test failed", failing ? "var(--red)" : undefined)}
        {stat("Last success", ago(lastOk), "Most recent good connection")}
        {stat("7-day success rate", okRate === null ? "\u2014" : `${okRate}%`, `${week.length} tests in the last 7 days`)}
      </div>

      <section className="feature-panel feature-main-panel">
        <div className="feature-panel-heading">
          <div><h2>Connections</h2><p>Each connection is tested from the server. Results and errors are kept as history.</p></div>
          <Activity size={19} />
        </div>
        <div className="feature-toolbar">
          <div style={{ flex: 1 }} />
          <button className="feature-primary-button" onClick={() => { setForm(EMPTY); setFormError(""); setShowCreate(true); }}><Plus size={15} /> Add integration</button>
        </div>
        <div className="feature-table-wrap">
          <table className="feature-table">
            <thead><tr><th>Name</th><th>Type</th><th>Endpoint</th><th>Status</th><th>Last success</th><th>Action</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="feature-no-results">Loading...</td></tr>
              : items.length === 0 ? <tr><td colSpan={6} className="feature-no-results">No integrations yet.</td></tr>
              : items.map((i) => (
                <tr key={i.id}>
                  <td onClick={() => setSelectedId(i.id)} style={{ cursor: "pointer" }}>
                    <strong>{i.name}</strong>
                    {i.status === "Error" && i.last_error && <><br /><small style={{ color: "var(--red)" }}>{i.last_error}</small></>}
                  </td>
                  <td>{i.type}</td>
                  <td>{host(i.api_endpoint)}</td>
                  <td><span className={`feature-status ${statusClass(i.status)}`}>{i.status}</span></td>
                  <td>{ago(i.last_synced_at)}</td>
                  <td>
                    <button className="feature-secondary-button" disabled={testingId === i.id || i.status === "Paused"} onClick={() => void test(i.id)}>
                      <RefreshCw size={14} /> {testingId === i.id ? "Testing..." : "Test"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add integration" description="The connection is tested automatically after saving. The API key is stored but never shown again.">
        <div><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label>Type</label><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label>Endpoint (https only)</label><input value={form.api_endpoint} onChange={(e) => setForm({ ...form, api_endpoint: e.target.value })} placeholder="https://api.example.com/health" /></div>
        <div><label>API key (optional)</label><input type="password" autoComplete="off" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} /></div>
        {formError && <p style={{ color: "var(--red)", fontSize: 13 }}>{formError}</p>}
        <div className="modal-footer">
          <button className="feature-secondary-button" onClick={() => setShowCreate(false)}>Cancel</button>
          <button className="feature-primary-button" disabled={busy} onClick={createIntegration}>{busy ? "Saving..." : "Save and test"}</button>
        </div>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelectedId(null)} title={selected?.name ?? ""} description={selected ? `${selected.type} integration` : ""}>
        {selected && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className={`feature-status ${statusClass(selected.status)}`}>{selected.status}</span>
              <small style={{ color: "var(--muted)" }}>Last success: {ago(selected.last_synced_at)}</small>
            </div>
            {selected.last_error && <div className="feature-demo-notice" style={{ borderColor: "var(--red)", color: "var(--red)" }}><AlertTriangle size={16} /><span>{selected.last_error}</span></div>}
            <div><label>Endpoint</label><input value={editEndpoint} onChange={(e) => setEditEndpoint(e.target.value)} /></div>
            <div><label>Replace API key (leave blank to keep the current one)</label><input type="password" autoComplete="off" value={editKey} onChange={(e) => setEditKey(e.target.value)} /></div>
            {formError && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{formError}</p>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="feature-primary-button" onClick={() => void saveSettings(selected)}>Save settings</button>
              <button className="feature-secondary-button" disabled={testingId === selected.id || selected.status === "Paused"} onClick={() => void test(selected.id)}>Test connection</button>
              <button className="feature-secondary-button" onClick={() => void setPaused(selected, selected.status !== "Paused")}>{selected.status === "Paused" ? "Resume" : "Pause"}</button>
            </div>
            <div>
              <label>Test history</label>
              <div style={{ display: "grid", gap: 8, maxHeight: 200, overflowY: "auto" }}>
                {logs.filter((l) => l.integration_id === selected.id).length === 0 && <small style={{ color: "var(--muted)" }}>No tests run yet.</small>}
                {logs.filter((l) => l.integration_id === selected.id).slice(0, 15).map((l) => (
                  <div key={l.id} style={{ fontSize: 13 }}>
                    <span className={`feature-status ${l.status === "success" ? "good" : "bad"}`}>{l.status}</span>{" "}
                    {new Date(l.created_at).toLocaleString()} &middot; {l.duration_ms ?? 0} ms
                    {l.message && <><br /><span style={{ color: "var(--muted)" }}>{l.message}</span></>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {notice && (<div className="feature-toast"><CheckCircle2 size={16} /><span>{notice}</span><button onClick={() => setNotice("")}>Dismiss</button></div>)}
    </div>
  );
}