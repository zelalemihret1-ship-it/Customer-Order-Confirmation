// ── WORKSHOP (module + page: /workshop.html) ───────────────────────────────────────────────────
// v150: every admin who has the "Workshop" section (Manage Admins → tick Workshop) gets HIS OWN workshop settings:
//   • the private Telegram group (and topic) of the workshop — picked from his own chats, or pasted as a link / id
//   • how orders go to the workshop:  MANUAL (he presses Send)  ·  AFTER the customer CONFIRMS (automatic)  ·  WITHOUT confirmation (automatic, the moment the order is created)
//   • readymade products (the in-stock Stock view of Reports) can be sent to the same group
// Everything is sent from the admin's OWN connected Telegram account (never the bot). The workshop gets the product photo + the
// production details only — no phone number, no payment, no customer contact.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const express = require("express");

const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const uid = () => crypto.randomBytes(6).toString("hex");
const MODES = ["manual", "after_confirm", "on_create"];

function register(app, ctx) {
  const { requireAccess, supabase, baseDir, helpers } = ctx;
  const hasPerm = typeof ctx.hasPerm === "function" ? ctx.hasPerm : (actor, key) => actor?.role === "owner" || actor?.role === "open" || (actor?.perms || []).includes(key);
  const DATA_FILE = path.join(baseDir, "workshop-data.json");
  let db = { admins: {}, sent: {}, log: [], catalog: [], savedAt: "" };

  // ── storage (file + Supabase, restored on every start) ─────────────────────────────────────
  let chain = Promise.resolve();
  const persist = () => (chain = chain.then(async () => {
    db.savedAt = new Date().toISOString();
    try { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch {}
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "workshop_data", value: db, updated_at: new Date().toISOString() }); } catch {} }
  }).catch(() => {}));
  async function load() {
    let d = null;
    if (supabase) { try { const { data } = await supabase.from("app_settings").select("value").eq("key", "workshop_data").maybeSingle(); if (data?.value && typeof data.value === "object") d = data.value; } catch {} }
    if (!d) { try { d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch {} }
    if (d && typeof d === "object") db = { admins: {}, sent: {}, log: [], catalog: [], savedAt: "", ...d };
    if (!Array.isArray(db.catalog)) db.catalog = [];
    if (!db.admins || typeof db.admins !== "object") db.admins = {};
    if (!db.sent || typeof db.sent !== "object") db.sent = {};
    if (!Array.isArray(db.log)) db.log = [];
  }

  // ── who is who ──────────────────────────────────────────────────────────────────────────────
  const keyOf = actor => String(actor?.telegramId || "") || "open";
  const settingsOf = key => { const s = db.admins[key] || {}; return { targets: Array.isArray(s.targets) ? s.targets : [], mode: MODES.includes(s.mode) ? s.mode : "manual", updatedAt: s.updatedAt || "" }; };
  function accountOf(actor) {
    let acc = typeof ctx.accountFor === "function" ? ctx.accountFor(actor) : null;
    if (!acc && actor?.role === "open" && ctx.admins) acc = [...ctx.admins.values()].find(a => a.ready) || null; // open mode (no admin list yet): any connected account
    return acc;
  }
  const mineOnly = (actor, o) => actor?.role === "owner" || actor?.role === "open" || actor?.viewer || String(o.createdByTelegramId || "") === String(actor?.telegramId || "");
  // v152: only orders that are IN PROGRESS — not failed (rejected by the customer) and not completed (paid in full)
  const isActive = o => o.status !== "Rejected" && !o.paidFull;
  const nowEth = () => { const g = new Date().toLocaleString("sv-SE", { timeZone: helpers.TZ || "Africa/Addis_Ababa" }); return { d: helpers.ethDate(g.slice(0, 10)), t: g.slice(11, 16) }; };
  const stamp = () => { const n = nowEth(); return n.d + " " + n.t; };

  // ── Telegram targets: public @username · private group id (-100…) · any t.me link, + optional forum TOPIC ──
  function parseTgLink(x) {
    let t = String(x || "").trim(); if (!t) return null;
    t = t.replace(/^(https?:\/\/)?(www\.)?(t|telegram)\.me\//i, "");
    const parts = t.split(/[/?#]/).filter(Boolean); if (!parts.length) return null;
    if (parts[0] === "c" && /^\d+$/.test(parts[1] || "")) return { chat: "-100" + parts[1], topic: /^\d+$/.test(parts[2] || "") ? Number(parts[2]) : 0 };
    const u = parts[0].replace(/^@+/, "");
    if (/^-100\d{5,15}$/.test(u)) return { chat: u, topic: /^\d+$/.test(parts[1] || "") ? Number(parts[1]) : 0 };
    if (/^-\d{5,20}$/.test(u)) return { chat: u, topic: 0 };
    if (/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(u)) return { chat: u, topic: /^\d+$/.test(parts[1] || "") ? Number(parts[1]) : 0 };
    return null;
  }
  function cleanTargets(v) {
    const arr = Array.isArray(v) ? v : String(v || "").split(/[\s,;\n]+/), out = [];
    for (const x of arr) {
      let o = null;
      if (x && typeof x === "object") { const pl = parseTgLink(x.chat); if (pl) o = { chat: pl.chat, title: clip(x.title, 80), topic: Number.isInteger(Number(x.topic)) && Number(x.topic) > 0 ? Number(x.topic) : pl.topic, topicTitle: clip(x.topicTitle, 80) }; }
      else { const pl = parseTgLink(x); if (pl) o = { chat: pl.chat, title: /^-?\d/.test(pl.chat) ? "" : "@" + pl.chat, topic: pl.topic, topicTitle: "" }; }
      if (o && !out.some(y => y.chat.toLowerCase() === o.chat.toLowerCase() && y.topic === o.topic)) out.push(o);
    }
    return out.slice(0, 5);
  }
  const targetName = g => (g.title || (/^-/.test(g.chat) ? "Group " + g.chat : "@" + g.chat)) + (g.topic ? " › " + (g.topicTitle || "topic " + g.topic) : "");
  async function resolveTarget(acc, g) {
    const key = /^-?\d+$/.test(g.chat) ? BigInt(g.chat) : "@" + g.chat;
    try { return await acc.client.getEntity(key); }
    catch (e) { if (typeof key === "bigint") { await acc.client.getDialogs({ limit: 500 }); return await acc.client.getEntity(key); } throw e; }
  }
  const tgFriendly = e => {
    const m = String(e?.errorMessage || e?.message || e || "");
    if (/FLOOD_WAIT|PEER_FLOOD/i.test(m)) return "Telegram asked to slow down. Try again in a few minutes.";
    if (/USERNAME_NOT_OCCUPIED|USERNAME_INVALID/i.test(m)) return "No Telegram group with this username exists. Check the spelling.";
    if (/CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED|USER_BANNED_IN_CHANNEL|CHANNEL_PRIVATE|CHAT_SEND_PHOTOS_FORBIDDEN|CHAT_SEND_MEDIA_FORBIDDEN/i.test(m)) return "Your Telegram account is not allowed to post in that group. Join it with your own account (and check you may send photos).";
    if (/PEER_ID_INVALID|Cannot find any entity|not found/i.test(m)) return "Your Telegram account cannot see that group. Join the group with your own account, or pick it from “My groups”.";
    if (/TOPIC_CLOSED|TOPIC_DELETED|MSG_ID_INVALID|REPLY_MESSAGE_ID_INVALID/i.test(m)) return "The topic number is wrong or the topic is closed.";
    if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(m)) return "Your Telegram connection expired. Connect your Telegram account again.";
    return clip(m, 160) || "Could not send.";
  };

  // ── pictures ────────────────────────────────────────────────────────────────────────────────
  async function orderPhotoBuf(o) {
    const u = String(o.photo || ""); if (!u) return null;
    try {
      if (/^https?:\/\//i.test(u)) { const r = await fetch(u); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()); }
      const f = path.join(ctx.uploadDir || path.join(__dirname, "public", "uploads"), path.basename(u.split("?")[0]));
      return fs.readFileSync(f);
    } catch { return null; }
  }
  async function sendOne(acc, entity, reply, buf, caption) {
    if (buf) {
      const f = path.join(os.tmpdir(), "wsp-" + uid() + ".jpg");
      fs.writeFileSync(f, buf);
      try { await acc.client.sendFile(entity, { file: f, caption: caption.slice(0, 1000), forceDocument: false, ...reply }); } finally { try { fs.unlinkSync(f); } catch {} }
    } else await acc.client.sendMessage(entity, { message: caption.slice(0, 4000), ...reply });
  }
  // items: [{ buf, caption }] → every target gets every item
  async function deliver(acc, targets, items, head) {
    const results = [];
    for (const g of targets) {
      try {
        const entity = await resolveTarget(acc, g), reply = g.topic ? { replyTo: g.topic } : {};
        if (head) await acc.client.sendMessage(entity, { message: head, ...reply });
        for (const it of items) { if (it !== items[0] || head) await new Promise(x => setTimeout(x, 700)); await sendOne(acc, entity, reply, it.buf, it.caption); }
        results.push({ name: targetName(g), ok: true });
      } catch (e) { results.push({ name: targetName(g), ok: false, error: tgFriendly(e) }); }
    }
    return results;
  }

  // ── what the workshop receives (NO phone, NO payment, NO customer contact) ───────────────────
  const line = (icon, label, v) => { v = clip(v, 120); return v ? `${icon} ${label}: ${v}` : ""; };
  function orderCaption(o, how) {
    const size = [o.length, o.width, o.height].map(x => clip(x, 20)).filter(Boolean).join(" × ");
    const L = [
      `🛠 WORKSHOP ORDER — ${clip(o.orderId, 40)}`,
      line("🛋", "Product", o.product),
      size ? `📏 Size (L × W × H): ${size}` : "",
      line("🧱", "Material", o.material), line("🎨", "Color", o.color), line("✨", "Style", o.style), line("🖌", "Design", o.design),
      line("🔧", "Handle", o.handle), line("🚪", "Door", o.door), line("🗂", "Partition", o.partition), line("🧰", "Drawer", o.drawer),
      line("➕", "Extra", o.additionalFeatures),
      line("📅", "Completion date", o.completionDate), line("🚚", "Delivery date", o.deliveryDate),
      how
    ];
    return L.filter(Boolean).join("\n");
  }
  const howLine = (o, force) => o.status === "Confirmed" ? "✅ Customer CONFIRMED this order" : force ? "⚠ Sent WITHOUT the customer's confirmation (status: " + clip(o.status || "Pending", 20) + ")" : "";
  function compactOrder(o, actor) {
    const sent = db.sent[String(o.id)] || [];
    return { id: o.id, orderId: o.orderId || "", size: [o.length, o.width, o.height].map(x => clip(x, 20)).filter(Boolean).join(" × "), product: clip(o.product, 80), status: o.status || "Pending", customerName: clip(o.customerName, 60), createdAt: o.createdAt || "", completionDate: clip(o.completionDate, 30), deliveryDate: clip(o.deliveryDate, 30), photo: o.photo || "", sent: sent.filter(s => s.key === keyOf(actor)).slice(-3) };
  }

  // ── send an order to the workshop ───────────────────────────────────────────────────────────
  async function sendOrder(o, actor, opt = {}) {
    const key = keyOf(actor), s = settingsOf(key);
    if (!s.targets.length) return { ok: false, error: "First choose the workshop Telegram group (Settings below)." };
    const acc = opt.acc || accountOf(actor);
    if (!acc?.ready) return { ok: false, error: "Your own Telegram account is not connected. Connect it first (Settings → Connect my Telegram account), then try again." };
    if (o.status === "Rejected" && !opt.force) return { ok: false, code: "REJECTED", error: "The customer REJECTED this order." };
    if (o.status !== "Confirmed" && !opt.force && !opt.auto && s.mode === "after_confirm") return { ok: false, code: "NOT_CONFIRMED", error: "The customer has not confirmed this order yet." };
    const buf = await orderPhotoBuf(o);
    const results = await deliver(acc, s.targets, [{ buf, caption: orderCaption(o, howLine(o, opt.force)) }]);
    const okN = results.filter(x => x.ok).length;
    const rec = { key, by: clip(actor?.name || "Admin", 60), at: stamp(), auto: !!opt.auto, ok: okN > 0, to: results.filter(x => x.ok).map(x => x.name), error: okN ? "" : (results[0]?.error || "") };
    (db.sent[String(o.id)] = db.sent[String(o.id)] || []).push(rec); if (db.sent[String(o.id)].length > 20) db.sent[String(o.id)].shift();
    db.log.push({ at: rec.at, key, by: rec.by, what: `${rec.auto ? "Auto" : "Manual"} · order ${o.orderId || o.id}`, ok: rec.ok, error: rec.error }); if (db.log.length > 200) db.log.splice(0, db.log.length - 200);
    persist();
    return { ok: okN > 0, results, error: okN ? (okN < results.length ? "Some groups could not be reached." : "") : (results[0]?.error || "Could not send.") };
  }
  const actorOfOrder = o => ({ role: o.createdByRole === "owner" ? "owner" : (o.createdByTelegramId ? "admin" : "open"), telegramId: String(o.createdByTelegramId || ""), name: o.createdByName || "Admin" });
  const autoAcc = (o, actor) => accountOf(actor) || (ctx.admins && o.adminId ? ctx.admins.get(String(o.adminId)) : null);
  async function onOrderCreated(o) { // WITHOUT confirmation: the moment the order is created
    const actor = actorOfOrder(o), s = settingsOf(keyOf(actor));
    if (s.mode !== "on_create" || !s.targets.length || (db.sent[String(o.id)] || []).some(x => x.ok && x.key === keyOf(actor))) return;
    await sendOrder(o, actor, { auto: true, force: true, acc: autoAcc(o, actor) });
  }
  async function onOrderConfirmed(o) { // AFTER the customer confirmed
    const actor = actorOfOrder(o), s = settingsOf(keyOf(actor));
    if (s.mode !== "after_confirm" || !s.targets.length || (db.sent[String(o.id)] || []).some(x => x.ok && x.key === keyOf(actor))) return;
    await sendOrder(o, actor, { auto: true, acc: autoAcc(o, actor) });
  }

  // ── readymade products (the in-stock Stock view of Reports) ──────────────────────────────────
  const readyData = () => ctx.reports && typeof ctx.reports.readymade === "function" ? ctx.reports.readymade() : { groups: [], photoBuf: async () => null, caption: () => "" };
  const inProgressReady = () => ctx.reports && typeof ctx.reports.inProgress === "function" ? ctx.reports.inProgress() : [];
  const compactGroup = g => ({ key: g.key, model: g.model, handle: g.handle || "", desc: g.desc || "", count: g.items.length, codes: g.items.map(p => p.code), photo: g.photo || "" });

  // ── STANDARD PRODUCTS (a catalogue made once, then chosen when sending: photo + name + standard measurements) ──
  const PHOTO_DIR = path.join(baseDir, "workshop-photos");
  const photoFile = id => path.join(PHOTO_DIR, id + ".jpg");
  async function savePhoto(dataUrl) {
    const m = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
    if (!m) throw new Error("The photo could not be read. Choose it again.");
    const buf = Buffer.from(m[1], "base64");
    if (buf.length < 200) throw new Error("The photo is empty. Choose it again.");
    if (buf.length > 1.5 * 1024 * 1024) throw new Error("The photo is too big (max 1.5 MB after shrinking).");
    const id = crypto.randomBytes(12).toString("hex");
    try { fs.mkdirSync(PHOTO_DIR, { recursive: true }); fs.writeFileSync(photoFile(id), buf); } catch {}
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "wphoto_" + id, value: { b64: m[1] }, updated_at: new Date().toISOString() }); } catch {} }
    return id;
  }
  async function photoBuf(id) {
    if (!/^[a-f0-9]{24}$/.test(String(id || ""))) return null;
    try { return fs.readFileSync(photoFile(id)); } catch {}
    if (supabase) { try { const { data } = await supabase.from("app_settings").select("value").eq("key", "wphoto_" + id).maybeSingle(); if (data?.value?.b64) return Buffer.from(data.value.b64, "base64"); } catch {} }
    return null;
  }
  async function dropPhoto(id) {
    if (!id || db.catalog.some(p => p.photo === id)) return;
    try { fs.unlinkSync(photoFile(id)); } catch {}
    if (supabase) { try { await supabase.from("app_settings").delete().eq("key", "wphoto_" + id); } catch {} }
  }
  app.get("/api/workshop-photo/:id.jpg", async (req, res) => {
    const buf = await photoBuf(String(req.params.id || ""));
    if (!buf) return res.status(404).end();
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" });
    res.send(buf);
  });
  const cleanSizes = v => { const arr = Array.isArray(v) ? v : String(v || "").split(/\n|;/); return [...new Set(arr.map(x => clip(x, 60)).filter(Boolean))].slice(0, 40); };
  const compactCat = p => ({ id: p.id, name: p.name, sizes: p.sizes || [], photo: p.photo || "" });
  const canManage = actor => actor?.role === "owner" || actor?.role === "open";
  function itemCaption(it, p, order, actor) {
    const isOrder = it.kind === "order";
    const L = [
      it.custom ? (order ? `🆕 NEW DESIGN — CUSTOM ORDER — ${clip(order.orderId, 40)}` : "🆕 NEW DESIGN — CUSTOM PRODUCT") : isOrder ? `🛠 WORKSHOP ORDER — ${clip(order.orderId, 40)}` : "🛋 WORKSHOP — READYMADE PRODUCT",
      `🪑 Product: ${clip(p.name, 100)}`,
      `🔢 Quantity: ×${it.qty}`,
      `📏 Measurement: ${clip(it.size, 80)}`,
      order ? `🆔 Order ID: ${clip(order.orderId, 40)}` : "",
      it.note ? `📝 Notes: ${clip(it.note, 400)}` : "",
      `👤 From: ${clip(actor?.name || "Admin", 60)}`
    ];
    return L.filter(Boolean).join("\n");
  }

  // ── routes ──────────────────────────────────────────────────────────────────────────────────
  const router = express.Router();
  router.use(requireAccess);
  router.use((req, res, next) => hasPerm(req.actor, "workshop") ? next() : res.status(403).json({ ok: false, error: "The main admin has not given you the Workshop section. Ask them to turn it on in Manage Admins." }));
  router.use(express.json({ limit: "25mb" }));
  const view = actor => {
    const key = keyOf(actor), s = settingsOf(key), acc = accountOf(actor), R = readyData();
    return {
      ok: true, me: { key, name: clip(actor?.name, 60) }, settings: { ...s, targetNames: s.targets.map(targetName) },
      sender: { ready: !!acc?.ready, label: clip(acc?.label, 60) },
      orders: (ctx.getOrders() || []).filter(o => mineOnly(actor, o) && isActive(o)).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 80).map(o => compactOrder(o, actor)),
      readymade: inProgressReady(),
      catalog: db.catalog.map(compactCat), canManage: canManage(actor),
      log: db.log.filter(l => l.key === key).slice(-15).reverse()
    };
  };
  router.get("/state", (req, res) => res.json(view(req.actor)));
  router.post("/settings", (req, res) => {
    const key = keyOf(req.actor), targets = cleanTargets(req.body?.targets), mode = String(req.body?.mode || "manual");
    if (!MODES.includes(mode)) return res.json({ ok: false, error: "Unknown sending mode." });
    if (mode !== "manual" && !targets.length) return res.json({ ok: false, error: "Choose the workshop group first — automatic sending needs a group." });
    db.admins[key] = { targets, mode, updatedAt: stamp() }; persist();
    res.json({ ...view(req.actor), message: mode === "manual" ? "✅ Saved. You send orders yourself." : mode === "after_confirm" ? "✅ Saved. Every order goes to the workshop automatically AFTER the customer confirms." : "✅ Saved. Every order goes to the workshop automatically as soon as it is created (without confirmation)." });
  });
  router.post("/dialogs", async (req, res) => { // the groups the admin's OWN Telegram account is in
    const acc = accountOf(req.actor);
    if (!acc?.ready) return res.json({ ok: false, error: "Your own Telegram account is not connected. Connect it first (Settings → Connect my Telegram account)." });
    try {
      const ds = await acc.client.getDialogs({ limit: 300 });
      const list = ds.filter(d => d.isGroup || d.isChannel).map(d => ({ chat: String(d.id), title: clip(d.title || d.name, 80) })).filter(x => /^-\d+$/.test(x.chat)).slice(0, 150);
      res.json({ ok: true, groups: list });
    } catch (e) { res.json({ ok: false, error: tgFriendly(e) }); }
  });
  router.post("/send-order", async (req, res) => {
    const o = (ctx.getOrders() || []).find(x => String(x.id) === String(req.body?.id));
    if (!o || !mineOnly(req.actor, o)) return res.json({ ok: false, error: "Order not found." });
    const r = await sendOrder(o, req.actor, { force: !!req.body?.force });
    res.json({ ...view(req.actor), ...r, message: r.ok ? `✅ Order ${o.orderId || o.id} sent to the workshop.` : undefined });
  });
  router.post("/send-readymade", async (req, res) => {
    const key = keyOf(req.actor), s = settingsOf(key);
    if (!s.targets.length) return res.json({ ok: false, error: "First choose the workshop Telegram group (Settings below)." });
    const acc = accountOf(req.actor);
    if (!acc?.ready) return res.json({ ok: false, error: "Your own Telegram account is not connected. Connect it first (Settings → Connect my Telegram account), then try again." });
    const R = readyData(), want = Array.isArray(req.body?.keys) ? req.body.keys.map(String) : null;
    const groups = R.groups.filter(g => !want || want.includes(g.key)).slice(0, 40);
    if (!groups.length) return res.json({ ok: false, error: "Choose at least one readymade product." });
    const items = [];
    for (const g of groups) { const buf = g.photo ? await R.photoBuf(g.photo) : null; items.push({ buf, caption: R.caption(g) }); }
    const n = nowEth(), head = `🛋 READYMADE PRODUCTS — ${n.d}\n${groups.reduce((a, g) => a + g.items.length, 0)} product${groups.reduce((a, g) => a + g.items.length, 0) === 1 ? "" : "s"} · ${groups.length} model${groups.length === 1 ? "" : "s"}`;
    const results = await deliver(acc, s.targets, items, head);
    const okN = results.filter(x => x.ok).length;
    db.log.push({ at: stamp(), key, by: clip(req.actor?.name || "Admin", 60), what: `Readymade · ${groups.length} model(s)`, ok: okN > 0, error: okN ? "" : (results[0]?.error || "") }); if (db.log.length > 200) db.log.splice(0, db.log.length - 200);
    persist();
    res.json({ ...view(req.actor), ok: okN > 0, results, error: okN ? (okN < results.length ? "Some groups could not be reached." : "") : (results[0]?.error || "Could not send."), message: okN ? `✅ ${groups.length} readymade model(s) sent to the workshop.` : undefined });
  });
  router.post("/catalog/save", async (req, res) => { // main admin: add / change a standard product
    if (!canManage(req.actor)) return res.json({ ok: false, error: "Only a main admin can change the standard products." });
    const name = clip(req.body?.name, 100), sizes = cleanSizes(req.body?.sizes);
    if (!name) return res.json({ ok: false, error: "Type the product name." });
    const prev = req.body?.id ? db.catalog.find(p => p.id === String(req.body.id)) : null;
    if (req.body?.id && !prev) return res.json({ ok: false, error: "That standard product no longer exists." });
    let photo = prev?.photo || "";
    try {
      if (req.body?.photo) { const old = photo; photo = await savePhoto(req.body.photo); if (old) setTimeout(() => dropPhoto(old), 0); }
      else if (req.body?.removePhoto && photo) { const old = photo; photo = ""; setTimeout(() => dropPhoto(old), 0); }
    } catch (e) { return res.json({ ok: false, error: e.message }); }
    if (!photo) return res.json({ ok: false, error: "Add the product photo — the workshop sees this picture." });
    if (prev) Object.assign(prev, { name, sizes, photo });
    else { if (db.catalog.length >= 300) return res.json({ ok: false, error: "Too many standard products (max 300)." }); db.catalog.push({ id: uid(), name, sizes, photo, createdAt: stamp() }); }
    db.catalog.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    persist(); res.json({ ...view(req.actor), message: prev ? "✅ Standard product updated." : "✅ Standard product added." });
  });
  router.post("/catalog/delete", (req, res) => {
    if (!canManage(req.actor)) return res.json({ ok: false, error: "Only a main admin can change the standard products." });
    const i = db.catalog.findIndex(p => p.id === String(req.body?.id));
    if (i < 0) return res.json({ ok: false, error: "Not found." });
    const [gone] = db.catalog.splice(i, 1); persist(); setTimeout(() => dropPhoto(gone.photo), 0);
    res.json({ ...view(req.actor), message: "🗑 Standard product removed." });
  });
  // the basket: [{ pid, qty, size, kind: "order" | "readymade", orderId (internal id, only for kind=order), note }]
  router.post("/send-items", async (req, res) => {
    const key = keyOf(req.actor), s = settingsOf(key);
    if (!s.targets.length) return res.json({ ok: false, error: "First choose the workshop Telegram group (Settings above)." });
    const acc = accountOf(req.actor);
    if (!acc?.ready) return res.json({ ok: false, error: "Your own Telegram account is not connected. Connect it first (Settings → Connect my Telegram account), then try again." });
    const raw = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20) : [];
    if (!raw.length) return res.json({ ok: false, error: "Add at least one product to the list." });
    const items = [], mineOrders = (ctx.getOrders() || []).filter(o => mineOnly(req.actor, o));
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i] || {};
      const qty = Math.floor(Number(r.qty));
      if (!(qty >= 1 && qty <= 9999)) return res.json({ ok: false, error: `Line ${i + 1}: choose a quantity (1 – 9999).` });
      const size = clip(r.size, 80);
      if (!size) return res.json({ ok: false, error: `Line ${i + 1}: choose or type the measurement.` });
      if (r.custom) { // NEW DESIGN: a one-off product made in the page (own photo + name) — it is not saved in the standard products
        const name = clip(r.name, 100);
        if (!name) return res.json({ ok: false, error: `Line ${i + 1}: type the name of the new design.` });
        const m = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(r.photoData || ""));
        if (!m) return res.json({ ok: false, error: `Line ${i + 1}: the photo of the new design could not be read. Choose it again.` });
        const buf = Buffer.from(m[1], "base64");
        if (buf.length < 200 || buf.length > 6 * 1024 * 1024) return res.json({ ok: false, error: `Line ${i + 1}: the photo is empty or too big.` });
        let order = null;
        if (r.orderId) { order = mineOrders.find(o => String(o.id) === String(r.orderId)); if (!order) return res.json({ ok: false, error: `Line ${i + 1}: the chosen order was not found.` }); }
        const it = { kind: "order", custom: true, qty, size, note: clip(r.note, 400) };
        items.push({ buf, caption: itemCaption(it, { name }, order, req.actor), what: `New design${order ? " · " + (order.orderId || order.id) : ""} · ${name} ×${qty}` });
        continue;
      }
      const p = db.catalog.find(x => x.id === String(r.pid));
      if (!p) return res.json({ ok: false, error: `Line ${i + 1}: the standard product no longer exists.` });
      const kind = r.kind === "order" ? "order" : r.kind === "readymade" ? "readymade" : "";
      if (!kind) return res.json({ ok: false, error: `Line ${i + 1}: decide if it is an ORDER or READYMADE.` });
      let order = null;
      if (kind === "order") { order = mineOrders.find(o => String(o.id) === String(r.orderId)); if (!order) return res.json({ ok: false, error: `Line ${i + 1}: choose the order this product belongs to.` }); }
      const it = { kind, qty, size, note: clip(r.note, 400) };
      items.push({ buf: await photoBuf(p.photo), caption: itemCaption(it, p, order, req.actor), what: `${kind === "order" ? "Order " + (order.orderId || order.id) : "Readymade"} · ${p.name} ×${qty}` });
    }
    const results = await deliver(acc, s.targets, items, "");
    const okN = results.filter(x => x.ok).length;
    for (const it of items) db.log.push({ at: stamp(), key, by: clip(req.actor?.name || "Admin", 60), what: it.what, ok: okN > 0, error: okN ? "" : (results[0]?.error || "") });
    if (db.log.length > 200) db.log.splice(0, db.log.length - 200);
    persist();
    res.json({ ...view(req.actor), ok: okN > 0, results, error: okN ? (okN < results.length ? "Some groups could not be reached." : "") : (results[0]?.error || "Could not send."), message: okN ? `✅ ${items.length} product${items.length === 1 ? "" : "s"} sent to the workshop.` : undefined });
  });
  router.post("/test", async (req, res) => {
    const s = settingsOf(keyOf(req.actor));
    if (!s.targets.length) return res.json({ ok: false, error: "First choose the workshop Telegram group." });
    const acc = accountOf(req.actor);
    if (!acc?.ready) return res.json({ ok: false, error: "Your own Telegram account is not connected. Connect it first (Settings → Connect my Telegram account)." });
    const results = await deliver(acc, s.targets, [{ buf: null, caption: "✅ AMBAR workshop test — this group will receive orders and readymade products from " + clip(req.actor?.name || "the admin", 60) + "." }]);
    const okN = results.filter(x => x.ok).length;
    res.json({ ok: okN > 0, results, error: okN ? "" : (results[0]?.error || "Could not send."), message: okN ? "✅ Test message sent." : undefined });
  });
  app.get("/api/workshop-version", (req, res) => res.json({ ok: true, workshop: "v152" }));
  app.use("/api/workshop", router);

  return { load, onOrderCreated, onOrderConfirmed };
}
module.exports = { register };
