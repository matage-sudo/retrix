"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, RefreshCw, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Modal from "@/components/modal";

const tabs = ["Products", "Customers", "Suppliers", "Employees", "Inventory", "Sales"];

export default function RetailData() {
  const supabase = useMemo(() => createClient(), []);
  const [activeTab, setActiveTab] = useState("Products");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data: member } = await supabase.from("organization_members").select("organization_id").eq("user_id", user.id).limit(1).maybeSingle();
      if (!member) return;

      let table = "";
      if (activeTab === "Products") table = "retail_products";
      else if (activeTab === "Customers") table = "retail_customers";
      else if (activeTab === "Employees") table = "retail_employees";
      
      if (!table) { setData([]); setLoading(false); return; }

      let query = supabase.from(table).select("*").eq("organization_id", member.organization_id);
      
      if (search) {
        query = query.ilike("name", `%${search}%`); // Simplistic search
      }

      const { data: records } = await query;
      setData(records || []);
    } finally {
      setLoading(false);
    }
  }, [supabase, search, activeTab]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleCreate() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: member } = await supabase.from("organization_members").select("organization_id").eq("user_id", user?.id).limit(1).maybeSingle();
      
      let table = "";
      let payload: any = { organization_id: member?.organization_id };

      if (activeTab === "Products") {
        table = "retail_products";
        payload = { ...payload, sku: formData.sku, name: formData.name, category: formData.category, price: parseFloat(formData.price) || 0, status: "Active" };
      } else if (activeTab === "Customers") {
        table = "retail_customers";
        payload = { ...payload, full_name: formData.full_name, email: formData.email, phone: formData.phone, loyalty_tier: formData.loyalty_tier || "Standard" };
      } else if (activeTab === "Employees") {
        table = "retail_employees";
        payload = { ...payload, full_name: formData.full_name, role: formData.role, email: formData.email, status: "Active" };
      }

      if (table) {
        const { error } = await supabase.from(table).insert(payload);
        if (error) throw error;
      }
      
      setShowCreate(false);
      setFormData({});
      void loadData();
    } catch (err) {
      alert("Failed to save record. Check console.");
    } finally {
      setSaving(false);
    }
  }

  function renderCreateForm() {
    if (activeTab === "Products") {
      return (
        <>
          <div><label>SKU</label><input value={formData.sku || ""} onChange={e => setFormData({...formData, sku: e.target.value})} placeholder="e.g. PRD-001" /></div>
          <div><label>Product Name</label><input value={formData.name || ""} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Wireless Mouse" /></div>
          <div><label>Category</label><input value={formData.category || ""} onChange={e => setFormData({...formData, category: e.target.value})} placeholder="e.g. Electronics" /></div>
          <div><label>Unit Price</label><input type="number" value={formData.price || ""} onChange={e => setFormData({...formData, price: e.target.value})} placeholder="0.00" /></div>
        </>
      );
    }
    if (activeTab === "Customers") {
      return (
        <>
          <div><label>Full Name</label><input value={formData.full_name || ""} onChange={e => setFormData({...formData, full_name: e.target.value})} placeholder="John Doe" /></div>
          <div><label>Email</label><input type="email" value={formData.email || ""} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="john@example.com" /></div>
          <div><label>Phone</label><input value={formData.phone || ""} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="+1 234 567" /></div>
          <div><label>Loyalty Tier</label>
            <select value={formData.loyalty_tier || ""} onChange={e => setFormData({...formData, loyalty_tier: e.target.value})}>
              <option value="Standard">Standard</option><option value="Silver">Silver</option><option value="Gold">Gold</option><option value="VIP">VIP</option>
            </select>
          </div>
        </>
      );
    }
    if (activeTab === "Employees") {
      return (
        <>
          <div><label>Full Name</label><input value={formData.full_name || ""} onChange={e => setFormData({...formData, full_name: e.target.value})} placeholder="Jane Smith" /></div>
          <div><label>Role</label><input value={formData.role || ""} onChange={e => setFormData({...formData, role: e.target.value})} placeholder="e.g. Store Manager" /></div>
          <div><label>Email</label><input type="email" value={formData.email || ""} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="jane@retrix.com" /></div>
        </>
      );
    }
    return <p style={{ fontSize: '12px', color: 'var(--muted)' }}>This tab does not support manual creation yet.</p>;
  }

  return (
    <div className="feature-workspace">
      <div className="feature-panel">
        <div className="feature-panel-heading">
          <div><h2>Retail records</h2><p>Showing up to 100 records per category</p></div>
          <button className="feature-secondary-button" onClick={loadData}><RefreshCw size={15} /> Refresh</button>
        </div>

        <div className="feature-toolbar" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0' }}>
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '8px 16px', background: 'transparent', border: 0, borderBottom: activeTab === tab ? '2px solid var(--blue)' : '2px solid transparent', color: activeTab === tab ? 'var(--text)' : 'var(--muted)', cursor: 'pointer', fontWeight: 600 }}>
              {tab}
            </button>
          ))}
        </div>

        <div className="feature-toolbar">
          <div className="feature-search">
            <Search size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${activeTab.toLowerCase()}...`} />
          </div>
          {(activeTab === "Products" || activeTab === "Customers" || activeTab === "Employees") && (
            <button className="feature-primary-button" onClick={() => setShowCreate(true)}>
              <Plus size={15} /> Create
            </button>
          )}
        </div>

        <div className="feature-table-wrap">
          <table className="feature-table">
            <thead>
              <tr>
                {activeTab === "Products" && <><th>SKU</th><th>NAME</th><th>CATEGORY</th><th>PRICE</th><th>STATUS</th></>}
                {activeTab === "Customers" && <><th>NAME</th><th>EMAIL</th><th>PHONE</th><th>TIER</th></>}
                {activeTab === "Employees" && <><th>NAME</th><th>ROLE</th><th>EMAIL</th><th>STATUS</th></>}
                {["Suppliers", "Inventory", "Sales"].includes(activeTab) && <th>INFORMATION</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="feature-no-results">Loading...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={5} className="feature-no-results">No records found. Click Create to add one.</td></tr>
              ) : (
                data.map((item) => (
                  <tr key={item.id}>
                    {activeTab === "Products" && <><td>{item.sku}</td><td>{item.name}</td><td>{item.category || "—"}</td><td>${item.price || 0}</td><td><span className="feature-status good">{item.status}</span></td></>}
                    {activeTab === "Customers" && <><td>{item.full_name}</td><td>{item.email}</td><td>{item.phone}</td><td>{item.loyalty_tier}</td></>}
                    {activeTab === "Employees" && <><td>{item.full_name}</td><td>{item.role}</td><td>{item.email}</td><td><span className="feature-status good">{item.status}</span></td></>}
                    {["Suppliers", "Inventory", "Sales"].includes(activeTab) && <td>Coming soon</td>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={`Create ${activeTab.slice(0, -1)}`} description={`Add a new ${activeTab.slice(0, -1).toLowerCase()} record.`}>
        {renderCreateForm()}
        <div className="modal-footer">
          <button className="feature-secondary-button" onClick={() => setShowCreate(false)}>Cancel</button>
          <button className="feature-primary-button" onClick={handleCreate}>{saving ? "Saving..." : "Save Record"}</button>
        </div>
      </Modal>
    </div>
  );
}
