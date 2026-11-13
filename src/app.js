import "./style.css";
import { initial } from "./demo-data.js";
import { icon } from "./icons.js";
import { CloudRepository, readConfig, safeImage } from "./repository.js";
import {
  STATUS,
  PRIORITY,
  TAGS,
  esc,
  clock,
  normalize,
  enrichDemo,
  lastPublic,
  lastIncoming,
  assigneeName,
  awaitingSince,
  sla,
  duration,
  metrics,
  matches,
  summarize,
  csvExport,
} from "./domain.js";

const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const KEY = "wasl-inbox-v2";
const VIEWS = {
  all: "صندوق الوارد",
  mine: "المسندة إليّ",
  unassigned: "غير المسندة",
  starred: "المميزة بنجمة",
  urgent: "الحالات العاجلة",
  followup: "حان وقت المتابعة",
  waiting: "بانتظار ردّك",
  resolved: "تم حلّها",
};
let chats = [],
  activeId = null,
  view = "all",
  contactType = "all",
  statusFilter = "all",
  sort = "recent";
let cloudMode = false,
  repository = null,
  configError = "",
  activeUserId = null,
  sessionGeneration = 0;
let saving = false,
  refreshing = false,
  refreshAgain = false,
  refreshTimer = null,
  toastTimer = null;
let composeMode = "reply",
  attachment = null,
  attachmentName = "",
  pendingSend = null,
  selectMode = false;
const selected = new Set(),
  drafts = {};
const current = () => chats.find((c) => c.id === activeId);
const draftKey = () => `${activeId}:${composeMode}`;
const timeNow = () => clock(Date.now());

