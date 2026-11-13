import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

test("schema enforces tenant isolation, trusted incoming messages and private images", async () => {
  const db = new PGlite();
  try {
    // Minimal platform contracts; no real Supabase project or credentials are used.
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth,public to authenticated,anon;
      grant execute on function auth.uid() to authenticated,anon;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select,insert,delete on storage.objects to authenticated;
      insert into auth.users values ('${A}'),('${B}');
    `);
    await db.exec(
      await readFile(
        new URL("../supabase/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    const asUser = async (uid, sql) => {
      await db.exec(
        `set role authenticated;select set_config('request.jwt.claim.sub','${uid}',false)`,
      );
      try {
        return await db.query(sql);
      } finally {
        await db.exec("reset role");
      }
    };
    await asUser(
      A,
      `insert into public.conversations(id,owner_id,name,initials,contact_type,order_number,status)
      values ('${C}','${A}','عميل','ع','customer','1048','resolved')`,
    );
    await asUser(
      A,
      `insert into public.messages(conversation_id,owner_id,direction,body)
      values ('${C}','${A}','outgoing','مرحباً')`,
    );
    assert.equal(
      (await asUser(A, "select * from public.messages")).rows.length,
      1,
    );
    assert.equal(
      (await asUser(A, "select status from public.conversations")).rows[0]
        .status,
      "open",
    );
    await asUser(
      A,
      `update public.conversations set status='resolved',priority='urgent',assignee='me',starred=true,tags=array['الدفع'],follow_up_at=now()+interval '30 minutes' where id='${C}'`,
    );
    await asUser(
      A,
      `insert into public.messages(conversation_id,owner_id,direction,body) values ('${C}','${A}','note','ملاحظة داخلية')`,
    );
    const afterNote = (
      await asUser(
        A,
        "select status,unread_count,priority,assignee,starred,tags from public.conversations",
      )
    ).rows[0];
    assert.equal(afterNote.status, "resolved");
    assert.equal(afterNote.unread_count, 0);
    assert.equal(afterNote.priority, "urgent");
    assert.equal(afterNote.assignee, "me");
    assert.equal(afterNote.starred, true);
    await assert.rejects(
      asUser(
        A,
        `update public.conversations set assignee='another-user' where id='${C}'`,
      ),
      /check constraint/,
    );

    assert.equal(
      (await asUser(B, "select * from public.conversations")).rows.length,
      0,
    );
    assert.equal(
      (await asUser(B, "select * from public.messages")).rows.length,
      0,
    );
    assert.equal(
      (
        await asUser(
          B,
          `update public.conversations set status='resolved' where id='${C}' returning id`,
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      asUser(
        A,
        `update public.conversations set owner_id='${B}' where id='${C}'`,
      ),
      /row-level security/,
    );
    await assert.rejects(
      asUser(
        B,
        `insert into public.messages(conversation_id,owner_id,direction,body) values ('${C}','${B}','outgoing','forbidden')`,
      ),
      /foreign key/,
    );
    await assert.rejects(
      asUser(
        A,
        `insert into public.messages(conversation_id,owner_id,direction,body) values ('${C}','${A}','incoming','impersonation')`,
      ),
      /row-level security/,
    );
    await assert.rejects(
      asUser(A, `update public.messages set body='edited'`),
      /permission denied/,
    );
    await assert.rejects(
      asUser(
        A,
        `insert into public.messages(conversation_id,owner_id,direction,body,image_path) values ('${C}','${A}','outgoing','','${B}/${C}/image.jpg')`,
      ),
      /check constraint/,
    );
    const path = `${A}/${C}/proof.jpg`;
    await asUser(
      A,
      `insert into storage.objects(bucket_id,name) values ('chat-attachments','${path}')`,
    );
    assert.equal(
      (await asUser(A, "select * from storage.objects")).rows.length,
      1,
    );
    assert.equal(
      (await asUser(B, "select * from storage.objects")).rows.length,
      0,
    );
    await assert.rejects(
      asUser(
        B,
        `insert into storage.objects(bucket_id,name) values ('chat-attachments','${path}')`,
      ),
      /row-level security/,
    );
    assert.equal(
      (
        await db.query(
          "select public from storage.buckets where id='chat-attachments'",
        )
      ).rows[0].public,
      false,
    );
    await db.exec(
      `insert into public.messages(conversation_id,owner_id,direction,body) values ('${C}','${A}','incoming','تحديث من تكامل موثوق')`,
    );
    assert.equal(
      (await asUser(A, "select unread_count from public.conversations")).rows[0]
        .unread_count,
      1,
    );
    await db.exec("set role anon");
    try {
      await assert.rejects(
        db.query("select * from public.conversations"),
        /permission denied/,
      );
    } finally {
      await db.exec("reset role");
    }
  } finally {
    await db.close();
  }
});
