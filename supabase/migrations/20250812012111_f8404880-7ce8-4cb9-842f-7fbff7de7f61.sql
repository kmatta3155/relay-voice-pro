-- Add site admin flag to profiles if missing
alter table public.profiles
  add column if not exists is_site_admin boolean not null default false;

-- Promote the specified user to site admin
update public.profiles
set is_site_admin = true
where email = 'ramakrismatta@gmail.com';