function icons(root = document) {
  root
    .querySelectorAll("[data-icon]")
    .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3600);
}
function persist() {
  if (cloudMode) return true;
  try {
    localStorage.setItem(KEY, JSON.stringify(chats));
    return true;
  } catch {
    toast("تعذّر الحفظ في المتصفح. التغييرات متاحة مؤقتاً حتى إغلاق الصفحة.");
    return false;
  }
}
function saveDraft() {
  if (activeId) drafts[draftKey()] = $("#messageInput").value;
}
function avatar(c, small = false) {
  return `<span class="avatar ${esc(c.color || "blue")} ${!cloudMode && c.online ? "online" : ""} ${small ? "small" : ""}">${esc(c.initials || "و")}</span>`;
}
function busy(value) {
  saving = value;
  for (const e of $$(
    "button[type=submit],#messageInput,#attachBtn,#emojiBtn,.details-panel select",
  ))
    e.disabled = value;
}
function cloudError(error) {
  toast(
    error?.code === "42P01" || error?.code === "42703"
      ? "إعداد مساحة العمل يحتاج تحديثاً. راجع ملف إعداد قاعدة البيانات."
      : error?.code === "42501"
        ? "لا توجد صلاحية لتنفيذ العملية."
        : "تعذّر إكمال العملية. بقيت بياناتك لتتمكن من المحاولة مجدداً.",
  );
}
function modeLabel(text, offline = false) {
  $(".local-indicator").innerHTML = `<i></i><span>${esc(text)}</span>`;
  $(".local-indicator").classList.toggle("offline", offline);
}
function filtered() {
  const list = chats.filter((c) =>
    matches(c, {
      view,
      type: contactType,
      status: statusFilter,
      query: $("#search").value,
    }),
  );
  const recent = (c) =>
    new Date(c.messages.at(-1)?.createdAt || c.createdAt || 0).getTime();
  return list.sort((a, b) =>
    sort === "priority"
      ? { urgent: 3, high: 2, normal: 1 }[b.priority] -
          { urgent: 3, high: 2, normal: 1 }[a.priority] || recent(b) - recent(a)
      : sort === "oldest"
        ? recent(a) - recent(b)
        : recent(b) - recent(a),
  );
}
function renderMetrics() {
  const m = metrics(chats);
  $("#totalCount").textContent = m.total;
  $("#waitingCount").textContent = m.waiting;
  $("#resolvedCount").textContent = m.resolved;
  $("#responseTime").textContent =
    m.average === null ? "—" : duration(m.average);
  $("#responseSample").textContent = m.responses
    ? `من ${m.responses} استجابة في السجل`
    : "لا توجد ردود قابلة للقياس";
  const percent = m.total ? Math.round((m.resolved / m.total) * 100) : 0;
  $("#resolvedPercentage").textContent = `${percent}% من إجمالي المحادثات`;
  $("#resolutionRing").style.setProperty("--progress", `${percent}%`);
  $("#navTotal").textContent = m.total;
  for (const key of [
    "all",
    "mine",
    "unassigned",
    "starred",
    "urgent",
    "followup",
  ])
    $(`#view-${key}`).textContent = chats.filter((c) =>
      matches(c, { view: key }),
    ).length;
  $("#notificationDot").hidden =
    !m.waiting && !chats.some((c) => matches(c, { view: "followup" }));
}
function renderList() {
  const list = filtered();
  $("#viewTitle").innerHTML =
    `${esc(VIEWS[view] || VIEWS.all)} <span id="listCount">${list.length}</span>`;
  $("#listDescription").textContent = {
    recent: "الأحدث أولاً",
    oldest: "الأقدم أولاً",
    priority: "حسب الأولوية",
  }[sort];
  $("#conversationList").classList.toggle("selection-mode", selectMode);
  $("#bulkToolbar").hidden = !selectMode;
  $("#selectedCount").textContent = `${selected.size} محددة`;
  $("#bulkResolve").disabled = !selected.size || saving;
  $("#selectAll").checked =
    !!list.length && list.every((c) => selected.has(c.id));
  $("#selectAll").indeterminate =
    list.some((c) => selected.has(c.id)) && !$("#selectAll").checked;
  $("#conversationList").innerHTML = list.length
    ? list
        .map((c) => {
          const last = lastPublic(c),
            waiting = sla(c).state === "overdue";
          return `<div class="conversation-row ${c.id === activeId ? "active" : ""}">${selectMode ? `<input type="checkbox" class="row-checkbox" data-check="${esc(c.id)}" aria-label="تحديد محادثة ${esc(c.name)}" ${selected.has(c.id) ? "checked" : ""}>` : ""}<button class="row-main" data-chat="${esc(c.id)}" aria-label="محادثة ${esc(c.name)}" aria-current="${c.id === activeId}">${avatar(c)}<span class="row-content"><span class="row-top"><strong>${esc(c.name)}</strong><time>${esc(last?.time || c.time || "الآن")}</time></span><span class="row-preview" style="display:block">${last?.by === "me" ? "أنت: " : ""}${esc(last?.text || (last?.image ? "صورة مرفقة" : "ابدأ محادثة جديدة"))}</span><span class="row-bottom"><span class="row-order">#W-${esc(c.order)}</span>${c.tags[0] ? `<span class="row-tag">${esc(c.tags[0])}</span>` : ""}${c.starred ? `<span class="row-star">${icon("star")}</span>` : ""}${c.priority !== "normal" ? `<span class="row-flag ${c.priority}" title="أولوية ${PRIORITY[c.priority]}">${icon("flag")}</span>` : ""}${c.unread ? `<span class="unread-badge">${c.unread}</span>` : waiting ? `<span class="row-flag urgent" title="متأخر عن وقت الرد المستهدف">${icon("clock")}</span>` : c.assignee === "me" ? '<span class="row-assigned" title="مسندة إليك">م</span>' : ""}</span></span></button></div>`;
        })
        .join("")
    : `<div class="empty-state">${icon("search")}<strong>لا توجد محادثات هنا</strong><small>جرّب بحثاً مختلفاً، أو أنشئ محادثة جديدة للبدء.</small><button id="clearFilters">إظهار كل المحادثات</button></div>`;
  $$(".saved-views [data-view]").forEach((b) =>
    b.classList.toggle("selected", b.dataset.view === view),
  );
  if ($("#clearFilters"))
    $("#clearFilters").onclick = () => {
      view = "all";
      contactType = "all";
      statusFilter = "all";
      $("#search").value = "";
      $("#statusFilter").value = "all";
      renderTypeTabs();
      renderList();
    };
}
function renderTypeTabs() {
  $$("[data-type]").forEach((b) => {
    const on = b.dataset.type === contactType;
    b.classList.toggle("selected", on);
    b.setAttribute("aria-selected", String(on));
  });
}
function highlight(value, query) {
  const text = String(value || "");
  if (!query) return esc(text);
  const pieces = text.split(
    new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
  );
  return pieces
    .map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part)))
    .join("");
}
function renderMessages(scroll = false) {
  const c = current(),
    el = $("#messages"),
    nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80,
    previous = el.scrollTop;
  if (!c) {
    el.innerHTML = `<div class="empty-state">${icon("chat")}<strong>كل محادثة، بداية لتجربة أفضل.</strong><small>اختر محادثة من القائمة أو أنشئ محادثة جديدة.</small></div>`;
    return;
  }
  const q = $("#messageSearch").value.trim(),
    list = c.messages.filter(
      (m) => !q || (m.text || "").toLowerCase().includes(q.toLowerCase()),
    );
  $("#messageMatchCount").textContent = q ? `${list.length} نتيجة` : "";
  el.innerHTML =
    `<div class="date-label"><span>${cloudMode ? "سجل المحادثة" : "محادثة توضيحية"}</span></div>` +
    (list.length
      ? list
          .map((m) => {
            if (m.by === "event")
              return `<div class="event-label">${icon("checks")}${highlight(m.text, q)}</div>`;
            if (m.by === "note")
              return `<div class="internal-note"><div>${icon("lock")}ملاحظة داخلية · لا تُرسل للعميل</div><p>${highlight(m.text, q)}</p><time>${esc(m.time)}</time></div>`;
            const image = safeImage(m.image, repository?.origin),
              missing = m.imagePath && !image;
            return `<article class="message ${m.by === "me" ? "outgoing" : "incoming"}"><div class="message-author">${m.by === "me" ? '<span class="mini-agent">م</span>أنت · خدمة العملاء' : esc(c.name)}</div><div class="bubble">${image ? `<img src="${esc(image)}" alt="صورة مرفقة في المحادثة">` : missing ? "<small>المرفق غير متاح حالياً. أعد تحديث المحادثة.</small>" : ""}${highlight(m.text, q)}</div><div class="message-meta"><time>${esc(m.time)}</time>${m.by === "me" ? `<span title="${cloudMode ? "محفوظة على مساحة العمل" : "محفوظة في العرض التجريبي"}">${icon("check")}</span>` : ""}</div></article>`;
          })
          .join("")
      : `<div class="empty-state">${icon(q ? "search" : "chat")}<strong>${q ? "لا توجد رسالة مطابقة" : "اكتب أول رسالة"}</strong><small>${q ? "جرّب عبارة أخرى." : "ابدأ التواصل من مربع الرد أدناه."}</small></div>`);
  requestAnimationFrame(() => {
    if (scroll || nearBottom) el.scrollTop = el.scrollHeight;
    else el.scrollTop = previous;
  });
}
function updateSla() {
  const c = current(),
    banner = $("#slaBanner");
  if (!c) {
    banner.hidden = true;
    return;
  }
  const item = sla(c);
  banner.hidden = item.state === "clear";
  banner.classList.toggle("overdue", item.state === "overdue");
  banner.innerHTML = `${icon("clock")}<span>${item.state === "overdue" ? "العميل ينتظر رداً · تجاوز الهدف" : "هدف الرد على الرسائل المفتوحة: 5 دقائق"}</span><strong>${item.state === "overdue" ? "+" : ""}${duration(item.seconds)}</strong>`;
}
function renderComposer() {
  const note = composeMode === "note",
    c = current();
  $("#replyMode").classList.toggle("selected", !note);
  $("#noteMode").classList.toggle("selected", note);
  $("#replyMode").setAttribute("aria-selected", String(!note));
  $("#noteMode").setAttribute("aria-selected", String(note));
  $("#messageForm").classList.toggle("note-composer", note);
  $("#sendLabel").textContent = note ? "حفظ الملاحظة" : "إرسال الرد";
  $("#messageInput").placeholder = note
    ? "أضف معلومة تساعدك في متابعة الحالة…"
    : "اكتب ردّك، وخلّ التجربة أقرب…";
  $("#composeRecipient").textContent = note
    ? "داخلية · لا تظهر للعميل"
    : c
      ? `الردّ على ${c.type === "driver" ? "المندوب" : "العميل"}`
      : "اختر محادثة";
  $("#attachBtn").disabled = note || saving;
  const value = drafts[draftKey()] || "";
  if ($("#messageInput").value !== value) $("#messageInput").value = value;
  $("#draftHint").textContent = value
    ? "مسودة محفوظة مؤقتاً"
    : "ردّك واضح، وعميلك مطمئن.";
  const replies = note
    ? [
        [
          "متابعة المندوب",
          "يرجى متابعة المندوب وتأكيد وقت الوصول قبل إغلاق الحالة.",
        ],
        [
          "تأكيد التفاصيل",
          "تأكد من تفاصيل الطلب والعنوان مع العميل قبل المتابعة.",
        ],
      ]
    : [
        ["متابعة الطلب", "جاري التواصل مع المندوب، وبنوافيك بالتحديث قريباً."],
        ["طلب الموقع", "فضلاً أرسل موقعك الحالي لتسهيل وصول المندوب."],
        ["شكر العميل", "شكراً لتواصلك معنا، سعداء بخدمتك دائماً 💚"],
      ];
  $("#quickReplies").innerHTML =
    icon("bolt") +
    replies
      .map(
        ([label, text]) =>
          `<button data-reply="${esc(text)}">${label}</button>`,
      )
      .join("");
  $("#attachmentPreview").hidden = !attachment || note;
}
function renderChat(scroll = false) {
  const c = current();
  $("#chatAvatar").innerHTML = c ? avatar(c) : "";
  $("#chatName").textContent = c?.name || "صندوق الوارد";
  $("#chatSubtitle").innerHTML = c
    ? `${!cloudMode && c.online ? '<i class="status-dot green"></i>' : ""}${c.type === "driver" ? "مندوب توصيل" : "عميل"} <span>·</span> ${cloudMode ? "الحضور غير متاح" : c.online ? "متاح في بيانات العرض" : "سجل توضيحي"}`
    : "اختر محادثة للمتابعة";
  $("#starBtn").classList.toggle("starred", !!c?.starred);
  $("#starBtn").setAttribute("aria-pressed", String(!!c?.starred));
  $("#orderStripId").textContent = c ? `#W-${c.order}` : "—";
  $("#orderStripState").textContent = c?.orderState || "";
  $("#orderStripState").classList.toggle(
    "delivered",
    c?.orderState === "تم التسليم",
  );
  renderMessages(scroll);
  renderComposer();
  renderDetails();
  updateSla();
}
function render(scroll = false) {
  renderMetrics();
  renderList();
  renderChat(scroll);
}
function renderDetails() {
  const c = current(),
    el = $("#detailsPanel");
  if (!c) {
    el.innerHTML = '<p class="detail-note">اختر محادثة لعرض تفاصيلها.</p>';
    return;
  }
  const amount = Number(String(c.amount || "").replaceAll(",", "")) || 0,
    delivery = Number(String(c.delivery || "").replaceAll(",", "")) || 0;
  const steps = ["طلب جديد", "قيد التجهيز", "في الطريق", "تم التسليم"],
    stage = steps.indexOf(c.orderState);
  el.innerHTML = `<div class="details-heading"><h3>تفاصيل المحادثة</h3><button class="icon-btn" id="closeDetails" aria-label="إغلاق التفاصيل">${icon("x")}</button></div>
  <section class="detail-section"><div class="contact-card">${avatar(c)}<div><strong>${esc(c.name)}</strong><small>${c.type === "driver" ? "مندوب توصيل" : "عميل"} · #W-${esc(c.order)}</small></div></div>
  <div class="control-pair"><label for="detailStatus">الحالة</label><select id="detailStatus">${Object.entries(
    STATUS,
  )
    .map(
      ([v, l]) =>
        `<option value="${v}" ${c.status === v ? "selected" : ""}>${l}</option>`,
    )
    .join("")}</select></div>
  <div class="control-pair"><label for="detailPriority">الأولوية</label><select id="detailPriority" class="priority-${esc(c.priority)}">${Object.entries(
    PRIORITY,
  )
    .map(
      ([v, l]) =>
        `<option value="${v}" ${c.priority === v ? "selected" : ""}>${l}</option>`,
    )
    .join("")}</select></div>
  <div class="control-pair"><label for="detailAssignee">المسؤول</label><select id="detailAssignee"><option value="" ${!c.assignee ? "selected" : ""}>غير مسندة</option><option value="me" ${c.assignee === "me" ? "selected" : ""}>مسندة إليّ</option></select></div></section>
  <section class="detail-section"><h4 class="detail-label">الوسوم<span>${c.tags.length}</span></h4><div class="tags">${c.tags.map((tag) => `<span class="tag-chip">${esc(tag)}<button data-remove-tag="${esc(tag)}" aria-label="إزالة وسم ${esc(tag)}">×</button></span>`).join("")}<button id="addTagBtn" class="add-tag">+ إضافة وسم</button></div><select id="tagSelect" class="tag-selector" aria-label="إضافة وسم" hidden><option value="">اختر الوسم</option>${TAGS.filter(
    (t) => !c.tags.includes(t),
  )
    .map((t) => `<option>${t}</option>`)
    .join("")}</select></section>
  <section class="detail-section"><h4 class="detail-label">طلب التوصيل<button class="small-icon" id="editOrderBtn" aria-label="تعديل بيانات الطلب">${icon("edit")}</button></h4><div class="order-card"><div class="order-card-head"><span>${icon("box")}</span><div><small>رقم الطلب</small><b dir="ltr">#W-${esc(c.order)}</b></div><span class="delivery-badge ${stage === 3 ? "delivered" : ""}">${esc(c.orderState)}</span></div><div class="route"><div class="route-point"><small>نقطة الاستلام</small><b>${esc(c.restaurant || "بانتظار تحديد المتجر")}</b><p>${esc(c.pickup || "لم يُحدد العنوان بعد")}</p></div><div class="route-point destination"><small>عنوان التوصيل</small><b>${esc(c.address || "لم يُحدد العنوان بعد")}</b></div></div><div class="order-progress" aria-label="تقدم الطلب"><span class="${stage >= 0 ? "done" : ""}"></span><span class="${stage >= 1 ? "done" : ""}"></span><span class="${stage >= 2 ? "done" : ""}"></span><span class="${stage >= 3 ? "done" : ""}"></span></div></div></section>
  <section class="detail-section"><h4 class="detail-label">مندوب التوصيل</h4><div class="driver-card"><span class="avatar sage">${esc(
    (c.driver || "—")
      .split(" ")
      .map((x) => x[0])
      .slice(0, 2)
      .join(" "),
  )}</span><div><strong>${esc(c.driver || "لم يُعيّن مندوب")}</strong><small>${c.driver ? "المندوب المرتبط بالطلب" : "بانتظار التعيين"}</small></div><button class="icon-btn" id="contactDriver" aria-label="مراسلة المندوب">${icon("chat")}</button></div></section>
  <section class="detail-section"><h4 class="detail-label">ملخص الدفع</h4><div class="payment-row"><span>قيمة الطلب</span><b>${esc(c.amount || "—")} ر.ي</b></div><div class="payment-row"><span>التوصيل</span><b>${esc(c.delivery || "—")} ر.ي</b></div><div class="payment-row payment-total"><span>الإجمالي</span><b>${amount || delivery ? (amount + delivery).toLocaleString("en-US") : "—"} ر.ي</b></div><div class="payment-row"><span>طريقة الدفع</span><b>${esc(c.payment || "غير محددة")}</b></div></section>
  <section class="detail-section"><h4 class="detail-label">تذكير بالمتابعة<span>${icon("clock")}</span></h4><div class="followup"><select id="followupSelect" aria-label="تحديد موعد المتابعة"><option value="">تحديد موعد للمتابعة</option><option value="15">بعد 15 دقيقة</option><option value="30">بعد 30 دقيقة</option><option value="60">بعد ساعة</option><option value="1440">بعد 24 ساعة</option></select>${c.followUpAt ? `<div class="followup-label ${new Date(c.followUpAt) < new Date() ? "overdue" : ""}">${icon("clock")}<span>${new Date(c.followUpAt).toLocaleString("ar-YE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Aden" })}</span><button id="clearFollowup">إلغاء</button></div>` : ""}</div></section>
  <button class="detail-summary" id="detailSummary">${icon("spark")}ملخص السجل والخطوة التالية${icon("arrowLeft")}</button>`;
  $("#closeDetails").onclick = () => el.classList.remove("open");
  $("#detailStatus").onchange = (e) =>
    patchChat(c, { status: e.target.value }, "تم تحديث حالة المحادثة");
  $("#detailPriority").onchange = (e) =>
    patchChat(c, { priority: e.target.value }, "تم تحديث الأولوية");
  $("#detailAssignee").onchange = (e) =>
    patchChat(
      c,
      { assignee: e.target.value || null },
      e.target.value ? "تم إسناد المحادثة إليك" : "أصبحت المحادثة غير مسندة",
    );
  $("#addTagBtn").onclick = () => {
    $("#tagSelect").hidden = !$("#tagSelect").hidden;
  };
  $("#tagSelect").onchange = (e) => {
    if (e.target.value)
      patchChat(c, { tags: [...c.tags, e.target.value] }, "تمت إضافة الوسم");
  };
  $$("[data-remove-tag]").forEach(
    (b) =>
      (b.onclick = () =>
        patchChat(
          c,
          { tags: c.tags.filter((t) => t !== b.dataset.removeTag) },
          "تمت إزالة الوسم",
        )),
  );
  $("#followupSelect").onchange = (e) => {
    if (e.target.value)
      patchChat(
        c,
        {
          followUpAt: new Date(
            Date.now() + Number(e.target.value) * 60000,
          ).toISOString(),
        },
        "تم تحديد موعد المتابعة",
      );
  };
  if ($("#clearFollowup"))
    $("#clearFollowup").onclick = () =>
      patchChat(c, { followUpAt: null }, "تم إلغاء المتابعة");
  $("#editOrderBtn").onclick = () => editOrder(c);
  $("#contactDriver").onclick = () => contactDriver(c);
  $("#detailSummary").onclick = () => showSummary(c);
}

