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
    return { workshop, finishing, stock: one(s.stock), driver: one(s.driver), material: one(s.material), mode: MODES.includes(s.mode) ? s.mode : (s.mode === "on_create" ? "after_confirm" : "manual"), updatedAt: s.updatedAt || "" };
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
  async function botPost(g, buf, caption, markup, html) { // html = true → caption is Telegram HTML (bold lines)
    const topic = g.topic > 1 ? g.topic : 0;
    if (buf) {
      const build = () => { const fd = new FormData(); fd.append("chat_id", chatKey(g)); if (topic) fd.append("message_thread_id", String(topic)); fd.append("caption", html ? caption : caption.slice(0, 1000)); if (html) fd.append("parse_mode", "HTML"); if (markup) fd.append("reply_markup", JSON.stringify(markup)); fd.append("photo", new Blob([buf], { type: "image/jpeg" }), "product.jpg"); return fd; };
      try { const r = await ctx.tgApi.sendForm("sendPhoto", build); return { chat: r.chat?.id != null ? String(r.chat.id) : chatKey(g), message_id: r.message_id, photo: true }; }
      catch (e) { if (!/IMAGE_PROCESS_FAILED|PHOTO_INVALID|wrong file|image/i.test(String(e.message))) throw e; } // not a picture Telegram accepts → plain text
    }
    const r = await tg("sendMessage", { chat_id: chatKey(g), ...(topic ? { message_thread_id: topic } : {}), text: html ? caption : caption.slice(0, 4000), ...(html ? { parse_mode: "HTML" } : {}), ...(markup ? { reply_markup: markup } : {}) });
    return { chat: r.chat?.id != null ? String(r.chat.id) : chatKey(g), message_id: r.message_id, photo: false };
  }
  // v165: production messages are sent by the connected admin USER ACCOUNT, never by the bot.
  async function userPost(actor, g, buf, caption, html) {
    const acc = accountOf(actor);
    if (!acc?.ready) throw new Error("Your own Telegram account is not connected. Connect it before sending to topics.");
    const entity = await resolveTarget(acc, g);
    const replyTo = g.topic > 1 ? Number(g.topic) : undefined;
    if (buf) return await acc.client.sendFile(entity, { file: buf, caption: html ? caption : String(caption || "").slice(0, 4000), parseMode: html ? "html" : undefined, forceDocument: false, ...(replyTo ? { replyTo } : {}) });
    return await acc.client.sendMessage(entity, { message: html ? caption : String(caption || "").slice(0, 4000), ...(replyTo ? { replyTo } : {}) });
  }

  async function botEdit(ref, caption, markup, html) { // change the text of a posted message (and drop its button); never throws
    if (!ref) return;
    const body = { chat_id: ref.chat, message_id: ref.message_id, reply_markup: markup || { inline_keyboard: [] }, ...(html ? { parse_mode: "HTML" } : {}) };
    try { await tg(ref.photo ? "editMessageCaption" : "editMessageText", ref.photo ? { ...body, caption: html ? caption : caption.slice(0, 1000) } : { ...body, text: html ? caption : caption.slice(0, 4000) }); }
    catch (e) { if (!/not modified/i.test(String(e.message))) { try { await tg("editMessageReplyMarkup", { chat_id: ref.chat, message_id: ref.message_id, reply_markup: { inline_keyboard: [] } }); } catch {} } }
  }
  const kbWorkshop = id => ({ inline_keyboard: [[{ text: "🛠 Finished workshop", callback_data: "wsf:" + id }]] });
  const kbFinishing = id => ({ inline_keyboard: [[{ text: "✅ Finished", callback_data: "wfin:" + id }]] });
  const kbSoldOut = id => ({ inline_keyboard: [[{ text: "🔴 Sold Out", callback_data: "wsold:" + id }]] });
  const kbRestock = id => ({ inline_keyboard: [[{ text: "♻️ Restock", callback_data: "wrestock:" + id }]] });
  // v164: STOCK-post buttons. ORDER (finished): 🚚 Send to driver (+ Sold Out). READYMADE: Sold Out → then Restock + 🚚 Send to driver. Driver button disappears once sent.
  const isOrderJob = j => j.kind === "order" || !!j.orderLabel;
  const kbStock = j => {
    const row = [], drv = { text: "🚚 Send to driver", callback_data: "wdrv:" + j.id };
    if (j.stockState === "sold") { row.push({ text: "♻️ Restock", callback_data: "wrestock:" + j.id }); if (!j.driver) row.push(drv); }
    else { if (isOrderJob(j) && !j.driver) row.push(drv); row.push({ text: "🔴 Sold Out", callback_data: "wsold:" + j.id }); }
    return { inline_keyboard: [row] };
  };
  const stockExtra = j => (j.stockState === "sold" ? `🔴 SOLD OUT — ${j.soldBy} · ${j.soldAt}` : j.restockAt ? `♻️ RESTOCKED — ${j.restockBy} · ${j.restockAt}` : `📦 IN STOCK — ${(j.finDone || {}).by || ""} · ${(j.finDone || {}).at || ""}`) + (j.driver ? `\n🚚 Sent to driver — ${j.driver.by} · ${j.driver.at}` : "");

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
  const compactCat = p => ({ id: p.id, name: p.name, ptype: p.ptype || "", sizes: p.sizes || [], photo: p.photo || "" });
  const canManage = actor => !!actor && hasPerm(actor, "workshop"); // v159: every admin who has the Workshop section can add / change standard products

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
  // v159: an order without its own Product ID gets the next ID of the Z/Y/X sequence. It is RESERVED when first shown so the Orders list and the Telegram message agree.
  const reservedSet = () => new Set(Object.values(db.reserved || {}));
  // v160: Shoe Shelf → Z1, Z2 … (old sequence). Every other product type → 1A, 1B … 1Z, 2A … 2Z …
  const isShoe = pt => /shoe\s*shelf/i.test(String(pt || ""));
  const orderPtype = o => clip(o?.ptype || o?.productType || "", 40) || (/shoe/i.test(String(o?.product || o?.model || "")) ? "Shoe Shelf" : "");
  const orderCodeFor = (o, reserve) => {
    db.reserved = db.reserved || {}; R().setReservedCodes?.(reservedSet);
    const taken = c => typeof R().codeTaken === "function" && R().codeTaken(c); // v159: orders always take the next Z/Y/X ID (no original code)
    const cur = db.reserved[o.id]; if (cur && !taken(cur)) return cur;
    if (!reserve || typeof R().peekSeqCodes !== "function") return "";
    delete db.reserved[o.id]; const c = R().peekSeqCodes(1, orderPtype(o))[0]; if (c) { db.reserved[o.id] = c; persist(); } return c || "";
  };
  // v160: measurement "120*35*120"
  const fmtSize = v => clip(v, 80).replace(/(\d(?:\.\d+)?\s*(?:cm|mm|m)?)\s*[×✕xX*]\s*(?=\d)/gi, "$1*").replace(/\s*\*\s*/g, "*");
  const esc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // v160: the WORKSHOP post is short: AMBAR FURNITURE · bold "ProductID-Model" (one line per unit) · measurement · quantity · additional texts. Telegram HTML (bold).
  function workshopCaption(j, extra) {
    const model = clip(j.name || "", 100), codes = (j.codes || []).length ? j.codes : ["—"];
    const tail = extra ? "\n\n" + esc(extra) : "", LIMIT = 1000 - tail.length;
    const head = ["<b>AMBAR FURNITURE</b>", "", ...codes.map(c => "<b>" + esc(c + (model ? "-" + model : "")) + "</b>"), ...(j.orderLabel ? ["Order ID: " + esc(clip(j.orderLabel, 40))] : []), "", "Measurement: " + esc(fmtSize(j.size) || "—"), "Quantity: " + (j.qty || 1)];
    const more = [...(j.details || []), j.note ? clip(j.note, 400) : ""].filter(Boolean);
    let out = head.join("\n");
    if (more.length) {
      out += "\n\nADDITIONAL TEXTS:";
      for (const m of more) { const l = "\n" + esc(m); if (out.length + l.length > LIMIT) break; out += l; }
    }
    return out.slice(0, LIMIT) + tail;
  }
  function jobCaption(j, stage, extra) {
    if (stage === "workshop") return workshopCaption(j, extra);
    const head = "_________ AMBAR FURNITURE _________";
    const ordered = j.kind === "order" || !!j.orderLabel;
    const L = [head, ordered ? "ORDERED PRODUCT" : "READYMADE PRODUCT", "PRODUCT ID" + ((j.codes || []).length > 1 ? `s (${j.codes.length})` : "") + "- " + (clip((j.codes || []).join(", "), 330) || "Pending"), "MODEL- " + clip(j.name || "—", 100), j.ptype ? "PRODUCT TYPE- " + clip(j.ptype, 40) : "", ordered ? "ORDER ID- " + clip(j.orderLabel, 40) : "", "", "📏 Measurement: " + clip(j.size || "—", 80), "🔢 Quantity: " + (j.qty || 1), "ADDITIONAL TEXTS:", ...(j.details || []), j.note ? clip(j.note, 400) : "", extra || ""];
    return L.filter(Boolean).join("\n");
  }
  const orderDetails = o => [line("🧱", "Material", o.material), line("🎨", "Color", o.color), line("✨", "Style", o.style), line("🖌", "Design", o.design), line("🔧", "Handle", o.handle), line("🚪", "Door", o.door), line("🗂", "Partition", o.partition), line("🧰", "Drawer", o.drawer), line("➕", "Extra", o.additionalFeatures), line("📅", "Completion date", o.completionDate), line("🚚", "Delivery date", o.deliveryDate)].filter(Boolean);
  const findOrder = id => (ctx.getOrders() || []).find(o => String(o.id) === String(id));
  // v164: an order whose production is FINISHED (or already handed to the driver) is no longer listed in "Which order?"
  const orderDone = o => { const js = Object.values(db.jobs).filter(j => String(j.orderId) === String(o.id)); return js.length > 0 && js.every(j => j.stage === "finished" || !!j.driver); };
  const orderJob = oid => Object.values(db.jobs).filter(j => String(j.orderId) === String(oid)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  async function saveOrderStage(j, patch) { // the order shows where its production is
    if (!j.orderId) return;
    const o = findOrder(j.orderId); if (!o) return;
    o.workshop = { ...(o.workshop || {}), jobId: j.id, stage: j.stage, ...patch };
    try { if (typeof ctx.saveOrder === "function") await ctx.saveOrder(o); } catch (e) { console.warn("Workshop: order stage not saved:", e.message); }
  }
  const compactJob = j => ({ id: j.id, kind: j.kind, custom: !!j.custom, name: j.name, qty: j.qty || 0, size: j.size || "", orderLabel: j.orderLabel || "", codes: j.codes || [], stage: j.stage, stageName: STAGES[j.stage] || j.stage, createdAt: j.createdAt || "", wsDone: j.wsDone || null, finDone: j.finDone || null, stockState: j.stockState || "stock", ordered: isOrderJob(j), driverAt: j.driver ? j.driver.at : "", by: j.by || "", photo: j.photoId || "" });
  const log = (key, actor, what, ok, error) => { db.log.push({ at: stamp(), key, by: clip(actor?.name || "Admin", 60), what, ok: !!ok, error: error || "" }); if (db.log.length > 300) db.log.splice(0, db.log.length - 300); };

  // create the job, make its Reports product(s), post it in the WORKSHOP topic with the button
  async function createJob(spec, actor) {
    const key = keyOf(actor), s = settingsOf(key); R().setReservedCodes?.(reservedSet);
    if (!s.workshop) return { ok: false, error: "First choose the WORKSHOP group and topic (Settings above)." };
    if (!s.finishing) return { ok: false, error: "First choose the FINISHING group and topic (Settings above) — the workshop button sends the job there." };
    if (!s.stock) return { ok: false, error: "First choose the STOCK group and topic (Settings above) — finished products are posted there." };
    const id = uid(), by = clip(actor?.name || "Admin", 60);
    const j = { id, key, telegramId: String(actor?.telegramId || ""), kind: spec.kind, custom: !!spec.custom, name: clip(spec.name, 100), qty: spec.qty || 0, size: clip(spec.size, 80), ptype: clip(spec.ptype, 40), note: clip(spec.note, 400), orderId: spec.orderId || "", orderLabel: spec.orderLabel || "", details: spec.details || [], by, stage: "workshop", createdAt: stamp(), createdAtIso: new Date().toISOString(), productIds: [], codes: [], photoId: "" };
    // 1) Reports: the product(s) enter the Workflow (ORDER or READYMADE). Existing Workflow products (sent from the Readymade tab) are reused.
    if (spec.existingProductIds && spec.existingProductIds.length) {
      for (const pid of spec.existingProductIds) { const st = R().wsStatus ? R().wsStatus(pid) : null; if (st) { j.productIds.push(pid); j.codes.push(st.code); if (R().wsSetStage) R().wsSetStage(pid, "workshop", by, id); } }
    } else if (typeof R().wsAddProduct === "function") {
      const n = Math.max(1, Math.min(spec.qty || 1, 100));
      for (let i = 0; i < n; i++) {
        const p = await R().wsAddProduct({ ptype: spec.ptype || "", model: spec.name, code: spec.productCode || "", desc: [j.size, spec.orderLabel].filter(Boolean).join(" · "), seqId: true, orderType: spec.kind === "order" ? "ORDER" : "READYMADE", priority: spec.priority || "MEDIUM", handle: spec.handle || "", note: j.note, orderRef: spec.orderLabel || "", jobId: id, photoBuf: spec.buf, deliveryDate: spec.deliveryDate || "", salesName: by }, by);
        j.productIds.push(p.id); j.codes.push(p.code);
      }
    }
    // 2) the bot posts it in the WORKSHOP topic
    let ref;
    try { ref = await userPost(actor, s.workshop, spec.buf, jobCaption(j, "workshop"), true); }
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
    try { ref = await userPost({ telegramId: j.telegramId, name: by, role: "admin" }, s.finishing, j.photoId ? await photoBuf(j.photoId) : null, jobCaption(j, "finishing", `⏩ Finished in the workshop by ${by} · ${at}`), true);  }
    catch (e) { return { ok: false, error: botFriendly(e) }; }
    j.stage = "finishing"; j.wsDone = { by, at }; j.finMsg = ref;
    for (const pid of j.productIds || []) if (R().wsSetStage) R().wsSetStage(pid, "finishing", by, j.id);
    await botEdit(j.wsMsg, jobCaption(j, "workshop", `✅ Finished workshop — ${by} · ${at}\n➡ Sent to FINISHING`), null, true);
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
    try { j.stockMsg = await userPost({ telegramId: j.telegramId, name: by, role: "admin" }, s.stock, j.photoId ? await photoBuf(j.photoId) : null, jobCaption(j, "stock", `📦 IN STOCK — ${by} · ${at}`), true); }
    catch (e) { j.stockPostError = botFriendly(e); }
    await saveOrderStage(j, { finishedAt: at, finishedBy: by });
    log(j.key, { name: by }, `Finished · ${j.name} → stock`, true, missing.length ? missing.join(" ") : ""); persist();
    return { ok: true, job: j, warning: [missing.length ? "Some products were not found in Reports: " + missing.join(" ") : "", j.stockPostError ? "Stock group post failed: " + j.stockPostError : ""].filter(Boolean).join(" · ") };
  }
  // v164: SEND TO DRIVER — a finished ORDER, or a SOLD readymade product, is posted in the DRIVER place (group + topic) chosen in the settings
  function driverCaption(j, by, at) {
    const model = clip(j.name || "", 100), codes = (j.codes || []).length ? j.codes : ["—"], o = j.orderId ? findOrder(j.orderId) : null;
    const lines = ["<b>AMBAR FURNITURE</b>", "<b>🚚 FOR THE DRIVER</b>", "", ...codes.map(c => "<b>" + esc(c + (model ? "-" + model : "")) + "</b>"), ...(j.orderLabel ? ["Order ID: " + esc(clip(j.orderLabel, 40))] : []), "", "Measurement: " + esc(fmtSize(j.size) || "—"), "Quantity: " + (j.qty || 1)];
    const info = o ? [["Customer", o.customerName], ["Phone", o.phone || o.telegramPhone], ["Location", o.location], ["Delivery date", o.deliveryDate]].map(([l, v]) => clip(v, 120) ? l + ": " + esc(clip(v, 120)) : "").filter(Boolean) : [];
    if (info.length) lines.push("", ...info);
    lines.push("", "Sent by " + esc(by) + " · " + esc(at));
    let out = ""; for (const l of lines) { if ((out + "\n" + l).length > 990) break; out += (out ? "\n" : "") + l; }
    return out;
  }
  async function sendToDriver(jobId, byName) {
    const j = db.jobs[String(jobId)]; if (!j) return { ok: false, error: "This job was not found any more." };
    if (j.driver) return { ok: false, code: "DONE", error: "Already sent to the driver." };
    if (j.stage !== "finished") return { ok: false, code: "EARLY", error: "The product is not finished yet." };
    if (!isOrderJob(j) && j.stockState !== "sold") return { ok: false, code: "EARLY", error: "A readymade product goes to the driver after it is SOLD." };
    const s = settingsOf(j.key); if (!s.driver) return { ok: false, error: "The DRIVER place is not chosen. Choose it in the Workshop settings (Driver topic) and save." };
    const by = clip(byName, 60) || "Admin", at = stamp();
    let ref; try { ref = await userPost({ telegramId: j.telegramId, name: by, role: "admin" }, s.driver, j.photoId ? await photoBuf(j.photoId) : null, driverCaption(j, by, at), true); } catch (e) { return { ok: false, error: botFriendly(e) }; }
    j.driver = { by, at, msg: ref };
    if (j.stockMsg) await botEdit(j.stockMsg, jobCaption(j, "stock", stockExtra(j)), kbStock(j));
    await saveOrderStage(j, { driverAt: at, driverBy: by });
    log(j.key, { name: by }, `Sent to driver · ${j.name}`, true, ""); persist();
    return { ok: true, job: j };
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
      await botEdit(j.stockMsg, jobCaption(j, "stock", stockExtra(j)), kbStock(j));
      log(j.key, { name: by }, `Sold Out · ${j.name}`, true, ""); persist();
      return answer("🔴 Product marked Sold Out. Restock is now available.");
    }
    if (action === "wdrv") {
      if (j.stockMsg && chatId && String(j.stockMsg.chat) !== chatId) return answer("This button belongs to the STOCK group only.", true);
      const r = await sendToDriver(j.id, by);
      return answer(r.ok ? "🚚 Sent to the driver." : r.error, !r.ok && r.code !== "DONE");
    }
    if (action === "wrestock") {
      if (j.stockMsg && chatId && String(j.stockMsg.chat) !== chatId) return answer("This button belongs to the STOCK group only.", true);
      const results = (j.productIds || []).map(pid => typeof R().wsRestock === "function" ? R().wsRestock(pid, by) : { ok: false, error: "Restock action is unavailable." });
      const bad = results.find(x => !x.ok);
      if (bad) return answer(bad.error, true);
      j.stockState = "stock"; j.restockAt = stamp(); j.restockBy = by;
      await botEdit(j.stockMsg, jobCaption(j, "stock", stockExtra(j)), kbStock(j));
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
    const sentJob = await createJob({ kind: "order", name: o.product || "Furniture order", ptype: orderPtype(o), productCode: orderCodeFor(o, true), qty: 1, size: sizeOfOrder(o), note: "", orderId: o.id, orderLabel: o.orderId || String(o.id), details: orderDetails(o), buf, handle: o.handle, deliveryDate: "", priority: "MEDIUM" }, opt.actor || actor);
    if (sentJob.ok && db.reserved && db.reserved[o.id]) { delete db.reserved[o.id]; persist(); }
    return sentJob;
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
  const compactOrder = (o, actor) => { const j = orderJob(o.id); return { id: o.id, orderId: o.orderId || "", productId: originalProductCode(o), size: sizeOfOrder(o), status: clip(o.status, 20), product: clip(o.product, 80), customerName: clip(o.customerName, 60), createdAt: o.createdAt || "", completionDate: clip(o.completionDate, 30), deliveryDate: clip(o.deliveryDate, 30), photo: o.photo || "", job: j ? { id: j.id, stage: j.stage, stageName: STAGES[j.stage] } : null }; };
  const view = actor => {
    const key = keyOf(actor), s = settingsOf(key), acc = accountOf(actor);
    const inProg = (typeof R().inProgress === "function" ? R().inProgress() : []).map(p => { const j = Object.values(db.jobs).find(x => (x.productIds || []).includes(p.id)); return { ...p, job: j ? compactJob(j) : null }; });
    const mine = Object.values(db.jobs).filter(j => j.key === key).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return {
      ok: true, me: { key, name: clip(actor?.name, 60) },
      settings: { workshop: s.workshop, finishing: s.finishing, stock: s.stock, driver: s.driver, material: s.material, mode: s.mode, workshopName: targetName(s.workshop), finishingName: targetName(s.finishing), stockName: targetName(s.stock), driverName: targetName(s.driver), materialName: targetName(s.material) },
      sender: { ready: !!acc?.ready, label: clip(acc?.label, 60) },
      // Once sent to the workshop, remove the order from this sending queue permanently.
      // This also hides older orders that were already sent before this update.
      orders: (ctx.getOrders() || []).filter(o => mineOnly(actor, o) && isOrderable(o) && !orderJob(o.id) && (() => { const t = Date.parse(o.createdAt || o.created || ""); return Number.isFinite(t) && t >= Date.parse(db.cutoverAt); })()).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 120).map(o => compactOrder(o, actor)),
      allOrders: (ctx.getOrders() || []).filter(o => mineOnly(actor, o) && !orderDone(o)).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 400).map(o => compactOrder(o, actor)), // v163: the "Which order?" list shows ALL orders
      readymade: inProg,
      // v159: Progress must match the Workflow Products tab. Besides my own jobs it also lists every job linked to a product that is currently in Reports -> Workflow
      // (sent by another admin, or created before the cutover stamp) so a product shown "In workshop" is never missing from Progress.
      jobs: (() => { const live = new Set(inProg.filter(p => p.job).map(p => p.job.id)); const seen = new Set(); return Object.values(db.jobs).filter(j => j.stage !== "finished" && (live.has(j.id) || (j.key === key && j.createdAtIso && Date.parse(j.createdAtIso) >= Date.parse(db.cutoverAt)))).sort((x, y) => String(y.createdAtIso || y.createdAt).localeCompare(String(x.createdAtIso || x.createdAt))).filter(j => !seen.has(j.id) && seen.add(j.id)).slice(0, 100).map(compactJob); })(),
      doneJobs: mine.filter(j => j.stage === "finished" && j.createdAtIso && Date.parse(j.createdAtIso) >= Date.parse(db.cutoverAt)).slice(0, 15).map(compactJob),
      catalog: db.catalog.map(compactCat), canManage: canManage(actor),
      materials: typeof R().wsMaterials === "function" ? R().wsMaterials().materials : [], matGroups: typeof R().wsMaterials === "function" ? R().wsMaterials().groups : [], cutRequests: typeof R().wsCutRequests === "function" ? R().wsCutRequests() : [], // v165
      log: db.log.filter(l => l.key === key).slice(-100).reverse()
    };
  };
  router.get("/state", (req, res) => res.json(view(req.actor)));
  router.post("/settings", (req, res) => {
    const key = keyOf(req.actor), mode = String(req.body?.mode || "manual");
    if (!MODES.includes(mode)) return res.json({ ok: false, error: "Unknown sending mode." });
    const one = x => (x && x.chat ? cleanTargets([x])[0] || null : null);
    const workshop = one(req.body?.workshop), finishing = one(req.body?.finishing), stock = one(req.body?.stock), driver = one(req.body?.driver), material = one(req.body?.material);
    if (workshop && finishing && workshop.chat.toLowerCase() === finishing.chat.toLowerCase() && workshop.topic === finishing.topic) return res.json({ ok: false, error: "The WORKSHOP and the FINISHING place are the same. Choose a different topic (or group) for finishing." });
    if (mode !== "manual" && (!workshop || !finishing)) return res.json({ ok: false, error: "Choose both the workshop and the finishing place first — automatic sending needs them." });
    if (workshop && stock && workshop.chat.toLowerCase() === stock.chat.toLowerCase() && workshop.topic === stock.topic) return res.json({ ok: false, error: "Choose a different STOCK place from the WORKSHOP place." });
    if (finishing && stock && finishing.chat.toLowerCase() === stock.chat.toLowerCase() && finishing.topic === stock.topic) return res.json({ ok: false, error: "Choose a different STOCK place from the FINISHING place." });
    for (const [n, g] of [["WORKSHOP", workshop], ["FINISHING", finishing], ["STOCK", stock]]) if (driver && g && driver.chat.toLowerCase() === g.chat.toLowerCase() && driver.topic === g.topic) return res.json({ ok: false, error: `Choose a different DRIVER place from the ${n} place.` });
    db.admins[key] = { workshop, finishing, stock, driver, material, mode, updatedAt: stamp() }; persist();
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
      for (const [label, g] of [["Workshop", cleanTargets([req.body?.workshop])[0]], ["Finishing", cleanTargets([req.body?.finishing])[0]], ["Stock", cleanTargets([req.body?.stock])[0]], ["Driver", cleanTargets([req.body?.driver])[0]]]) {
        if (!g && label === "Driver") continue; // optional
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
    for (const [label, g] of [["Workshop", s.workshop], ["Finishing", s.finishing], ["Stock", s.stock], ["Driver", s.driver], ["Material", s.material]]) {
      if (!g) continue;
      try { await userPost(req.actor, g, null, `AMBAR ${label.toUpperCase()} TEST\nThis topic receives production updates from ${clip(req.actor?.name || "the admin", 60)}.`, false); res2.push({ name: label + " · " + targetName(g), ok: true }); }
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
      const r = await createJob({ kind: isOrder ? "order" : "readymade", ptype: p.ptype || "", name: p.model || p.desc || p.code, qty: 1, size: p.desc && p.model ? p.desc : "", note: "", handle: p.handle, orderLabel: p.orderRef || "", existingProductIds: [p.id], buf }, req.actor);
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
  router.post("/job/send-driver", async (req, res) => {
    const j = db.jobs[String(req.body?.id)];
    if (!j || j.key !== keyOf(req.actor)) return res.json({ ok: false, error: "Job not found." });
    const r = await sendToDriver(j.id, req.actor?.name || "Admin");
    res.json({ ...view(req.actor), ok: r.ok, error: r.error, message: r.ok ? "🚚 Sent to the driver." : undefined });
  });
  router.post("/job/sold-out", async (req, res) => {
    const j = db.jobs[String(req.body?.id)];
    if (!j || j.key !== keyOf(req.actor) || j.stage !== "finished") return res.json({ ok: false, error: "Finished job not found." });
    const results = (j.productIds || []).map(pid => R().wsSoldOut ? R().wsSoldOut(pid, req.actor?.name || "Admin") : { ok: false, error: "Sold Out is unavailable." });
    const bad = results.find(x => !x.ok); if (bad) return res.json({ ...view(req.actor), ok: false, error: bad.error });
    j.stockState = "sold"; j.soldAt = stamp(); j.soldBy = req.actor?.name || "Admin";
    if (j.stockMsg) await botEdit(j.stockMsg, jobCaption(j, "stock", stockExtra(j)), kbStock(j));
    persist(); res.json({ ...view(req.actor), ok: true, message: "🔴 Product marked Sold Out." });
  });
  router.post("/job/restock", async (req, res) => {
    const j = db.jobs[String(req.body?.id)];
    if (!j || j.key !== keyOf(req.actor) || j.stage !== "finished") return res.json({ ok: false, error: "Finished job not found." });
    const results = (j.productIds || []).map(pid => R().wsRestock ? R().wsRestock(pid, req.actor?.name || "Admin") : { ok: false, error: "Restock is unavailable." });
    const bad = results.find(x => !x.ok); if (bad) return res.json({ ...view(req.actor), ok: false, error: bad.error });
    j.stockState = "stock"; j.restockAt = stamp(); j.restockBy = req.actor?.name || "Admin";
    if (j.stockMsg) await botEdit(j.stockMsg, jobCaption(j, "stock", stockExtra(j)), kbStock(j));
    persist(); res.json({ ...view(req.actor), ok: true, message: "♻️ Product restocked and returned to In Stock." });
  });
  // Explicit dispatch messages from the Production & Dispatch workspace.
  router.post("/dispatch/send", async (req, res) => {
    const kind = String(req.body?.kind || "");
    if (!["driver", "material"].includes(kind)) return res.status(400).json({ ...view(req.actor), ok: false, error: "Choose a valid dispatch destination." });
    const target = settingsOf(keyOf(req.actor))[kind];
    if (!target) return res.status(400).json({ ...view(req.actor), ok: false, error: `The ${kind.toUpperCase()} Telegram topic is not selected. Choose it in Production & Dispatch settings and save first.` });
    const message = String(req.body?.text || "").trim().slice(0, 3500);
    if (!message) return res.status(400).json({ ...view(req.actor), ok: false, error: "Enter dispatch details before sending." });
    try {
      await userPost(req.actor, target, null, `<b>AMBAR FURNITURE</b>\n${kind === "driver" ? "🚚 <b>DRIVER DISPATCH</b>" : "🧱 <b>MATERIAL DISPATCH</b>"}\n\n${esc(message)}\n\nSent by: ${esc(req.actor?.name || "Admin")}`, true);
      log(keyOf(req.actor), req.actor, `${kind === "driver" ? "Driver" : "Material"} dispatch message`, true, "Sent to the selected Telegram topic.");
      return res.json({ ...view(req.actor), ok: true, message: `✅ ${kind === "driver" ? "Driver" : "Material"} dispatch sent to the selected Telegram topic.` });
    } catch (e) {
      log(keyOf(req.actor), req.actor, `${kind === "driver" ? "Driver" : "Material"} dispatch message`, false, clip(e.message, 180));
      return res.status(400).json({ ...view(req.actor), ok: false, error: `Telegram send failed: ${clip(e.message, 180)}` });
    }
  });
  // v165: Material ADD is immediate; CUT is a request and requires main-admin approval.
  router.post("/material/add", (req, res) => {
    if (typeof R().wsMaterial !== "function") return res.json({ ...view(req.actor), ok: false, error: "Materials are not available." });
    const r = R().wsMaterial("add", req.body, req.actor?.name);
    if (r.ok) log(keyOf(req.actor), req.actor, `Material · ${r.message}`, true, "");
    res.json({ ...view(req.actor), ok: r.ok, error: r.error, message: r.ok ? r.message : undefined });
  });
  router.post("/material/move", (req, res) => {
    if (req.body?.type === "cut") return res.status(400).json({ ...view(req.actor), ok: false, error: "Use the Cut request button. Main admin approval is required." });
    if (typeof R().wsMaterial !== "function") return res.json({ ...view(req.actor), ok: false, error: "Materials are not available." });
    const r = R().wsMaterial("add", req.body, req.actor?.name);
    if (r.ok) log(keyOf(req.actor), req.actor, `Material · ${r.message}`, true, "");
    res.json({ ...view(req.actor), ok: r.ok, error: r.error, message: r.ok ? r.message : undefined });
  });
  router.post("/material/cut-request", async (req, res) => {
    if (typeof R().wsRequestCut !== "function") return res.json({ ...view(req.actor), ok: false, error: "Material cut requests are not available." });
    const r = R().wsRequestCut(req.body, req.actor);
    if (!r.ok) return res.json({ ...view(req.actor), ok: false, error: r.error });
    const target = settingsOf(keyOf(req.actor)).material;
    let tg = "";
    if (target) {
      try {
        await userPost(req.actor, target, null, `<b>AMBAR FURNITURE</b>\n✂️ <b>MATERIAL CUT REQUEST</b>\n\nMaterial: ${esc(r.request.material + (r.request.mtype ? " " + r.request.mtype : ""))}\nQuantity: ${esc(String(r.request.qty))} ${esc(r.request.unit)}\nAvailable: ${esc(String(r.request.before))} ${esc(r.request.unit)}\nRequested by: ${esc(r.request.by)}${r.request.note ? "\nNote: " + esc(r.request.note) : ""}\n\n⏳ Waiting for main admin approval.`, true);
        tg = " Sent to the selected Material topic from your Telegram account.";
      } catch (e) { tg = " Telegram topic send failed: " + clip(e.message, 180); }
    } else tg = " No Material topic is selected yet.";
    log(keyOf(req.actor), req.actor, `Material · ${r.message}`, true, tg);
    res.json({ ...view(req.actor), ok: true, message: r.message + tg });
  });
  router.post("/material/cut-decide", async (req, res) => {
    if (req.actor?.role !== "owner") return res.json({ ...view(req.actor), ok: false, error: "Only the main admin can approve or reject material cuts." });
    const approve = req.body?.approve === true || req.body?.approve === "true";
    const r = R().wsApproveCut ? R().wsApproveCut(req.body?.id, approve, req.actor, req.body?.note) : { ok: false, error: "Material cut approval is not available." };
    if (!r.ok) return res.json({ ...view(req.actor), ok: false, error: r.error });
    const target = settingsOf(keyOf(req.actor)).material;
    if (target) {
      try { await userPost(req.actor, target, null, `<b>AMBAR FURNITURE</b>\n${approve ? "✅ <b>MATERIAL CUT APPROVED</b>" : "❌ <b>MATERIAL CUT REJECTED</b>"}\n\nMaterial: ${esc(r.request.material + (r.request.mtype ? " " + r.request.mtype : ""))}\nQuantity: ${esc(String(r.request.qty))} ${esc(r.request.unit)}\n${approve ? "Remaining: " + esc(String(r.request.after)) + " " + esc(r.request.unit) : ""}\nRequested by: ${esc(r.request.by)}\nApproved by: ${esc(req.actor?.name || "Main admin")}${r.request.decisionNote ? "\nNote: " + esc(r.request.decisionNote) : ""}`, true); } catch {}
    }
    res.json({ ...view(req.actor), ok: true, message: r.message });
  });
  router.post("/catalog/save", async (req, res) => { // main admin: add / change a standard product
    if (!canManage(req.actor)) return res.json({ ok: false, error: "You need the Workshop section to change the standard products." });
    const name = clip(req.body?.name, 100), sizes = cleanSizes(req.body?.sizes), ptype = clip(req.body?.ptype, 40);
    if (!name) return res.json({ ok: false, error: "Type the product name." });
    if (!ptype) return res.json({ ok: false, error: "Choose the product type." });
    const prev = req.body?.id ? db.catalog.find(p => p.id === String(req.body.id)) : null;
    if (req.body?.id && !prev) return res.json({ ok: false, error: "That standard product no longer exists." });
    let photo = prev?.photo || "";
    try {
      if (req.body?.photo) { const old = photo; photo = await savePhoto(req.body.photo); if (old) setTimeout(() => dropPhoto(old), 0); }
      else if (req.body?.removePhoto && photo) { const old = photo; photo = ""; setTimeout(() => dropPhoto(old), 0); }
    } catch (e) { return res.json({ ok: false, error: e.message }); }
    if (!photo) return res.json({ ok: false, error: "Add the product photo — the workshop sees this picture." });
    if (prev) Object.assign(prev, { name, ptype, sizes, photo });
    else { if (db.catalog.length >= 300) return res.json({ ok: false, error: "Too many standard products (max 300)." }); db.catalog.push({ id: uid(), name, ptype, sizes, photo, createdAt: stamp() }); }
    db.catalog.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    persist(); res.json({ ...view(req.actor), message: prev ? "✅ Standard product updated." : "✅ Standard product added." });
  });
  router.post("/catalog/delete", (req, res) => {
    if (!canManage(req.actor)) return res.json({ ok: false, error: "You need the Workshop section to change the standard products." });
    const i = db.catalog.findIndex(p => p.id === String(req.body?.id));
    if (i < 0) return res.json({ ok: false, error: "Not found." });
    const [gone] = db.catalog.splice(i, 1); persist(); setTimeout(() => dropPhoto(gone.photo), 0);
    res.json({ ...view(req.actor), message: "🗑 Standard product removed." });
  });
  // the basket: [{ pid, qty, size, kind: "order" | "readymade", orderId (internal id, only for kind=order), note }] — every line becomes its own job
  router.post("/preview-ids", (req, res) => { // v159: the Product IDs the list will receive (in list order, one per unit)
    R().setReservedCodes?.(reservedSet);
    const orderIds = (Array.isArray(req.body?.orders) ? req.body.orders : []).slice(0, 200).map(String);
    if (orderIds.length) { // Orders tab: the Product ID each order will get
      db.reserved = db.reserved || {}; const out = {}; const shown = new Set(orderIds);
      for (const k of Object.keys(db.reserved)) if (!findOrder(k) || orderJob(k)) delete db.reserved[k];
      for (const id of orderIds) { const o = findOrder(id); if (o) out[id] = orderCodeFor(o, true); }
      return res.json({ ok: true, orderCodes: out });
    }
    const counts = (Array.isArray(req.body?.counts) ? req.body.counts : []).slice(0, 40).map(n => Math.max(1, Math.min(100, Math.floor(Number(n)) || 1)));
    const types = Array.isArray(req.body?.types) ? req.body.types : [];
    const fam = i => isShoe(types[i]) ? "s" : "o", need = { s: 0, o: 0 }; counts.forEach((n, i) => { need[fam(i)] += n; });
    const peek = (n, pt) => n && typeof R().peekSeqCodes === "function" ? R().peekSeqCodes(n, pt) : [];
    const pool = { s: peek(need.s, "Shoe Shelf"), o: peek(need.o, "") }, pos = { s: 0, o: 0 };
    res.json({ ok: true, codes: counts.map((n, i) => { const f = fam(i), out = pool[f].slice(pos[f], pos[f] + n); pos[f] += n; return out; }) });
  });
  router.post("/send-items", async (req, res) => {
    const key = keyOf(req.actor), s = settingsOf(key);
    if (!s.workshop || !s.finishing) return res.json({ ok: false, error: "First choose the WORKSHOP and the FINISHING place (Settings above)." });
    const raw = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20) : [];
    if (!raw.length) return res.json({ ok: false, error: "Add at least one product to the list." });
    const specs = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i] || {};
      const qty = Math.floor(Number(r.qty));
      if (!(qty >= 1 && qty <= 9999)) return res.json({ ok: false, error: `Line ${i + 1}: choose a quantity (1 – 9999).` });
      const size = clip(r.size, 80);
      if (!size) return res.json({ ok: false, error: `Line ${i + 1}: choose or type the measurement.` });
      const colorDetails = c => clip(c, 40) ? [line("🎨", "Color", c)] : []; // v164: chosen / typed colour → ADDITIONAL TEXTS
      const anyOrder = id => { const o = findOrder(id); return o && mineOnly(req.actor, o) ? o : null; }; // v163: any order, not only confirmed + delivered
      if (r.custom) { // NEW DESIGN: a one-off product made in the page (own photo + name) — not saved in the standard products
        const name = clip(r.name, 100);
        if (!name) return res.json({ ok: false, error: `Line ${i + 1}: type the name of the new design.` });
        const m = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(r.photoData || ""));
        if (!m) return res.json({ ok: false, error: `Line ${i + 1}: the photo of the new design could not be read. Choose it again.` });
        const buf = Buffer.from(m[1], "base64");
        if (buf.length < 200 || buf.length > 6 * 1024 * 1024) return res.json({ ok: false, error: `Line ${i + 1}: the photo is empty or too big.` });
        let order = null; const typedLabel = !r.orderId ? clip(r.orderLabel, 40) : ""; // v163: any order of mine, or a TYPED order ID
        if (r.orderId) { order = anyOrder(r.orderId); if (!order) return res.json({ ok: false, error: `Line ${i + 1}: the chosen order was not found.` }); }
        const cptype = clip(r.ptype, 40); if (!cptype) return res.json({ ok: false, error: `Line ${i + 1}: choose the product type.` });
        specs.push({ kind: order || typedLabel ? "order" : "readymade", custom: true, ptype: cptype, name, qty, size, note: clip(r.note, 400), details: colorDetails(r.color), buf, orderId: order ? order.id : "", orderLabel: order ? (order.orderId || String(order.id)) : typedLabel });
        continue;
      }
      const p = db.catalog.find(x => x.id === String(r.pid));
      if (!p) return res.json({ ok: false, error: `Line ${i + 1}: the standard product no longer exists.` });
      const kind = r.kind === "order" ? "order" : r.kind === "readymade" ? "readymade" : "";
      if (!kind) return res.json({ ok: false, error: `Line ${i + 1}: decide if it is an ORDER or READYMADE.` });
      let order = null, typedLabel = "";
      if (kind === "order") { if (r.orderId) order = anyOrder(r.orderId); else typedLabel = clip(r.orderLabel, 40); if (!order && !typedLabel) return res.json({ ok: false, error: `Line ${i + 1}: choose the order of this product, or type its order ID.` }); }
      specs.push({ kind, standard: true, ptype: p.ptype || "", name: p.name, qty, size, note: clip(r.note, 400), details: colorDetails(r.color), buf: await photoBuf(p.photo), orderId: order ? order.id : "", orderLabel: order ? (order.orderId || String(order.id)) : typedLabel });
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
  app.get("/api/workshop-version", (req, res) => res.json({ ok: true, workshop: "v165", cutoverAt: db.cutoverAt }));
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
