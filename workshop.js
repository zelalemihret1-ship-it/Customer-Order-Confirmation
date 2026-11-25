// ── WORKSHOP (module + page: /workshop.html) ───────────────────────────────────────────────────
// v154: synchronized production, stock and workshop message formats, connected to Reports and to the orders
//   • each admin picks TWO places in his own Telegram groups: the WORKSHOP topic and the FINISHING topic (a real group list + a real topic list)
//   • only orders that are CONFIRMED by the customer and whose card was DELIVERED are orderable here (rejected / undelivered orders are removed from the list)
//   • an order / readymade product sent to the workshop = a JOB. The BOT posts it in the WORKSHOP topic with the button  🛠 Finished workshop
//       → the job is posted in the FINISHING topic with the button  ✅ Finished
//       → Finished: the product moves to STOCK in Reports and the order shows "Finished · in stock"
//   • the same two buttons also exist in the mini app (Progress tab) in case somebody does not use Telegram
// Browsing groups/topics uses the admin's OWN Telegram account; the job messages (with buttons) are posted by the BOT — a user account cannot send buttons —
// so the AMBAR bot must be a member of the group. The workshop gets the product photo + production details only: no phone number, no payment, no customer contact.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const express = require("express");

const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const uid = () => crypto.randomBytes(6).toString("hex");
const MODES = ["manual", "after_confirm"];

