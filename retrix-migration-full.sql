-- 0. FIX: replace restrictive status CHECK constraints with the workflow values
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname as cname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in ('public.governance_issues'::regclass, 'public.policies'::regclass,
                         'public.compliance_records'::regclass, 'public.integrations'::regclass)
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.cname);
  end loop;
end $$;

update public.governance_issues
   set status = case lower(replace(status, '_', ' '))
     when 'in review' then 'In Review' when 'in progress' then 'In Review'
     when 'resolved' then 'Resolved' when 'closed' then 'Resolved'
     else 'Open' end
 where status not in ('Open', 'In Review', 'Resolved');
alter table public.governance_issues add constraint governance_issues_status_check
  check (status in ('Open', 'In Review', 'Resolved'));

update public.policies
   set status = case lower(coalesce(status, ''))
     when 'published' then 'Published' when 'active' then 'Published'
     when 'in review' then 'In Review' when 'review' then 'In Review' when 'pending' then 'In Review'
     when 'retired' then 'Retired' when 'archived' then 'Retired'
     else 'Draft' end
 where status is null or status not in ('Draft', 'In Review', 'Published', 'Retired');
alter table public.policies alter column status set default 'Draft';
alter table public.policies add constraint policies_status_check
  check (status in ('Draft', 'In Review', 'Published', 'Retired'));

update public.compliance_records
   set status = case lower(replace(coalesce(status, ''), '_', ' '))
     when 'compliant' then 'Compliant' when 'completed' then 'Compliant'
     when 'non-compliant' then 'Non-Compliant' when 'non compliant' then 'Non-Compliant' when 'failed' then 'Non-Compliant'
     when 'in progress' then 'In Progress' when 'active' then 'In Progress'
     else 'Pending' end
 where status is null or status not in ('Pending', 'In Progress', 'Compliant', 'Non-Compliant');
alter table public.compliance_records alter column status set default 'Pending';
alter table public.compliance_records add constraint compliance_records_status_check
  check (status in ('Pending', 'In Progress', 'Compliant', 'Non-Compliant'));

update public.integrations
   set status = case lower(status)
     when 'connected' then 'Connected' when 'active' then 'Connected'
     when 'error' then 'Error' when 'failed' then 'Error'
     when 'paused' then 'Paused' when 'disabled' then 'Paused'
     else 'Pending' end
 where status not in ('Connected', 'Pending', 'Error', 'Paused');
alter table public.integrations add constraint integrations_status_check
  check (status in ('Connected', 'Pending', 'Error', 'Paused'));

-- Retrix workflow migration. Idempotent: safe to run more than once.
-- Relies on existing is_org_member(uuid) and is_org_admin(uuid).

-- 1. DATA QUALITY
alter table public.governance_issues
  add column if not exists assigned_to      uuid references auth.users(id) on delete set null,
  add column if not exists asset_id         uuid references public.data_assets(id) on delete set null,
  add column if not exists issue_type       text not null default 'Other',
  add column if not exists due_date         date,
  add column if not exists resolved_at      timestamptz,
  add column if not exists resolution_note  text;

create or replace function public.issue_lifecycle() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'Resolved' and old.status is distinct from 'Resolved' then
    new.resolved_at := now();
  elsif new.status <> 'Resolved' then
    new.resolved_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_issue_lifecycle on public.governance_issues;
create trigger trg_issue_lifecycle before update on public.governance_issues
  for each row execute function public.issue_lifecycle();

create table if not exists public.issue_comments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  issue_id        uuid not null references public.governance_issues(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  kind            text not null default 'comment',
  body            text not null,
  created_at      timestamptz not null default now()
);
create index if not exists issue_comments_issue_idx on public.issue_comments(issue_id, created_at);
alter table public.issue_comments enable row level security;

drop policy if exists issue_comments_read   on public.issue_comments;
drop policy if exists issue_comments_insert on public.issue_comments;
create policy issue_comments_read   on public.issue_comments for select
  using (public.is_org_member(organization_id));
create policy issue_comments_insert on public.issue_comments for insert
  with check (public.is_org_member(organization_id) and user_id = auth.uid());

-- 2. POLICIES
alter table public.policies
  add column if not exists submitted_at   timestamptz,
  add column if not exists approver_id    uuid references auth.users(id) on delete set null,
  add column if not exists approved_at    timestamptz,
  add column if not exists review_date    date,
  add column if not exists rejection_note text;

create table if not exists public.policy_approvals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_id       uuid not null references public.policies(id) on delete cascade,
  action          text not null,
  actor_id        uuid references auth.users(id) on delete set null,
  comment         text,
  created_at      timestamptz not null default now()
);
create index if not exists policy_approvals_policy_idx on public.policy_approvals(policy_id, created_at);
alter table public.policy_approvals enable row level security;

drop policy if exists policy_approvals_read   on public.policy_approvals;
drop policy if exists policy_approvals_insert on public.policy_approvals;
create policy policy_approvals_read   on public.policy_approvals for select
  using (public.is_org_member(organization_id));
