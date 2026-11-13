import { test } from "node:test";
import assert from "node:assert/strict";
import {
  metrics,
  awaitingSince,
  sla,
  matches,
  csvExport,
  summarize,
} from "../src/domain.js";
const time = "2026-11-14T10:00:00.000Z";
const msg = (by, minutes, text = "رسالة") => ({
  by,
  text,
  createdAt: new Date(new Date(time).getTime() + minutes * 60000).toISOString(),
});
const chat = (patch) => ({
  id: "a",
  name: "عميل",
  type: "customer",
  order: "100",
  priority: "normal",
  status: "open",
  tags: [],
  assignee: null,
  starred: false,
  followUpAt: null,
  messages: [],
  ...patch,
});

test("reading a conversation and writing an internal note do not satisfy response SLA", () => {
  const c = chat({ unread: 0, messages: [msg("them", 0), msg("note", 3)] });
  assert.equal(awaitingSince(c), time);
  assert.equal(sla(c, new Date(time).getTime() + 6 * 60000).state, "overdue");
  assert.equal(metrics([c]).waiting, 1);
  assert.equal(metrics([c]).responses, 0);
});
test("SLA uses the oldest unanswered incoming message and closes on a real reply", () => {
  const c = chat({
    messages: [msg("them", 0), msg("them", 2), msg("note", 3)],
  });
  assert.equal(awaitingSince(c), time);
  c.messages.push(msg("me", 4));
  assert.equal(awaitingSince(c), null);
  assert.equal(metrics([c]).average, 240);
  assert.equal(metrics([c]).responses, 1);
});
test("resolved conversations and future followups are not listed as waiting or due", () => {
  const c = chat({
    status: "resolved",
    priority: "urgent",
    messages: [msg("them", 0)],
    followUpAt: "2026-11-15T10:00:00Z",
  });
  assert.equal(metrics([c]).waiting, 0);
  assert.equal(metrics([c]).urgent, 0);
  assert.equal(
    matches(c, { view: "followup", now: new Date(time).getTime() }),
    false,
  );
  assert.equal(matches(c, { view: "resolved" }), true);
});
test("saved views, status, type and search combine rather than replacing one another", () => {
  const c = chat({
    name: "سارة",
    assignee: "me",
    priority: "urgent",
    tags: ["تعديل العنوان"],
  });
  assert.equal(
    matches(c, {
      view: "mine",
      type: "customer",
      status: "open",
      query: "العنوان",
    }),
    true,
  );
  assert.equal(
    matches(c, { view: "mine", type: "driver", query: "سارة" }),
    false,
  );
  assert.equal(matches(c, { view: "unassigned" }), false);
});
test("CSV prevents spreadsheet formula injection and summary does not leak internal notes", () => {
  const c = chat({
    name: '=HYPERLINK("evil")',
    messages: [
      msg("them", 0, "رسالة العميل"),
      msg("note", 1, "معلومة داخلية سرية"),
    ],
    tags: ["تعديل العنوان"],
  });
  const csv = csvExport([c]);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.equal(summarize(c).incoming, "رسالة العميل");
  assert.ok(!JSON.stringify(summarize(c)).includes("سرية"));
});
