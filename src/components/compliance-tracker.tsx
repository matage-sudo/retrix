"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Plus, Search, Trash2 } from "lucide-react";
import Modal from "@/components/modal";
import { useOrg } from "@/lib/use-org";

type CStatus = "Pending" | "In Progress" | "Compliant" | "Non-Compliant";
type Rec = {
  id: string; requirement: string; status: CStatus; due_date: string | null; assigned_to: string | null;
  framework: string | null; notes: string | null; completed_at: string | null; created_at: string | null;
};
type Evidence = { id: string; title: string; url: string | null; added_by: string | null; created_at: string };
type Member = { user_id: string; email: string; role: string };

const STATUSES: CStatus[] = ["Pending", "In Progress", "Compliant", "Non-Compliant"];
const FRAMEWORKS = ["Kenya Data Protection Act 2019", "GDPR", "ISO 27001", "PCI DSS", "SOC 2", "Internal policy"];
const FILTERS = ["Open", "Overdue", "Compliant", "All"] as const;
type Filter = (typeof FILTERS)[number];
const DAY = 86_400_000;
const COLS = "id,requirement,status,due_date,assigned_to,framework,notes,completed_at,created_at";
const EMPTY = { requirement: "", framework: FRAMEWORKS[0], due_date: "", assigned_to: "", notes: "" };

const statusClass = (s: string) => (s === "Compliant" ? "good" : s === "Non-Compliant" ? "bad" : s === "In Progress" ? "warning" : "neutral");
function normStatus(s: string | null): CStatus {
  const v = String(s ?? "").toLowerCase().replace("_", " ");
  if (v === "compliant" || v === "completed") return "Compliant";
  if (v === "non-compliant" || v === "non compliant") return "Non-Compliant";
  if (v === "in progress" || v === "active") return "In Progress";
  return "Pending";
}

