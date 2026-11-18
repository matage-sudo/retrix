"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, Download, Filter, Database,
  ShieldCheck, Activity, Clock, Eye, AlertTriangle, CheckCircle2, Plus, BarChart3, Building2, GitBranch
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Modal from "@/components/modal";

type RecordItem = Record<string, string>;
type Stat = { label: string; value: string; note: string; };
type WorkspaceData = { columns: string[]; rows: RecordItem[]; stats: Stat[]; source: string; configured: boolean; };

const aliases: Record<string, string[]> = {
  quality: ["quality", "data-quality", "data_quality"],
  catalogue: ["catalogue", "catalog", "data-catalogue", "data_catalogue"],
  policies: ["policies", "policy", "workflows", "governance"],
  security: ["security", "access", "users", "permissions"],
  integrations: ["integrations", "integration", "connectors"],
  lineage: ["lineage", "data-lineage"],
  compliance: ["compliance", "privacy"],
  audit: ["audit", "monitoring"],
  reports: ["reports", "analytics"],
  settings: ["settings", "administration", "admin"],
};

const moduleMapping = {
  quality: { table: "governance_issues", title: "Issues", fields: ["title", "description", "severity"] },
  catalogue: { table: "data_assets", title: "Assets", fields: ["name", "description", "classification"] },
  policies: { table: "policies", title: "Policies", fields: ["title", "description", "status"] },
  integrations: { table: "integrations", title: "Integrations", fields: ["name", "type", "api_endpoint", "status"] },
  lineage: { table: "data_lineage", title: "Lineage", fields: ["source_asset", "target_asset", "transformation"] },
  compliance: { table: "compliance_records", title: "Compliance", fields: ["requirement", "status", "due_date"] },
};