create policy policy_approvals_insert on public.policy_approvals for insert
  with check (public.is_org_member(organization_id) and actor_id = auth.uid());

create or replace function public.policy_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status in ('Published', 'Retired') and not public.is_org_admin(new.organization_id) then
      raise exception 'Only administrators can move a policy to %', new.status;
    end if;
    if new.status = 'In Review' then
      new.submitted_at := now();
      new.rejection_note := null;
    elsif new.status = 'Published' then
      new.approver_id := auth.uid();
      new.approved_at := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_policy_guard on public.policies;
create trigger trg_policy_guard before update on public.policies
  for each row execute function public.policy_guard();

-- 3. ACCESS CONTROL
create table if not exists public.access_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requester_id    uuid not null references auth.users(id) on delete cascade,
  requested_role  text not null check (requested_role in ('viewer','member','admin')),
  reason          text,
  status          text not null default 'Pending' check (status in ('Pending','Approved','Denied')),
  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.access_requests enable row level security;

drop policy if exists access_requests_read   on public.access_requests;
drop policy if exists access_requests_insert on public.access_requests;
create policy access_requests_read on public.access_requests for select
  using (public.is_org_member(organization_id)
         and (requester_id = auth.uid() or public.is_org_admin(organization_id)));
create policy access_requests_insert on public.access_requests for insert
  with check (requester_id = auth.uid() and public.is_org_member(organization_id) and status = 'Pending');

create table if not exists public.member_invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null,
  role            text not null check (role in ('viewer','member','admin')),
  status          text not null default 'Pending' check (status in ('Pending','Accepted','Revoked')),
  invited_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz
);
create unique index if not exists member_invites_pending_uq
  on public.member_invites(organization_id, lower(email)) where status = 'Pending';
alter table public.member_invites enable row level security;

