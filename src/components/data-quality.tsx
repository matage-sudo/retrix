"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Plus, Search, ShieldCheck } from "lucide-react";
import Modal from "@/components/modal";
import { useOrg } from "@/lib/use-org";

type Severity = "High" | "Medium" | "Low";
type Status = "Open" | "In Review" | "Resolved";

type Issue = {
  id: string;
  title: string;
  description: string | null;
  severity: Severity;
  status: Status;
  created_by: string | null;
  assigned_to: string | null;
  asset_id: string | null;
  issue_type: string | null;
  due_date: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};
type Asset = { id: string; name: string };
type Member = { user_id: string; email: string; role: string };
type Comment = { id: string; user_id: string | null; body: string; kind: string; created_at: string };
type NewIssue = {
  title: string; description: string; severity: Severity; issue_type: string;
  asset_id: string; assigned_to: string; due_date: string;
};

const FILTERS = ["Unresolved", "Open", "In Review", "Resolved", "All"] as const;
type Filter = (typeof FILTERS)[number];

const ISSUE_TYPES = ["Missing data", "Duplicate", "Invalid format", "Inconsistent", "Outdated", "Other"];
const WEIGHT: Record<Severity, number> = { High: 25, Medium: 10, Low: 3 };
const SLA_DAYS: Record<Severity, number> = { High: 3, Medium: 7, Low: 14 };
const NEXT: Record<Status, Status[]> = {
  Open: ["In Review", "Resolved"],
  "In Review": ["Open", "Resolved"],
  Resolved: ["Open"],
};
const DAY = 86_400_000;
const EMPTY: NewIssue = { title: "", description: "", severity: "Medium", issue_type: "Other", asset_id: "", assigned_to: "", due_date: "" };

const sevClass = (s: string) => (s === "High" ? "bad" : s === "Medium" ? "warning" : "neutral");
const statusClass = (s: string) => (s === "Resolved" ? "good" : s === "In Review" ? "warning" : "bad");

function normSeverity(s: string): Severity {
  const v = String(s).toLowerCase();
  return v === "high" ? "High" : v === "low" ? "Low" : "Medium";
}
function normStatus(s: string): Status {
  const v = String(s).toLowerCase().replace("_", " ");
  return v === "resolved" ? "Resolved" : v === "in review" ? "In Review" : "Open";
}
function slaDate(sev: Severity) {
  return new Date(Date.now() + SLA_DAYS[sev] * DAY).toISOString().slice(0, 10);
}
function ageLabel(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  return d <= 0 ? "Today" : d === 1 ? "1 day" : `${d} days`;
}
function scoreColor(score: number) {
  return score >= 80 ? "var(--green)" : score >= 50 ? "var(--orange)" : "var(--red)";
}

