"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, LockKeyhole, Trash2 } from "lucide-react";
import { useOrg } from "@/lib/use-org";

type Member = { user_id: string; email: string; role: string; created_at: string };
type Req = { id: string; requester_id: string; requested_role: string; reason: string | null; status: string; created_at: string };
type Invite = { id: string; email: string; role: string; status: string; created_at: string };

const ROLES = ["viewer", "member", "admin"];
const ROLE_NOTE: Record<string, string> = {
  viewer: "Read-only access",
  member: "Can create and edit records",
  admin: "Manages members, approves policies",
};
const statusClass = (s: string) => (s === "Approved" || s === "Accepted" ? "good" : s === "Denied" || s === "Revoked" ? "bad" : "warning");
const isAdminRole = (r: string) => ["admin", "owner"].includes(r.toLowerCase());

export default function AccessControl() {
  const { supabase, ctx, error: orgError } = useOrg();
  const [members, setMembers] = useState<Member[]>([]);
  const [requests, setRequests] = useState<Req[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invite, setInvite] = useState({ email: "", role: "member" });
  const [reqForm, setReqForm] = useState({ role: "member", reason: "" });
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ctx) return;
    setLoading(true);
    const org = ctx.organizationId;
    const [m, r, i] = await Promise.all([
      supabase.rpc("org_members_directory", { org }),
      supabase.from("access_requests").select("id, requester_id, requested_role, reason, status, created_at").eq("organization_id", org).order("created_at", { ascending: false }).limit(100),
      supabase.from("member_invites").select("id, email, role, status, created_at").eq("organization_id", org).order("created_at", { ascending: false }).limit(100),
    ]);
    if (m.error) setError(m.error.message); else { setError(""); setMembers((m.data ?? []) as Member[]); }
    setRequests((r.data ?? []) as Req[]);
    setInvites((i.data ?? []) as Invite[]);
    setLoading(false);
  }, [supabase, ctx]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const emailOf = (id: string) => (id === ctx?.userId ? "You" : members.find((m) => m.user_id === id)?.email ?? id.slice(0, 8));
  const adminCount = members.filter((m) => isAdminRole(m.role)).length;
  const pendingReqs = requests.filter((r) => r.status === "Pending");
  const pendingInvites = invites.filter((i) => i.status === "Pending");

  async function changeRole(m: Member, role: string) {
    if (!ctx) return;
    setFormError("");
    if (isAdminRole(m.role) && !isAdminRole(role) && adminCount <= 1) { setFormError("The organization needs at least one administrator."); return; }
    const { error: e } = await supabase.from("organization_members").update({ role }).eq("organization_id", ctx.organizationId).eq("user_id", m.user_id);
    if (e) { setFormError(e.message); return; }
    setNotice(`Role changed to ${role}.`); await load();
  }

  async function removeMember(m: Member) {
    if (!ctx) return;
    if (isAdminRole(m.role) && adminCount <= 1) { setFormError("You cannot remove the only administrator."); return; }
    if (!window.confirm(`Remove ${m.email} from this organization? They will lose all access.`)) return;
    const { error: e } = await supabase.from("organization_members").delete().eq("organization_id", ctx.organizationId).eq("user_id", m.user_id);
    if (e) { setFormError(e.message); return; }
    setNotice("Member removed."); await load();
  }

  async function review(r: Req, approve: boolean) {
    const { error: e } = await supabase.rpc("review_access_request", { request_id: r.id, approve });
    if (e) { setFormError(e.message); return; }
    setNotice(approve ? "Request approved and role updated." : "Request denied."); await load();
  }

  async function sendInvite() {
    if (!ctx) return;
    const email = invite.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setFormError("Enter a valid email address."); return; }
    if (members.some((m) => m.email.toLowerCase() === email)) { setFormError("That person is already a member."); return; }
    setBusy(true); setFormError("");
    const { error: e } = await supabase.from("member_invites").insert({ organization_id: ctx.organizationId, email, role: invite.role, invited_by: ctx.userId });
    setBusy(false);
    if (e) { setFormError(e.code === "23505" ? "There is already a pending invite for that email." : e.message); return; }
    setInvite({ email: "", role: "member" }); setNotice("Invite saved. They join automatically when they sign in with that email."); await load();
  }

  async function revokeInvite(i: Invite) {
    const { error: e } = await supabase.from("member_invites").update({ status: "Revoked" }).eq("id", i.id);
    if (e) { setFormError(e.message); return; }
    await load();
  }

  async function requestAccess() {
    if (!ctx) return;
    if (!reqForm.reason.trim()) { setFormError("Say why you need this access."); return; }
    setBusy(true); setFormError("");
    const { error: e } = await supabase.from("access_requests").insert({
      organization_id: ctx.organizationId, requester_id: ctx.userId, requested_role: reqForm.role, reason: reqForm.reason.trim(), status: "Pending",
    });
    setBusy(false);
    if (e) { setFormError(e.message); return; }
    setReqForm({ role: "member", reason: "" }); setNotice("Request sent to the administrators."); await load();
  }

  const stat = (label: string, value: number, note: string, tone?: string) => (
    <div className="feature-stat-card" key={label}>
      <div className="feature-stat-top"><span>{label}</span></div>
      <strong style={tone ? { color: tone } : undefined}>{loading ? "..." : value}</strong>
      <small>{note}</small>
    </div>
  );

  const hasPendingOwn = pendingReqs.some((r) => r.requester_id === ctx?.userId);

  return (
    <div className="feature-workspace">
      {(error || orgError) && (
        <div className="feature-demo-notice" style={{ borderColor: "var(--red)", color: "var(--red)" }}>
          <AlertTriangle size={16} /><span>{error || orgError}</span>
        </div>
      )}
      <div className="feature-stat-grid">
        {stat("Members", members.length, "People with access")}
        {stat("Administrators", adminCount, "Can manage access")}
        {stat("Pending requests", pendingReqs.length, "Waiting for a decision", pendingReqs.length ? "var(--orange)" : undefined)}
        {stat("Pending invites", pendingInvites.length, "Not yet accepted")}
      </div>

      {formError && <div className="feature-demo-notice" style={{ borderColor: "var(--red)", color: "var(--red)" }}><AlertTriangle size={16} /><span>{formError}</span></div>}

      <section className="feature-panel feature-main-panel">
        <div className="feature-panel-heading">
          <div><h2>Members and roles</h2><p>{ctx?.isAdmin ? "Change roles or remove access. Every change is written to the audit log." : "Only administrators can change roles."}</p></div>
          <LockKeyhole size={19} />
        </div>
        <div className="feature-table-wrap">
          <table className="feature-table">
            <thead><tr><th>Member</th><th>Role</th><th>What it allows</th><th>Joined</th>{ctx?.isAdmin && <th>Action</th>}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="feature-no-results">Loading...</td></tr>
              : members.map((m) => {
                const self = m.user_id === ctx?.userId;
                const owner = m.role.toLowerCase() === "owner";
                return (
                  <tr key={m.user_id}>
                    <td><strong>{m.email}</strong>{self && <small style={{ color: "var(--muted)" }}> (you)</small>}</td>
                    <td>
                      {ctx?.isAdmin && !self && !owner ? (
                        <select value={m.role} onChange={(e) => void changeRole(m, e.target.value)}>
                          {ROLES.map((r) => <option key={r}>{r}</option>)}
                        </select>
                      ) : <span className={`feature-status ${isAdminRole(m.role) ? "good" : "neutral"}`}>{m.role}</span>}
                    </td>
                    <td>{owner ? "Full control" : ROLE_NOTE[m.role] ?? "\u2014"}</td>
                    <td>{new Date(m.created_at).toLocaleDateString()}</td>
                    {ctx?.isAdmin && (
                      <td>{!self && !owner && <button className="feature-row-action" title="Remove member" onClick={() => void removeMember(m)}><Trash2 size={14} /></button>}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {ctx?.isAdmin ? (
        <div className="feature-content-grid">
          <section className="feature-panel feature-main-panel">
            <div className="feature-panel-heading"><div><h2>Access requests</h2><p>Approving updates the member's role immediately.</p></div></div>
            <div className="feature-table-wrap">
              <table className="feature-table">
                <thead><tr><th>Requester</th><th>Wants</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>
                  {requests.length === 0 ? <tr><td colSpan={5} className="feature-no-results">No access requests.</td></tr>
                  : requests.map((r) => (
                    <tr key={r.id}>
                      <td>{emailOf(r.requester_id)}</td><td>{r.requested_role}</td><td>{r.reason ?? "\u2014"}</td>
                      <td><span className={`feature-status ${statusClass(r.status)}`}>{r.status}</span></td>
                      <td>{r.status === "Pending" && (<div style={{ display: "flex", gap: 6 }}>
                        <button className="feature-primary-button" onClick={() => void review(r, true)}>Approve</button>
                        <button className="feature-secondary-button" onClick={() => void review(r, false)}>Deny</button>
                      </div>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="feature-side-column">
            <div className="feature-panel">
              <div className="feature-panel-heading"><div><h2>Invite someone</h2><p>They join with this role when they sign in with the same email.</p></div></div>
              <div style={{ padding: "0 20px 16px", display: "grid", gap: 10 }}>
                <input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="name@company.com" />
                <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
                <button className="feature-primary-button" disabled={busy} onClick={sendInvite}>{busy ? "Saving..." : "Create invite"}</button>
              </div>
              {invites.map((i) => (
                <div className="feature-health-row" key={i.id}>
                  <span>{i.email} <small style={{ color: "var(--muted)" }}>({i.role})</small></span>
                  {i.status === "Pending"
                    ? <button className="feature-secondary-button" onClick={() => void revokeInvite(i)}>Revoke</button>
                    : <span className={`feature-status ${statusClass(i.status)}`}>{i.status}</span>}
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : (
        <section className="feature-panel">
          <div className="feature-panel-heading"><div><h2>Request more access</h2><p>You are a {ctx?.role}. An administrator reviews your request.</p></div></div>
          <div style={{ padding: "0 20px 16px", display: "grid", gap: 10, maxWidth: 520 }}>
            {hasPendingOwn ? <p style={{ margin: 0 }}>You already have a request waiting for review.</p> : (<>
              <select value={reqForm.role} onChange={(e) => setReqForm({ ...reqForm, role: e.target.value })}>{ROLES.filter((r) => r !== ctx?.role).map((r) => <option key={r}>{r}</option>)}</select>
              <textarea rows={3} value={reqForm.reason} onChange={(e) => setReqForm({ ...reqForm, reason: e.target.value })} placeholder="Why do you need this access?" />
              <button className="feature-primary-button" disabled={busy} onClick={requestAccess}>Send request</button>
            </>)}
            {requests.filter((r) => r.requester_id === ctx?.userId).map((r) => (
              <div key={r.id} style={{ fontSize: 13 }}>{r.requested_role} &middot; <span className={`feature-status ${statusClass(r.status)}`}>{r.status}</span> &middot; {new Date(r.created_at).toLocaleDateString()}</div>
            ))}
          </div>
        </section>
      )}

      {notice && (<div className="feature-toast"><CheckCircle2 size={16} /><span>{notice}</span><button onClick={() => setNotice("")}>Dismiss</button></div>)}
    </div>
  );
}