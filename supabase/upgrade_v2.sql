-- Only for a project that already ran the v1 schema.sql.
-- Fresh projects should run the current schema.sql alone.
begin;
alter table public.conversations
  add column priority text not null default 'normal' check (priority in ('normal','high','urgent')),
  add column assignee text check (assignee is null or assignee = 'me'),
  add column starred boolean not null default false,
  add column tags text[] not null default '{}'::text[] check (cardinality(tags) <= 5 and tags <@ array['تأخير التوصيل','تعديل العنوان','مشكلة في الطلب','الدفع','إثبات التسليم']::text[]),
  add column follow_up_at timestamptz;
alter table public.messages drop constraint messages_direction_check;
alter table public.messages add constraint messages_direction_check check (direction in ('outgoing','incoming','event','note'));
alter table public.messages add constraint messages_note_no_image check (direction <> 'note' or image_path is null);
drop policy messages_send on public.messages;
create policy messages_send on public.messages for insert to authenticated
  with check (owner_id = (select auth.uid()) and direction in ('outgoing','note'));
commit;
