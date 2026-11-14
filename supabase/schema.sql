-- Server-side lock and schedule rules for Focus Lock.
-- Apply this in the Supabase SQL editor. The anon key cannot bypass these triggers.
-- The dashboard and service role can, because they are the project owner.

create table if not exists public.lists (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  patterns jsonb not null default '[]'::jsonb,
  lock_end timestamptz,
  schedule jsonb,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

alter table public.lists enable row level security;

create policy lists_select on public.lists
  for select using (user_id = auth.uid());

create policy lists_insert on public.lists
  for insert with check (user_id = auth.uid());

create policy lists_update on public.lists
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy lists_delete on public.lists
  for delete using (user_id = auth.uid());

create or replace function public.prevent_weakening()
returns trigger
language plpgsql
as $$
declare
  old_commit timestamptz;
  new_commit timestamptz;
  pattern text;
begin
  if tg_op = 'DELETE' then
    if old.lock_end is not null and old.lock_end > now() then
      raise exception 'cannot delete a list while a lock is active';
    end if;
    if old.schedule is not null and (old.schedule->>'commitmentEnd')::timestamptz > now() then
      raise exception 'cannot delete a list while a schedule is committed';
    end if;
    return old;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'cannot change owner';
  end if;

  if old.lock_end is not null and old.lock_end > now() then
    if new.lock_end is null or new.lock_end < old.lock_end then
      raise exception 'cannot weaken an active lock';
    end if;
    for pattern in select jsonb_array_elements_text(old.patterns)
    loop
      if not (new.patterns @> to_jsonb(pattern)) then
        raise exception 'cannot remove a pattern while a lock is active';
      end if;
    end loop;
  end if;

  if old.schedule is not null and (old.schedule->>'commitmentEnd')::timestamptz > now() then
    if new.schedule is null then
      raise exception 'cannot deactivate a committed schedule';
    end if;
    old_commit := (old.schedule->>'commitmentEnd')::timestamptz;
    new_commit := (new.schedule->>'commitmentEnd')::timestamptz;
    if new_commit < old_commit then
      raise exception 'cannot shorten a schedule commitment';
    end if;
    if (new.schedule->>'start') > (old.schedule->>'start') or (new.schedule->>'end') < (old.schedule->>'end') then
      raise exception 'cannot shorten a schedule window';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(old.schedule->'days') as old_day
      where not (new.schedule->'days' @> jsonb_build_array(old_day))
    ) then
      raise exception 'cannot remove a schedule day';
    end if;
    for pattern in select jsonb_array_elements_text(old.patterns)
    loop
      if not (new.patterns @> to_jsonb(pattern)) then
        raise exception 'cannot remove a pattern while a schedule is committed';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists lists_prevent_weakening on public.lists;
create trigger lists_prevent_weakening
  before update or delete on public.lists
  for each row execute function public.prevent_weakening();
