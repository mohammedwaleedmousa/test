-- Read-only checks after installing schema.sql in the dedicated hosted project.
select schemaname, tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('conversations','messages');
select schemaname, tablename, policyname, cmd, roles from pg_policies
where (schemaname = 'public' and tablename in ('conversations','messages'))
   or (schemaname = 'storage' and policyname like 'wasl_images_%');
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='chat-attachments';
select pubname, schemaname, tablename from pg_publication_tables
where pubname='supabase_realtime' and tablename in ('conversations','messages');
