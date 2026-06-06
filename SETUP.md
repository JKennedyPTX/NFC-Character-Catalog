# NFC Catalog — Backend Setup (Supabase + GitHub Pages)

This guide turns the catalog into a private, backed-up app:

- Your catalog lives in a Supabase database (not just one browser).
- You log in to manage it.
- The **only** thing the public can reach is a single entry via its exact NFC/QR link. Nobody can browse or list your catalog.

Everything below is copy-paste. You do **not** need to write any code.

---

## 1. Create a Supabase project

1. Go to https://supabase.com and sign up (free).
2. Click **New project**. Give it a name, set a strong database password (save it somewhere), pick a region near you, and create it. Wait ~2 minutes for it to finish provisioning.

## 2. Create the database tables and security rules

1. In your project, open **SQL Editor** (left sidebar) → **New query**.
2. Paste the entire block below and click **Run**.

```sql
-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- Entries: the id IS the unguessable token used in NFC/QR links
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null,
  code text default '',
  collection text default '',
  emoji text default '🔖',
  tagline text default '',
  description text default '',
  images jsonb default '[]'::jsonb,
  theme jsonb default '{"accent":"#4a7c59","tintHue":120,"pattern":"plain"}'::jsonb,
  inherit_theme boolean default false,
  links jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Per-collection default themes
create table if not exists public.collection_themes (
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null,
  theme jsonb not null,
  primary key (owner, name)
);

-- Lock both tables down
alter table public.entries enable row level security;
alter table public.collection_themes enable row level security;

-- Logged-in owners can do anything with THEIR OWN rows; nobody else can read them
drop policy if exists owner_all_entries on public.entries;
create policy owner_all_entries on public.entries
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists owner_all_cthemes on public.collection_themes;
create policy owner_all_cthemes on public.collection_themes
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- Public read of ONE entry by exact id, with its theme resolved.
-- There is no way to list entries this way — you must already know the id.
create or replace function public.get_public_entry(entry_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select to_jsonb(e) - 'owner'
         || jsonb_build_object(
              'resolvedTheme',
              case when e.inherit_theme then coalesce(ct.theme, e.theme) else e.theme end
            )
  from public.entries e
  left join public.collection_themes ct
    on ct.owner = e.owner and ct.name = e.collection
  where e.id = entry_id;
$$;

revoke all on function public.get_public_entry(uuid) from public;
grant execute on function public.get_public_entry(uuid) to anon, authenticated;
```

## 3. Create the image storage bucket

Run this as a second query:

```sql
insert into storage.buckets (id, name, public)
values ('entry-images', 'entry-images', true)
on conflict (id) do nothing;

-- Anyone can read an image if they have its (unguessable) URL
drop policy if exists public_read_images on storage.objects;
create policy public_read_images on storage.objects
  for select using (bucket_id = 'entry-images');

-- Only logged-in users can upload / change / delete images
drop policy if exists auth_insert_images on storage.objects;
create policy auth_insert_images on storage.objects
  for insert to authenticated with check (bucket_id = 'entry-images');

drop policy if exists auth_update_images on storage.objects;
create policy auth_update_images on storage.objects
  for update to authenticated using (bucket_id = 'entry-images');

drop policy if exists auth_delete_images on storage.objects;
create policy auth_delete_images on storage.objects
  for delete to authenticated using (bucket_id = 'entry-images');
```

## 4. Create your admin login

1. Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Enter your email and a password. **Tick "Auto Confirm User"** so you can log in immediately.
3. This email + password is what you'll use to log into the catalog.

(Optional: under **Authentication → Providers → Email**, you can turn off "Allow new users to sign up" so only users you create can ever log in.)

## 5. Paste your credentials into the app

1. Open `src/config.js`.
2. From Supabase: **Project Settings → API**. Copy:
   - **Project URL** → paste as `SUPABASE_URL`
   - **Project API keys → `anon` / `public`** → paste as `SUPABASE_ANON_KEY`
3. Save. (The anon key is meant to be public — it's safe to commit. Your data is protected by the rules from steps 2–3, not by hiding this key.)

## 6. Run locally

```
npm install
npm run dev
```

Open the printed URL, log in with the user from step 4, and add an entry. Each entry's detail page shows its NFC/QR link — that link is what you program onto a tag or share.

## 7. Move your existing catalog over (optional)

If you already built a catalog in the old localStorage version: open that old version, **Settings → Export JSON**. Then in the new version, log in and use **Import JSON** — it pushes those entries into the database.

## 8. Deploy to GitHub Pages (stable public URL)

1. Create a GitHub repo and push this project to it.
2. In the repo: **Settings → Pages → Build and deployment → Source = GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) builds and deploys automatically on every push to `main`.
4. Your site will be at `https://<your-username>.github.io/<repo-name>/`.
5. In the app's **Settings → Base URL**, set it to that URL so NFC/QR links point at the live site.

That's it. Anyone scanning a tag opens exactly one entry; managing the catalog requires your login.

---

### Security notes / honest caveats

- **Entries** are truly private: anonymous visitors can only fetch a single entry by its exact UUID and cannot list or guess others.
- **Images** sit in a public-read bucket with random filenames. They're only handed out alongside their entry, but they are not encrypted — anyone with the direct image URL could view that image. For most catalogs this is fine; switching to signed (expiring) URLs is a future upgrade.
- The `anon` key being public is expected and safe by Supabase's design.
