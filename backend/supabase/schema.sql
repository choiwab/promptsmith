-- Promptsmith default Supabase schema (matches SUPABASE_TABLE_PREFIX=promptsmith_)
-- Public mode: no login required, anonymous users can read and modify all repository data.

create table if not exists public.promptsmith_projects (
  project_id text primary key,
  name text not null,
  active_baseline_commit_id text null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.promptsmith_commits (
  commit_id text primary key,
  project_id text not null references public.promptsmith_projects(project_id) on delete cascade,
  prompt text not null,
  model text not null,
  seed text null,
  parent_commit_id text null,
  image_paths jsonb not null default '[]'::jsonb,
  status text not null check (status in ('success', 'failed')),
  error text null,
  created_at timestamptz not null
);

create index if not exists idx_promptsmith_commits_project_created
  on public.promptsmith_commits(project_id, created_at desc);

create table if not exists public.promptsmith_comparisons (
  report_id text primary key,
  project_id text not null references public.promptsmith_projects(project_id) on delete cascade,
  baseline_commit_id text not null,
  candidate_commit_id text not null,
  pixel_diff_score double precision not null,
  semantic_similarity double precision not null,
  vision_structural_score double precision not null,
  drift_score double precision not null,
  threshold double precision not null,
  verdict text not null check (verdict in ('pass', 'fail', 'inconclusive')),
  degraded boolean not null default false,
  explanation jsonb not null default '{}'::jsonb,
  artifacts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.promptsmith_projects to anon, authenticated;
grant select, insert, update, delete on table public.promptsmith_commits to anon, authenticated;
grant select, insert, update, delete on table public.promptsmith_comparisons to anon, authenticated;

alter table public.promptsmith_projects enable row level security;
alter table public.promptsmith_commits enable row level security;
alter table public.promptsmith_comparisons enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'promptsmith_projects'
      and policyname = 'Public full access promptsmith_projects'
  ) then
    create policy "Public full access promptsmith_projects"
    on public.promptsmith_projects
    for all
    to anon, authenticated
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'promptsmith_commits'
      and policyname = 'Public full access promptsmith_commits'
  ) then
    create policy "Public full access promptsmith_commits"
    on public.promptsmith_commits
    for all
    to anon, authenticated
    using (true)
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'promptsmith_comparisons'
      and policyname = 'Public full access promptsmith_comparisons'
  ) then
    create policy "Public full access promptsmith_comparisons"
    on public.promptsmith_comparisons
    for all
    to anon, authenticated
    using (true)
    with check (true);
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('promptsmith-images', 'promptsmith-images', true)
on conflict (id) do update
set public = excluded.public;

grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on table storage.objects to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read promptsmith images'
  ) then
    create policy "Public read promptsmith images"
    on storage.objects
    for select
    to anon, authenticated
    using (bucket_id = 'promptsmith-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public insert promptsmith images'
  ) then
    create policy "Public insert promptsmith images"
    on storage.objects
    for insert
    to anon, authenticated
    with check (bucket_id = 'promptsmith-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public update promptsmith images'
  ) then
    create policy "Public update promptsmith images"
    on storage.objects
    for update
    to anon, authenticated
    using (bucket_id = 'promptsmith-images')
    with check (bucket_id = 'promptsmith-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public delete promptsmith images'
  ) then
    create policy "Public delete promptsmith images"
    on storage.objects
    for delete
    to anon, authenticated
    using (bucket_id = 'promptsmith-images');
  end if;
end $$;