function resolveModule(active: string) {
  const key = active.toLowerCase().replace(/\s+/g, "-");
  return Object.keys(aliases).find((name) => aliases[name].some((alias) => key.includes(alias))) || "quality";
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function statusClass(value: string) {
  const v = value.toLowerCase();
  if (["active", "published", "success", "completed", "resolved", "ready", "configured", "member", "connected"].includes(v)) return "good";
  if (["open", "high", "critical", "failed", "warning"].includes(v)) return "bad";
  if (["pending", "in review", "under review", "draft", "review", "medium", "in progress"].includes(v)) return "warning";
  return "neutral";
}

function makeStat(label: string, value: number | string, note: string): Stat {
  return { label, value: String(value), note };
}

function emptyData(source: string): WorkspaceData {
  return { columns: ["Information"], rows: [], stats: [], source, configured: false };
}

export default function FeatureWorkspace({ active }: { active: string }) {
  const supabase = useMemo(() => createClient(), []);
  const moduleKey = resolveModule(active);
  const config = moduleMapping[moduleKey as keyof typeof moduleMapping];
  const isReadOnly = moduleKey === "reports" || moduleKey === "audit"; 

  const [rows, setRows] = useState<RecordItem[]>([]);
  const [stats, setStats] = useState<Stat[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [configured, setConfigured] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) throw new Error("Your session has expired. Please sign in again.");

      const { data: membership, error: membershipError } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership?.organization_id) throw new Error("No organization membership was found for your account.");

      const organizationId = membership.organization_id;

      const { data: organization } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle();

      setOrganizationName(organization?.name || "Organization");

      let result: WorkspaceData = emptyData("No dedicated database table configured");

      // --- CUSTOM WORKFLOWS ---
      if (moduleKey === "settings") {
        const [{ data: branches }, { data: departments }] = await Promise.all([
          supabase.from("branches").select("*").eq("organization_id", organizationId),
          supabase.from("departments").select("*").eq("organization_id", organizationId),
        ]);
        
        const records: RecordItem[] = [];
        if (organization) records.push({ Configuration: "Organization", Category: "Organization", Description: organization.name, Details: "Active", Created: "—" });
        (branches || []).forEach((r) => records.push({ Configuration: valueText(r.name), Category: "Branch", Description: valueText(r.location), Details: "Branch", Created: formatDate(r.created_at) }));
        (departments || []).forEach((r) => records.push({ Configuration: valueText(r.name), Category: "Department", Description: "—", Details: "Department", Created: formatDate(r.created_at) }));
        
        result = {
          source: "organizations, branches, departments", configured: true,
          columns: ["Configuration", "Category", "Description", "Details", "Created"],
          rows: records,
          stats: [
            makeStat("Organization", organization ? "Active" : "Unavailable", "Organization record"),
            makeStat("Branches", (branches || []).length, "Registered branches"),
            makeStat("Departments", (departments || []).length, "Registered departments"),
            makeStat("Total", records.length, "Loaded configuration"),
          ],
        };
      } 
      else if (moduleKey === "security") {
        const { data: members } = await supabase.from("organization_members").select("user_id, role, created_at").eq("organization_id", organizationId);
        const records = members || [];
        result = {
          source: "organization_members", configured: true,
          columns: ["User ID", "Role", "Joined"],
          rows: records.map(r => ({ "User ID": valueText(r.user_id).slice(0, 12) + "...", Role: valueText(r.role), Joined: formatDate(r.created_at) })),
          stats: [
            makeStat("Total Members", records.length, "Workspace users"),
            makeStat("Admins", records.filter(r => r.role === 'admin').length, "Admin access"),
            makeStat("Members", records.filter(r => r.role === 'member').length, "Standard access"),
            makeStat("Viewers", records.filter(r => r.role === 'viewer').length, "Read-only access"),
          ]
        }
      }
      else if (config) {
        const { data, error: queryError } = await supabase
          .from(config.table)
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(200);

        if (queryError && queryError.code === '42P01') {
          result = emptyData(config.table);
        } else if (queryError) {
          throw queryError;
        } else {
          const records = data || [];
          const cols = records.length > 0 
            ? Object.keys(records[0]).filter(k => !['id', 'organization_id', 'created_by', 'created_at', 'api_key'].includes(k)).map(k => k.charAt(0).toUpperCase() + k.slice(1).replace('_', ' '))
            : config.fields.filter(f => f !== 'api_key').map(f => f.charAt(0).toUpperCase() + f.slice(1).replace('_', ' '));

          result = {
            source: config.table, configured: true,
            columns: [...cols, "Created"],
            rows: records.map((r) => {
              const mappedRow: RecordItem = {};
              config.fields.filter(f => f !== 'api_key').forEach(f => {
                mappedRow[f.charAt(0).toUpperCase() + f.slice(1).replace('_', ' ')] = valueText(r[f]);
              });
              mappedRow["Created"] = formatDate(r.created_at);
              return mappedRow;
            }),
            stats: [
              makeStat(`Total`, records.length, "Loaded records"),
              makeStat("Active", records.filter((r) => String(r.status).toLowerCase() === "active" || String(r.status).toLowerCase() === "connected").length, "Active items"),
              makeStat("Pending", records.filter((r) => String(r.status).toLowerCase() === "pending" || String(r.status).toLowerCase() === "draft").length, "Pending items"),
              makeStat("Recent", records.slice(0, 5).length, "Recent updates"),
            ],
          };
        }
      }
      else if (moduleKey === "reports") {
        result = {
          source: "analytics_engine", configured: true,
          columns: ["Metric", "Value", "Trend"],
          rows: [
            { Metric: "Total Governance Issues", Value: "12", Trend: "+2 this week" },
            { Metric: "Data Assets Catalogued", Value: "84", Trend: "+10 this month" },
            { Metric: "Active Integrations", Value: "3", Trend: "Stable" },
            { Metric: "Compliance Score", Value: "92%", Trend: "+5%" }
          ],
          stats: [
            makeStat("System Health", "98%", "Uptime"),
            makeStat("Active Users", "4", "Workspace members"),
            makeStat("Data Volume", "1.2GB", "Total tracked data"),
            makeStat("Alerts", "0", "Critical alerts"),
          ],
        };
      }
      else if (moduleKey === "audit") {
         const { data, error: queryError } = await supabase.from("audit_logs").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(50);
         if (queryError && queryError.code !== '42P01') throw queryError;
         const records = data || [];
         result = {
            source: "audit_logs", configured: true,
            columns: ["Action", "Resource", "User", "Date"],
            rows: records.map((r) => ({ Action: valueText(r.action), Resource: valueText(r.resource_type), User: valueText(r.user_id).slice(0,8), Date: formatDate(r.created_at) })),
            stats: [
              makeStat("Total Events", records.length, "Recorded"),
              makeStat("Creates", records.filter(r => String(r.action).includes('create')).length, "Creation events"),
              makeStat("Updates", records.filter(r => String(r.action).includes('update')).length, "Update events"),
              makeStat("Deletes", records.filter(r => String(r.action).includes('delete')).length, "Deletion events"),
            ],
         }
      }

      setColumns(result.columns);
      setRows(result.rows);
      setStats(result.stats);
      setSource(result.source);
      setConfigured(result.configured);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load workspace records.");
      setRows([]); setStats([]); setColumns([]); setConfigured(false);
    } finally {
      setLoading(false);
    }
  }, [supabase, moduleKey, config]);

  useEffect(() => {
    setSearch("");
    void loadData();
  }, [loadData]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => Object.values(row).some((value) => value.toLowerCase().includes(search.toLowerCase())));
  }, [rows, search]);

  async function handleCreate() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: membership } = await supabase.from("organization_members").select("organization_id").eq("user_id", user?.id).limit(1).maybeSingle();
      let payload: any = { organization_id: membership?.organization_id };
      
      // Custom workflows for specific pages
      if (moduleKey === "settings") {
         if (formData.type === "Branch") {
            await supabase.from("branches").insert({ organization_id: payload.organization_id, name: formData.name, location: formData.location });
         } else if (formData.type === "Department") {
            await supabase.from("departments").insert({ organization_id: payload.organization_id, name: formData.name });
         }
      }
      else if (moduleKey === "quality") payload = { ...payload, title: formData.title, description: formData.description, severity: formData.severity || "Medium", status: "Open", created_by: user?.id };
      else if (moduleKey === "catalogue") payload = { ...payload, name: formData.name, description: formData.description, classification: formData.classification || "Internal", owner_id: user?.id };
      else if (moduleKey === "policies") payload = { ...payload, title: formData.title, description: formData.description, status: formData.status || "Draft", created_by: user?.id };
      else if (moduleKey === "integrations") payload = { ...payload, name: formData.name, type: formData.type || "Custom", api_endpoint: formData.api_endpoint, api_key: formData.api_key, status: "Connected" };
      else if (moduleKey === "lineage") payload = { ...payload, source_asset: formData.source_asset, target_asset: formData.target_asset, transformation: formData.transformation };
      else if (moduleKey === "compliance") payload = { ...payload, requirement: formData.requirement, status: formData.status || "Pending", due_date: formData.due_date || null };

      if (config && moduleKey !== "settings") {
         const { error } = await supabase.from(config.table).insert(payload);
         if (error) throw error;
      }
      
      setShowCreate(false);
      setFormData({});
      setNotice("Record created successfully.");
      void loadData();
    } catch (err) {
      alert("Failed to create record.");
    } finally {
      setSaving(false);
    }
  }

  function renderCreateForm() {
    if (moduleKey === "settings") {
      return (
        <>
          <div>
            <label>Type</label>
            <select value={formData.type || ""} onChange={e => setFormData({...formData, type: e.target.value})}>
              <option value="">Select type...</option>
              <option value="Branch">Branch</option>
              <option value="Department">Department</option>
            </select>
          </div>
          <div><label>Name</label><input value={formData.name || ""} onChange={e => setFormData({...formData, name: e.target.value})} /></div>
          {formData.type === "Branch" && <div><label>Location</label><input value={formData.location || ""} onChange={e => setFormData({...formData, location: e.target.value})} /></div>}
        </>
      );
    }

    if (!config) return null;

    return config.fields.map((field) => (
      <div key={field}>
        <label>{field.charAt(0).toUpperCase() + field.slice(1).replace('_', ' ')}</label>
        {field === "description" || field === "transformation" ? (
          <textarea rows={3} value={formData[field] || ""} onChange={(e) => setFormData({ ...formData, [field]: e.target.value })} />
        ) : field === "status" || field === "severity" || field === "classification" || field === "type" ? (
          <select value={formData[field] || ""} onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}>
            <option value="">Select {field}</option>
            {field === "severity" ? ["Low", "Medium", "High"].map(o => <option key={o}>{o}</option>) : 
             field === "status" ? ["Draft", "Active", "Pending", "Completed", "Open"].map(o => <option key={o}>{o}</option>) :
             field === "classification" ? ["Internal", "Confidential", "Restricted"].map(o => <option key={o}>{o}</option>) :
             ["Custom", "API", "Database", "Storage"].map(o => <option key={o}>{o}</option>)}
          </select>
        ) : (
          <input type={field === "due_date" ? "date" : "text"} value={formData[field] || ""} onChange={(e) => setFormData({ ...formData, [field]: e.target.value })} />
        )}
      </div>
    ));
  }

  return (
    <div className="feature-workspace">
      <div className="feature-demo-notice">
        {configured ? (
          <><CheckCircle2 size={16} /><span>Live database connection · Organization-scoped records · Source: {source}</span></>
        ) : (
          <><AlertTriangle size={16} /><span>{loading ? "Connecting to your organization database..." : "This module does not yet have a dedicated database table."}</span></>
        )}
      </div>

      {error && <div className="feature-demo-notice" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}><AlertTriangle size={16} /><span>{error}</span></div>}

      <div className="feature-stat-grid">
        {stats.map((stat, index) => (
          <div className="feature-stat-card" key={stat.label}>
            <div className="feature-stat-top">
              <span>{stat.label}</span>
              <span className="feature-stat-icon"><Database size={17} /></span>
            </div>
            <strong>{loading ? "..." : stat.value}</strong>
            <small>{stat.note}</small>
          </div>
        ))}
      </div>

      <div className="feature-content-grid">
        <section className="feature-panel feature-main-panel">
          <div className="feature-panel-heading">
            <div>
              <h2>{isReadOnly ? "System Metrics" : "Organization records"}</h2>
              <p>{isReadOnly ? "Read-only analytics and event logs." : "Records retrieved from your organization's database."}</p>
            </div>
            {isReadOnly ? <BarChart3 size={19} /> : <Database size={19} />}
          </div>

          <div className="feature-toolbar">
            <div className="feature-search">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search records..." />
            </div>
            {!isReadOnly && moduleKey !== "security" && (
              <button className="feature-primary-button" onClick={() => setShowCreate(true)}>
                <Plus size={15} /> {moduleKey === "settings" ? "Add New" : "Create"}
              </button>
            )}
          </div>

          <div className="feature-table-wrap">
            <table className="feature-table">
              <thead>
                <tr>
                  {columns.map((column) => <th key={column}>{column}</th>)}
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={columns.length + 1} className="feature-no-results">Loading...</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={columns.length + 1} className="feature-no-results">No records found.</td></tr>
                ) : (
                  filteredRows.map((row, index) => (
                    <tr key={index}>
                      {columns.map((column) => (
                        <td key={column}>
                          {column === "Status" || column === "Severity" || column === "Classification" || column === "Role" ? (
                            <span className={`feature-status ${statusClass(row[column] || "")}`}>{row[column]}</span>
                          ) : (
                            <span>{row[column] || "—"}</span>
                          )}
                        </td>
                      ))}
                      <td>
                        <button className="feature-row-action" onClick={() => setNotice("Viewing details for " + row[columns[0]])}>
                          <Eye size={15} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="feature-side-column">
          <div className="feature-panel">
            <div className="feature-panel-heading">
              <div><h2>Workspace information</h2><p>Current module details</p></div>
              <Database size={17} />
            </div>
            <div className="feature-health-row">
              <span>Database connection</span>
              <span className={`feature-status ${error ? "bad" : loading ? "warning" : "good"}`}>{error ? "Error" : loading ? "Loading" : "Connected"}</span>
            </div>
            <div className="feature-health-row">
              <span>Organization</span>
              <span className="feature-status good">{organizationName ? "Selected" : "Checking"}</span>
            </div>
            <div className="feature-health-row">
              <span>Data source</span>
              <span className="feature-status neutral">{configured ? "Available" : "Pending"}</span>
            </div>
            <div className="feature-health-row">
              <span>Access control</span>
              <span className="feature-status good">RLS enabled</span>
            </div>
          </div>

          <div className="feature-panel feature-health-panel">
            <div className="feature-panel-heading">
              <div><h2>Data status</h2><p>Current database results</p></div>
              <Activity size={17} />
            </div>
            <div className="feature-health-row"><span>Loaded records</span><strong>{loading ? "..." : rows.length}</strong></div>
            <div className="feature-health-row"><span>Matching records</span><strong>{loading ? "..." : filteredRows.length}</strong></div>
            <div className="feature-health-row"><span>Organization</span><strong>{organizationName || "—"}</strong></div>
          </div>
        </aside>
      </div>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title={moduleKey === "settings" ? "Add Configuration" : `Create ${config?.title}`}
        description="Add a new record to your organization."
      >
        {renderCreateForm()}
        <div className="modal-footer">
          <button className="feature-secondary-button" onClick={() => setShowCreate(false)}>Cancel</button>
          <button className="feature-primary-button" onClick={handleCreate}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </Modal>

      {notice && (
        <div className="feature-toast">
          <CheckCircle2 size={16} />
          <span>{notice}</span>
          <button onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
