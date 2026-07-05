create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null unique,
  phone text,
  address text,
  profile_picture text,
  account_number text not null unique,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  balance numeric(14, 2) not null default 0 check (balance >= 0),
  savings_balance numeric(14, 2) not null default 0 check (savings_balance >= 0),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('deposit', 'withdrawal', 'transfer', 'adjustment', 'correction')),
  amount numeric(14, 2) not null check (amount > 0),
  description text not null default '',
  balance_before numeric(14, 2) not null,
  balance_after numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  admin_id uuid references public.profiles(id)
);

create table if not exists public.debit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  bank_name text,
  cardholder_name text,
  card_number text,
  expiry text,
  cvv text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checking_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  bank_name text,
  routing_number text,
  account_number text,
  account_holder text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id),
  target_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_account_number text;
begin
  generated_account_number := lpad((floor(random() * 10000000000))::bigint::text, 10, '0');

  insert into public.profiles (id, full_name, email, account_number)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    generated_account_number
  )
  on conflict (id) do nothing;

  insert into public.accounts (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists accounts_updated_at on public.accounts;
create trigger accounts_updated_at
before update on public.accounts
for each row execute function public.touch_updated_at();

drop trigger if exists debit_cards_updated_at on public.debit_cards;
create trigger debit_cards_updated_at
before update on public.debit_cards
for each row execute function public.touch_updated_at();

drop trigger if exists checking_accounts_updated_at on public.checking_accounts;
create trigger checking_accounts_updated_at
before update on public.checking_accounts
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.debit_cards enable row level security;
alter table public.checking_accounts enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
for insert to authenticated
with check (id = auth.uid() and role = 'user');

drop policy if exists "profiles_update_own_limited" on public.profiles;
create policy "profiles_update_own_limited" on public.profiles
for update to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists "accounts_select_own_or_admin" on public.accounts;
create policy "accounts_select_own_or_admin" on public.accounts
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "accounts_insert_own" on public.accounts;
create policy "accounts_insert_own" on public.accounts
for insert to authenticated
with check (
  user_id = auth.uid()
  and balance = 0
  and savings_balance = 0
  and status = 'active'
);

drop policy if exists "accounts_admin_update" on public.accounts;
create policy "accounts_admin_update" on public.accounts
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "transactions_select_own_or_admin" on public.transactions;
create policy "transactions_select_own_or_admin" on public.transactions
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "transactions_admin_insert" on public.transactions;
create policy "transactions_admin_insert" on public.transactions
for insert to authenticated
with check (public.is_admin());

drop policy if exists "debit_cards_select_own_or_admin" on public.debit_cards;
create policy "debit_cards_select_own_or_admin" on public.debit_cards
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "debit_cards_admin_all" on public.debit_cards;
create policy "debit_cards_admin_all" on public.debit_cards
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "checking_select_own_or_admin" on public.checking_accounts;
create policy "checking_select_own_or_admin" on public.checking_accounts
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "checking_admin_all" on public.checking_accounts;
create policy "checking_admin_all" on public.checking_accounts
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "audit_logs_admin_select" on public.audit_logs;
create policy "audit_logs_admin_select" on public.audit_logs
for select to authenticated
using (public.is_admin());

drop policy if exists "audit_logs_admin_insert" on public.audit_logs;
create policy "audit_logs_admin_insert" on public.audit_logs
for insert to authenticated
with check (public.is_admin());

create or replace view public.admin_user_overview
with (security_invoker = true) as
select
  p.id,
  p.full_name,
  p.email,
  p.phone,
  p.address,
  p.profile_picture,
  p.account_number,
  p.role,
  p.created_at,
  a.balance,
  a.savings_balance,
  a.status
from public.profiles p
left join public.accounts a on a.user_id = p.id;

create or replace view public.admin_transaction_overview
with (security_invoker = true) as
select
  t.*,
  p.full_name as user_name,
  p.email as user_email,
  admin.full_name as admin_name
from public.transactions t
left join public.profiles p on p.id = t.user_id
left join public.profiles admin on admin.id = t.admin_id;

create or replace function public.admin_update_user(
  target_user_id uuid,
  profile_updates jsonb,
  account_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  update public.profiles
  set
    full_name = coalesce(profile_updates ->> 'full_name', full_name),
    email = coalesce(profile_updates ->> 'email', email),
    phone = profile_updates ->> 'phone',
    address = profile_updates ->> 'address',
    profile_picture = nullif(profile_updates ->> 'profile_picture', ''),
    role = coalesce(profile_updates ->> 'role', role)
  where id = target_user_id;

  update public.accounts
  set status = account_status
  where user_id = target_user_id;

  insert into public.audit_logs (admin_id, target_user_id, action, entity_type, metadata)
  values (auth.uid(), target_user_id, 'updated user', 'profiles', profile_updates);
end;
$$;

create or replace function public.admin_set_account_status(target_user_id uuid, account_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  update public.accounts set status = account_status where user_id = target_user_id;
  insert into public.audit_logs (admin_id, target_user_id, action, entity_type, metadata)
  values (auth.uid(), target_user_id, 'changed account status', 'accounts', jsonb_build_object('status', account_status));
end;
$$;

create or replace function public.admin_modify_balance(
  target_user_id uuid,
  action_type text,
  amount_value numeric,
  action_description text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_balance numeric(14, 2);
  next_balance numeric(14, 2);
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if amount_value <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  select balance into previous_balance
  from public.accounts
  where user_id = target_user_id
  for update;

  if previous_balance is null then
    raise exception 'Account not found';
  end if;

  if action_type in ('withdrawal', 'transfer') then
    next_balance := previous_balance - amount_value;
  elsif action_type in ('adjustment', 'correction') then
    next_balance := amount_value;
  else
    next_balance := previous_balance + amount_value;
  end if;

  if next_balance < 0 then
    raise exception 'Insufficient funds';
  end if;

  update public.accounts
  set balance = next_balance
  where user_id = target_user_id;

  insert into public.transactions (
    user_id,
    transaction_type,
    amount,
    description,
    balance_before,
    balance_after,
    admin_id
  )
  values (
    target_user_id,
    action_type,
    amount_value,
    action_description,
    previous_balance,
    next_balance,
    auth.uid()
  );

  insert into public.audit_logs (admin_id, target_user_id, action, entity_type, metadata)
  values (
    auth.uid(),
    target_user_id,
    action_type,
    'transactions',
    jsonb_build_object('amount', amount_value, 'balance_before', previous_balance, 'balance_after', next_balance)
  );
end;
$$;

create or replace function public.admin_delete_user_records(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  insert into public.audit_logs (admin_id, target_user_id, action, entity_type)
  values (auth.uid(), target_user_id, 'deleted user records', 'profiles');

  delete from public.profiles where id = target_user_id;
end;
$$;

insert into storage.buckets (id, name, public)
values ('profile-pictures', 'profile-pictures', true)
on conflict (id) do nothing;

drop policy if exists "profile_pictures_read" on storage.objects;
create policy "profile_pictures_read" on storage.objects
for select to authenticated
using (bucket_id = 'profile-pictures');

drop policy if exists "profile_pictures_own_upload" on storage.objects;
create policy "profile_pictures_own_upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'profile-pictures'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "profile_pictures_own_update" on storage.objects;
create policy "profile_pictures_own_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'profile-pictures'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
)
with check (
  bucket_id = 'profile-pictures'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

revoke update on public.profiles from authenticated;
grant update (phone, address, profile_picture) on public.profiles to authenticated;
grant select, insert on public.profiles to authenticated;

revoke insert, update, delete on public.accounts from authenticated;
grant select, insert on public.accounts to authenticated;

revoke insert, update, delete on public.transactions from authenticated;
grant select on public.transactions to authenticated;

grant select on public.debit_cards to authenticated;
grant select on public.checking_accounts to authenticated;
grant select on public.audit_logs to authenticated;
grant select on public.admin_user_overview to authenticated;
grant select on public.admin_transaction_overview to authenticated;