function databasePatch(patch) {
  const names = {
    status: "status",
    priority: "priority",
    assignee: "assignee",
    starred: "starred",
    tags: "tags",
    followUpAt: "follow_up_at",
    unread: "unread_count",
    orderState: "order_state",
  };
  return Object.fromEntries(
    Object.entries(patch)
      .filter(([key]) => names[key])
      .map(([key, value]) => [names[key], value]),
  );
}
async function mutate(operation, apply, text = "") {
  if (saving) return false;
  saveDraft();
  busy(true);
  const generation = sessionGeneration;
  try {
    if (cloudMode) await operation();
    if (generation !== sessionGeneration) return false;
    apply();
    if (!cloudMode) persist();
    render(true);
    if (cloudMode) {
      try {
        await refreshCloud();
      } catch {
        toast("تم الحفظ، وتعذّر تحديث القائمة. أعد تحميل الصفحة.");
        return true;
      }
    }
    if (text) toast(text);
    return true;
  } catch (error) {
    cloudError(error);
    return false;
  } finally {
    busy(false);
    if (composeMode === "note") $("#attachBtn").disabled = true;
    if (refreshAgain) {
      refreshAgain = false;
      scheduleRefresh();
    }
  }
}
async function patchChat(c, patch, text) {
  return mutate(
    () => repository.update(c.id, databasePatch(patch)),
    () => Object.assign(c, patch),
    text,
  );
}
async function selectChat(id) {
  if (saving) return;
  saveDraft();
  activeId = id;
  attachment = null;
  pendingSend = null;
  $("#attachmentPreview").hidden = true;
  $("#messageSearch").value = "";
  $("#chatSearchBar").hidden = true;
  $("#chatMenu").hidden = true;
  const c = current();
  if (!c) return;
  renderChat(true);
  renderList();
  $(".inbox").classList.add("chat-visible");
  closeSidebar();
  if (c.unread) {
    if (cloudMode) {
      try {
        await repository.update(c.id, { unread_count: 0 });
        c.unread = 0;
        renderList();
      } catch (error) {
        cloudError(error);
      }
    } else {
      c.unread = 0;
      persist();
      renderList();
    }
  }
}
function setComposeMode(mode) {
  saveDraft();
  composeMode = mode;
  renderComposer();
  $("#messageInput").focus();
}
async function send(e) {
  e?.preventDefault();
  if (saving) return;
  const c = current(),
    text = $("#messageInput").value.trim(),
    note = composeMode === "note",
    image = note ? null : attachment;
  if (!c) return toast("اختر محادثة أو أنشئ محادثة جديدة.");
  if (!text && !image) return;
  if (text.length > 4000) return toast("الحد الأقصى للرسالة 4000 حرف.");
  if (
    !pendingSend ||
    pendingSend.chat !== c.id ||
    pendingSend.text !== text ||
    pendingSend.image !== image ||
    pendingSend.note !== note
  )
    pendingSend = { id: crypto.randomUUID(), chat: c.id, text, image, note };
  const id = pendingSend.id,
    modeKey = draftKey(),
    createdAt = new Date().toISOString();
  await mutate(
    () => repository.send(c.id, text, image, id, note ? "note" : "outgoing"),
    () => {
      c.messages.push({
        id,
        by: note ? "note" : "me",
        text,
        time: clock(createdAt),
        createdAt,
        ...(image ? { image } : {}),
      });
      if (!note) {
        c.unread = 0;
        if (c.status === "resolved") c.status = "open";
      }
      c.time = clock(createdAt);
      drafts[modeKey] = "";
      $("#messageInput").value = "";
      if (!note) attachment = null;
      pendingSend = null;
      $("#attachmentPreview").hidden = true;
      $("#messageSearch").value = "";
      $("#emojiPicker").hidden = true;
    },
    note ? "حُفظت الملاحظة الداخلية" : "",
  );
  $("#messageInput").focus();
}
async function createChat(c) {
  return mutate(
    () => repository.create(c),
    () => {
      chats.unshift(c);
      activeId = c.id;
    },
    "تم إنشاء المحادثة",
  );
}
async function contactDriver(c) {
  if (!c.driver) return toast("لم يُعيّن مندوب لهذا الطلب بعد.");
  let d = chats.find(
    (x) => x.name === c.driver && x.type === "driver" && x.order === c.order,
  );
  if (!d) {
    d = normalize({
      ...c,
      id: crypto.randomUUID(),
      name: c.driver,
      initials: c.driver
        .split(" ")
        .map((x) => x[0])
        .slice(0, 2)
        .join(" "),
      type: "driver",
      color: "sage",
      unread: 0,
      messages: [],
      starred: false,
      priority: "normal",
      status: "open",
      assignee: "me",
      followUpAt: null,
      createdAt: new Date().toISOString(),
    });
    if (!(await createChat(d))) return;
  }
  await selectChat(d.id);
  $("#detailsPanel").classList.remove("open");
}
function dialog(id) {
  const d = $(id);
  if (!d.open) d.showModal();
}
function info(title, html) {
  $("#infoTitle").textContent = title;
  $("#infoBody").innerHTML = html;
  dialog("#infoDialog");
}
function showSummary(c = current()) {
  if (!c) return toast("اختر محادثة أولاً.");
  const summary = summarize(c);
  info(
    `ملخص محادثة ${c.name}`,
    `<div class="summary-card"><h3>آخر ما قاله العميل / المندوب</h3><p>${esc(summary.incoming)}</p></div><div class="summary-card"><h3>آخر رد من خدمة العملاء</h3><p>${esc(summary.outgoing)}</p></div><div class="summary-card next"><h3>الخطوة التالية المقترحة</h3><p>${esc(summary.next)}</p></div><p class="info-footnote">الطلب #W-${esc(c.order)} · ${STATUS[c.status]} · أولوية ${PRIORITY[c.priority]}<br>هذا الملخص مستخرج من السجل والوسوم، ويحتاج مراجعتك قبل اتخاذ إجراء.</p>`,
  );
}
const SUGGESTIONS = [
  [
    "تأكيد متابعة الطلب",
    "جاري متابعة طلبك مع المندوب، وبنرسل لك وقت الوصول فور تأكيده. شكراً لانتظارك.",
  ],
  [
    "تأكيد العنوان الجديد",
    "شكراً لإرسال العنوان. بنراجع التفاصيل ونؤكدها مع المندوب قبل متابعة التوصيل.",
  ],
  [
    "الاعتذار عن مشكلة الطلب",
    "نعتذر عن المشكلة التي واجهتك. فضلاً أرسل صورة أو تفاصيل إضافية لنتابعها مع المتجر ونساعدك في حلها.",
  ],
];
function replyAssistant() {
  if (!current()) return toast("اختر محادثة أولاً.");
  info(
    "مساعد الردود",
    `<p class="info-footnote">قوالب قابلة للتعديل. اختر الرد المناسب، راجعه، ثم أرسله بنفسك.</p>${SUGGESTIONS.map(([title, text], i) => `<button class="suggestion-button" data-suggestion="${i}"><strong>${title} ${icon("arrowLeft")}</strong><p>${text}</p></button>`).join("")}`,
  );
}
function showAnalytics() {
  const m = metrics(chats);
  info(
    "نظرة على أداء التواصل",
    `<div class="analytics-head"><div class="analytic-stat"><strong>${m.total}</strong><span>محادثة في السجل</span></div><div class="analytic-stat"><strong>${m.waiting}</strong><span>بانتظار رد</span></div><div class="analytic-stat"><strong>${m.urgent}</strong><span>حالة عاجلة مفتوحة</span></div></div>${Object.entries(
      STATUS,
    )
      .map(([status, label]) => {
        const n = chats.filter((c) => c.status === status).length;
        return `<div class="analytics-row"><span>${label}</span><div class="analytics-bar"><i style="width:${m.total ? (n / m.total) * 100 : 0}%"></i></div><b>${n}</b></div>`;
      })
      .join(
        "",
      )}<p class="info-footnote">متوسط وقت الرد: ${m.average === null ? "لا توجد بيانات كافية" : duration(m.average)}، محسوب من ${m.responses} ردود على رسائل واردة. الملاحظات الداخلية لا تُحسب رداً على العميل.<br>${cloudMode ? "المؤشرات تخص السجل المحمّل في هذا الحساب." : "المؤشرات محسوبة من بيانات العرض التجريبي."}</p>`,
  );
}
function showOrders() {
  const unique = [...new Map(chats.map((c) => [c.order, c])).values()];
  info(
    "الطلبات المرتبطة بالمحادثات",
    `<div class="table-wrap"><table class="data-table"><thead><tr><th>رقم الطلب</th><th>المتجر</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${unique.map((c) => `<tr><td dir="ltr">W-${esc(c.order)}</td><td>${esc(c.restaurant || "غير محدد")}</td><td>${esc(c.orderState)}</td><td><button data-open="${esc(c.id)}">فتح المحادثة</button></td></tr>`).join("")}</tbody></table></div>`,
  );
}
function showDrivers() {
  const drivers = chats.filter((c) => c.type === "driver");
  info(
    "محادثات المناديب",
    drivers.length
      ? drivers
          .map(
            (c) =>
              `<button class="suggestion-button" data-open="${esc(c.id)}"><strong>${esc(c.name)}</strong><p>الطلب #W-${esc(c.order)} · ${esc(c.orderState)}</p></button>`,
          )
          .join("")
      : '<p class="info-footnote">لا توجد محادثات مناديب بعد.</p>',
  );
}
function shortcuts() {
  info(
    "اختصارات تسرّع يومك",
    `<div class="shortcut-list"><div><span>البحث السريع والإجراءات</span><kbd>⌘ / Ctrl + K</kbd></div><div><span>بحث في صندوق الوارد</span><kbd>/</kbd></div><div><span>محادثة جديدة</span><kbd>N</kbd></div><div><span>إرسال رد أو حفظ ملاحظة</span><kbd>Enter</kbd></div><div><span>سطر جديد داخل الرسالة</span><kbd>Shift + Enter</kbd></div><div><span>إغلاق النافذة</span><kbd>Esc</kbd></div></div><p class="info-footnote">اختصارات N و / تعمل خارج حقول الكتابة.</p>`,
  );
}
function editOrder(c) {
  if (!c) return;
  for (const [field, key] of [
    ["Restaurant", "restaurant"],
    ["Pickup", "pickup"],
    ["Address", "address"],
  ])
    $(`#edit${field}`).value = c[key] || "";
  $("#editOrderState").value = c.orderState;
  $("#editAmount").value = String(c.amount || "").replaceAll(",", "");
  $("#editDelivery").value = String(c.delivery || "").replaceAll(",", "");
  $("#editPayment").value = c.payment || "الدفع عند الاستلام";
  dialog("#orderDialog");
}
function download(name, content, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportMessages() {
  const c = current();
  if (!c) return;
  const messages = c.messages.filter((m) => ["me", "them"].includes(m.by));
  download(
    `Wasl-W-${c.order}.txt`,
    "\uFEFF" +
      `وصل — سجل الرسائل\n${c.name} | #W-${c.order}\nالملاحظات الداخلية مستثناة من هذا التصدير.\n\n` +
      messages
        .map(
          (m) =>
            `${m.time} ${m.by === "me" ? "خدمة العملاء" : c.name}: ${m.text || "[صورة مرفقة]"}`,
        )
        .join("\n\n"),
  );
  toast("تم تنزيل الرسائل دون الملاحظات الداخلية.");
}
function setView(next) {
  view = next;
  selected.clear();
  renderList();
  closeSidebar();
  if (matchMedia("(max-width:700px)").matches)
    $(".inbox").classList.remove("chat-visible");
}
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebarOverlay").hidden = true;
}
function showDetails() {
  if (matchMedia("(max-width:1300px)").matches)
    $("#detailsPanel").classList.toggle("open");
  else {
    $("#detailsPanel").scrollTop = 0;
    $("#detailsPanel").animate(
      [{ background: "var(--teal-soft)" }, { background: "var(--panel-soft)" }],
      { duration: 600 },
    );
  }
}
function toggleTheme() {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("wasl-theme", next);
  } catch {}
  $("#themeBtn").innerHTML = icon(next === "dark" ? "sun" : "moon");
}
function commandResults() {
  const q = $("#commandInput").value.trim().toLowerCase();
  const found = chats
    .filter((c) =>
      [c.name, c.order, ...c.tags].join(" ").toLowerCase().includes(q),
    )
    .slice(0, 7);
  const actions = [
    ["new", "محادثة جديدة", "plus"],
    ["analytics", "نظرة على الأداء", "chart"],
    ["theme", "تبديل المظهر", "moon"],
    ["summary", "ملخص المحادثة الحالية", "spark"],
  ].filter(([, label]) => !q || label.includes(q));
  $("#commandResults").innerHTML =
    (actions.length
      ? "<h3>إجراءات سريعة</h3>" +
        actions
          .map(
            ([key, label, name]) =>
              `<button data-command="${key}">${icon(name)}${label}<small>إجراء</small></button>`,
          )
          .join("")
      : "") +
      (found.length
        ? "<h3>المحادثات</h3>" +
          found
            .map(
              (c) =>
                `<button data-command-chat="${esc(c.id)}">${avatar(c)}${esc(c.name)}<small dir="ltr">#W-${esc(c.order)}</small></button>`,
            )
            .join("")
        : "") || '<div class="empty-state">لا توجد نتائج مطابقة.</div>';
}
function openCommand() {
  dialog("#commandDialog");
  $("#commandInput").value = "";
  commandResults();
  $("#commandInput").focus();
}

