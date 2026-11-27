// v177: Order products shows only the NEWEST unsent orders (sent ones move to the Sent tab) · Readymade has two types: Standard products and Custom products · no customer picker in Readymade.
// ── WORKSHOP v176 — rebuilt from scratch (module + page: /workshop.html) ─────────────────────────────
// One job only: send products to the workshop Telegram group.
//   • ORDER products  — a customer's order (photo + measurement + details + the CUSTOMER'S info)
//   • READYMADE products — in-stock / new ready-made products (photo + details + optional customer info)
// Each admin picks ONE workshop group (and topic) in the page. Posts are sent from the admin's own connected Telegram
// account; if that is not connected the AMBAR bot posts instead (the bot must be in the group).
// New readymade products are saved straight into Reports → Stock (so Stock view on Home shows them).
// The old production / material / driver / confirmation / monthly-report parts of the Workshop were removed.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const express = require("express");

const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const uid = () => crypto.randomBytes(6).toString("hex");
const esc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const wait = ms => new Promise(r => setTimeout(r, ms));

function register(app, ctx) {
  const { requireAccess, supabase, baseDir, helpers } = ctx;
  const hasPerm = typeof ctx.hasPerm === "function" ? ctx.hasPerm : (actor, key) => actor?.role === "owner" || actor?.role === "open" || (actor?.perms || []).includes(key);
  const DATA_FILE = path.join(baseDir, "workshop2-data.json");
  const R = () => ctx.reports || {};
  let db = { admins: {}, sent: [], savedAt: "" };

  // ── storage (file + Supabase) ───────────────────────────────────────────────────────────────
  let chain = Promise.resolve();
  const persist = () => (chain = chain.then(async () => {
    db.savedAt = new Date().toISOString();
    try { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch {}
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "workshop2_data", value: db, updated_at: new Date().toISOString() }); } catch {} }
  }).catch(() => {}));
  async function load() {
    let d = null;
    if (supabase) { try { const { data } = await supabase.from("app_settings").select("value").eq("key", "workshop2_data").maybeSingle(); if (data?.value && typeof data.value === "object") d = data.value; } catch {} }
    if (!d) { try { d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch {} }
    if (d && typeof d === "object") db = { admins: {}, sent: [], savedAt: "", ...d };
    if (!db.admins || typeof db.admins !== "object" || Array.isArray(db.admins)) db.admins = {};
    if (!Array.isArray(db.sent)) db.sent = [];
    if (!d) await importOldGroups(); // first start of v176: keep every admin's workshop group from the old Workshop
  }
  async function importOldGroups() {
    let old = null;
    if (supabase) { try { const { data } = await supabase.from("app_settings").select("value").eq("key", "workshop_data").maybeSingle(); if (data?.value && typeof data.value === "object") old = data.value; } catch {} }
    if (!old) { try { old = JSON.parse(fs.readFileSync(path.join(baseDir, "workshop-data.json"), "utf8")); } catch {} }
    let n = 0;
    for (const [k, a] of Object.entries(old?.admins || {})) { const g = cleanGroup(a?.workshop); if (g) { db.admins[k] = { group: g, updatedAt: stamp() }; n++; } }
    if (n) await persist();
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────────
  const keyOf = actor => String(actor?.telegramId || "") || "open";
  const isOwnerA = a => a?.role === "owner" || a?.role === "open";
  const mineOnly = (actor, o) => isOwnerA(actor) || actor?.viewer || String(o.createdByTelegramId || "") === String(actor?.telegramId || "");
  const nowEth = () => { const g = new Date().toLocaleString("sv-SE", { timeZone: helpers.TZ || "Africa/Addis_Ababa" }); return { d: helpers.ethDate(g.slice(0, 10)), t: g.slice(11, 16) }; };
  const stamp = () => { const n = nowEth(); return n.d + " " + n.t; };
  function accountOf(actor) {
    let acc = typeof ctx.accountFor === "function" ? ctx.accountFor(actor) : null;
    if (!acc && actor?.role === "open" && ctx.admins) acc = [...ctx.admins.values()].find(a => a.ready) || null;
    return acc;
  }
  const groupOf = actor => (db.admins[keyOf(actor)] || {}).group || null;
  const fmtSize = v => clip(v, 80).replace(/(\d(?:\.\d+)?\s*(?:cm|mm|m)?)\s*[×✕xX*]\s*(?=\d)/gi, "$1*").replace(/\s*\*\s*/g, "*");
  const sizeOfOrder = o => [o.length, o.width, o.height].map(x => clip(x, 20)).filter(Boolean).join("*");
  const customers = () => (typeof ctx.getCustomerRecords === "function" ? ctx.getCustomerRecords() : []) || [];
  const customerById = id => customers().find(c => String(c.id) === String(id)) || null;
  const customerOfOrder = o => customerById(o.customerId || (typeof ctx.customerIdFor === "function" ? ctx.customerIdFor(o) : "")) || null;
  const findOrder = id => (ctx.getOrders() || []).find(o => String(o.id) === String(id));
  const log = (actor, kind, title, ref, customer, ok, error) => { db.sent.push({ id: uid(), at: stamp(), by: clip(actor?.name || "Admin", 60), key: keyOf(actor), kind, title: clip(title, 100), ref: clip(ref, 80), customer: clip(customer, 80), ok: !!ok, error: clip(error, 200) }); if (db.sent.length > 400) db.sent.splice(0, db.sent.length - 400); persist(); };

  // ── Telegram groups: @username · group id (-100…) · t.me link, + optional forum TOPIC ───────
  function parseTgLink(x) {
    let t = String(x || "").trim(); if (!t) return null;
    t = t.replace(/^(https?:\/\/)?(www\.)?(t|telegram)\.me\//i, "");
    const parts = t.split(/[/?#]/).filter(Boolean); if (!parts.length) return null;
    if (parts[0] === "c" && /^\d+$/.test(parts[1] || "")) return { chat: "-100" + parts[1], nums: parts.slice(2).filter(p => /^\d+$/.test(p)).map(Number) };
    const u = parts[0].replace(/^@+/, "");
    if (/^-100\d{5,15}$/.test(u)) return { chat: u, nums: parts.slice(1).filter(p => /^\d+$/.test(p)).map(Number) };
    if (/^-\d{5,20}$/.test(u)) return { chat: u, nums: [] };
    if (/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(u)) return { chat: u, nums: parts.slice(1).filter(p => /^\d+$/.test(p)).map(Number) };
    return null;
  }
  function cleanGroup(x) {
    if (!x || typeof x !== "object") return null;
    const pl = parseTgLink(x.chat); if (!pl) return null;
    return { chat: pl.chat, title: clip(x.title, 80), topic: Number.isInteger(Number(x.topic)) && Number(x.topic) > 1 ? Number(x.topic) : 0, topicTitle: clip(x.topicTitle, 80) };
  }
  const groupName = g => g ? (g.title || (/^-/.test(g.chat) ? "Group " + g.chat : "@" + g.chat)) + (g.topic ? " › " + (g.topicTitle || "topic " + g.topic) : "") : "";
  const chatKey = g => /^-?\d+$/.test(String(g.chat)) ? String(g.chat) : "@" + String(g.chat).replace(/^@/, "");
  async function resolveTarget(acc, g) {
    const key = /^-?\d+$/.test(g.chat) ? BigInt(g.chat) : "@" + g.chat;
    try { return await acc.client.getEntity(key); }
    catch (e) { if (typeof key === "bigint") { await acc.client.getDialogs({ limit: 500 }); return await acc.client.getEntity(key); } throw e; }
  }
  const tgFriendly = e => {
    const m = String(e?.errorMessage || e?.message || e || "");
    if (/FLOOD_WAIT|PEER_FLOOD|Too Many Requests/i.test(m)) return "Telegram asked to slow down. Try again in a few minutes.";
    if (/USERNAME_NOT_OCCUPIED|USERNAME_INVALID/i.test(m)) return "No Telegram group with this username exists. Check the spelling.";
    if (/CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED|USER_BANNED_IN_CHANNEL|CHANNEL_PRIVATE|CHAT_SEND_PHOTOS_FORBIDDEN|CHAT_SEND_MEDIA_FORBIDDEN/i.test(m)) return "Your Telegram account is not allowed to write in that group.";
    if (/PEER_ID_INVALID|Cannot find any entity|not found/i.test(m)) return "Your Telegram account cannot see that group. Join the group with your own account, or pick it from the list.";
    if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(m)) return "Your Telegram connection expired. Connect your Telegram account again.";
    return clip(m, 160) || "Could not reach Telegram.";
  };
  const botFriendly = e => {
    const m = String(e?.message || e || "");
    if (/BOT_TOKEN is not configured/i.test(m)) return "The AMBAR bot is not set up on the server (BOT_TOKEN).";
    if (/chat not found/i.test(m)) return "The AMBAR bot cannot see this group. Add the bot to the group (as admin).";
    if (/not enough rights|have no rights|CHAT_WRITE_FORBIDDEN|need administrator|bot was kicked|bot is not a member|forbidden/i.test(m)) return "The AMBAR bot is not allowed to post here. Add the bot to the group and make it an admin.";
    if (/message thread not found|TOPIC_CLOSED|TOPIC_DELETED/i.test(m)) return "That topic does not exist (or is closed). Choose the topic again.";
    if (/Too Many Requests|retry after/i.test(m)) return "Telegram asked to slow down. Try again in a minute.";
    return clip(m, 160) || "The bot could not post.";
  };
  const tg = (method, body) => ctx.tgApi.call(method, body);

  // ── posting: the admin's own account first, the AMBAR bot as the fallback ────────────────────
  async function botPost(g, buf, caption) { // caption = Telegram HTML
    const topic = g.topic > 1 ? g.topic : 0;
    if (buf) {
      const build = () => { const fd = new FormData(); fd.append("chat_id", chatKey(g)); if (topic) fd.append("message_thread_id", String(topic)); fd.append("caption", caption); fd.append("parse_mode", "HTML"); fd.append("photo", new Blob([buf], { type: "image/jpeg" }), "product.jpg"); return fd; };
      try { await ctx.tgApi.sendForm("sendPhoto", build); return; }
      catch (e) { if (!/IMAGE_PROCESS_FAILED|PHOTO_INVALID|wrong file|image/i.test(String(e.message))) throw e; }
    }
    await tg("sendMessage", { chat_id: chatKey(g), ...(topic ? { message_thread_id: topic } : {}), text: caption.slice(0, 4000), parse_mode: "HTML" });
  }
  async function userPost(acc, g, buf, caption) {
    const entity = await resolveTarget(acc, g);
    const replyTo = g.topic > 1 ? Number(g.topic) : undefined;
    if (buf) { // a real image extension makes Telegram show it as a PHOTO (not a file)
      const ext = buf.slice(0, 4).toString("hex") === "89504e47" ? ".png" : buf.slice(0, 4).toString("hex") === "52494646" ? ".webp" : ".jpg";
      const tmp = path.join(os.tmpdir(), "ambar-ws-" + uid() + ext);
      fs.writeFileSync(tmp, buf);
      try { return await acc.client.sendFile(entity, { file: tmp, caption, parseMode: "html", forceDocument: false, ...(replyTo ? { replyTo } : {}) }); }
      finally { fs.unlink(tmp, () => {}); }
    }
    return await acc.client.sendMessage(entity, { message: caption, parseMode: "html", ...(replyTo ? { replyTo } : {}) });
  }
  async function post(actor, g, buf, caption) { // → throws a readable Error
    const acc = accountOf(actor); let userErr = null;
    if (acc?.ready) { try { await userPost(acc, g, buf, caption); return "your Telegram account"; } catch (e) { userErr = e; } }
    try { await botPost(g, buf, caption); return "the AMBAR bot"; }
    catch (e) { throw new Error(userErr ? tgFriendly(userErr) + " (bot: " + botFriendly(e) + ")" : botFriendly(e) + (acc?.ready ? "" : " — or connect your own Telegram account.")); }
  }
  const capLines = (lines, max) => { let out = ""; for (const l of lines) { if (l == null || l === false) continue; const add = (out ? "\n" : "") + l; if (out.length + add.length > max) break; out += add; } return out; };

  // ── captions ────────────────────────────────────────────────────────────────────────────────
  const custLines = (c, fallback) => {
    const name = clip(c?.name || fallback?.name, 80), id = clip(c?.id, 20), phone = [c?.phone, c?.additionalPhone].map(x => clip(x, 30)).filter(Boolean).join(" / ") || clip(fallback?.phone, 40), loc = clip(c?.location || fallback?.location, 200);
    if (!name && !phone && !loc) return [];
    return ["", "<b>CUSTOMER</b>", ...[name ? "👤 " + esc(name) + (id ? " (ID " + esc(id) + ")" : "") : "", phone ? "📞 " + esc(phone) : "", loc ? "📍 " + esc(loc) : ""].filter(Boolean)];
  };
  const detail = (icon, label, v) => { v = clip(v, 120); return v ? `${icon} ${label}: ${esc(v)}` : ""; };
  function orderCaption(o, cust, note) {
    const code = [o.productId, o.productCode, o.modelCode].map(x => clip(x, 30)).find(Boolean) || "";
    const L = ["<b>AMBAR FURNITURE</b>", "🛠 <b>ORDER PRODUCT</b>", "", "<b>" + esc(clip(o.product || "Furniture order", 100)) + "</b>" + (code ? " · " + esc(code) : ""), "Order ID: " + esc(clip(o.orderId || o.id, 40)), "Measurement: " + esc(fmtSize(sizeOfOrder(o)) || "—"),
      ...custLines(cust, { name: o.customerName, phone: o.phone || o.telegramPhone, location: o.location }), ""];
    const d = [detail("🧱", "Material", o.material), detail("🎨", "Color", o.color), detail("✨", "Style", o.style), detail("🖌", "Design", o.design), detail("🔧", "Handle", o.handle), detail("🚪", "Door", o.door), detail("🗂", "Partition", o.partition), detail("🧰", "Drawer", o.drawer), detail("➕", "Extra", o.additionalFeatures), detail("📅", "Completion date", o.completionDate), detail("🚚", "Delivery date", o.deliveryDate)].filter(Boolean);
    const tail = clip(note, 300) ? ["", "📝 " + esc(clip(note, 300))] : [];
    return capLines([...L, ...(d.length ? ["ADDITIONAL TEXTS:", ...d] : []), ...tail], 1000);
  }
  function readymadeCaption(p, cust, note) {
    const L = ["<b>AMBAR FURNITURE</b>", p.custom ? "🎨 <b>CUSTOM PRODUCT</b>" : "📦 <b>READYMADE PRODUCT</b> · STANDARD", "", "<b>" + esc((p.code || "—") + (p.model ? "-" + p.model : "")) + "</b>", p.ptype ? "Type: " + esc(clip(p.ptype, 40)) : "", "Measurement: " + esc(fmtSize(p.desc) || "—"), p.color ? "🎨 Color: " + esc(clip(p.color, 40)) : "", p.handle ? "🔧 Handle: " + esc(clip(p.handle, 60)) : "", p.capacity ? "Capacity: " + esc(clip(p.capacity, 40)) : "", p.note ? "📝 " + esc(clip(p.note, 200)) : "", ...custLines(cust, null)];
    const tail = clip(note, 300) ? ["", "📝 " + esc(clip(note, 300))] : [];
    return capLines([...L, ...tail], 1000);
  }

  // ── pictures ────────────────────────────────────────────────────────────────────────────────
  async function orderPhotoBuf(o) {
    const u = String(o.photo || ""); if (!u) return null;
    try {
      if (/^https?:\/\//i.test(u)) { const r = await fetch(u); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()); }
      return fs.readFileSync(path.join(ctx.uploadDir || path.join(__dirname, "public", "uploads"), path.basename(u.split("?")[0])));
    } catch { return null; }
  }
  const productPhotoBuf = async p => { try { return p.photo && typeof R().wsPhotoBuf === "function" ? await R().wsPhotoBuf(p.photo) : null; } catch { return null; } };
  function photoFromDataUrl(dataUrl) {
    if (!dataUrl) return null;
    const m = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
    if (!m) throw new Error("The photo could not be read. Choose it again.");
    const buf = Buffer.from(m[1], "base64");
    if (buf.length < 200) throw new Error("The photo is empty. Choose it again.");
    if (buf.length > 1.5 * 1024 * 1024) throw new Error("The photo is too big (max 1.5 MB after shrinking).");
    return buf;
  }

  // ── sending ─────────────────────────────────────────────────────────────────────────────────
  const noGroup = "First choose the workshop group (Workshop page → Workshop group).";
  async function sendOrder(o, actor, { note = "", again = false } = {}) {
    const g = groupOf(actor); if (!g) return { ok: false, error: noGroup };
    if (o.status === "Rejected") return { ok: false, error: "The customer REJECTED this order." };
    if (o.workshopSent && !again) return { ok: false, code: "ALREADY", error: `This order was already sent to the workshop (${o.workshopSent.at || ""}).` };
    const cust = customerOfOrder(o), buf = await orderPhotoBuf(o);
    try { await post(actor, g, buf, orderCaption(o, cust, note)); }
    catch (e) { log(actor, "order", o.product || "Order", o.orderId || o.id, cust?.name || o.customerName, false, e.message); return { ok: false, error: e.message }; }
    o.workshopSent = { at: stamp(), by: clip(actor?.name || "Admin", 60), count: ((o.workshopSent && o.workshopSent.count) || 0) + 1 };
    try { if (typeof ctx.saveOrder === "function") await ctx.saveOrder(o); } catch (e) { console.warn("Workshop: order mark not saved:", e.message); }
    log(actor, "order", o.product || "Order", o.orderId || o.id, cust?.name || o.customerName, true, "");
    return { ok: true };
  }
  async function sendProducts(list, actor, { customerId = "", note = "" } = {}) {
    const g = groupOf(actor); if (!g) return { ok: false, error: noGroup, sent: 0 };
    const cust = customerId ? customerById(customerId) : null; let sent = 0, err = "";
    for (const p of list) {
      if (sent || err) await wait(700);
      const buf = await productPhotoBuf(p);
      try { await post(actor, g, buf, readymadeCaption(p, cust, note)); sent++; log(actor, "readymade", (p.model || p.desc || "Product"), p.code, cust?.name || "", true, ""); }
      catch (e) { err = e.message; log(actor, "readymade", (p.model || p.desc || "Product"), p.code, cust?.name || "", false, e.message); }
    }
    return { ok: sent > 0, sent, error: err };
  }

  // ── compact views ───────────────────────────────────────────────────────────────────────────
  const compactOrder = o => { const c = customerOfOrder(o); return { id: o.id, orderId: o.orderId || "", product: clip(o.product, 80), size: fmtSize(sizeOfOrder(o)), status: clip(o.status, 20), customerId: c?.id || clip(o.customerId, 20), customerName: clip(c?.name || o.customerName, 60), createdAt: o.createdAt || "", photo: o.photo || "", sent: o.workshopSent || null }; };
  const stockList = () => (typeof R().wsStockView === "function" ? R().wsStockView() : []);
  const compactProduct = p => ({ id: p.id, code: p.code, model: p.model, ptype: p.ptype, desc: p.desc, handle: p.handle, photo: p.photo, status: p.status, capacity: p.capacity, note: p.note, custom: !!p.custom, color: p.color || "" });
  const senderInfo = actor => { const acc = accountOf(actor); return { ready: !!acc?.ready, label: clip(acc?.label, 60) }; };
  const orderList = actor => (ctx.getOrders() || []).filter(o => mineOnly(actor, o)).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  function view(actor) {
    const g = groupOf(actor), owner = isOwnerA(actor);
    return {
      ok: true, me: { name: clip(actor?.name, 60), owner }, group: g, groupName: groupName(g), sender: senderInfo(actor),
      orders: orderList(actor).slice(0, 200).map(compactOrder),
      stock: stockList().filter(p => p.status === "stock").map(compactProduct),
      workflow: (typeof R().inProgress === "function" ? R().inProgress() : []).filter(p => !/CUS|ORD/i.test(String(p.orderType || ""))).map(p => ({ id: p.id, code: p.code, model: p.model, desc: p.desc, ptype: p.ptype, photo: p.photo })),
      ptypes: ["Shoe Shelf", "Console Table", "TV Stand", "Wardrobe", "Bed", "Sofa", "Dining Table", "Coffee Table", "Cabinet", "Others"],
      sent: db.sent.filter(x => owner || x.key === keyOf(actor)).slice(-80).reverse()
    };
  }

  // ── routes ──────────────────────────────────────────────────────────────────────────────────
  const router = express.Router();
  router.use(requireAccess);
  router.use((req, res, next) => hasPerm(req.actor, "workshop") ? next() : res.status(403).json({ ok: false, error: "The main admin has not given you the Workshop section. Ask them to turn it on in Manage Admins." }));
  router.use(express.json({ limit: "10mb" }));
  router.get("/state", (req, res) => res.json(view(req.actor)));

  // the customer-details button: one customer's orders + the stock, and whether the group is chosen
  router.get("/customer/:id", (req, res) => {
    const c = customerById(req.params.id); if (!c) return res.json({ ok: false, error: "Customer not found." });
    const orders = orderList(req.actor).filter(o => { const oc = customerOfOrder(o); return oc ? String(oc.id) === String(c.id) : String(o.customerId || "") === String(c.id); }).slice(0, 60).map(compactOrder);
    res.json({ ok: true, customer: { id: c.id, name: clip(c.name, 60), phone: clip(c.phone, 30), location: clip(c.location, 120) }, group: groupName(groupOf(req.actor)), orders, stock: stockList().filter(p => p.status === "stock").map(compactProduct) });
  });

  router.post("/settings", (req, res) => {
    const g = cleanGroup(req.body?.group); if (!g) return res.json({ ok: false, error: "Choose a Telegram group first." });
    db.admins[keyOf(req.actor)] = { group: g, updatedAt: stamp() }; persist();
    res.json({ ...view(req.actor), message: "✅ Saved. Products will be sent to " + groupName(g) + "." });
  });
  router.post("/settings/clear", (req, res) => { delete db.admins[keyOf(req.actor)]; persist(); res.json({ ...view(req.actor), message: "Workshop group removed." }); });

  router.post("/dialogs", async (req, res) => {
    const acc = accountOf(req.actor);
    if (!acc?.ready) return res.json({ ok: false, error: "Your own Telegram account is not connected, so the group list cannot be shown. Paste the group link instead." });
    try {
      const ds = await acc.client.getDialogs({ limit: 400 });
      const list = ds.filter(d => d.isGroup || d.isChannel).map(d => ({ chat: String(d.id), title: clip(d.title || d.name, 80), forum: !!d.entity?.forum })).filter(x => /^-\d+$/.test(x.chat)).sort((a, b) => Number(b.forum) - Number(a.forum) || a.title.localeCompare(b.title)).slice(0, 250);
      res.json({ ok: true, groups: list });
    } catch (e) { res.json({ ok: false, error: tgFriendly(e) }); }
  });
  async function topicsOf(acc, chat) {
    const { Api } = require("telegram");
    const entity = await resolveTarget(acc, { chat });
    const title = clip(entity.title || entity.firstName || "", 80);
    if (!entity.forum) return { forum: false, title, topics: [] };
    const r = await acc.client.invoke(new Api.channels.GetForumTopics({ channel: entity, offsetDate: 0, offsetId: 0, offsetTopic: 0, limit: 100 }));
    const topics = (r.topics || []).filter(t => t.className === "ForumTopic").map(t => ({ id: Number(t.id), title: clip(t.title, 60), closed: !!t.closed }));
    if (!topics.some(t => t.id === 1)) topics.unshift({ id: 1, title: "General", closed: false });
    return { forum: true, title, topics: topics.sort((a, b) => a.id - b.id) };
  }
  router.post("/topics", async (req, res) => {
    const acc = accountOf(req.actor);
    if (!acc?.ready) return res.json({ ok: false, error: "Your own Telegram account is not connected. Paste a link of the topic instead." });
    const pl = parseTgLink(req.body?.chat); if (!pl) return res.json({ ok: false, error: "This group could not be read." });
    try { res.json({ ok: true, chat: pl.chat, ...(await topicsOf(acc, pl.chat)) }); } catch (e) { res.json({ ok: false, error: tgFriendly(e) }); }
  });
  router.post("/resolve", async (req, res) => { // a pasted link / @username / id → the real group (+ topic when the link has one)
    const raw = String(req.body?.link || "").trim();
    const m = raw.replace(/^(https?:\/\/)?(www\.)?(t|telegram)\.me\//i, "").split(/[/?#]/).filter(Boolean);
    if (m[0] === "joinchat" || /^\+/.test(m[0] || "")) return res.json({ ok: false, error: "An invite link (t.me/+…) cannot be used. Open the group, long-press any message → Copy link, and paste THAT link — or choose the group from the list." });
    const pl = parseTgLink(raw); if (!pl) return res.json({ ok: false, error: "This is not a Telegram group link, @username or id." });
    const acc = accountOf(req.actor);
    if (!acc?.ready) return res.json({ ok: true, unchecked: true, chat: pl.chat, title: /^-?\d/.test(pl.chat) ? "" : "@" + pl.chat, topic: pl.nums.length >= 2 ? pl.nums[0] : 0, topicTitle: "", forum: null, topics: [] });
    try {
      const t = await topicsOf(acc, pl.chat); let topic = 0, topicTitle = "";
      if (t.forum) { const hit = t.topics.find(x => x.id === (pl.nums[0] || 0)); if (hit) { topic = hit.id > 1 ? hit.id : 0; topicTitle = hit.title; } }
      res.json({ ok: true, chat: pl.chat, title: t.title, topic, topicTitle, forum: t.forum, topics: t.topics });
    } catch (e) { res.json({ ok: false, error: tgFriendly(e) }); }
  });
  router.post("/test", async (req, res) => {
    const g = groupOf(req.actor); if (!g) return res.json({ ok: false, error: noGroup });
    try { const via = await post(req.actor, g, null, `<b>AMBAR WORKSHOP TEST</b>\nThis group receives products from ${esc(clip(req.actor?.name || "the admin", 60))}.`); res.json({ ok: true, message: "✅ Test message posted in " + groupName(g) + " (sent by " + via + ")." }); }
    catch (e) { res.json({ ok: false, error: e.message }); }
  });

  router.post("/send-order", async (req, res) => {
    const o = findOrder(req.body?.id);
    if (!o || !mineOnly(req.actor, o)) return res.json({ ok: false, error: "Order not found." });
    const r = await sendOrder(o, req.actor, { note: req.body?.note, again: !!req.body?.again });
    res.json({ ...view(req.actor), ok: r.ok, code: r.code, error: r.error, message: r.ok ? `✅ Order ${o.orderId || o.id} sent to the workshop group.` : undefined });
  });
  router.post("/send-product", async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 30) : [];
    const list = stockList().filter(p => ids.includes(p.id) && p.status === "stock");
    if (!list.length) return res.json({ ...view(req.actor), ok: false, error: "Choose at least one product that is in stock." });
    const r = await sendProducts(list, req.actor, { customerId: String(req.body?.customerId || ""), note: req.body?.note }); // v177: the Workshop page sends no customer; Customer ID → Send to workshop still does
    res.json({ ...view(req.actor), ok: r.ok, error: r.error, message: r.ok ? `✅ ${r.sent} product${r.sent === 1 ? "" : "s"} sent to the workshop group.` + (r.error ? " Not sent: " + r.error : "") : undefined });
  });
  // a NEW readymade product — STANDARD (a regular model) or CUSTOM (a one-off custom design, with a color): saved to Stock (Reports) and, if asked, sent to the workshop group
  router.post("/add-product", async (req, res) => {
    const b = req.body || {}, custom = b.custom === true || b.custom === "true", model = clip(b.model, 40), qty = Math.max(1, Math.min(parseInt(b.qty, 10) || 1, 20));
    if (!model) return res.json({ ok: false, error: custom ? "Type the custom product name." : "Type the product model / name." });
    if (typeof R().wsAddProduct !== "function") return res.json({ ok: false, error: "Reports is not ready." });
    let buf = null; try { buf = photoFromDataUrl(b.photo); } catch (e) { return res.json({ ok: false, error: e.message }); }
    const by = clip(req.actor?.name || "Admin", 60), made = [];
    try {
      for (let i = 0; i < qty; i++) {
        const p = await R().wsAddProduct({ ptype: clip(b.ptype, 40), model, desc: clip(b.size, 160), seqId: true, orderType: "READYMADE", priority: "MEDIUM", handle: clip(b.handle, 60), note: clip(b.note, 300), photoBuf: buf, salesName: by, custom, color: custom ? clip(b.color, 40) : "" }, by);
        R().wsFinish(p.id, by); made.push(p.id);
      }
    } catch (e) { return res.json({ ok: false, error: "Could not save the product: " + e.message }); }
    const list = stockList().filter(p => made.includes(p.id)), word = custom ? "custom product" : "product";
    if (!b.send) return res.json({ ...view(req.actor), ok: true, message: `✅ ${list.length} ${word}${list.length === 1 ? "" : "s"} added to Stock (${list.map(p => p.code).join(", ")}).` });
    const r = await sendProducts(list, req.actor, { note: "" });
    res.json({ ...view(req.actor), ok: true, message: `✅ Added to Stock (${list.map(p => p.code).join(", ")})` + (r.sent ? ` and ${r.sent} sent to the workshop group.` : "."), warning: r.error ? "Saved in Stock, but NOT sent: " + r.error + " — use Send on the product to try again." : "" });
  });
  router.post("/product/finish", (req, res) => { const r = typeof R().wsFinish === "function" ? R().wsFinish(String(req.body?.id || ""), clip(req.actor?.name, 60)) : { ok: false, error: "Reports is not ready." }; res.json({ ...view(req.actor), ok: !!r.ok, error: r.error, message: r.ok ? `✅ ${r.code} is now in Stock.` : undefined }); });
  router.post("/product/sold", (req, res) => { const r = R().wsSoldOut(String(req.body?.id || ""), clip(req.actor?.name, 60)); res.json({ ...view(req.actor), ok: !!r.ok, error: r.error, message: r.ok ? `✅ ${r.code} marked Sold Out.` : undefined }); });
  router.post("/product/delete", async (req, res) => {
    if (!isOwnerA(req.actor)) return res.json({ ...view(req.actor), ok: false, error: "Only the main admin can delete a product." });
    const r = await R().wsOp("/product/delete", { id: String(req.body?.id || "") }, req.actor);
    res.json({ ...view(req.actor), ok: r.ok, error: r.error, message: r.ok ? "🗑 Product deleted." : undefined });
  });
  app.get("/api/workshop-version", (req, res) => res.json({ ok: true, workshop: "v177" }));

  // Home → Stock view: every in-stock product with all its info (any assigned admin may look)
  app.get("/api/stock", requireAccess, (req, res) => {
    const items = stockList().filter(p => p.status === "stock");
    res.json({ ok: true, now: nowEth(), total: items.length, items });
  });

  app.use("/api/workshop", router);
  return { load };
}
module.exports = { register };
