export const STATUS = {
  open: "مفتوحة",
  pending: "قيد المتابعة",
  resolved: "تم الحل",
};
export const PRIORITY = { normal: "عادية", high: "مرتفعة", urgent: "عاجلة" };
export const TAGS = [
  "تأخير التوصيل",
  "تعديل العنوان",
  "مشكلة في الطلب",
  "الدفع",
  "إثبات التسليم",
];
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const clock = (value) =>
  new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Aden",
  });
export const lastPublic = (c) =>
  [...c.messages].reverse().find((m) => ["me", "them"].includes(m.by));
export const lastIncoming = (c) =>
  [...c.messages].reverse().find((m) => m.by === "them");
export const lastOutgoing = (c) =>
  [...c.messages].reverse().find((m) => m.by === "me");
export const assigneeName = (value) => (value === "me" ? "أنت" : "غير مسندة");

export function normalize(c, index = 0, anchor = Date.now()) {
  const start = anchor - (index + 1) * 8 * 60000;
  return {
    ...c,
    priority: PRIORITY[c.priority] ? c.priority : "normal",
    assignee: c.assignee === "me" ? "me" : null,
    starred: !!c.starred,
    tags: Array.isArray(c.tags) ? c.tags.filter((t) => TAGS.includes(t)) : [],
    followUpAt: c.followUpAt || null,
    messages: (c.messages || []).map((m, i) => ({
      ...m,
      id: m.id || `${c.id}-m${i}`,
      createdAt: m.createdAt || new Date(start + i * 60000).toISOString(),
      time: clock(m.createdAt || start + i * 60000),
    })),
  };
}
export function enrichDemo(source, anchor = Date.now()) {
  const priorities = [
    "high",
    "urgent",
    "normal",
    "high",
    "normal",
    "normal",
    "normal",
    "normal",
  ];
  const tags = [
    ["تأخير التوصيل"],
    ["تأخير التوصيل"],
    ["تعديل العنوان"],
    ["مشكلة في الطلب"],
    ["مشكلة في الطلب"],
    [],
    ["إثبات التسليم"],
    [],
  ];
  return source.map((c, i) =>
    normalize(
      {
        ...structuredClone(c),
        priority: priorities[i],
        assignee: i % 3 === 0 ? "me" : null,
        tags: tags[i] || [],
        starred: i === 0,
        followUpAt:
          i === 3 ? new Date(anchor + 30 * 60000).toISOString() : null,
      },
      i,
      anchor,
    ),
  );
}
export function awaitingSince(c) {
  if (c.status === "resolved") return null;
  let first = null;
  for (const m of c.messages) {
    if (m.by === "them" && !first) first = m.createdAt;
    if (m.by === "me") first = null;
  }
  return first;
}
export function sla(c, now = Date.now()) {
  const since = awaitingSince(c);
  if (!since) return { state: "clear", seconds: 0 };
  const seconds = Math.ceil(
    (new Date(since).getTime() + 5 * 60000 - now) / 1000,
  );
  return { state: seconds < 0 ? "overdue" : "waiting", seconds };
}
export function duration(seconds) {
  const n = Math.max(0, Math.round(Math.abs(seconds)));
  if (n < 60) return `${n} ث`;
  if (n < 3600)
    return `${Math.floor(n / 60)} د ${n % 60 ? `${n % 60} ث` : ""}`.trim();
  return `${Math.floor(n / 3600)} س ${Math.floor((n % 3600) / 60)} د`;
}
export function metrics(chats) {
  const intervals = [];
  for (const c of chats) {
    let start = null;
    for (const m of c.messages) {
      if (m.by === "them" && !start) start = new Date(m.createdAt).getTime();
      if (m.by === "me" && start !== null) {
        const delta = (new Date(m.createdAt).getTime() - start) / 1000;
        if (delta >= 0) intervals.push(delta);
        start = null;
      }
    }
  }
  return {
    total: chats.length,
    waiting: chats.filter((c) => awaitingSince(c)).length,
    urgent: chats.filter(
      (c) => c.priority === "urgent" && c.status !== "resolved",
    ).length,
    resolved: chats.filter((c) => c.status === "resolved").length,
    average: intervals.length
      ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
      : null,
    responses: intervals.length,
  };
}
export function matches(
  c,
  {
    view = "all",
    type = "all",
    status = "all",
    query = "",
    now = Date.now(),
  } = {},
) {
  if (type !== "all" && c.type !== type) return false;
  if (status !== "all" && c.status !== status) return false;
  if (view === "mine" && c.assignee !== "me") return false;
  if (view === "unassigned" && c.assignee) return false;
  if (view === "urgent" && (c.priority !== "urgent" || c.status === "resolved"))
    return false;
  if (view === "starred" && !c.starred) return false;
  if (view === "waiting" && !awaitingSince(c)) return false;
  if (
    view === "followup" &&
    (!c.followUpAt || new Date(c.followUpAt).getTime() > now)
  )
    return false;
  if (view === "resolved" && c.status !== "resolved") return false;
  const q = query.trim().toLowerCase();
  return (
    !q ||
    [c.name, c.order, ...c.tags, ...c.messages.map((m) => m.text || "")]
      .join(" ")
      .toLowerCase()
      .includes(q)
  );
}
export function summarize(c) {
  const incoming = lastIncoming(c),
    outgoing = lastOutgoing(c);
  let next = "راجع آخر رسالة وحدد الخطوة التالية مع العميل.";
  if (c.tags.includes("تأخير التوصيل"))
    next = "تواصل مع المندوب، وأكد وقت الوصول للعميل.";
  if (c.tags.includes("تعديل العنوان"))
    next = "أكد العنوان الجديد، ثم حدّث بيانات الطلب قبل متابعة التوصيل.";
  if (c.status === "resolved")
    next = "تم الحل. يمكن إعادة فتح المحادثة إذا احتاج العميل متابعة إضافية.";
  return {
    incoming: incoming?.text || "لا توجد رسالة واردة في السجل.",
    outgoing: outgoing?.text || "لم يُرسل رد بعد.",
    next,
  };
}
export function csvExport(chats) {
  const quote = (value) => {
    let text = String(value ?? "");
    // CSV cells must not become spreadsheet formulas when opened in Excel.
    if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" +
    [
      [
        "الاسم",
        "الطلب",
        "النوع",
        "الحالة",
        "الأولوية",
        "الإسناد",
        "الوسوم",
        "موعد المتابعة",
      ],
      ...chats.map((c) => [
        c.name,
        `W-${c.order}`,
        c.type === "driver" ? "مندوب" : "عميل",
        STATUS[c.status],
        PRIORITY[c.priority],
        assigneeName(c.assignee),
        c.tags.join("، "),
        c.followUpAt || "",
      ]),
    ]
      .map((row) => row.map(quote).join(","))
      .join("\r\n")
  );
}