// Data refreshes preserve the selected conversation, search filters, and unsent drafts.
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (saving || refreshing) {
      refreshAgain = true;
      return;
    }
    refreshCloud().catch(cloudError);
  }, 200);
}
async function refreshCloud() {
  if (!cloudMode) return;
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  const generation = sessionGeneration;
  refreshing = true;
  saveDraft();
  try {
    const data = await repository.list();
    if (generation !== sessionGeneration || !cloudMode) return;
    chats = data.map((c, i) => normalize(c, i));
    if (!chats.some((c) => c.id === activeId)) activeId = chats[0]?.id || null;
    for (const id of selected)
      if (!chats.some((c) => c.id === id)) selected.delete(id);
    render(false);
  } finally {
    refreshing = false;
    if (refreshAgain && !saving) {
      refreshAgain = false;
      scheduleRefresh();
    }
  }
}
function clearPrivateState() {
  sessionGeneration++;
  activeUserId = null;
  cloudMode = false;
  repository?.unsubscribe();
  clearTimeout(refreshTimer);
  chats = [];
  activeId = null;
  attachment = null;
  pendingSend = null;
  selected.clear();
  for (const key of Object.keys(drafts)) delete drafts[key];
  $("#messageInput").value = "";
  render();
}
function showAuth() {
  $("#authError").textContent =
    configError ||
    (!repository
      ? "مساحة العمل غير مهيأة بعد. يمكنك استكشاف العرض التجريبي."
      : "");
  $("#loginBtn").disabled = !repository || saving;
  dialog("#authDialog");
}
function demoMode() {
  clearPrivateState();
  let restored = null;
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    if (
      Array.isArray(value) &&
      value.length &&
      value.every(
        (c) =>
          typeof c.id === "string" &&
          typeof c.name === "string" &&
          Array.isArray(c.messages),
      )
    )
      restored = value;
  } catch {}
  chats = restored
    ? restored.map((c, i) => normalize(c, i))
    : enrichDemo(initial);
  if (!restored) {
    const c = chats[0];
    c.messages.splice(c.messages.length - 1, 0, {
      id: "demo-note",
      by: "note",
      text: "العميل ينتظر عند البوابة. يُرجى تأكيد الوصول مع المندوب قبل إغلاق المحادثة.",
      createdAt: c.messages.at(-1).createdAt,
      time: c.messages.at(-1).time,
    });
    persist();
  }
  activeId = chats[0]?.id || null;
  $("#agentName").textContent = "محمد وليد";
  $("#agentRole").textContent = "مساحة العرض التجريبي";
  $("#accountBtn").setAttribute("aria-label", "الدخول إلى مساحة العمل");
  $("#modeFooter").textContent =
    "عرض تجريبي · بيانات توضيحية محفوظة في المتصفح";
  modeLabel("عرض تجريبي");
  render(true);
  $("#authDialog").close();
}
async function enterCloud(user) {
  clearPrivateState();
  repository.user = user;
  activeUserId = user.id;
  cloudMode = true;
  $("#agentName").textContent =
    user.user_metadata?.full_name || user.email?.split("@")[0] || "مساحة العمل";
  $("#agentRole").textContent = "مساحة عمل خاصة";
  $("#accountBtn").setAttribute("aria-label", "تسجيل الخروج");
  $("#modeFooter").textContent =
    "صندوق خاص · آخر 100 محادثة و200 رسالة لكل محادثة";
  modeLabel("جارٍ الاتصال…");
  try {
    await refreshCloud();
    if (!cloudMode || activeUserId !== user.id) return;
    $("#authDialog").close();
    repository.subscribe(scheduleRefresh, (state) => {
      if (!cloudMode) return;
      if (state === "SUBSCRIBED") {
        modeLabel("متصل بمساحة العمل");
        scheduleRefresh();
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(state))
        modeLabel("التحديث المباشر غير متصل", true);
    });
  } catch {
    clearPrivateState();
    $("#authError").textContent =
      "تعذّر تحميل مساحة العمل. تأكد من إعداد الجداول وتحديثها، ثم أعد المحاولة.";
    dialog("#authDialog");
    modeLabel("تعذّر الاتصال", true);
  }
}

