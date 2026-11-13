-- Run once in the SQL Editor of a NEW, dedicated Supabase project.
-- Frontend uses a publishable key and an authenticated user. No anon data access.
begin;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 70),
  initials text not null default '' check (length(initials) <= 10),
  contact_type text not null check (contact_type in ('customer','driver')),
  color text not null default 'blue' check (color in ('blue','sage','peach','lilac','rose','sand')),
  order_number text not null check (length(trim(order_number)) between 1 and 24),
  order_state text not null default 'طلب جديد',
  order_details jsonb not null default '{}'::jsonb check (jsonb_typeof(order_details) = 'object'),
  priority text not null default 'normal' check (priority in ('normal','high','urgent')),
  assignee text check (assignee is null or assignee = 'me'),
  starred boolean not null default false,
  tags text[] not null default '{}'::text[] check (cardinality(tags) <= 5 and tags <@ array['تأخير التوصيل','تعديل العنوان','مشكلة في الطلب','الدفع','إثبات التسليم']::text[]),
  follow_up_at timestamptz,
  status text not null default 'open' check (status in ('open','pending','resolved')),
  unread_count integer not null default 0 check (unread_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index conversations_owner_updated_idx on public.conversations(owner_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  owner_id uuid not null,
  direction text not null check (direction in ('outgoing','incoming','event','note')),
  body text not null default '' check (length(body) <= 4000),
  image_path text,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, owner_id) references public.conversations(id, owner_id) on delete cascade,
  check (length(trim(body)) > 0 or image_path is not null),
  check (direction <> 'note' or image_path is null),
  check (image_path is null or (
    image_path like owner_id::text || '/' || conversation_id::text || '/%'
    and image_path !~ '(^|/)\.\.(/|$)'
  ))
);
create index messages_conversation_created_idx on public.messages(conversation_id, created_at desc);
create index messages_owner_idx on public.messages(owner_id);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
revoke all on public.conversations, public.messages from anon, authenticated;
grant select, insert, update on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;

create policy conversations_read on public.conversations for select to authenticated
  using (owner_id = (select auth.uid()));
create policy conversations_create on public.conversations for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy conversations_update on public.conversations for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy messages_read on public.messages for select to authenticated
  using (owner_id = (select auth.uid()));
-- Internal notes remain private; incoming messages must be inserted by a trusted integration, not impersonated by the browser.
create policy messages_send on public.messages for insert to authenticated
  with check (owner_id = (select auth.uid()) and direction in ('outgoing','note'));

create function public.wasl_touch_conversation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger conversations_touch before update on public.conversations
for each row execute function public.wasl_touch_conversation();

create function public.wasl_message_added() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.conversations set
    updated_at = clock_timestamp(),
    unread_count = case when new.direction = 'incoming' then unread_count + 1
                        when new.direction = 'outgoing' then 0 else unread_count end,
    status = case when new.direction = 'outgoing' and status = 'resolved' then 'open' else status end
  where id = new.conversation_id and owner_id = new.owner_id;
  return new;
end;
$$;
create trigger messages_added after insert on public.messages
for each row execute function public.wasl_message_added();
revoke all on function public.wasl_touch_conversation(), public.wasl_message_added() from public, anon, authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
allowed_mime_types = excluded.allowed_mime_types;

create policy wasl_images_read on storage.objects for select to authenticated
using (bucket_id = 'chat-attachments'
  and (select auth.uid())::text = split_part(storage.objects.name, '/', 1)
  and exists (select 1 from public.conversations c
              where c.id::text = split_part(storage.objects.name, '/', 2) and c.owner_id = (select auth.uid())));
create policy wasl_images_upload on storage.objects for insert to authenticated
with check (bucket_id = 'chat-attachments'
  and (select auth.uid())::text = split_part(storage.objects.name, '/', 1)
  and exists (select 1 from public.conversations c
              where c.id::text = split_part(storage.objects.name, '/', 2) and c.owner_id = (select auth.uid())));
create policy wasl_images_cleanup on storage.objects for delete to authenticated
using (bucket_id = 'chat-attachments'
  and (select auth.uid())::text = split_part(storage.objects.name, '/', 1)
  and exists (select 1 from public.conversations c
              where c.id::text = split_part(storage.objects.name, '/', 2) and c.owner_id = (select auth.uid())));

-- The application tables, not Supabase's protected realtime schema.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'conversations') then
      alter publication supabase_realtime add table public.conversations;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
  end if;
end;
$$;
commit;