export default function ComplianceTracker() {
  const { supabase, ctx, error: orgError } = useOrg();
  const [recs, setRecs] = useState<Rec[]>([]);
  const [evCount, setEvCount] = useState<Record<string, number>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<Filter>("Open");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [evForm, setEvForm] = useState({ title: "", url: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    const org = ctx.organizationId;
    const [r, e, m] = await Promise.all([
      supabase.from("compliance_records").select(COLS).eq("organization_id", org).order("due_date", { ascending: true, nullsFirst: false }).limit(300),
      supabase.from("compliance_evidence").select("compliance_id").eq("organization_id", org),
      supabase.rpc("org_members_directory", { org }),
    ]);
    if (r.error) setError(r.error.message);
    else {
      setError("");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setRecs((r.data ?? []).map((x: any) => ({ ...x, status: normStatus(x.status) })));
    }
    const counts: Record<string, number> = {};
    (e.data ?? []).forEach((x: { compliance_id: string }) => { counts[x.compliance_id] = (counts[x.compliance_id] ?? 0) + 1; });
    setEvCount(counts);
    setMembers((m.data ?? []) as Member[]);
    setLoading(false);
  }, [supabase, ctx]);
  useEffect(() => { void load(); }, [load]);

  const loadEvidence = useCallback(async (id: string) => {
    const { data } = await supabase.from("compliance_evidence").select("id, title, url, added_by, created_at").eq("compliance_id", id).order("created_at", { ascending: false });
    setEvidence((data ?? []) as Evidence[]);
  }, [supabase]);

  useEffect(() => {
    setEvidence([]); setEvForm({ title: "", url: "" }); setFormError("");
    const r = recs.find((x) => x.id === selectedId);
    if (r) { setNotes(r.notes ?? ""); void loadEvidence(r.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, loadEvidence]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const assignable: Member[] = members.length ? members : ctx ? [{ user_id: ctx.userId, email: "You", role: ctx.role }] : [];
  const who = useCallback((id: string | null, fb = "Unassigned") => {
    if (!id) return fb;
    if (id === ctx?.userId) return "You";
    return members.find((m) => m.user_id === id)?.email ?? id.slice(0, 8);
  }, [members, ctx]);

  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = (r: Rec) => r.status !== "Compliant" && !!r.due_date && r.due_date < today;
  const daysLeft = (d: string) => Math.ceil((new Date(d).getTime() - new Date(today).getTime()) / DAY);

  const summary = useMemo(() => {
    const done = recs.filter((r) => r.status === "Compliant").length;
    return {
      rate: recs.length ? Math.round((done / recs.length) * 100) : 0,
      overdue: recs.filter(isOverdue).length,
      soon: recs.filter((r) => r.status !== "Compliant" && r.due_date && r.due_date >= today && daysLeft(r.due_date) <= 30).length,
      progress: recs.filter((r) => r.status === "In Progress").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, today]);

  const countFor = (f: Filter) => f === "All" ? recs.length : f === "Open" ? recs.filter((r) => r.status !== "Compliant").length : f === "Overdue" ? recs.filter(isOverdue).length : recs.filter((r) => r.status === "Compliant").length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recs.filter((r) =>
      (filter === "All" || (filter === "Open" ? r.status !== "Compliant" : filter === "Overdue" ? isOverdue(r) : r.status === "Compliant")) &&
      (!q || r.requirement.toLowerCase().includes(q) || (r.framework ?? "").toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, filter, search, today]);

  const selected = recs.find((r) => r.id === selectedId) ?? null;

  async function createRec() {
    if (!ctx) return;
    if (!form.requirement.trim()) { setFormError("Describe the requirement."); return; }
    setBusy(true); setFormError("");
    const { error: e } = await supabase.from("compliance_records").insert({
      organization_id: ctx.organizationId, requirement: form.requirement.trim(), framework: form.framework, status: "Pending",
      due_date: form.due_date || null, assigned_to: form.assigned_to || null, notes: form.notes.trim() || null,
    });
    setBusy(false);
    if (e) { setFormError(e.message); return; }
    setShowCreate(false); setForm(EMPTY); setNotice("Requirement added."); await load();
  }

  async function setStatus(r: Rec, next: CStatus) {
    setFormError("");
    if (next === "Compliant" && !(evCount[r.id] > 0)) { setFormError("Attach at least one piece of evidence before marking this compliant."); return; }
    const { error: e } = await supabase.from("compliance_records").update({ status: next }).eq("id", r.id);
    if (e) { setFormError(e.message); return; }
    setNotice(`Marked ${next}.`); await load();
  }

  async function update(r: Rec, patch: Record<string, unknown>, msg: string) {
    const { error: e } = await supabase.from("compliance_records").update(patch).eq("id", r.id);
    if (e) { setFormError(e.message); return; }
    setNotice(msg); await load();
  }

  async function addEvidence(r: Rec) {
    if (!ctx) return;
    if (!evForm.title.trim()) { setFormError("Give the evidence a title."); return; }
    if (evForm.url.trim() && !/^https?:\/\//i.test(evForm.url.trim())) { setFormError("The link must start with http:// or https://"); return; }
    setFormError("");
    const { error: e } = await supabase.from("compliance_evidence").insert({
      organization_id: ctx.organizationId, compliance_id: r.id, title: evForm.title.trim(), url: evForm.url.trim() || null, added_by: ctx.userId,
    });
    if (e) { setFormError(e.message); return; }
    setEvForm({ title: "", url: "" }); await Promise.all([loadEvidence(r.id), load()]);
  }

  async function removeEvidence(r: Rec, id: string) {
    const { error: e } = await supabase.from("compliance_evidence").delete().eq("id", id);
    if (e) { setFormError(e.message); return; }
    await Promise.all([loadEvidence(r.id), load()]);
  }

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
        {stat("Compliance rate", `${summary.rate}%`, "Requirements marked compliant", summary.rate >= 80 ? "var(--green)" : summary.rate >= 50 ? "var(--orange)" : "var(--red)")}
        {stat("Overdue", summary.overdue, "Past their due date", summary.overdue ? "var(--red)" : undefined)}
        {stat("Due in 30 days", summary.soon, "Needs attention soon")}
        {stat("In progress", summary.progress, "Being worked on")}
      </div>

      <section className="feature-panel feature-main-panel">
        <div className="feature-panel-heading">
          <div><h2>Requirements</h2><p>Track each obligation to completion. A requirement can only be marked compliant once evidence is attached.</p></div>
          <FileText size={19} />
        </div>
        <div className="feature-toolbar">
          <div className="feature-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search requirements or frameworks..." /></div>
          <button className="feature-primary-button" onClick={() => { setForm(EMPTY); setFormError(""); setShowCreate(true); }}><Plus size={15} /> Add requirement</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 20px 14px" }}>
          {FILTERS.map((f) => (<button key={f} className={filter === f ? "feature-primary-button" : "feature-secondary-button"} onClick={() => setFilter(f)}>{f} ({countFor(f)})</button>))}
        </div>
        <div className="feature-table-wrap">
          <table className="feature-table">
            <thead><tr><th>Requirement</th><th>Framework</th><th>Status</th><th>Due</th><th>Owner</th><th>Evidence</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="feature-no-results">Loading...</td></tr>
              : visible.length === 0 ? <tr><td colSpan={6} className="feature-no-results">{recs.length ? "Nothing matches these filters." : "No requirements yet."}</td></tr>
              : visible.map((r) => {
                const od = isOverdue(r);
                return (
                  <tr key={r.id} onClick={() => setSelectedId(r.id)} style={{ cursor: "pointer" }}>
                    <td><strong>{r.requirement}</strong></td>
                    <td>{r.framework ?? "\u2014"}</td>
                    <td><span className={`feature-status ${statusClass(r.status)}`}>{r.status}</span></td>
                    <td style={od ? { color: "var(--red)", fontWeight: 600 } : undefined}>
                      {r.due_date ?? "\u2014"}{r.due_date && r.status !== "Compliant" ? (od ? ` (${Math.abs(daysLeft(r.due_date))}d overdue)` : ` (${daysLeft(r.due_date)}d left)`) : ""}
                    </td>
                    <td>{who(r.assigned_to)}</td>
                    <td>{evCount[r.id] ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add compliance requirement" description="Starts as Pending.">
        <div><label>Requirement</label><textarea rows={3} value={form.requirement} onChange={(e) => setForm({ ...form, requirement: e.target.value })} placeholder="e.g. Register as a data controller with the regulator" /></div>
        <div><label>Framework</label><select value={form.framework} onChange={(e) => setForm({ ...form, framework: e.target.value })}>{FRAMEWORKS.map((f) => <option key={f}>{f}</option>)}</select></div>
        <div><label>Due date</label><input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
        <div><label>Owner</label><select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}><option value="">Unassigned</option>{assignable.map((m) => <option key={m.user_id} value={m.user_id}>{m.email}</option>)}</select></div>
        <div><label>Notes</label><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        {formError && <p style={{ color: "var(--red)", fontSize: 13 }}>{formError}</p>}
        <div className="modal-footer">
          <button className="feature-secondary-button" onClick={() => setShowCreate(false)}>Cancel</button>
          <button className="feature-primary-button" disabled={busy} onClick={createRec}>{busy ? "Saving..." : "Add requirement"}</button>
        </div>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelectedId(null)} title={selected?.requirement ?? ""} description={selected?.framework ?? ""}>
        {selected && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label>Status</label>
                <select value={selected.status} onChange={(e) => void setStatus(selected, e.target.value as CStatus)}>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div><label>Due date</label><input type="date" value={selected.due_date ?? ""} onChange={(e) => void update(selected, { due_date: e.target.value || null }, "Due date updated.")} /></div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label>Owner</label>
                <select value={selected.assigned_to ?? ""} onChange={(e) => void update(selected, { assigned_to: e.target.value || null }, "Owner updated.")}>
                  <option value="">Unassigned</option>{assignable.map((m) => <option key={m.user_id} value={m.user_id}>{m.email}</option>)}
                </select>
              </div>
            </div>
            {selected.completed_at && <small style={{ color: "var(--muted)" }}>Completed {new Date(selected.completed_at).toLocaleString()}</small>}

            <div>
              <label>Notes</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              <button className="feature-secondary-button" style={{ marginTop: 6 }} onClick={() => void update(selected, { notes: notes.trim() || null }, "Notes saved.")}>Save notes</button>
            </div>

            <div>
              <label>Evidence ({evidence.length})</label>
              <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
                {evidence.length === 0 && <small style={{ color: "var(--muted)" }}>No evidence attached yet.</small>}
                {evidence.map((ev) => (
                  <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                    <span>
                      {ev.url ? <a href={ev.url} target="_blank" rel="noreferrer noopener">{ev.title}</a> : ev.title}
                      <small style={{ color: "var(--muted)" }}> &middot; {who(ev.added_by, "Unknown")} &middot; {new Date(ev.created_at).toLocaleDateString()}</small>
                    </span>
                    {ctx?.isAdmin && <button className="feature-row-action" title="Remove evidence" onClick={() => void removeEvidence(selected, ev.id)}><Trash2 size={14} /></button>}
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <input value={evForm.title} onChange={(e) => setEvForm({ ...evForm, title: e.target.value })} placeholder="Evidence title, e.g. Registration certificate" />
                <input value={evForm.url} onChange={(e) => setEvForm({ ...evForm, url: e.target.value })} placeholder="Link to the document (optional)" />
                <button className="feature-secondary-button" onClick={() => void addEvidence(selected)}>Attach evidence</button>
              </div>
            </div>
            {formError && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{formError}</p>}
          </div>
        )}
      </Modal>

      {notice && (<div className="feature-toast"><CheckCircle2 size={16} /><span>{notice}</span><button onClick={() => setNotice("")}>Dismiss</button></div>)}
    </div>
  );
}