icons();
try {
  document.documentElement.dataset.theme =
    localStorage.getItem("wasl-theme") || "light";
} catch {}
$("#themeBtn").innerHTML = icon(
  document.documentElement.dataset.theme === "dark" ? "sun" : "moon",
);
$("#themeBtn").onclick = toggleTheme;
$("#homeBtn").onclick = () => setView("all");
$("#settingsBtn").onclick = () =>
  info(
    "إعدادات مساحة العمل",
    `<div class="summary-card"><h3>المظهر</h3><p>تبديل المظهر الفاتح والداكن متاح من زر القمر أعلى الصفحة.</p></div><div class="summary-card"><h3>نمط التشغيل</h3><p>${cloudMode ? "مساحة عمل متصلة بحسابك." : "عرض تجريبي ببيانات توضيحية. تفعيل التخزين السحابي يحتاج إعداد Supabase."}</p></div><p class="info-footnote">الإسناد هنا لتنظيم العمل داخل صندوقك، ولا يمنح حساباً آخر صلاحية الوصول.</p>`,
  );
$$("[data-view]").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
$$("[data-metric]").forEach(
  (b) => (b.onclick = () => setView(b.dataset.metric)),
);
$$("[data-nav]").forEach(
  (b) =>
    (b.onclick = () => {
      ({
        overview: showAnalytics,
        inbox: () => setView("all"),
        orders: showOrders,
        drivers: showDrivers,
      })[b.dataset.nav]();
    }),
);
$("#responseMetric").onclick = showAnalytics;
$("#viewsHelp").onclick = () =>
  info(
    "رتّب متابعتك بطريقتك",
    `<p class="info-footnote">اعرض المسند إليك، والحالات العاجلة، والمميزة بنجمة، والمتابعات التي حان موعدها.<br>الإسناد لتنظيم العمل فقط؛ صلاحيات الوصول يحددها حساب مساحة العمل.</p>`,
  );
