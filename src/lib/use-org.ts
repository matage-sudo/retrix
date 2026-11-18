"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type OrgContext = {
  userId: string;
  organizationId: string;
  role: string;
  isAdmin: boolean;
};

export function useOrg() {
  const supabase = useMemo(() => createClient(), []);
  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        if (alive) setError("Your session has expired. Please sign in again.");
        return;
      }
      const { data: member, error: memberError } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (memberError || !member) {
        if (alive) setError(memberError?.message ?? "No organization membership was found for your account.");
        return;
      }
      if (alive) {
        setCtx({
          userId: user.id,
          organizationId: member.organization_id,
          role: member.role,
          isAdmin: ["admin", "owner"].includes(String(member.role).toLowerCase()),
        });
      }
    })();
    return () => { alive = false; };
  }, [supabase]);

  return { supabase, ctx, error };
}