function register(app, ctx) {
  const { requireAccess, supabase, baseDir, helpers } = ctx;
  const hasPerm = typeof ctx.hasPerm === "function" ? ctx.hasPerm : (actor, key) => actor?.role === "owner" || actor?.role === "open" || (actor?.perms || []).includes(key);
  const DATA_FILE = path.join(baseDir, "workshop-data.json");
  let db = { admins: {}, sent: {}, jobs: {}, log: [], catalog: [], savedAt: "", cutoverAt: "", cutoverVersion: 157 };

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
    if (d && typeof d === "object") db = { admins: {}, sent: {}, jobs: {}, log: [], catalog: [], savedAt: "", ...d };
    if (!Array.isArray(db.catalog)) db.catalog = [];
    for (const k of ["admins", "sent", "jobs"]) if (!db[k] || typeof db[k] !== "object" || Array.isArray(db[k])) db[k] = {};
    if (!Array.isArray(db.log)) db.log = [];
    // v157: start the Workshop queue fresh from this deployment; retain historical records in storage.
    if (db.cutoverVersion !== 157 || !db.cutoverAt) { db.cutoverAt = new Date().toISOString(); db.cutoverVersion = 157; await persist(); }
  }

  // ── who is who ──────────────────────────────────────────────────────────────────────────────
  const keyOf = actor => String(actor?.telegramId || "") || "open";
  const settingsOf = key => {
    const s = db.admins[key] || {};
    const one = x => (x && typeof x === "object" ? cleanTargets([x])[0] : null) || null;
    const workshop = one(s.workshop) || (Array.isArray(s.targets) && s.targets[0] ? cleanTargets([s.targets[0]])[0] || null : null); // v150–v152 saved one "targets" list: its first group is the workshop
    const finishing = one(s.finishing);
    return { workshop, finishing, stock: one(s.stock), mode: MODES.includes(s.mode) ? s.mode : (s.mode === "on_create" ? "after_confirm" : "manual"), updatedAt: s.updatedAt || "" };
  };
  function accountOf(actor) {
    let acc = typeof ctx.accountFor === "function" ? ctx.accountFor(actor) : null;
    if (!acc && actor?.role === "open" && ctx.admins) acc = [...ctx.admins.values()].find(a => a.ready) || null; // open mode (no admin list yet): any connected account
    return acc;
  }
  const mineOnly = (actor, o) => actor?.role === "owner" || actor?.role === "open" || actor?.viewer || String(o.createdByTelegramId || "") === String(actor?.telegramId || "");
  // v153: ORDERABLE = the customer CONFIRMED it AND the order card was DELIVERED to the customer. Everything else (rejected, still waiting, not delivered) is not shown.
  const isOrderable = o => o.status === "Confirmed" && !!(o.sent || o.customerDelivered);
  const nowEth = () => { const g = new Date().toLocaleString("sv-SE", { timeZone: helpers.TZ || "Africa/Addis_Ababa" }); return { d: helpers.ethDate(g.slice(0, 10)), t: g.slice(11, 16) }; };
  const stamp = () => { const n = nowEth(); return n.d + " " + n.t; };
  const R = () => ctx.reports || {};

  // ── Telegram targets: public @username · private group id (-100…) · any t.me link, + optional forum TOPIC ──
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
  function cleanTargets(v) {
    const arr = Array.isArray(v) ? v : String(v || "").split(/[\s,;\n]+/), out = [];
    for (const x of arr) {
      let o = null;
      if (x && typeof x === "object") { const pl = parseTgLink(x.chat); if (pl) o = { chat: pl.chat, title: clip(x.title, 80), topic: Number.isInteger(Number(x.topic)) && Number(x.topic) > 1 ? Number(x.topic) : 0, topicTitle: clip(x.topicTitle, 80) }; }
      else { const pl = parseTgLink(x); if (pl) o = { chat: pl.chat, title: /^-?\d/.test(pl.chat) ? "" : "@" + pl.chat, topic: 0, topicTitle: "" }; }
      if (o && !out.some(y => y.chat.toLowerCase() === o.chat.toLowerCase() && y.topic === o.topic)) out.push(o);
    }
    return out.slice(0, 5);
  }
  const targetName = g => g ? (g.title || (/^-/.test(g.chat) ? "Group " + g.chat : "@" + g.chat)) + (g.topic ? " › " + (g.topicTitle || "topic " + g.topic) : (g.topicTitle ? " › " + g.topicTitle : "")) : "";
  async function resolveTarget(acc, g) {
    const key = /^-?\d+$/.test(g.chat) ? BigInt(g.chat) : "@" + g.chat;
    try { return await acc.client.getEntity(key); }
    catch (e) { if (typeof key === "bigint") { await acc.client.getDialogs({ limit: 500 }); return await acc.client.getEntity(key); } throw e; }
  }
  const tgFriendly = e => {
    const m = String(e?.errorMessage || e?.message || e || "");
    if (/FLOOD_WAIT|PEER_FLOOD|Too Many Requests/i.test(m)) return "Telegram asked to slow down. Try again in a few minutes.";
    if (/USERNAME_NOT_OCCUPIED|USERNAME_INVALID/i.test(m)) return "No Telegram group with this username exists. Check the spelling.";
    if (/CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED|USER_BANNED_IN_CHANNEL|CHANNEL_PRIVATE|CHAT_SEND_PHOTOS_FORBIDDEN|CHAT_SEND_MEDIA_FORBIDDEN/i.test(m)) return "Your Telegram account is not allowed to look into that group. Join it with your own account.";
    if (/PEER_ID_INVALID|Cannot find any entity|not found/i.test(m)) return "Your Telegram account cannot see that group. Join the group with your own account, or pick it from the list.";
    if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(m)) return "Your Telegram connection expired. Connect your Telegram account again.";
    return clip(m, 160) || "Could not reach Telegram.";
  };
  const botFriendly = e => {
    const m = String(e?.message || e || "");
    if (/BOT_TOKEN is not configured/i.test(m)) return "The AMBAR bot is not set up on the server (BOT_TOKEN).";
    if (/chat not found/i.test(m)) return "The AMBAR bot cannot see this group. Add the bot to the group (as admin) first.";
    if (/not enough rights|have no rights|CHAT_WRITE_FORBIDDEN|need administrator|bot was kicked|bot is not a member|forbidden/i.test(m)) return "The AMBAR bot is not allowed to post here. Add the bot to the group and make it an admin.";
    if (/message thread not found|TOPIC_CLOSED|TOPIC_DELETED/i.test(m)) return "That topic does not exist (or is closed). Choose the topic again.";
    if (/Too Many Requests|retry after/i.test(m)) return "Telegram asked to slow down. Try again in a minute.";
    return clip(m, 160) || "The bot could not post.";
  };

  // ── posting with the BOT (inline buttons need the bot) ──────────────────────────────────────
  const tg = (method, body) => ctx.tgApi.call(method, body);
  const chatKey = g => /^-?\d+$/.test(String(g.chat)) ? String(g.chat) : "@" + String(g.chat).replace(/^@/, "");
  async function botPost(g, buf, caption, markup) {
    const topic = g.topic > 1 ? g.topic : 0;
    if (buf) {
      const build = () => { const fd = new FormData(); fd.append("chat_id", chatKey(g)); if (topic) fd.append("message_thread_id", String(topic)); fd.append("caption", caption.slice(0, 1000)); if (markup) fd.append("reply_markup", JSON.stringify(markup)); fd.append("photo", new Blob([buf], { type: "image/jpeg" }), "product.jpg"); return fd; };
      try { const r = await ctx.tgApi.sendForm("sendPhoto", build); return { chat: r.chat?.id != null ? String(r.chat.id) : chatKey(g), message_id: r.message_id, photo: true }; }
      catch (e) { if (!/IMAGE_PROCESS_FAILED|PHOTO_INVALID|wrong file|image/i.test(String(e.message))) throw e; } // not a picture Telegram accepts → plain text
    }
    const r = await tg("sendMessage", { chat_id: chatKey(g), ...(topic ? { message_thread_id: topic } : {}), text: caption.slice(0, 4000), ...(markup ? { reply_markup: markup } : {}) });
    return { chat: r.chat?.id != null ? String(r.chat.id) : chatKey(g), message_id: r.message_id, photo: false };
  }
  async function botEdit(ref, caption, markup) { // change the text of a posted message (and drop its button); never throws
    if (!ref) return;
    const body = { chat_id: ref.chat, message_id: ref.message_id, reply_markup: markup || { inline_keyboard: [] } };
    try { await tg(ref.photo ? "editMessageCaption" : "editMessageText", ref.photo ? { ...body, caption: caption.slice(0, 1000) } : { ...body, text: caption.slice(0, 4000) }); }
    catch (e) { if (!/not modified/i.test(String(e.message))) { try { await tg("editMessageReplyMarkup", { chat_id: ref.chat, message_id: ref.message_id, reply_markup: { inline_keyboard: [] } }); } catch {} } }
  }
  const kbWorkshop = id => ({ inline_keyboard: [[{ text: "🛠 Finished workshop", callback_data: "wsf:" + id }]] });
  const kbFinishing = id => ({ inline_keyboard: [[{ text: "✅ Finished", callback_data: "wfin:" + id }]] });
  const kbSoldOut = id => ({ inline_keyboard: [[{ text: "🔴 Sold Out", callback_data: "wsold:" + id }]] });
  const kbRestock = id => ({ inline_keyboard: [[{ text: "♻️ Restock", callback_data: "wrestock:" + id }]] });

  // ── pictures ────────────────────────────────────────────────────────────────────────────────
  async function orderPhotoBuf(o) {
    const u = String(o.photo || ""); if (!u) return null;
    try {
      if (/^https?:\/\//i.test(u)) { const r = await fetch(u); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()); }
      const f = path.join(ctx.uploadDir || path.join(__dirname, "public", "uploads"), path.basename(u.split("?")[0]));
      return fs.readFileSync(f);
    } catch { return null; }
  }
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
    if (!id || db.catalog.some(p => p.photo === id) || Object.values(db.jobs).some(j => j.photoId === id)) return;
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

  // ── jobs: one job = one thing sent to the workshop. stage: workshop → finishing → finished ────
  const STAGES = { workshop: "In workshop", finishing: "In finishing", finished: "Finished · in stock" };
  const sizeOfOrder = o => [o.length, o.width, o.height].map(x => clip(x, 20)).filter(Boolean).join(" × ");
  const line = (icon, label, v) => { v = clip(v, 120); return v ? `${icon} ${label}: ${v}` : ""; };
  const originalProductCode = o => {
    const direct = [o?.productId, o?.productCode, o?.prodId, o?.modelCode, o?.modelId, o?.code].map(x => clip(x, 30)).find(Boolean);
    if (direct) return direct;
    const label = clip(o?.product || o?.model || "", 120);
    const match = label.match(/\b[A-Z0-9]{1,12}-[A-Z0-9]{1,12}\b/i);
    return match ? match[0].toUpperCase() : "";
  };
  function jobCaption(j, stage, extra) {
    const head = "_________ AMBAR FURNITURE _________";
    const ordered = j.kind === "order" || !!j.orderLabel;
    const L = [head, ordered ? "ORDERED PRODUCT" : "READYMADE PRODUCT", "PRODUCT ID- " + ((j.codes || []).join(", ") || "Pending"), "MODEL- " + clip(j.name || "—", 100), ordered ? "ORDER ID- " + clip(j.orderLabel, 40) : "", "", "📏 Measurement: " + clip(j.size || "—", 80), "🔢 Quantity: " + (j.qty || 1), "ADDITIONAL TEXTS:", ...(j.details || []), j.note ? clip(j.note, 400) : "", extra || ""];
    return L.filter(Boolean).join("\n");
  }
  const orderDetails = o => [line("🧱", "Material", o.material), line("🎨", "Color", o.color), line("✨", "Style", o.style), line("🖌", "Design", o.design), line("🔧", "Handle", o.handle), line("🚪", "Door", o.door), line("🗂", "Partition", o.partition), line("🧰", "Drawer", o.drawer), line("➕", "Extra", o.additionalFeatures), line("📅", "Completion date", o.completionDate), line("🚚", "Delivery date", o.deliveryDate)].filter(Boolean);
  const findOrder = id => (ctx.getOrders() || []).find(o => String(o.id) === String(id));
  const orderJob = oid => Object.values(db.jobs).filter(j => String(j.orderId) === String(oid)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  async function saveOrderStage(j, patch) { // the order shows where its production is
    if (!j.orderId) return;
    const o = findOrder(j.orderId); if (!o) return;
    o.workshop = { ...(o.workshop || {}), jobId: j.id, stage: j.stage, ...patch };
    try { if (typeof ctx.saveOrder === "function") await ctx.saveOrder(o); } catch (e) { console.warn("Workshop: order stage not saved:", e.message); }
  }
  const compactJob = j => ({ id: j.id, kind: j.kind, custom: !!j.custom, name: j.name, qty: j.qty || 0, size: j.size || "", orderLabel: j.orderLabel || "", codes: j.codes || [], stage: j.stage, stageName: STAGES[j.stage] || j.stage, createdAt: j.createdAt || "", wsDone: j.wsDone || null, finDone: j.finDone || null, stockState: j.stockState || "stock", by: j.by || "", photo: j.photoId || "" });
  const log = (key, actor, what, ok, error) => { db.log.push({ at: stamp(), key, by: clip(actor?.name || "Admin", 60), what, ok: !!ok, error: error || "" }); if (db.log.length > 300) db.log.splice(0, db.log.length - 300); };

  // create the job, make its Reports product(s), post it in the WORKSHOP topic with the button
  async function createJob(spec, actor) {
    const key = keyOf(actor), s = settingsOf(key);
    if (!s.workshop) return { ok: false, error: "First choose the WORKSHOP group and topic (Settings above)." };
    if (!s.finishing) return { ok: false, error: "First choose the FINISHING group and topic (Settings above) — the workshop button sends the job there." };
    if (!s.stock) return { ok: false, error: "First choose the STOCK group and topic (Settings above) — finished products are posted there." };
    const id = uid(), by = clip(actor?.name || "Admin", 60);
    const j = { id, key, kind: spec.kind, custom: !!spec.custom, name: clip(spec.name, 100), qty: spec.qty || 0, size: clip(spec.size, 80), note: clip(spec.note, 400), orderId: spec.orderId || "", orderLabel: spec.orderLabel || "", details: spec.details || [], by, stage: "workshop", createdAt: stamp(), createdAtIso: new Date().toISOString(), productIds: [], codes: [], photoId: "" };
    // 1) Reports: the product(s) enter the Workflow (ORDER or READYMADE). Existing Workflow products (sent from the Readymade tab) are reused.
    if (spec.existingProductIds && spec.existingProductIds.length) {
      for (const pid of spec.existingProductIds) { const st = R().wsStatus ? R().wsStatus(pid) : null; if (st) { j.productIds.push(pid); j.codes.push(st.code); if (R().wsSetStage) R().wsSetStage(pid, "workshop", by, id); } }
    } else if (typeof R().wsAddProduct === "function") {
      const n = Math.max(1, Math.min(spec.qty || 1, 100));
      for (let i = 0; i < n; i++) {
        const p = await R().wsAddProduct({ model: spec.name, code: spec.productCode || "", desc: [j.size, spec.orderLabel].filter(Boolean).join(" · "), orderType: spec.kind === "order" ? "ORDER" : "READYMADE", priority: spec.priority || "MEDIUM", handle: spec.handle || "", note: j.note, orderRef: spec.orderLabel || "", jobId: id, photoBuf: spec.buf, deliveryDate: spec.deliveryDate || "", salesName: by }, by);
        j.productIds.push(p.id); j.codes.push(p.code);
      }
    }
    // 2) the bot posts it in the WORKSHOP topic
    let ref;
    try { ref = await botPost(s.workshop, spec.buf, jobCaption(j, "workshop"), kbWorkshop(id)); }
    catch (e) { if (!spec.existingProductIds && j.productIds.length && R().wsRemove) R().wsRemove(j.productIds); return { ok: false, error: botFriendly(e) }; }
    j.wsMsg = ref;
    if (spec.buf && spec.buf.length <= 1.4 * 1024 * 1024) { try { j.photoId = await savePhoto("data:image/jpeg;base64," + spec.buf.toString("base64")); } catch {} } // kept so the FINISHING post shows the same picture
    db.jobs[id] = j;
    const keys = Object.keys(db.jobs); if (keys.length > 600) { for (const k of keys.sort((a, b) => String(db.jobs[a].createdAt).localeCompare(String(db.jobs[b].createdAt))).slice(0, keys.length - 600)) if (db.jobs[k].stage === "finished") { const ph = db.jobs[k].photoId; delete db.jobs[k]; if (ph) setTimeout(() => dropPhoto(ph), 0); } }
    await saveOrderStage(j, { sentAt: stamp(), by });
    log(key, actor, `${j.kind === "order" ? "Order " + (j.orderLabel || "") : "Readymade"} · ${j.name}${j.qty ? " ×" + j.qty : ""}`, true, "");
    persist();
    return { ok: true, job: j };
  }

  // WORKSHOP → FINISHING (button "Finished workshop")
  async function toFinishing(jobId, byName) {
    const j = db.jobs[String(jobId)]; if (!j) return { ok: false, error: "This job was not found any more." };
    if (j.stage === "finishing") return { ok: false, code: "DONE", error: "Already in finishing." };
    if (j.stage === "finished") return { ok: false, code: "DONE", error: "This job is already finished." };
    const s = settingsOf(j.key);
    if (!s.finishing) return { ok: false, error: "The FINISHING topic is not chosen. Choose it in the Workshop settings." };
    const by = clip(byName, 60) || "Workshop", at = stamp();
    let ref;
    try { ref = await botPost(s.finishing, j.photoId ? await photoBuf(j.photoId) : null, jobCaption(j, "finishing", `⏩ Finished in the workshop by ${by} · ${at}`), kbFinishing(j.id));  }
    catch (e) { return { ok: false, error: botFriendly(e) }; }
    j.stage = "finishing"; j.wsDone = { by, at }; j.finMsg = ref;
    for (const pid of j.productIds || []) if (R().wsSetStage) R().wsSetStage(pid, "finishing", by, j.id);
    await botEdit(j.wsMsg, jobCaption(j, "workshop", `✅ Finished workshop — ${by} · ${at}\n➡ Sent to FINISHING`));
    await saveOrderStage(j, { wsDoneAt: at, wsDoneBy: by });
    log(j.key, { name: by }, `Finished workshop · ${j.name}`, true, ""); persist();
    return { ok: true, job: j };
  }
  // FINISHING → STOCK (button "Finished"): Reports product(s) go to STOCK, the order shows "Finished"
  async function toStock(jobId, byName) {
    const j = db.jobs[String(jobId)]; if (!j) return { ok: false, error: "This job was not found any more." };
    if (j.stage === "finished") return { ok: false, code: "DONE", error: "This job is already finished and in stock." };
    if (j.stage !== "finishing") return { ok: false, code: "EARLY", error: "The workshop has not pressed “Finished workshop” yet." };
    const s = settingsOf(j.key);
    if (!s.stock) return { ok: false, error: "The STOCK group is not chosen. Choose it in Workshop settings before finishing this product." };
    const by = clip(byName, 60) || "Finishing", at = stamp(), missing = [];
    for (const pid of j.productIds || []) { const r = typeof R().wsFinish === "function" ? R().wsFinish(pid, by) : { ok: false }; if (!r.ok) missing.push(r.error || "a product"); }
    j.stage = "finished"; j.finDone = { by, at };
    await botEdit(j.finMsg, jobCaption(j, "finishing", `✅ FINISHED — ${by} · ${at}\n📦 Sent to STOCK${(j.codes || []).length ? " (" + j.codes.join(", ") + ")" : ""}`));
    try { j.stockMsg = await botPost(s.stock, j.photoId ? await photoBuf(j.photoId) : null, jobCaption(j, "stock", `📦 IN STOCK — ${by} · ${at}`), kbSoldOut(j.id)); }
    catch (e) { j.stockPostError = botFriendly(e); }
    await saveOrderStage(j, { finishedAt: at, finishedBy: by });
    log(j.key, { name: by }, `Finished · ${j.name} → stock`, true, missing.length ? missing.join(" ") : ""); persist();
    return { ok: true, job: j, warning: [missing.length ? "Some products were not found in Reports: " + missing.join(" ") : "", j.stockPostError ? "Stock group post failed: " + j.stockPostError : ""].filter(Boolean).join(" · ") };
  }
  // the Telegram buttons (the server forwards every callback whose data starts with wsf: or wfin:)
  async function onButton(cb) {
    const [action, id] = String(cb?.data || "").split(":");
    const answer = (text, alert) => tg("answerCallbackQuery", { callback_query_id: cb.id, text: String(text).slice(0, 190), show_alert: !!alert }).catch(() => {});
    const j = db.jobs[String(id)];
    if (!j) return answer("This job was not found any more.", true);
    const chatId = String(cb.message?.chat?.id || "");
    const by = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") || (cb.from?.username ? "@" + cb.from.username : "Workshop");
    if (action === "wsf") {
      if (j.wsMsg && chatId && String(j.wsMsg.chat) !== chatId) return answer("This button belongs to another group.", true);
      const r = await toFinishing(j.id, by);
      return answer(r.ok ? "✅ Sent to FINISHING." : r.error, !r.ok && r.code !== "DONE");
    }
    if (action === "wfin") {
      if (j.finMsg && chatId && String(j.finMsg.chat) !== chatId) return answer("This button belongs to another group.", true);
      const r = await toStock(j.id, by);
      return answer(r.ok ? (j.stockPostError ? "Finished, but the stock-group post failed: " + j.stockPostError : "✅ Finished — posted to the STOCK group.") : r.error, !r.ok && r.code !== "DONE");
    }
    if (action === "wsold") {
      if (j.stockMsg && chatId && String(j.stockMsg.chat) !== chatId) return answer("This button belongs to the STOCK group only.", true);
      const results = (j.productIds || []).map(pid => typeof R().wsSoldOut === "function" ? R().wsSoldOut(pid, by) : { ok: false, error: "Stock action is unavailable." });
      const bad = results.find(x => !x.ok);
      if (bad) return answer(bad.error, true);
      j.stockState = "sold"; j.soldAt = stamp(); j.soldBy = by;
      await botEdit(j.stockMsg, jobCaption(j, "stock", `🔴 SOLD OUT — ${by} · ${j.soldAt}`), kbRestock(j.id));
      log(j.key, { name: by }, `Sold Out · ${j.name}`, true, ""); persist();
      return answer("🔴 Product marked Sold Out. Restock is now available.");
    }
    if (action === "wrestock") {
      if (j.stockMsg && chatId && String(j.stockMsg.chat) !== chatId) return answer("This button belongs to the STOCK group only.", true);
      const results = (j.productIds || []).map(pid => typeof R().wsRestock === "function" ? R().wsRestock(pid, by) : { ok: false, error: "Restock action is unavailable." });
      const bad = results.find(x => !x.ok);
      if (bad) return answer(bad.error, true);
      j.stockState = "stock"; j.restockAt = stamp(); j.restockBy = by;
      await botEdit(j.stockMsg, jobCaption(j, "stock", `♻️ RESTOCKED — ${by} · ${j.restockAt}`), kbSoldOut(j.id));
      log(j.key, { name: by }, `Restocked · ${j.name}`, true, ""); persist();
      return answer("♻️ Product restocked and returned to In Stock.");
    }
  }

  // ── send an order (only orderable orders) ───────────────────────────────────────────────────
  async function sendOrder(o, actor, opt = {}) {
    if (!isOrderable(o)) return { ok: false, code: "NOT_ORDERABLE", error: o.status === "Rejected" ? "The customer REJECTED this order." : o.status !== "Confirmed" ? "The customer has not confirmed this order yet." : "The order card was not delivered to the customer." };
    const prev = orderJob(o.id);
    if (prev && !opt.again) return { ok: false, code: "ALREADY", error: `This order is already ${STAGES[prev.stage] ? STAGES[prev.stage].toLowerCase() : "sent"}.` };
    const buf = await orderPhotoBuf(o);
    return createJob({ kind: "order", name: o.product || "Furniture order", productCode: originalProductCode(o), qty: 1, size: sizeOfOrder(o), note: "", orderId: o.id, orderLabel: o.orderId || String(o.id), details: orderDetails(o), buf, handle: o.handle, deliveryDate: "", priority: "MEDIUM" }, opt.actor || actor);
  }
  const actorOfOrder = o => ({ role: o.createdByRole === "owner" ? "owner" : (o.createdByTelegramId ? "admin" : "open"), telegramId: String(o.createdByTelegramId || ""), name: o.createdByName || "Admin" });
  async function onOrderCreated() { /* v153: orders only go to the workshop after the customer confirmed — nothing happens at creation */ }
  async function onOrderConfirmed(o) { // mode "after the customer confirms": automatic
    const actor = actorOfOrder(o), s = settingsOf(keyOf(actor));
    if (s.mode !== "after_confirm" || !s.workshop || !s.finishing || !s.stock || orderJob(o.id)) return;
    const r = await sendOrder(o, actor, {});
    if (!r.ok) log(keyOf(actor), actor, `Auto · order ${o.orderId || o.id}`, false, r.error);
    persist();
  }

  // ── routes ──────────────────────────────────────────────────────────────────────────────────
  const router = express.Router();
  router.use(requireAccess);
  router.use((req, res, next) => hasPerm(req.actor, "workshop") ? next() : res.status(403).json({ ok: false, error: "The main admin has not given you the Workshop section. Ask them to turn it on in Manage Admins." }));
  router.use(express.json({ limit: "25mb" }));
  const compactOrder = (o, actor) => { const j = orderJob(o.id); return { id: o.id, orderId: o.orderId || "", productId: originalProductCode(o), size: sizeOfOrder(o), product: clip(o.product, 80), customerName: clip(o.customerName, 60), createdAt: o.createdAt || "", completionDate: clip(o.completionDate, 30), deliveryDate: clip(o.deliveryDate, 30), photo: o.photo || "", job: j ? { id: j.id, stage: j.stage, stageName: STAGES[j.stage] } : null }; };
  const view = actor => {
    const key = keyOf(actor), s = settingsOf(key), acc = accountOf(actor);
    const inProg = (typeof R().inProgress === "function" ? R().inProgress() : []).map(p => { const j = Object.values(db.jobs).find(x => (x.productIds || []).includes(p.id)); return { ...p, job: j ? compactJob(j) : null }; });
    const mine = Object.values(db.jobs).filter(j => j.key === key).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return {
      ok: true, me: { key, name: clip(actor?.name, 60) },
      settings: { workshop: s.workshop, finishing: s.finishing, stock: s.stock, mode: s.mode, workshopName: targetName(s.workshop), finishingName: targetName(s.finishing), stockName: targetName(s.stock) },
      sender: { ready: !!acc?.ready, label: clip(acc?.label, 60) },
      // Once sent to the workshop, remove the order from this sending queue permanently.
      // This also hides older orders that were already sent before this update.
      orders: (ctx.getOrders() || []).filter(o => mineOnly(actor, o) && isOrderable(o) && !orderJob(o.id) && (() => { const t = Date.parse(o.createdAt || o.created || ""); return Number.isFinite(t) && t >= Date.parse(db.cutoverAt); })()).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 120).map(o => compactOrder(o, actor)),
      readymade: inProg,
      jobs: mine.filter(j => j.stage !== "finished" && j.createdAtIso && Date.parse(j.createdAtIso) >= Date.parse(db.cutoverAt)).slice(0, 100).map(compactJob),
      doneJobs: mine.filter(j => j.stage === "finished" && j.createdAtIso && Date.parse(j.createdAtIso) >= Date.parse(db.cutoverAt)).slice(0, 15).map(compactJob),
      catalog: db.catalog.map(compactCat), canManage: canManage(actor),
      log: db.log.filter(l => l.key === key).slice(-100).reverse()
    };
  };
  router.get("/state", (req, res) => res.json(view(req.actor)));
  router.post("/settings", (req, res) => {
    const key = keyOf(req.actor), mode = String(req.body?.mode || "manual");
    if (!MODES.includes(mode)) return res.json({ ok: false, error: "Unknown sending mode." });
    const one = x => (x && x.chat ? cleanTargets([x])[0] || null : null);
    const workshop = one(req.body?.workshop), finishing = one(req.body?.finishing), stock = one(req.body?.stock);
    if (workshop && finishing && workshop.chat.toLowerCase() === finishing.chat.toLowerCase() && workshop.topic === finishing.topic) return res.json({ ok: false, error: "The WORKSHOP and the FINISHING place are the same. Choose a different topic (or group) for finishing." });
    if (mode !== "manual" && (!workshop || !finishing)) return res.json({ ok: false, error: "Choose both the workshop and the finishing place first — automatic sending needs them." });
    if (workshop && stock && workshop.chat.toLowerCase() === stock.chat.toLowerCase() && workshop.topic === stock.topic) return res.json({ ok: false, error: "Choose a different STOCK place from the WORKSHOP place." });
    if (finishing && stock && finishing.chat.toLowerCase() === stock.chat.toLowerCase() && finishing.topic === stock.topic) return res.json({ ok: false, error: "Choose a different STOCK place from the FINISHING place." });
    db.admins[key] = { workshop, finishing, stock, mode, updatedAt: stamp() }; persist();
    res.json({ ...view(req.actor), message: mode === "manual" ? "✅ Saved. You send orders to the workshop yourself." : "✅ Saved. Every order goes to the workshop automatically AFTER the customer confirms." });
  });
  // the groups the admin's OWN Telegram account is in (with a flag for groups that have topics)
  router.post("/dialogs", async (req, res) => {
    const acc = accountOf(req.actor);
    if (!acc?.ready) return res.json({ ok: false, error: "Your own Telegram account is not connected. Connect it first (Settings → Connect my Telegram account), or paste the group link instead." });
    try {
      const ds = await acc.client.getDialogs({ limit: 400 });
      const list = ds.filter(d => d.isGroup || d.isChannel).map(d => ({ chat: String(d.id), title: clip(d.title || d.name, 80), forum: !!d.entity?.forum, channel: !!d.entity?.broadcast })).filter(x => /^-\d+$/.test(x.chat)).sort((a, b) => Number(b.forum) - Number(a.forum) || a.title.localeCompare(b.title)).slice(0, 250);
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
    if (!acc?.ready) return res.json({ ok: false, error: "Your own Telegram account is not connected, so the topics cannot be listed. Paste a link of the topic instead." });
    const pl = parseTgLink(req.body?.chat); if (!pl) return res.json({ ok: false, error: "This group could not be read." });
    try { res.json({ ok: true, chat: pl.chat, ...(await topicsOf(acc, pl.chat)) }); } catch (e) { res.json({ ok: false, error: tgFriendly(e) }); }
  });
  // a pasted link / @username / id → the real group, its title, and the topic only if it really is a topic of that group
  router.post("/resolve", async (req, res) => {
    const raw = String(req.body?.link || "").trim();
    const m = raw.replace(/^(https?:\/\/)?(www\.)?(t|telegram)\.me\//i, "").split(/[/?#]/).filter(Boolean);
    if (m[0] === "joinchat" || /^\+/.test(m[0] || "")) return res.json({ ok: false, error: "An invite link (t.me/+…) cannot be used. Open the group, long-press any message → Copy link, and paste THAT link — or choose the group from the list." });
    const pl = parseTgLink(raw); if (!pl) return res.json({ ok: false, error: "This is not a Telegram group link, @username or id." });
    const acc = accountOf(req.actor);
    if (!acc?.ready) return res.json({ ok: true, unchecked: true, chat: pl.chat, title: /^-?\d/.test(pl.chat) ? "" : "@" + pl.chat, topic: pl.nums.length >= 2 ? pl.nums[0] : 0, topicTitle: "", forum: null, topics: [] });
    try {
      const t = await topicsOf(acc, pl.chat);
      let topic = 0, topicTitle = "";
      if (t.forum) { // t.me/c/ID/TOPIC/MESSAGE → topic = first number; t.me/c/ID/N → N is a topic only if that topic exists (otherwise it is a message in General)
        const cand = pl.nums[0] || 0, hit = t.topics.find(x => x.id === cand);
        if (hit) { topic = hit.id > 1 ? hit.id : 0; topicTitle = hit.title; }
      }
      res.json({ ok: true, chat: pl.chat, title: t.title, topic, topicTitle, forum: t.forum, topics: t.topics });
    } catch (e) { res.json({ ok: false, error: tgFriendly(e) }); }
  });
  // is the AMBAR bot able to post in the chosen place?
  router.post("/bot-check", async (req, res) => {
    const out = [];
    try {
      const me = await tg("getMe", {});
      for (const [label, g] of [["Workshop", cleanTargets([req.body?.workshop])[0]], ["Finishing", cleanTargets([req.body?.finishing])[0]], ["Stock", cleanTargets([req.body?.stock])[0]]]) {
        if (!g) { out.push({ label, ok: false, error: "Not chosen yet." }); continue; }
        try {
          const cm = await tg("getChatMember", { chat_id: chatKey(g), user_id: me.id });
          const st = String(cm.status || "");
          if (["left", "kicked"].includes(st)) out.push({ label, ok: false, error: `Add @${me.username} to this group.` });
          else if (st === "restricted" && cm.can_send_messages === false) out.push({ label, ok: false, error: `@${me.username} is muted in this group. Make it an admin.` });
          else out.push({ label, ok: true, status: st });
        } catch (e) { out.push({ label, ok: false, error: botFriendly(e) }); }
      }
      res.json({ ok: out.every(x => x.ok), bot: me.username || "", checks: out });
    } catch (e) { res.json({ ok: false, error: botFriendly(e), checks: out }); }
  });
  router.post("/test", async (req, res) => { // posts a test line (no button) to BOTH places, exactly the way the real jobs are posted
    const s = settingsOf(keyOf(req.actor)), res2 = [];
    if (!s.workshop || !s.finishing || !s.stock) return res.json({ ok: false, error: "Choose the Workshop, Finishing and Stock places first, then Save." });
    for (const [label, g] of [["Workshop", s.workshop], ["Finishing", s.finishing], ["Stock", s.stock]]) {
      try { await botPost(g, null, `✅ AMBAR ${label.toUpperCase()} test — this place receives ${label === "Workshop" ? "new jobs from" : "jobs finished in the workshop by"} ${clip(req.actor?.name || "the admin", 60)}.`, null); res2.push({ name: label + " · " + targetName(g), ok: true }); }
      catch (e) { res2.push({ name: label + " · " + targetName(g), ok: false, error: botFriendly(e) }); }
    }
    const okN = res2.filter(x => x.ok).length;
    res.json({ ok: okN === res2.length, results: res2, error: okN === res2.length ? "" : (res2.find(x => !x.ok)?.error || "Could not send."), message: okN === res2.length ? "✅ Test messages posted in the Workshop, Finishing and Stock places." : undefined });
  });
  router.post("/send-order", async (req, res) => {
    const o = findOrder(req.body?.id);
    if (!o || !mineOnly(req.actor, o)) return res.json({ ok: false, error: "Order not found." });
    const r = await sendOrder(o, req.actor, { again: !!req.body?.again });
    res.json({ ...view(req.actor), ok: r.ok, error: r.error, message: r.ok ? `✅ Order ${o.orderId || o.id} sent to the workshop.` : undefined });
  });
  router.post("/send-product", async (req, res) => { // selected Reports Workflow products → workshop
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 40) : [];
    const list = (typeof R().inProgress === "function" ? R().inProgress() : []).filter(p => ids.includes(p.id));
    if (!list.length) return res.json({ ok: false, error: "Choose at least one product from Reports → Workflow Products." });
    let okN = 0, err = "";
    for (const p of list) {
      if (Object.values(db.jobs).some(x => (x.productIds || []).includes(p.id))) { err = err || `${p.code} is already sent to the workshop.`; continue; }
      let buf = null; if (p.photo && typeof R().readymade === "function") { try { buf = await R().readymade().photoBuf(p.photo); } catch {} }
      if (okN) await new Promise(x => setTimeout(x, 700));
      const isOrder = /ORDER|CUS/i.test(String(p.orderType || ""));
      const r = await createJob({ kind: isOrder ? "order" : "readymade", name: p.model || p.desc || p.code, qty: 1, size: p.desc && p.model ? p.desc : "", note: "", handle: p.handle, orderLabel: p.orderRef || "", existingProductIds: [p.id], buf }, req.actor);
      if (r.ok) okN++; else err = r.error;
    }
    res.json({ ...view(req.actor), ok: okN > 0, error: okN ? (err || "") : err, message: okN ? `✅ ${okN} product${okN === 1 ? "" : "s"} sent to the workshop.` : undefined });
  });
  router.post("/job/finish-workshop", async (req, res) => { // the same as the Telegram button
    const j = db.jobs[String(req.body?.id)];
    if (!j || j.key !== keyOf(req.actor)) return res.json({ ok: false, error: "Job not found." });
    const r = await toFinishing(j.id, req.actor?.name || "Admin");
    res.json({ ...view(req.actor), ok: r.ok, error: r.error, message: r.ok ? "✅ Sent to FINISHING." : undefined });
  });
  router.post("/job/finish", async (req, res) => {
    const j = db.jobs[String(req.body?.id)];
    if (!j || j.key !== keyOf(req.actor)) return res.json({ ok: false, error: "Job not found." });
    const r = await toStock(j.id, req.actor?.name || "Admin");
    res.json({ ...view(req.actor), ok: r.ok, error: r.error, message: r.ok ? "✅ Finished — the product is now IN STOCK (Reports)." + (r.warning ? " ⚠ " + r.warning : "") : undefined });
  });
  router.post("/job/sold-out", async (req, res) => {
    const j = db.jobs[String(req.body?.id)];
    if (!j || j.key !== keyOf(req.actor) || j.stage !== "finished") return res.json({ ok: false, error: "Finished job not found." });
    const results = (j.productIds || []).map(pid => R().wsSoldOut ? R().wsSoldOut(pid, req.actor?.name || "Admin") : { ok: false, error: "Sold Out is unavailable." });
    const bad = results.find(x => !x.ok); if (bad) return res.json({ ...view(req.actor), ok: false, error: bad.error });
    j.stockState = "sold"; j.soldAt = stamp(); j.soldBy = req.actor?.name || "Admin";
    if (j.stockMsg) await botEdit(j.stockMsg, jobCaption(j, "stock", `🔴 SOLD OUT — ${j.soldBy} · ${j.soldAt}`), kbRestock(j.id));
    persist(); res.json({ ...view(req.actor), ok: true, message: "🔴 Product marked Sold Out." });
  });
  router.post("/job/restock", async (req, res) => {
    const j = db.jobs[String(req.body?.id)];
    if (!j || j.key !== keyOf(req.actor) || j.stage !== "finished") return res.json({ ok: false, error: "Finished job not found." });
    const results = (j.productIds || []).map(pid => R().wsRestock ? R().wsRestock(pid, req.actor?.name || "Admin") : { ok: false, error: "Restock is unavailable." });
    const bad = results.find(x => !x.ok); if (bad) return res.json({ ...view(req.actor), ok: false, error: bad.error });
    j.stockState = "stock"; j.restockAt = stamp(); j.restockBy = req.actor?.name || "Admin";
    if (j.stockMsg) await botEdit(j.stockMsg, jobCaption(j, "stock", `♻️ RESTOCKED — ${j.restockBy} · ${j.restockAt}`), kbSoldOut(j.id));
    persist(); res.json({ ...view(req.actor), ok: true, message: "♻️ Product restocked and returned to In Stock." });
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
  // the basket: [{ pid, qty, size, kind: "order" | "readymade", orderId (internal id, only for kind=order), note }] — every line becomes its own job
  router.post("/send-items", async (req, res) => {
    const key = keyOf(req.actor), s = settingsOf(key);
    if (!s.workshop || !s.finishing) return res.json({ ok: false, error: "First choose the WORKSHOP and the FINISHING place (Settings above)." });
    const raw = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20) : [];
    if (!raw.length) return res.json({ ok: false, error: "Add at least one product to the list." });
    const specs = [], orderable = (ctx.getOrders() || []).filter(o => mineOnly(req.actor, o) && isOrderable(o));
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i] || {};
      const qty = Math.floor(Number(r.qty));
      if (!(qty >= 1 && qty <= 9999)) return res.json({ ok: false, error: `Line ${i + 1}: choose a quantity (1 – 9999).` });
      const size = clip(r.size, 80);
      if (!size) return res.json({ ok: false, error: `Line ${i + 1}: choose or type the measurement.` });
      const pickOrder = id => { const o = orderable.find(x => String(x.id) === String(id)); return o || null; };
      if (r.custom) { // NEW DESIGN: a one-off product made in the page (own photo + name) — not saved in the standard products
        const name = clip(r.name, 100);
        if (!name) return res.json({ ok: false, error: `Line ${i + 1}: type the name of the new design.` });
        const m = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(r.photoData || ""));
        if (!m) return res.json({ ok: false, error: `Line ${i + 1}: the photo of the new design could not be read. Choose it again.` });
        const buf = Buffer.from(m[1], "base64");
        if (buf.length < 200 || buf.length > 6 * 1024 * 1024) return res.json({ ok: false, error: `Line ${i + 1}: the photo is empty or too big.` });
        let order = null;
        if (r.orderId) { order = pickOrder(r.orderId); if (!order) return res.json({ ok: false, error: `Line ${i + 1}: the chosen order is not orderable (it must be confirmed and delivered).` }); }
        specs.push({ kind: order ? "order" : "readymade", custom: true, name, qty, size, note: clip(r.note, 400), buf, orderId: order ? order.id : "", orderLabel: order ? (order.orderId || String(order.id)) : "" });
        continue;
      }
      const p = db.catalog.find(x => x.id === String(r.pid));
      if (!p) return res.json({ ok: false, error: `Line ${i + 1}: the standard product no longer exists.` });
      const kind = r.kind === "order" ? "order" : r.kind === "readymade" ? "readymade" : "";
      if (!kind) return res.json({ ok: false, error: `Line ${i + 1}: decide if it is an ORDER or READYMADE.` });
      let order = null;
      if (kind === "order") { order = pickOrder(r.orderId); if (!order) return res.json({ ok: false, error: `Line ${i + 1}: choose a confirmed and delivered order for this product.` }); }
      specs.push({ kind, name: p.name, qty, size, note: clip(r.note, 400), buf: await photoBuf(p.photo), orderId: order ? order.id : "", orderLabel: order ? (order.orderId || String(order.id)) : "" });
    }
    let okN = 0, err = "";
    for (const sp of specs) {
      if (okN) await new Promise(x => setTimeout(x, 700));
      const r = await createJob(sp, req.actor);
      if (r.ok) okN++; else { err = r.error; if (/First choose/.test(r.error)) break; }
    }
    persist();
    res.json({ ...view(req.actor), ok: okN > 0, error: okN ? (okN < specs.length ? `${specs.length - okN} could not be sent: ${err}` : "") : err, message: okN ? `✅ ${okN} product${okN === 1 ? "" : "s"} sent to the workshop.` : undefined });
  });
  app.get("/api/workshop-version", (req, res) => res.json({ ok: true, workshop: "v158", cutoverAt: db.cutoverAt }));
  app.use("/api/workshop", router);

  function deleteReportProducts(ids) {
    const gone = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
    for (const [id, j] of Object.entries(db.jobs)) {
      const pairs = (j.productIds || []).map((pid, i) => ({ pid: String(pid), code: (j.codes || [])[i] || "" })).filter(x => !gone.has(x.pid));
      j.productIds = pairs.map(x => x.pid);
      j.codes = pairs.map(x => x.code);
      if (!j.productIds.length) delete db.jobs[id];
    }
    persist();
  }
  return { load, onOrderCreated, onOrderConfirmed, onButton, deleteReportProducts };
}
module.exports = { register };