$("#mobileMenu").onclick = () => {
  $("#sidebar").classList.add("open");
  $("#sidebarOverlay").hidden = false;
};
$("#sidebarOverlay").onclick = closeSidebar;
$("#backBtn").onclick = () => $(".inbox").classList.remove("chat-visible");
$("#detailsBtn").onclick = showDetails;
$("#viewOrderBtn").onclick = showDetails;
$("#search").oninput = renderList;
$$("[data-type]").forEach(
  (b) =>
    (b.onclick = () => {
      contactType = b.dataset.type;
      renderTypeTabs();
      renderList();
    }),
);
$("#statusFilter").onchange = (e) => {
  statusFilter = e.target.value;
  renderList();
};
$("#sortBtn").onclick = () => {
  sort =
    sort === "recent" ? "priority" : sort === "priority" ? "oldest" : "recent";
  renderList();
};
$("#conversationList").onclick = (e) => {
  const b = e.target.closest("[data-chat]");
  if (b) selectChat(b.dataset.chat);
};
$("#conversationList").onchange = (e) => {
  const id = e.target.dataset.check;
  if (!id) return;
  if (e.target.checked) selected.add(id);
  else selected.delete(id);
  renderList();
};
$("#selectModeBtn").onclick = () => {
  selectMode = !selectMode;
  if (!selectMode) selected.clear();
  renderList();
};
$("#cancelSelection").onclick = () => {
  selectMode = false;
  selected.clear();
  renderList();
};
$("#selectAll").onchange = (e) => {
  for (const c of filtered())
    if (e.target.checked) selected.add(c.id);
    else selected.delete(c.id);
  renderList();
};
$("#bulkResolve").onclick = async () => {
  const ids = [...selected];
  if (!ids.length) return;
  await mutate(
    () => repository.updateMany(ids, { status: "resolved" }),
    () => {
      chats
        .filter((c) => selected.has(c.id))
        .forEach((c) => (c.status = "resolved"));
      selected.clear();
      selectMode = false;
    },
    "تم حلّ المحادثات المحددة",
  );
};
$("#starBtn").onclick = () => {
  const c = current();
  if (c)
    patchChat(
      c,
      { starred: !c.starred },
      c.starred ? "أزيلت النجمة" : "أضيفت للمحادثات المميزة",
    );
};
$("#menuBtn").onclick = () => ($("#chatMenu").hidden = !$("#chatMenu").hidden);
$("#summaryBtn").onclick = () => {
  $("#chatMenu").hidden = true;
  showSummary();
};
$("#markUnreadBtn").onclick = () => {
  const c = current();
  if (c) patchChat(c, { unread: 1 }, "تم تحديد المحادثة كغير مقروءة");
  $("#chatMenu").hidden = true;
};
$("#exportBtn").onclick = () => {
  exportMessages();
  $("#chatMenu").hidden = true;
};
$("#exportCsvBtn").onclick = () => {
  download(
    "Wasl_Conversations.csv",
    csvExport(filtered()),
    "text/csv;charset=utf-8",
  );
  toast("تم تصدير المحادثات المعروضة.");
};
$("#chatSearchBtn").onclick = () => {
  $("#chatSearchBar").hidden = !$("#chatSearchBar").hidden;
  if (!$("#chatSearchBar").hidden) $("#messageSearch").focus();
};
$("#messageSearch").oninput = () => renderMessages(true);
$("#closeChatSearch").onclick = () => {
  $("#chatSearchBar").hidden = true;
  $("#messageSearch").value = "";
  renderMessages(true);
};
$("#messageForm").onsubmit = send;
$("#replyMode").onclick = () => setComposeMode("reply");
$("#noteMode").onclick = () => setComposeMode("note");
$("#replyAssistBtn").onclick = replyAssistant;
$("#quickReplies").onclick = (e) => {
  const b = e.target.closest("[data-reply]");
  if (b) {
    $("#messageInput").value = b.dataset.reply;
    saveDraft();
    $("#messageInput").focus();
    $("#draftHint").textContent = "مسودة محفوظة مؤقتاً";
  }
};
$("#messageInput").oninput = () => {
  saveDraft();
  $("#messageInput").style.height = "auto";
  $("#messageInput").style.height =
    Math.min($("#messageInput").scrollHeight, 110) + "px";
  $("#draftHint").textContent = $("#messageInput").value
    ? "مسودة محفوظة مؤقتاً"
    : "ردّك واضح، وعميلك مطمئن.";
};
$("#messageInput").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
};
$("#emojiBtn").onclick = () =>
  ($("#emojiPicker").hidden = !$("#emojiPicker").hidden);
