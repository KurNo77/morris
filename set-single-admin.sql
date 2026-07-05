create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and lower(email) = 'collanon707@gmail.com'
  );
$$;

create or replace function public.enforce_single_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.email := lower(new.email);

  if new.email = 'collanon707@gmail.com' then
    new.role := 'admin';
  else
    new.role := 'user';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_single_admin on public.profiles;
create trigger profiles_single_admin
before insert or update of email, role on public.profiles
for each row execute function public.enforce_single_admin_profile();

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
for insert to authenticated
with check (
  id = auth.uid()
  and (
    role = 'user'
    or (role = 'admin' and lower(email) = 'collanon707@gmail.com')
  )
);

update public.profiles
set role = case when lower(email) = 'collanon707@gmail.com' then 'admin' else 'user' end;

notify pgrst, 'reload schema';
