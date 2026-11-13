import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig, safeImage, toConversation } from "../src/repository.js";

test("cloud config never accepts secret keys or silently falls back on partial config", () => {
  assert.equal(readConfig({}), null);
  assert.throws(() =>
    readConfig({ VITE_SUPABASE_URL: "https://example.supabase.co" }),
  );
  for (const key of ["sb_secret_abc", "service_role", "eyJhbGciOiJIUzI1NiJ9"]) {
    assert.throws(() =>
      readConfig({
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
      }),
    );
  }
  assert.throws(() =>
    readConfig({
      VITE_SUPABASE_URL: "http://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    }),
  );
});

test("image rendering rejects active content and untrusted external origins", () => {
  const origin = "https://example.supabase.co";
  assert.equal(safeImage("javascript:alert(1)", origin), "");
  assert.equal(safeImage("data:image/svg+xml;base64,AAAA", origin), "");
  assert.equal(
    safeImage(
      "https://attacker.test/storage/v1/object/sign/chat-attachments/a.jpg",
      origin,
    ),
    "",
  );
  assert.equal(
    safeImage(
      "https://example.supabase.co/storage/v1/object/public/chat-attachments/a.jpg",
      origin,
    ),
    "",
  );
  assert.equal(
    safeImage("data:image/jpeg;base64,AAAA", origin),
    "data:image/jpeg;base64,AAAA",
  );
});

test("server history maps chronologically and cannot override canonical identity", () => {
  const row = {
    id: "id",
    name: "اسم",
    initials: "ا",
    color: "blue",
    contact_type: "customer",
    order_number: "1",
    order_state: "جديد",
    status: "open",
    unread_count: 1,
    updated_at: "2026-11-14T07:05:00Z",
    order_details: { id: "forged", online: true },
    messages: [
      {
        id: "2",
        direction: "incoming",
        body: "ثانية",
        created_at: "2026-11-14T07:05:00Z",
      },
      {
        id: "1",
        direction: "outgoing",
        body: "أولى",
        created_at: "2026-11-14T07:00:00Z",
      },
    ],
  };
  const c = toConversation(row);
  assert.equal(c.id, "id");
  assert.equal(c.online, false);
  assert.deepEqual(
    c.messages.map((m) => m.text),
    ["أولى", "ثانية"],
  );
  assert.equal(c.time, "10:05");
});