$$("#emojiPicker button").forEach(
  (b) =>
    (b.onclick = () => {
      const input = $("#messageInput");
      input.setRangeText(
        b.textContent,
        input.selectionStart,
        input.selectionEnd,
        "end",
      );
      saveDraft();
      input.focus();
      $("#emojiPicker").hidden = true;
    }),
);
$("#attachBtn").onclick = () => $("#fileInput").click();
$("#fileInput").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    return toast("اختر صورة PNG أو JPG أو WebP بحد أقصى 5 ميجابايت.");
  const owner = activeId;
  try {
    const image = await createImageBitmap(file),
      canvas = document.createElement("canvas"),
      ratio = Math.min(1, 1000 / Math.max(image.width, image.height));
    canvas.width = image.width * ratio;
    canvas.height = image.height * ratio;
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    if (owner !== activeId) return;
    attachment = canvas.toDataURL("image/jpeg", 0.72);
    attachmentName = file.name;
    $("#attachmentPreview").innerHTML =
      `<img src="${attachment}" alt="معاينة المرفق"><span>${esc(attachmentName)}</span><button id="removeAttachment" class="icon-btn" aria-label="إزالة المرفق">${icon("x")}</button>`;
    $("#attachmentPreview").hidden = false;
    $("#removeAttachment").onclick = () => {
      attachment = null;
      $("#attachmentPreview").hidden = true;
    };
  } catch {
    toast("تعذّر فتح الصورة. جرّب ملفاً آخر.");
  }
};
$("#newChatBtn").onclick = () => dialog("#newChatDialog");
$("#newChatForm").onsubmit = async (e) => {
  e.preventDefault();
  if (saving) return;
  const name = $("#newName").value.trim(),
    order = $("#newOrder")
      .value.trim()
      .replace(/^#?(W-)?/i, "");
  if (!name || !order) return;
  const c = normalize({
    id: crypto.randomUUID(),
    name,
    initials: name
      .split(/\s+/)
      .map((x) => x[0])
      .slice(0, 2)
      .join(" "),
    type: $("#newType").value,
    color: "blue",
    online: false,
    order,
    orderState: "طلب جديد",
    status: "open",
    unread: 0,
    time: timeNow(),
    createdAt: new Date().toISOString(),
    messages: [],
    priority: $("#newPriority").value,
    assignee: $("#newAssignee").value || null,
  });
  if (await createChat(c)) {
    $("#newChatDialog").close();
    $("#newChatForm").reset();
    selectChat(c.id);
  }
};
$("#orderForm").onsubmit = async (e) => {
  e.preventDefault();
  const c = current();
  if (!c) return;
  const details = Object.fromEntries(
    [
      "driver",
      "address",
      "restaurant",
      "pickup",
      "amount",
      "delivery",
      "payment",
    ]
      .filter((k) => c[k] !== undefined)
      .map((k) => [k, c[k]]),
  );
  Object.assign(details, {
    restaurant: $("#editRestaurant").value.trim(),
    pickup: $("#editPickup").value.trim(),
    address: $("#editAddress").value.trim(),
    amount: $("#editAmount").value
      ? Number($("#editAmount").value).toLocaleString("en-US")
      : "",
    delivery: $("#editDelivery").value
      ? Number($("#editDelivery").value).toLocaleString("en-US")
      : "",
    payment: $("#editPayment").value,
  });
  const state = $("#editOrderState").value;
  if (
    await mutate(
      () =>
        repository.update(c.id, { order_details: details, order_state: state }),
      () => Object.assign(c, details, { orderState: state }),
      "تم حفظ تفاصيل الطلب",
    )
  )
    $("#orderDialog").close();
};
$$("[data-close]").forEach(
  (b) => (b.onclick = () => $(`#${b.dataset.close}`).close()),
);
$$("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    if (e.target === d && d.id !== "authDialog") {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    }
  }),
);
$("#infoBody").onclick = (e) => {
  const open = e.target.closest("[data-open]");
  if (open) {
    $("#infoDialog").close();
    selectChat(open.dataset.open);
  }
  const suggestion = e.target.closest("[data-suggestion]");
  if (suggestion) {
    $("#infoDialog").close();
    setComposeMode("reply");
    $("#messageInput").value =
      SUGGESTIONS[Number(suggestion.dataset.suggestion)][1];
    saveDraft();
    $("#messageInput").focus();
  }
};
$("#commandBtn").onclick = openCommand;
$("#commandInput").oninput = commandResults;
$("#commandInput").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("#commandResults button")?.click();
  }
};
$("#commandResults").onclick = (e) => {
  const chat = e.target.closest("[data-command-chat]"),
    action = e.target.closest("[data-command]");
  if (!chat && !action) return;
  $("#commandDialog").close();
  if (chat) selectChat(chat.dataset.commandChat);
  else
    ({
      new: () => dialog("#newChatDialog"),
      analytics: showAnalytics,
      theme: toggleTheme,
      summary: showSummary,
    })[action.dataset.command]();
};
$("#shortcutsBtn").onclick = shortcuts;
$("#helpBtn").onclick = shortcuts;
$("#notificationsBtn").onclick = () => {
  const pending = chats.filter(
    (c) => awaitingSince(c) || matches(c, { view: "followup" }),
  );
  info(
    "ما يحتاج انتباهك",
    pending.length
      ? pending
          .map(
            (c) =>
              `<button class="suggestion-button" data-open="${esc(c.id)}"><strong>${esc(c.name)} · #W-${esc(c.order)}</strong><p>${awaitingSince(c) ? "بانتظار رد على آخر الرسائل" : "حان موعد متابعة هذه المحادثة"}</p></button>`,
          )
          .join("")
      : '<p class="info-footnote">لا توجد رسائل بانتظار الرد أو متابعات مستحقة الآن.</p>',
  );
};
document.addEventListener("click", (e) => {
  if (!e.target.closest("#chatMenu") && !e.target.closest("#menuBtn"))
    $("#chatMenu").hidden = true;
  if (!e.target.closest("#emojiPicker") && !e.target.closest("#emojiBtn"))
    $("#emojiPicker").hidden = true;
});
document.addEventListener("keydown", (e) => {
  const input = e.target.closest(
    "input,textarea,select,[contenteditable=true]",
  );
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (!$("#authDialog").open) openCommand();
    return;
  }
  if (e.key === "Escape") {
    closeSidebar();
    $("#detailsPanel").classList.remove("open");
    $("#chatMenu").hidden = true;
  }
  if (
    input ||
    $$("dialog").some((d) => d.open) ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey
  )
    return;
  if (e.key === "/") {
    e.preventDefault();
    $("#search").focus();
  }
  if (e.key.toLowerCase() === "n") {
    e.preventDefault();
    dialog("#newChatDialog");
  }
});
$("#authDialog").addEventListener("cancel", (e) => e.preventDefault());
$("#demoBtn").onclick = demoMode;
$("#accountBtn").onclick = async () => {
  if (saving) return;
  if (!cloudMode) return showAuth();
  busy(true);
  try {
    await repository.signOut();
    clearPrivateState();
    showAuth();
  } catch (error) {
    cloudError(error);
  } finally {
    busy(false);
    $("#loginBtn").disabled = !repository;
  }
};
$("#authForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!repository || saving) return;
  $("#authError").textContent = "";
  busy(true);
  try {
    const user = await repository.signIn(
      $("#authEmail").value.trim(),
      $("#authPassword").value,
    );
    $("#authPassword").value = "";
    await enterCloud(user);
  } catch {
    $("#authError").textContent =
      "تعذّر تسجيل الدخول. تحقق من بياناتك واتصال الإنترنت.";
  } finally {
    busy(false);
  }
};
window.addEventListener("storage", (e) => {
  if (!cloudMode && e.key === KEY && e.newValue) {
    try {
      const value = JSON.parse(e.newValue);
      if (Array.isArray(value) && value.length) {
        saveDraft();
        chats = value.map((c, i) => normalize(c, i));
        if (!current()) activeId = chats[0].id;
        render(false);
      }
    } catch {}
  }
});
window.addEventListener("online", () => {
  if (cloudMode) scheduleRefresh();
});
window.addEventListener("offline", () => {
  if (cloudMode) modeLabel("الاتصال منقطع", true);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && cloudMode) scheduleRefresh();
});
setInterval(() => {
  updateSla();
  renderMetrics();
  if (view === "followup") renderList();
}, 15000);
setInterval(() => {
  if (cloudMode && !document.hidden) scheduleRefresh();
}, 240000);
async function boot() {
  let config = null;
  try {
    config = readConfig(import.meta.env);
  } catch (error) {
    configError = error.message;
  }
  if (!config) {
    demoMode();
    if (configError) showAuth();
    return;
  }
  repository = new CloudRepository(config);
  clearPrivateState();
  modeLabel("جارٍ الاتصال…");
  repository.client.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (event === "SIGNED_OUT" && cloudMode) {
        clearPrivateState();
        showAuth();
      } else if (
        event === "SIGNED_IN" &&
        session?.user &&
        activeUserId !== session.user.id
      )
        enterCloud(session.user);
    }, 0);
  });
  try {
    const user = await repository.session();
    if (user) await enterCloud(user);
    else showAuth();
  } catch {
    configError = "تعذّر الاتصال بمساحة العمل.";
    showAuth();
  }
}
boot();
