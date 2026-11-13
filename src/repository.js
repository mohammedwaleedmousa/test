import { createClient } from "@supabase/supabase-js";

const BUCKET = "chat-attachments";
const time = (value) =>
  new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Aden",
  });

export function readConfig(env) {
  const url = (env.VITE_SUPABASE_URL || "").trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!url && !key) return null;
  if (!url || !key)
    throw new Error(
      "أكمل عنوان مساحة العمل ومفتاح الاتصال العام في الإعدادات.",
    );
  if (new URL(url).protocol !== "https:")
    throw new Error("يجب أن يكون اتصال مساحة العمل عبر HTTPS.");
  if (!key.startsWith("sb_publishable_")) {
    throw new Error(
      "استخدم Publishable key فقط، ولا تضع أي مفتاح سري في الواجهة.",
    );
  }
  return { url, key };
}

export function safeImage(value, origin = "") {
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value || ""))
    return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.origin === new URL(origin).origin &&
      url.pathname.includes("/storage/v1/object/sign/chat-attachments/")
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function toConversation(row, signed = {}) {
  const messages = [...(row.messages || [])]
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    )
    .map((m) => ({
      id: m.id,
      by:
        m.direction === "outgoing"
          ? "me"
          : m.direction === "event"
            ? "event"
            : m.direction === "note"
              ? "note"
              : "them",
      text: m.body,
      time: time(m.created_at),
      createdAt: m.created_at,
      ...(m.image_path
        ? { image: signed[m.image_path] || "", imagePath: m.image_path }
        : {}),
    }));
  return {
    ...row.order_details,
    id: row.id,
    name: row.name,
    initials: row.initials,
    color: row.color,
    type: row.contact_type,
    order: row.order_number,
    orderState: row.order_state,
    online: false,
    status: row.status,
    unread: row.unread_count,
    createdAt: row.created_at,
    priority: row.priority || "normal",
    assignee: row.assignee || null,
    starred: !!row.starred,
    tags: row.tags || [],
    followUpAt: row.follow_up_at || null,
    time: time(row.updated_at),
    messages,
  };
}

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

export class CloudRepository {
  constructor(config) {
    this.origin = new URL(config.url).origin;
    this.client = createClient(config.url, config.key);
    this.user = null;
    this.channel = null;
  }
  async session() {
    const data = unwrap(await this.client.auth.getSession());
    this.user = data.session?.user || null;
    return this.user;
  }
  async signIn(email, password) {
    const data = unwrap(
      await this.client.auth.signInWithPassword({ email, password }),
    );
    this.user = data.user;
    return this.user;
  }
  async signOut() {
    this.unsubscribe();
    unwrap(await this.client.auth.signOut({ scope: "local" }));
    this.user = null;
  }
  async list() {
    const rows = unwrap(
      await this.client
        .from("conversations")
        .select("*, messages(*)")
        .eq("owner_id", this.user.id)
        .order("updated_at", { ascending: false })
        .order("created_at", { referencedTable: "messages", ascending: false })
        .limit(100)
        .limit(200, { referencedTable: "messages" }),
    );
    const paths = [
      ...new Set(
        rows.flatMap((r) =>
          r.messages.map((m) => m.image_path).filter(Boolean),
        ),
      ),
    ];
    const signed = {};
    if (paths.length) {
      const urls = unwrap(
        await this.client.storage.from(BUCKET).createSignedUrls(paths, 300),
      );
      for (const item of urls)
        if (!item.error && item.signedUrl) signed[item.path] = item.signedUrl;
    }
    return rows.map((r) => toConversation(r, signed));
  }
  async create(c) {
    unwrap(
      await this.client.from("conversations").insert({
        id: c.id,
        owner_id: this.user.id,
        name: c.name,
        initials: c.initials,
        contact_type: c.type,
        color: c.color,
        order_number: c.order,
        order_state: c.orderState,
        status: c.status,
        priority: c.priority || "normal",
        assignee: c.assignee || null,
        starred: !!c.starred,
        tags: c.tags || [],
        follow_up_at: c.followUpAt || null,
        order_details: Object.fromEntries(
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
        ),
      }),
    );
  }
  async update(id, patch) {
    const data = unwrap(
      await this.client
        .from("conversations")
        .update(patch)
        .eq("id", id)
        .eq("owner_id", this.user.id)
        .select("id")
        .single(),
    );
    if (!data) throw new Error("لم يتم تحديث المحادثة.");
  }
  async updateMany(ids, patch) {
    if (!ids.length) return;
    const rows = unwrap(
      await this.client
        .from("conversations")
        .update(patch)
        .in("id", ids)
        .eq("owner_id", this.user.id)
        .select("id"),
    );
    if (rows.length !== ids.length)
      throw new Error("تعذّر تحديث جميع المحادثات المحددة.");
  }
  async send(
    conversationId,
    text,
    imageData,
    messageId,
    direction = "outgoing",
  ) {
    if (!["outgoing", "note"].includes(direction))
      throw new Error("نوع الرسالة غير مسموح.");
    if (direction === "note" && imageData)
      throw new Error("الملاحظة الداخلية نصية فقط.");
    const prior = await this.client
      .from("messages")
      .select("id,created_at")
      .eq("id", messageId)
      .maybeSingle();
    if (prior.error) throw prior.error;
    if (prior.data) return prior.data;
    let imagePath = null;
    if (imageData) {
      const blob = await (await fetch(imageData)).blob();
      imagePath = `${this.user.id}/${conversationId}/${messageId}.jpg`;
      const upload = await this.client.storage
        .from(BUCKET)
        .upload(imagePath, blob, {
          contentType: "image/jpeg",
          upsert: false,
        });
      if (upload.error && String(upload.error.statusCode) !== "409")
        throw upload.error;
    }
    const result = await this.client
      .from("messages")
      .insert({
        id: messageId,
        owner_id: this.user.id,
        conversation_id: conversationId,
        direction,
        body: text,
        image_path: imagePath,
      })
      .select("id,created_at")
      .single();
    if (result.error) {
      // A lost HTTP response can follow a successful insert. Check before retrying or deleting its image.
      const check = await this.client
        .from("messages")
        .select("id,created_at")
        .eq("id", messageId)
        .maybeSingle();
      if (!check.error && check.data) return check.data;
      if (!check.error && imagePath)
        await this.client.storage.from(BUCKET).remove([imagePath]);
      throw result.error;
    }
    return result.data;
  }
  subscribe(onChange, onState) {
    this.unsubscribe();
    const filter = `owner_id=eq.${this.user.id}`;
    this.channel = this.client
      .channel(`inbox:${this.user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter },
        onChange,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter },
        onChange,
      )
      .subscribe((status) => onState(status));
  }
  unsubscribe() {
    if (this.channel) this.client.removeChannel(this.channel);
    this.channel = null;
  }
}