drop policy if exists member_invites_admin on public.member_invites;
create policy member_invites_admin on public.member_invites for all
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create or replace function public.org_members_directory(org uuid)
returns table(user_id uuid, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = org and public.is_org_member(org)
  order by m.created_at;
$$;

create or replace function public.review_access_request(request_id uuid, approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.access_requests;
begin
  select * into r from public.access_requests where id = request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not public.is_org_admin(r.organization_id) then raise exception 'Administrators only'; end if;
  if r.status <> 'Pending' then raise exception 'Request was already reviewed'; end if;

  update public.access_requests
     set status = case when approve then 'Approved' else 'Denied' end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = request_id;

  if approve then
    update public.organization_members
       set role = r.requested_role
     where organization_id = r.organization_id and user_id = r.requester_id;
  end if;
end $$;

create or replace function public.accept_my_invites() returns int
language plpgsql security definer set search_path = public, auth as $$
declare my_email text; n int;
begin
  select email into my_email from auth.users where id = auth.uid();
  if my_email is null then return 0; end if;

  with todo as (
    select * from public.member_invites
    where status = 'Pending' and lower(email) = lower(my_email)
  ), ins as (
    insert into public.organization_members(organization_id, user_id, role)
    select t.organization_id, auth.uid(), t.role from todo t
    where not exists (select 1 from public.organization_members m
                      where m.organization_id = t.organization_id and m.user_id = auth.uid())
    returning 1
  )
  update public.member_invites i
     set status = 'Accepted', accepted_at = now()
    from todo t where i.id = t.id;

  get diagnostics n = row_count;
  return n;
end $$;

-- 4. INTEGRATIONS
alter table public.integrations
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_error     text;

create table if not exists public.sync_logs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  integration_id   uuid not null references public.integrations(id) on delete cascade,
  status           text not null,
  message          text,
  records_synced   int not null default 0,
  duration_ms      int,
  created_at       timestamptz not null default now()
);
create index if not exists sync_logs_integration_idx on public.sync_logs(integration_id, created_at desc);
alter table public.sync_logs enable row level security;

drop policy if exists sync_logs_read   on public.sync_logs;
drop policy if exists sync_logs_insert on public.sync_logs;
create policy sync_logs_read   on public.sync_logs for select using (public.is_org_member(organization_id));
create policy sync_logs_insert on public.sync_logs for insert with check (public.is_org_member(organization_id));

-- 5. COMPLIANCE
alter table public.compliance_records
  add column if not exists framework    text,
  add column if not exists notes        text,
  add column if not exists completed_at timestamptz;

create or replace function public.compliance_lifecycle() returns trigger
language plpgsql as $$
begin
  if new.status = 'Compliant' and old.status is distinct from 'Compliant' then
    new.completed_at := now();
  elsif new.status is distinct from 'Compliant' then
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_compliance_lifecycle on public.compliance_records;
create trigger trg_compliance_lifecycle before update on public.compliance_records
  for each row execute function public.compliance_lifecycle();

create table if not exists public.compliance_evidence (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  compliance_id   uuid not null references public.compliance_records(id) on delete cascade,
  title           text not null,
  url             text,
  added_by        uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.compliance_evidence enable row level security;

drop policy if exists compliance_evidence_read   on public.compliance_evidence;
drop policy if exists compliance_evidence_insert on public.compliance_evidence;
drop policy if exists compliance_evidence_delete on public.compliance_evidence;
create policy compliance_evidence_read   on public.compliance_evidence for select using (public.is_org_member(organization_id));
create policy compliance_evidence_insert on public.compliance_evidence for insert with check (public.is_org_member(organization_id) and added_by = auth.uid());
create policy compliance_evidence_delete on public.compliance_evidence for delete using (public.is_org_admin(organization_id));

-- 6. LINEAGE
alter table public.data_lineage
  add column if not exists source_asset_id uuid references public.data_assets(id) on delete set null,
  add column if not exists target_asset_id uuid references public.data_assets(id) on delete set null;

-- 7. REPORTS
create or replace function public.governance_report(org uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_org_member(org) then raise exception 'Not a member of this organization'; end if;
  return jsonb_build_object(
    'issues_by_status', coalesce((select jsonb_object_agg(s, c) from (
        select coalesce(status,'Open') s, count(*) c from public.governance_issues
        where organization_id = org group by 1) x), '{}'::jsonb),
    'open_issues_by_severity', coalesce((select jsonb_object_agg(s, c) from (
        select coalesce(severity,'Medium') s, count(*) c from public.governance_issues
        where organization_id = org and status <> 'Resolved' group by 1) x), '{}'::jsonb),
    'avg_resolution_days', (select round(avg(extract(epoch from (resolved_at - created_at)) / 86400)::numeric, 1)
        from public.governance_issues where organization_id = org and resolved_at is not null),
    'overdue_issues', (select count(*) from public.governance_issues
        where organization_id = org and status <> 'Resolved' and due_date < current_date),
    'assets_by_classification', coalesce((select jsonb_object_agg(s, c) from (
        select coalesce(classification,'Internal') s, count(*) c from public.data_assets
        where organization_id = org group by 1) x), '{}'::jsonb),
    'policies_by_status', coalesce((select jsonb_object_agg(s, c) from (
        select coalesce(status,'Draft') s, count(*) c from public.policies
        where organization_id = org group by 1) x), '{}'::jsonb),
    'compliance_by_status', coalesce((select jsonb_object_agg(s, c) from (
        select coalesce(status,'Pending') s, count(*) c from public.compliance_records
        where organization_id = org group by 1) x), '{}'::jsonb),
    'overdue_compliance', (select count(*) from public.compliance_records
        where organization_id = org and coalesce(status,'Pending') <> 'Compliant' and due_date < current_date),
    'audit_events_30d', (select count(*) from public.audit_logs
        where organization_id = org and created_at > now() - interval '30 days'),
    'members', (select count(*) from public.organization_members where organization_id = org)
  );
end $$;

-- 8. AUDIT TRIGGERS
create or replace function public.log_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb; old_rec jsonb; org uuid; diff jsonb := '{}'::jsonb; k text; v jsonb; act text;
begin
  if tg_op = 'DELETE' then rec := to_jsonb(old) - 'api_key'; else rec := to_jsonb(new) - 'api_key'; end if;
  org := (rec->>'organization_id')::uuid;

  if org is not null then
    act := case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end;

    if tg_op = 'UPDATE' then
      old_rec := to_jsonb(old) - 'api_key';
      for k, v in select * from jsonb_each(rec) loop
        if k <> 'updated_at' and (old_rec -> k) is distinct from v then
          diff := diff || jsonb_build_object(k, jsonb_build_object('from', old_rec -> k, 'to', v));
        end if;
      end loop;
    end if;

    if not (tg_op = 'UPDATE' and diff = '{}'::jsonb) then
      insert into public.audit_logs(organization_id, user_id, action, resource_type, resource_id, details)
      values (org, auth.uid(), act, tg_table_name, (rec->>'id')::uuid,
              case when tg_op = 'UPDATE' then diff::text else rec::text end);
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'governance_issues','data_assets','data_lineage','policies','policy_approvals',
    'integrations','compliance_records','compliance_evidence','organization_members',
    'access_requests','member_invites','branches','departments'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I
                      for each row execute function public.log_audit()', t);
    end if;
  end loop;
end $$;

-- 9. FUNCTION PERMISSIONS
revoke all on function public.org_members_directory(uuid)          from public, anon;
revoke all on function public.review_access_request(uuid, boolean) from public, anon;
revoke all on function public.accept_my_invites()                  from public, anon;
revoke all on function public.governance_report(uuid)              from public, anon;
grant execute on function public.org_members_directory(uuid)          to authenticated;
grant execute on function public.review_access_request(uuid, boolean) to authenticated;
grant execute on function public.accept_my_invites()                  to authenticated;
grant execute on function public.governance_report(uuid)              to authenticated;
notify pgrst, 'reload schema';
