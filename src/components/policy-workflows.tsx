"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Plus, Search } from "lucide-react";
import Modal from "@/components/modal";
import { useOrg } from "@/lib/use-org";

type PStatus = "Draft" | "In Review" | "Published" | "Retired";
type Policy = {
  id: string; title: string; description: string | null; status: PStatus; owner: string | null;
  version: string | null; created_by: string | null; created_at: string | null; submitted_at: string | null;
  approver_id: string | null; approved_at: string | null; review_date: string | null; rejection_note: string | null;
};
type Approval = { id: string; action: string; actor_id: string | null; comment: string | null; created_at: string };
type Member = { user_id: string; email: string; role: string };

const FILTERS = ["All", "Draft", "In Review", "Published", "Retired"] as const;
type Filter = (typeof FILTERS)[number];
const COLS = "id,title,description,status,owner,version,created_by,created_at,submitted_at,approver_id,approved_at,review_date,rejection_note";
const EMPTY = { title: "", description: "", owner: "", review_date: "" };

const statusClass = (s: string) => (s === "Published" ? "good" : s === "In Review" ? "warning" : "neutral");
function normStatus(s: string | null): PStatus {
  const v = String(s ?? "").toLowerCase();
  if (v === "published" || v === "active") return "Published";
  if (v === "in review" || v === "review" || v === "pending") return "In Review";
  if (v === "retired") return "Retired";
  return "Draft";
}
function bumpVersion(v: string | null) {
  const major = parseInt(String(v ?? "1"), 10);
  return `${(Number.isNaN(major) ? 1 : major) + 1}.0`;
}

