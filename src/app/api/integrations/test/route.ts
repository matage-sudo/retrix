import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { lookup } from "node:dns/promises";
import net from "node:net";


function privateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
}

async function probe(endpoint: string, apiKey: string | null): Promise<{ ok: boolean; message: string }> {
  let u: URL;
  try { u = new URL(endpoint); } catch { return { ok: false, message: "Endpoint is not a valid URL" }; }
  if (u.protocol !== "https:") return { ok: false, message: "Only https endpoints can be tested" };
  if (u.hostname === "localhost") return { ok: false, message: "Private addresses are blocked" };

  let addrs: { address: string }[] = [];
  try { addrs = await lookup(u.hostname, { all: true }); } catch { /* handled below */ }
  if (!addrs.length) return { ok: false, message: "Host could not be resolved" };
  if (addrs.some((a) => privateIp(a.address))) return { ok: false, message: "Endpoint resolves to a private address, which is blocked" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(u, {
      method: "GET", redirect: "manual", signal: ctrl.signal,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (res.status === 401 || res.status === 403) return { ok: false, message: `Authentication rejected (HTTP ${res.status})` };
    if (res.status >= 400) return { ok: false, message: `Endpoint answered HTTP ${res.status}` };
    return { ok: true, message: `HTTP ${res.status}` };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, message: aborted ? "Timed out after 8 seconds" : "Connection failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ ok: false, message: "Not signed in" }, { status: 401 });

  const { integrationId } = await req.json().catch(() => ({}));
  if (!integrationId) return NextResponse.json({ ok: false, message: "Missing integration id" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return NextResponse.json({ ok: false, message: "Server is missing Supabase settings" }, { status: 500 });

  // Acts as the signed-in user, so RLS still decides what they can read and change.
  const sb = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });

  const { data: integ, error } = await sb.from("integrations").select("id, organization_id, api_endpoint, api_key").eq("id", integrationId).single();
  if (error || !integ) return NextResponse.json({ ok: false, message: "Integration not found" }, { status: 404 });
  if (!integ.api_endpoint) return NextResponse.json({ ok: false, message: "No endpoint configured" }, { status: 400 });

  const started = Date.now();
  const result = await probe(integ.api_endpoint, integ.api_key);
  const durationMs = Date.now() - started;

  await sb.from("sync_logs").insert({
    organization_id: integ.organization_id, integration_id: integ.id,
    status: result.ok ? "success" : "failed", message: result.message, records_synced: 0, duration_ms: durationMs,
  });
  await sb.from("integrations").update(
    result.ok
      ? { status: "Connected", last_synced_at: new Date().toISOString(), last_error: null }
      : { status: "Error", last_error: result.message }
  ).eq("id", integ.id);

  return NextResponse.json({ ok: result.ok, message: result.message, durationMs });
}