export default function DataQuality() {
  const { supabase, ctx, error: orgError } = useOrg();

  const [issues, setIssues] = useState<Issue[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [filter, setFilter] = useState<Filter>("Unresolved");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [resolveNote, setResolveNote] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<NewIssue>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    const org = ctx.organizationId;
    const [i, a, m] = await Promise.all([
      supabase.from("governance_issues").select("*").eq("organization_id", org).order("created_at", { ascending: false }).limit(500),
      supabase.from("data_assets").select("id, name").eq("organization_id", org).order("name"),
      supabase.rpc("org_members_directory", { org }),
    ]);
    if (i.error) {
      setError(i.error.message);
    } else {
      setError("");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setIssues((i.data ?? []).map((r: any) => ({ ...r, severity: normSeverity(r.severity), status: normStatus(r.status) })));
    }
    setAssets((a.data ?? []) as Asset[]);
    setMembers((m.data ?? []) as Member[]);
    setLoading(false);
  }, [supabase, ctx]);

  useEffect(() => { void load(); }, [load]);

  const loadComments = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("issue_comments").select("id, user_id, body, kind, created_at")
      .eq("issue_id", id).order("created_at");
    setComments((data ?? []) as Comment[]);
  }, [supabase]);

  useEffect(() => {
    setComments([]); setCommentText(""); setResolveNote(""); setFormError("");
    if (selectedId) void loadComments(selectedId);
  }, [selectedId, loadComments]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const assignable: Member[] = members.length
    ? members
    : ctx ? [{ user_id: ctx.userId, email: "You", role: ctx.role }] : [];

  const who = useCallback((id: string | null, fallback = "Unassigned") => {
    if (!id) return fallback;
    if (id === ctx?.userId) return "You";
    return members.find((m) => m.user_id === id)?.email ?? id.slice(0, 8);
  }, [members, ctx]);

  const assetName = useCallback((id: string | null) => assets.find((a) => a.id === id)?.name ?? "\u2014", [assets]);

  const today = new Date().toISOString().slice(0, 10);

  const summary = useMemo(() => {
    const unresolved = issues.filter((i) => i.status !== "Resolved");
    const resolved = issues.filter((i) => i.status === "Resolved" && i.resolved_at);
    const avgDays = resolved.length
      ? resolved.reduce((s, i) => s + (new Date(i.resolved_at as string).getTime() - new Date(i.created_at).getTime()), 0) / resolved.length / DAY
      : null;
    return {
      open: issues.filter((i) => i.status === "Open").length,
      review: issues.filter((i) => i.status === "In Review").length,
      overdue: unresolved.filter((i) => i.due_date && i.due_date < today).length,
      resolvedCount: issues.length - unresolved.length,
      avgDays,
    };
  }, [issues, today]);

  const assetScores = useMemo(() => assets.map((a) => {
    const open = issues.filter((i) => i.asset_id === a.id && i.status !== "Resolved");
    const penalty = open.reduce((s, i) => s + WEIGHT[i.severity], 0);
    return { ...a, open: open.length, score: Math.max(0, 100 - penalty) };
  }).sort((x, y) => x.score - y.score), [assets, issues]);

  const overall = assetScores.length
    ? Math.round(assetScores.reduce((s, a) => s + a.score, 0) / assetScores.length)
    : 100;

  const countFor = (f: Filter) =>
    f === "All" ? issues.length
    : f === "Unresolved" ? issues.filter((i) => i.status !== "Resolved").length
    : issues.filter((i) => i.status === f).length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issues
      .filter((i) =>
        (filter === "All" || (filter === "Unresolved" ? i.status !== "Resolved" : i.status === filter)) &&
        (!mine || i.assigned_to === ctx?.userId) &&
        (!q || i.title.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q)))
      .sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity] || +new Date(b.created_at) - +new Date(a.created_at));
  }, [issues, filter, mine, search, ctx]);

  const selected = issues.find((i) => i.id === selectedId) ?? null;

  async function postSystem(issueId: string, body: string) {
    if (!ctx) return;
    await supabase.from("issue_comments").insert({
      organization_id: ctx.organizationId, issue_id: issueId, user_id: ctx.userId, kind: "system", body,
    });
  }

  async function createIssue() {
    if (!ctx) return;
    if (!form.title.trim()) { setFormError("A title is required."); return; }
    setBusy(true); setFormError("");
    const { error: e } = await supabase.from("governance_issues").insert({
      organization_id: ctx.organizationId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      severity: form.severity,
      status: "Open",
      issue_type: form.issue_type,
      asset_id: form.asset_id || null,
      assigned_to: form.assigned_to || null,
      due_date: form.due_date || slaDate(form.severity),
      created_by: ctx.userId,
    });
    setBusy(false);
    if (e) { setFormError(e.message); return; }
    setShowCreate(false); setForm(EMPTY); setNotice("Issue reported.");
    await load();
  }

  async function changeStatus(issue: Issue, next: Status) {
    if (!ctx) return;
    if (next === "Resolved" && !resolveNote.trim()) { setFormError("Add a resolution note before resolving."); return; }
    setBusy(true); setFormError("");
    const patch: Record<string, unknown> = { status: next };
    if (next === "Resolved") patch.resolution_note = resolveNote.trim();
    if (next === "Open") patch.resolution_note = null;
    const { error: e } = await supabase.from("governance_issues").update(patch).eq("id", issue.id);
    if (e) { setFormError(e.message); setBusy(false); return; }
    await postSystem(issue.id, `Status changed from ${issue.status} to ${next}` + (next === "Resolved" ? `. Resolution: ${resolveNote.trim()}` : ""));
    setResolveNote(""); setNotice(`Issue moved to ${next}.`);
    await Promise.all([load(), loadComments(issue.id)]);
    setBusy(false);
  }

  async function assign(issue: Issue, userId: string) {
    const value = userId || null;
    setFormError("");
    const { error: e } = await supabase.from("governance_issues").update({ assigned_to: value }).eq("id", issue.id);
    if (e) { setFormError(e.message); return; }
    await postSystem(issue.id, value ? `Assigned to ${who(value)}` : "Assignee removed");
    await Promise.all([load(), loadComments(issue.id)]);
  }

  async function addComment(issue: Issue) {
    if (!ctx || !commentText.trim()) return;
    const { error: e } = await supabase.from("issue_comments").insert({
      organization_id: ctx.organizationId, issue_id: issue.id, user_id: ctx.userId, kind: "comment", body: commentText.trim(),
    });
    if (e) { setFormError(e.message); return; }
    setCommentText("");
    await loadComments(issue.id);
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
        {stat("Open", summary.open, "Awaiting triage", summary.open ? "var(--red)" : undefined)}
        {stat("In review", summary.review, "Being investigated")}
        {stat("Overdue", summary.overdue, "Past their SLA date", summary.overdue ? "var(--red)" : undefined)}
        {stat("Quality score", `${overall}%`, assetScores.length ? "Average across datasets" : "Link issues to datasets to score them", scoreColor(overall))}
      </div>

      <div className="feature-content-grid">
        <section className="feature-panel feature-main-panel">
          <div className="feature-panel-heading">
            <div>
              <h2>Issue queue</h2>
              <p>Triage, assign and resolve data quality issues. Highest severity first.</p>
            </div>
            <ShieldCheck size={19} />
          </div>

          <div className="feature-toolbar">
            <div className="feature-search">
              <Search size={16} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search issues..." />
            </div>
            <button className="feature-primary-button" onClick={() => { setForm(EMPTY); setFormError(""); setShowCreate(true); }}>
              <Plus size={15} /> Report issue
            </button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 20px 14px" }}>
            {FILTERS.map((f) => (
              <button key={f} className={filter === f ? "feature-primary-button" : "feature-secondary-button"} onClick={() => setFilter(f)}>
                {f} ({countFor(f)})
              </button>
            ))}
            <button className={mine ? "feature-primary-button" : "feature-secondary-button"} onClick={() => setMine(!mine)}>
              Assigned to me
            </button>
          </div>

          <div className="feature-table-wrap">
            <table className="feature-table">
              <thead>
                <tr><th>Issue</th><th>Dataset</th><th>Severity</th><th>Status</th><th>Assignee</th><th>Due</th><th>Age</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="feature-no-results">Loading...</td></tr>
                ) : visible.length === 0 ? (
                  <tr><td colSpan={7} className="feature-no-results">
                    {issues.length === 0 ? "No issues reported yet." : "No issues match these filters."}
                  </td></tr>
                ) : visible.map((i) => {
                  const overdue = i.status !== "Resolved" && !!i.due_date && i.due_date < today;
                  return (
                    <tr key={i.id} onClick={() => setSelectedId(i.id)} style={{ cursor: "pointer" }}>
                      <td><strong>{i.title}</strong><br /><small style={{ color: "var(--muted)" }}>{i.issue_type ?? "Other"}</small></td>
                      <td>{assetName(i.asset_id)}</td>
                      <td><span className={`feature-status ${sevClass(i.severity)}`}>{i.severity}</span></td>
                      <td><span className={`feature-status ${statusClass(i.status)}`}>{i.status}</span></td>
                      <td>{who(i.assigned_to)}</td>
                      <td style={overdue ? { color: "var(--red)", fontWeight: 600 } : undefined}>{i.due_date ?? "\u2014"}{overdue ? " (overdue)" : ""}</td>
                      <td>{i.status === "Resolved" ? "Closed" : ageLabel(i.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="feature-side-column">
          <div className="feature-panel">
            <div className="feature-panel-heading">
              <div><h2>Quality by dataset</h2><p>100 minus open issue weight (High 25, Medium 10, Low 3)</p></div>
              <ShieldCheck size={17} />
            </div>
            {assetScores.length === 0 ? (
              <div className="feature-health-row"><span>Add datasets in the Data Catalogue to see scores.</span></div>
            ) : assetScores.slice(0, 8).map((a) => (
              <div className="feature-health-row" key={a.id} style={{ display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span>{a.name} <small style={{ color: "var(--muted)" }}>({a.open} open)</small></span>
                  <strong style={{ color: scoreColor(a.score) }}>{a.score}%</strong>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: "rgba(128,128,128,.2)" }}>
                  <div style={{ width: `${a.score}%`, height: "100%", borderRadius: 4, background: scoreColor(a.score) }} />
                </div>
              </div>
            ))}
          </div>

          <div className="feature-panel">
            <div className="feature-panel-heading">
              <div><h2>Resolution</h2><p>How quickly issues get closed</p></div>
              <Clock3 size={17} />
            </div>
            <div className="feature-health-row"><span>Resolved issues</span><strong>{loading ? "..." : summary.resolvedCount}</strong></div>
            <div className="feature-health-row">
              <span>Average time to resolve</span>
              <strong>{loading ? "..." : summary.avgDays === null ? "\u2014" : `${summary.avgDays.toFixed(1)} days`}</strong>
            </div>
          </div>
        </aside>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Report a data quality issue"
        description="It starts as Open. If you leave the due date empty, the SLA for its severity is applied.">
        <div><label>Title</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Duplicate customer records in loyalty list" /></div>
        <div><label>Description</label><textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div>
          <label>Severity</label>
          <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}>
            <option value="High">High (SLA {SLA_DAYS.High} days)</option>
            <option value="Medium">Medium (SLA {SLA_DAYS.Medium} days)</option>
            <option value="Low">Low (SLA {SLA_DAYS.Low} days)</option>
          </select>
        </div>
        <div>
          <label>Issue type</label>
          <select value={form.issue_type} onChange={(e) => setForm({ ...form, issue_type: e.target.value })}>
            {ISSUE_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label>Affected dataset</label>
          <select value={form.asset_id} onChange={(e) => setForm({ ...form, asset_id: e.target.value })}>
            <option value="">Not linked</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label>Assign to</label>
          <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
            <option value="">Unassigned</option>
            {assignable.map((m) => <option key={m.user_id} value={m.user_id}>{m.email}</option>)}
          </select>
        </div>
        <div><label>Due date (optional)</label><input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
        {formError && <p style={{ color: "var(--red)", fontSize: 13 }}>{formError}</p>}
        <div className="modal-footer">
          <button className="feature-secondary-button" onClick={() => setShowCreate(false)}>Cancel</button>
          <button className="feature-primary-button" disabled={busy} onClick={createIssue}>{busy ? "Saving..." : "Report issue"}</button>
        </div>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelectedId(null)}
        title={selected?.title ?? ""}
        description={selected ? `Reported ${new Date(selected.created_at).toLocaleDateString()} by ${who(selected.created_by, "unknown")}` : ""}>
        {selected && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className={`feature-status ${sevClass(selected.severity)}`}>{selected.severity}</span>
              <span className={`feature-status ${statusClass(selected.status)}`}>{selected.status}</span>
              <span className="feature-status neutral">{selected.issue_type ?? "Other"}</span>
            </div>

            {selected.description && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{selected.description}</p>}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><label>Dataset</label><div>{assetName(selected.asset_id)}</div></div>
              <div><label>Due</label><div>{selected.due_date ?? "\u2014"}</div></div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label>Assignee</label>
                <select value={selected.assigned_to ?? ""} onChange={(e) => void assign(selected, e.target.value)}>
                  <option value="">Unassigned</option>
                  {assignable.map((m) => <option key={m.user_id} value={m.user_id}>{m.email}</option>)}
                </select>
              </div>
            </div>

            {selected.status === "Resolved" ? (
              <div>
                <label>Resolution</label>
                <p style={{ margin: 0 }}>{selected.resolution_note || "No note recorded."}</p>
                {selected.resolved_at && <small style={{ color: "var(--muted)" }}>Resolved {new Date(selected.resolved_at).toLocaleString()}</small>}
              </div>
            ) : (
              <div>
                <label>Resolution note (required to resolve)</label>
                <textarea rows={2} value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} placeholder="What was fixed, and how?" />
              </div>
            )}

            {formError && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{formError}</p>}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {NEXT[selected.status].map((n) => (
                <button key={n} disabled={busy}
                  className={n === "Resolved" ? "feature-primary-button" : "feature-secondary-button"}
                  onClick={() => void changeStatus(selected, n)}>
                  {n === "Resolved" ? <><CheckCircle2 size={15} /> Resolve</> : selected.status === "Resolved" ? "Reopen" : `Move to ${n}`}
                </button>
              ))}
            </div>

            <div>
              <label>Activity</label>
              <div style={{ display: "grid", gap: 8, maxHeight: 200, overflowY: "auto", marginBottom: 10 }}>
                {comments.length === 0 && <small style={{ color: "var(--muted)" }}>No activity yet.</small>}
                {comments.map((c) => (
                  <div key={c.id} style={{ fontSize: 13, color: c.kind === "system" ? "var(--muted)" : "var(--text)", fontStyle: c.kind === "system" ? "italic" : "normal" }}>
                    <strong>{who(c.user_id, "Unknown")}</strong> &middot; {new Date(c.created_at).toLocaleString()}<br />{c.body}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ flex: 1 }} value={commentText} onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void addComment(selected); }} placeholder="Add a comment..." />
                <button className="feature-secondary-button" onClick={() => void addComment(selected)}>Post</button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {notice && (
        <div className="feature-toast">
          <CheckCircle2 size={16} /><span>{notice}</span>
          <button onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}
    </div>
  );
}