export default function PolicyWorkflows() {
  const { supabase, ctx, error: orgError } = useOrg();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [history, setHistory] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [edit, setEdit] = useState({ title: "", description: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    const [p, m] = await Promise.all([
      supabase.from("policies").select(COLS).eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(300),
      supabase.rpc("org_members_directory", { org: ctx.organizationId }),
    ]);
    if (p.error) setError(p.error.message);
    else {
      setError("");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setPolicies((p.data ?? []).map((r: any) => ({ ...r, status: normStatus(r.status) })));
    }
    setMembers((m.data ?? []) as Member[]);
    setLoading(false);
  }, [supabase, ctx]);
  useEffect(() => { void load(); }, [load]);

  const loadHistory = useCallback(async (id: string) => {
    const { data } = await supabase.from("policy_approvals").select("id, action, actor_id, comment, created_at").eq("policy_id", id).order("created_at", { ascending: false });
    setHistory((data ?? []) as Approval[]);
  }, [supabase]);

  useEffect(() => {
    setComment(""); setFormError(""); setHistory([]);
    const p = policies.find((x) => x.id === selectedId);
    if (p) { setEdit({ title: p.title, description: p.description ?? "" }); void loadHistory(p.id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, loadHistory]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const who = useCallback((id: string | null, fb = "Unknown") => {
    if (!id) return fb;
    if (id === ctx?.userId) return "You";
    return members.find((m) => m.user_id === id)?.email ?? id.slice(0, 8);
  }, [members, ctx]);

  const today = new Date().toISOString().slice(0, 10);
  const count = (s: PStatus) => policies.filter((p) => p.status === s).length;
  const reviewDue = policies.filter((p) => p.status === "Published" && p.review_date && p.review_date < today).length;
  const countFor = (f: Filter) => (f === "All" ? policies.length : count(f));

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const order: Record<PStatus, number> = { "In Review": 0, Draft: 1, Published: 2, Retired: 3 };
    return policies
      .filter((p) => (filter === "All" || p.status === filter) && (!q || p.title.toLowerCase().includes(q) || (p.owner ?? "").toLowerCase().includes(q)))
      .sort((a, b) => order[a.status] - order[b.status]);
  }, [policies, filter, search]);

  const selected = policies.find((p) => p.id === selectedId) ?? null;

  async function createPolicy() {
    if (!ctx) return;
    if (!form.title.trim()) { setFormError("A title is required."); return; }
    setBusy(true); setFormError("");
    const { error: e } = await supabase.from("policies").insert({
      organization_id: ctx.organizationId, title: form.title.trim(), description: form.description.trim() || null,
      status: "Draft", owner: form.owner.trim() || null, version: "1.0", review_date: form.review_date || null, created_by: ctx.userId,
    });
    setBusy(false);
    if (e) { setFormError(e.message); return; }
    setShowCreate(false); setForm(EMPTY); setNotice("Draft policy created."); await load();
  }

  async function saveDraft(p: Policy) {
    if (!edit.title.trim()) { setFormError("Title cannot be empty."); return; }
    const { error: e } = await supabase.from("policies").update({ title: edit.title.trim(), description: edit.description.trim() || null }).eq("id", p.id);
    if (e) { setFormError(e.message); return; }
    setNotice("Draft saved."); await load();
  }

  async function transition(p: Policy, next: PStatus, action: string, extra: Record<string, unknown> = {}) {
    if (!ctx) return;
    if (action === "rejected" && !comment.trim()) { setFormError("Explain what must change before rejecting."); return; }
    setBusy(true); setFormError("");
    const { error: e } = await supabase.from("policies").update({ status: next, ...extra }).eq("id", p.id);
    if (e) { setFormError(e.message); setBusy(false); return; }
    await supabase.from("policy_approvals").insert({ organization_id: ctx.organizationId, policy_id: p.id, action, actor_id: ctx.userId, comment: comment.trim() || null });
    setComment(""); setNotice(`Policy ${action}.`);
    await Promise.all([load(), loadHistory(p.id)]);
    setBusy(false);
  }

  async function newVersion(p: Policy) {
    if (!ctx) return;
    setBusy(true);
    const { error: e } = await supabase.from("policies").insert({
      organization_id: ctx.organizationId, title: p.title, description: p.description, status: "Draft",
      owner: p.owner, version: bumpVersion(p.version), created_by: ctx.userId,
    });
    setBusy(false);
    if (e) { setFormError(e.message); return; }
    setSelectedId(null); setNotice(`Version ${bumpVersion(p.version)} created as a draft.`); await load();
  }

  const stat = (label: string, value: number, note: string, tone?: string) => (
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
        {stat("Awaiting approval", count("In Review"), "Submitted for review", count("In Review") ? "var(--orange)" : undefined)}
        {stat("Drafts", count("Draft"), "Being written")}
        {stat("Published", count("Published"), "In force")}
        {stat("Review due", reviewDue, "Published, past review date", reviewDue ? "var(--red)" : undefined)}
      </div>

      <section className="feature-panel feature-main-panel">
        <div className="feature-panel-heading">
          <div><h2>Policy lifecycle</h2><p>Draft, submit for review, administrator approval, publish, retire. Every decision is recorded.</p></div>
          <ClipboardCheck size={19} />
        </div>
        <div className="feature-toolbar">
          <div className="feature-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search policies or owners..." /></div>
          <button className="feature-primary-button" onClick={() => { setForm(EMPTY); setFormError(""); setShowCreate(true); }}><Plus size={15} /> New policy</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 20px 14px" }}>
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? "feature-primary-button" : "feature-secondary-button"} onClick={() => setFilter(f)}>{f} ({countFor(f)})</button>
          ))}
        </div>
        <div className="feature-table-wrap">
          <table className="feature-table">
            <thead><tr><th>Policy</th><th>Version</th><th>Status</th><th>Owner</th><th>Review date</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="feature-no-results">Loading...</td></tr>
              : visible.length === 0 ? <tr><td colSpan={5} className="feature-no-results">{policies.length ? "No policies match." : "No policies yet. Create the first draft."}</td></tr>
              : visible.map((p) => {
                const due = p.status === "Published" && !!p.review_date && p.review_date < today;
                return (
                  <tr key={p.id} onClick={() => setSelectedId(p.id)} style={{ cursor: "pointer" }}>
                    <td><strong>{p.title}</strong></td>
                    <td>v{p.version ?? "1.0"}</td>
                    <td><span className={`feature-status ${statusClass(p.status)}`}>{p.status}</span></td>
                    <td>{p.owner ?? "\u2014"}</td>
                    <td style={due ? { color: "var(--red)", fontWeight: 600 } : undefined}>{p.review_date ?? "\u2014"}{due ? " (review due)" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New policy" description="Starts as a draft at version 1.0. Nothing is enforced until an administrator publishes it.">
        <div><label>Title</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div><label>Policy text</label><textarea rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div><label>Owner (person or team)</label><input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></div>
        <div><label>Next review date</label><input type="date" value={form.review_date} onChange={(e) => setForm({ ...form, review_date: e.target.value })} /></div>
        {formError && <p style={{ color: "var(--red)", fontSize: 13 }}>{formError}</p>}
        <div className="modal-footer">
          <button className="feature-secondary-button" onClick={() => setShowCreate(false)}>Cancel</button>
          <button className="feature-primary-button" disabled={busy} onClick={createPolicy}>{busy ? "Saving..." : "Create draft"}</button>
        </div>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelectedId(null)} title={selected ? `${selected.title} (v${selected.version ?? "1.0"})` : ""}
        description={selected ? `Owner: ${selected.owner ?? "unassigned"}` : ""}>
        {selected && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className={`feature-status ${statusClass(selected.status)}`}>{selected.status}</span>
              {selected.approved_at && <span className="feature-status good">Approved by {who(selected.approver_id)} on {new Date(selected.approved_at).toLocaleDateString()}</span>}
            </div>

            {selected.rejection_note && selected.status === "Draft" && (
              <div className="feature-demo-notice" style={{ borderColor: "var(--orange)" }}><AlertTriangle size={16} /><span>Returned for changes: {selected.rejection_note}</span></div>
            )}

            {selected.status === "Draft" ? (
              <>
                <div><label>Title</label><input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
                <div><label>Policy text</label><textarea rows={6} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
              </>
            ) : (
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{selected.description || "No policy text."}</p>
            )}

            {selected.status === "In Review" && (
              <div>
                <label>{ctx?.isAdmin ? "Decision comment (required to reject)" : "Status"}</label>
                {ctx?.isAdmin
                  ? <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
                  : <p style={{ margin: 0 }}>Waiting for an administrator to approve or return this policy.</p>}
              </div>
            )}

            {formError && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{formError}</p>}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {selected.status === "Draft" && (<>
                <button className="feature-secondary-button" onClick={() => void saveDraft(selected)}>Save draft</button>
                <button className="feature-primary-button" disabled={busy} onClick={() => void transition(selected, "In Review", "submitted")}>Submit for review</button>
              </>)}
              {selected.status === "In Review" && ctx?.isAdmin && (<>
                <button className="feature-primary-button" disabled={busy} onClick={() => void transition(selected, "Published", "approved")}><CheckCircle2 size={15} /> Approve and publish</button>
                <button className="feature-secondary-button" disabled={busy} onClick={() => void transition(selected, "Draft", "rejected", { rejection_note: comment.trim() })}>Return to draft</button>
              </>)}
              {selected.status === "Published" && (<>
                <button className="feature-secondary-button" disabled={busy} onClick={() => void newVersion(selected)}>Create new version</button>
                {ctx?.isAdmin && <button className="feature-secondary-button" disabled={busy} onClick={() => void transition(selected, "Retired", "retired")}>Retire</button>}
              </>)}
            </div>

            <div>
              <label>Approval history</label>
              <div style={{ display: "grid", gap: 8, maxHeight: 180, overflowY: "auto" }}>
                {history.length === 0 && <small style={{ color: "var(--muted)" }}>No decisions recorded yet.</small>}
                {history.map((h) => (
                  <div key={h.id} style={{ fontSize: 13 }}>
                    <strong style={{ textTransform: "capitalize" }}>{h.action}</strong> by {who(h.actor_id)} &middot; {new Date(h.created_at).toLocaleString()}
                    {h.comment && <><br /><span style={{ color: "var(--muted)" }}>{h.comment}</span></>}
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