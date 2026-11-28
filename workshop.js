// v188: Standard / Custom are a CATALOG (saved models). Ordering one (quantity + measurement) creates the products in Reports → Workflow and posts each to the WORKSHOP group with a "Finished product" button; pressing it posts the product to the FINISHING group with a "Finished" button; pressing that puts the product In Stock. Buttons need the AMBAR bot (admin in both groups).
// v187: Workshop sends ONLY to the workshop group (the Sold Out group is no longer part of this page) · Standard / Custom products carry full info (material, color, handle, shoe capacity …) and start in Workflow = "Workshop products" · Sent tab lists the sent products · new Products page (Home → beside Stock view): Workshop · Stock · Sold, list / large, advance + restock.
// v178: NON-STOCK orders are sent to the workshop only AFTER the customer confirmed · Workshop → Readymade lists/sends only the Standard saved + Custom products (not the stock) · a product that IS in stock goes, linked with the customer's info, to the SOLD OUT group (+ topic) the admin selected and is marked Sold Out.
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
  // v191: per-admin action rights chosen by the main admin (Manage Admins → Section access). Owner = everything; no choice saved = allowed.
  const canDo = (actor, part, act) => typeof ctx.canDo === "function" ? ctx.canDo(actor, part, act) : true;
  const NO_RIGHT = "🔒 The main admin has not allowed you to do this. Ask them to turn it on in Manage Admins → Section access.";
  let db = { admins: {}, sent: [], psent: {}, catalog: [], jobs: {}, batches: {}, savedAt: "" };

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
    if (d && typeof d === "object") db = { admins: {}, sent: [], psent: {}, catalog: [], jobs: {}, batches: {}, savedAt: "", ...d };
    if (!db.admins || typeof db.admins !== "object" || Array.isArray(db.admins)) db.admins = {};
    if (!Array.isArray(db.sent)) db.sent = [];
    if (!Array.isArray(db.catalog)) db.catalog = [];
    if (!db.jobs || typeof db.jobs !== "object" || Array.isArray(db.jobs)) db.jobs = {};
    if (!db.psent || typeof db.psent !== "object" || Array.isArray(db.psent)) db.psent = {};
    if (!db.batches || typeof db.batches !== "object" || Array.isArray(db.batches)) db.batches = {};
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
  // v185: the Sent tab starts from the moment the admin last pressed "Start from now" (first start of this version = now)
  const sentFromOf = actor => { const k = keyOf(actor), a = db.admins[k] || {}; if (a.sentFrom === undefined) { db.admins[k] = { ...a, sentFrom: Date.now() }; persist(); return db.admins[k].sentFrom; } return Number(a.sentFrom) || 0; };
  const finGroupOf = actor => (db.admins[keyOf(actor)] || {}).finGroup || null;
  const soldGroupOf = actor => (db.admins[keyOf(actor)] || {}).soldGroup || null;
  const fmtSize = v => clip(v, 80).replace(/(\d(?:\.\d+)?\s*(?:cm|mm|m)?)\s*[×✕xX*]\s*(?=\d)/gi, "$1*").replace(/\s*\*\s*/g, "*");
  // v189: product types are CHOSEN (not typed) and the info fields are PREPARED lists (the admin can still pick "Other" and type). Values saved before are added to the lists automatically.
  const PTYPES = ["Shoe Shelf", "Console Table", "Chest Drawer", "Center Table", "TV Stand", "Dining Table", "Coffee Table", "Wardrobe", "Bed", "Sofa", "Cabinet", "Mirror", "Other"];
  const PRESET = {
    material: ["MDF", "Plywood", "Solid wood", "Laminate", "Melamine", "Veneer", "Glass", "Metal"],
    color: ["White", "Black", "Walnut", "Oak", "Grey", "Beige", "Brown", "Wenge", "Gold", "Natural wood"],
    handle: ["No handle (push to open)", "Gold bar handle", "Black bar handle", "Silver bar handle", "Knob handle", "Edge / groove pull"],
    capacity: ["12 pairs", "16 pairs", "20 pairs", "24 pairs", "30 pairs", "36 pairs", "48 pairs", "60 pairs"]
  };
  const SIZE_HINT = { "Shoe Shelf": "120*35*120", "Console Table": "100*35*80", "Chest Drawer": "80*40*110", "Center Table": "90*60*45", "TV Stand": "160*40*50", "Dining Table": "160*90*75", "Coffee Table": "100*60*45", "Wardrobe": "200*60*220", "Bed": "200*160*100", "Sofa": "220*90*85", "Cabinet": "100*40*180", "Mirror": "60*4*160" };
  const presetsView = () => {
    const learned = f => { const seen = new Set(PRESET[f].map(x => x.toLowerCase())), out = []; const add = v => { v = clip(v, 60); if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); } }; db.catalog.forEach(c => add(c[f])); allProducts().forEach(p => add(p[f])); return out.slice(0, 40); };
    return { material: [...PRESET.material, ...learned("material")], color: [...PRESET.color, ...learned("color")], handle: [...PRESET.handle, ...learned("handle")], capacity: [...PRESET.capacity, ...learned("capacity")], sizeHint: SIZE_HINT };
  };
  const peekIds = (n, ptype) => { try { return typeof R().peekSeqCodes === "function" ? R().peekSeqCodes(Math.max(1, Math.min(n, 20)), ptype) : []; } catch { return []; } };
  const sizeOfOrder = o => [o.length, o.width, o.height].map(x => clip(x, 20)).filter(Boolean).join("*");
  const customers = () => (typeof ctx.getCustomerRecords === "function" ? ctx.getCustomerRecords() : []) || [];
  const customerById = id => customers().find(c => String(c.id) === String(id)) || null;
  const customerOfOrder = o => customerById(o.customerId || (typeof ctx.customerIdFor === "function" ? ctx.customerIdFor(o) : "")) || null;
  const findOrder = id => (ctx.getOrders() || []).find(o => String(o.id) === String(id));
  const log = (actor, kind, title, ref, customer, ok, error) => { db.sent.push({ id: uid(), at: stamp(), ts: Date.now(), by: clip(actor?.name || "Admin", 60), key: keyOf(actor), kind, title: clip(title, 100), ref: clip(ref, 80), customer: clip(customer, 80), ok: !!ok, error: clip(error, 200) }); if (db.sent.length > 400) db.sent.splice(0, db.sent.length - 400); persist(); };

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
  async function botPost(g, buf, caption, markup) { // caption = Telegram HTML; markup = inline keyboard (only the bot can send buttons)
    const topic = g.topic > 1 ? g.topic : 0;
    if (buf) {
      const build = () => { const fd = new FormData(); fd.append("chat_id", chatKey(g)); if (topic) fd.append("message_thread_id", String(topic)); fd.append("caption", caption); fd.append("parse_mode", "HTML"); if (markup) fd.append("reply_markup", JSON.stringify(markup)); fd.append("photo", new Blob([buf], { type: "image/jpeg" }), "product.jpg"); return fd; };
      try { await ctx.tgApi.sendForm("sendPhoto", build); return; }
      catch (e) { if (!/IMAGE_PROCESS_FAILED|PHOTO_INVALID|wrong file|image/i.test(String(e.message))) throw e; }
    }
    await tg("sendMessage", { chat_id: chatKey(g), ...(topic ? { message_thread_id: topic } : {}), text: caption.slice(0, 4000), parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) });
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
    const L = ["<b>AMBAR FURNITURE</b>", p.custom ? "🎨 <b>CUSTOM PRODUCT</b>" : "📦 <b>READYMADE PRODUCT</b> · STANDARD", "", "<b>" + esc((p.code || "—") + (p.model ? "-" + p.model : "")) + "</b>", p.ptype ? "Type: " + esc(clip(p.ptype, 40)) : "", "Measurement: " + esc(fmtSize(p.desc) || "—"), p.material ? "🧱 Material: " + esc(clip(p.material, 60)) : "", p.color ? "🎨 Color: " + esc(clip(p.color, 40)) : "", p.handle ? "🔧 Handle: " + esc(clip(p.handle, 60)) : "", p.capacity ? "👟 Capacity: " + esc(clip(p.capacity, 40)) : "", p.note ? "📝 " + esc(clip(p.note, 200)) : "", ...custLines(cust, null)];
    const tail = clip(note, 300) ? ["", "📝 " + esc(clip(note, 300))] : [];
    return capLines([...L, ...tail], 1000);
  }

  // v188: workshop post (with the "Finished product" button) and finishing post (with the "Finished" button)
  function jobCaption(p, stage, n, total, by) {
    const L = ["<b>AMBAR FURNITURE</b>", stage === "finishing" ? "🎨 <b>FINISHING</b> · " + (p.custom ? "CUSTOM" : "STANDARD") : "🛠 <b>WORKSHOP</b> · " + (p.custom ? "CUSTOM" : "STANDARD"), "", "<b>" + esc((p.code || "—") + (p.model ? "-" + p.model : "")) + "</b>" + (total > 1 ? " · " + n + "/" + total : ""), p.ptype ? "Type: " + esc(clip(p.ptype, 40)) : false, "Measurement: " + esc(fmtSize(p.desc) || "—"), p.material ? "🧱 Material: " + esc(clip(p.material, 60)) : false, p.color ? "🎨 Color: " + esc(clip(p.color, 40)) : false, p.handle ? "🔧 Handle: " + esc(clip(p.handle, 60)) : false, p.capacity ? "👟 Capacity: " + esc(clip(p.capacity, 40)) : false, p.note ? "📝 " + esc(clip(p.note, 300)) : false, "", by ? "Sent by " + esc(clip(by, 60)) : false];
    return capLines(L, 1000);
  }
  const jobButton = (stage, id) => ({ inline_keyboard: [[stage === "finishing" ? { text: "✅ Finished", callback_data: "ws:d:" + id } : { text: "✅ Finished product", callback_data: "ws:f:" + id }]] });
  function soldCaption(p, cust, note, by) {
    const L = ["<b>AMBAR FURNITURE</b>", "🔴 <b>SOLD OUT</b> · from stock", "", "<b>" + esc((p.code || "—") + (p.model ? "-" + p.model : "")) + "</b>", p.ptype ? "Type: " + esc(clip(p.ptype, 40)) : false, "Measurement: " + esc(fmtSize(p.desc) || "—"), p.color ? "🎨 Color: " + esc(clip(p.color, 40)) : false, p.handle ? "🔧 Handle: " + esc(clip(p.handle, 60)) : false, p.capacity ? "Capacity: " + esc(clip(p.capacity, 40)) : false, p.note ? "📝 " + esc(clip(p.note, 200)) : false, ...custLines(cust, null)];
    const tail = clip(note, 300) ? ["", "📝 " + esc(clip(note, 300))] : [];
    return capLines([...L, ...tail, "", "Sold by " + esc(clip(by, 60))], 1000);
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
  const noSoldGroup = "First choose the Sold Out group (Workshop page → Sold Out group).";
  async function sendOrder(o, actor, { note = "", again = false } = {}) {
    const g = groupOf(actor); if (!g) return { ok: false, error: noGroup };
    if (o.status === "Rejected") return { ok: false, error: "The customer REJECTED this order." };
    if (o.workshopSent && !again) return { ok: false, code: "ALREADY", error: `This order was already sent to the workshop (${o.workshopSent.at || ""}).` };
    const cust = customerOfOrder(o), buf = await orderPhotoBuf(o);
    try { await post(actor, g, buf, orderCaption(o, cust, note)); }
    catch (e) { log(actor, "order", o.product || "Order", o.orderId || o.id, cust?.name || o.customerName, false, e.message); return { ok: false, error: e.message }; }
    o.workshopSent = { at: stamp(), ts: Date.now(), by: clip(actor?.name || "Admin", 60), count: ((o.workshopSent && o.workshopSent.count) || 0) + 1 };
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
      try { await post(actor, g, buf, readymadeCaption(p, cust, note)); sent++; const prev = db.psent[p.id] || {}; db.psent[p.id] = { at: stamp(), ts: Date.now(), by: clip(actor?.name || "Admin", 60), key: keyOf(actor), count: (prev.count || 0) + 1 }; log(actor, "readymade", (p.model || p.desc || "Product"), p.code, cust?.name || "", true, ""); try { if (typeof R().wsMarkSent === "function") R().wsMarkSent(p.id, actor?.name); if (typeof R().wsSetStage === "function") R().wsSetStage(p.id, "workshop", actor?.name); } catch {} }
      catch (e) { err = e.message; log(actor, "readymade", (p.model || p.desc || "Product"), p.code, cust?.name || "", false, e.message); }
    }
    return { ok: sent > 0, sent, error: err };
  }

  // a product that IS in stock: product info + customer info → the Sold Out group; the product is marked Sold Out (linked to the customer)
  async function sendSold(list, actor, customerId, note) {
    const g = soldGroupOf(actor); if (!g) return { ok: false, error: noSoldGroup, sent: 0 };
    const cust = customerById(customerId); if (!cust) return { ok: false, error: "Customer not found.", sent: 0 };
    const by = clip(actor?.name || "Admin", 60), who = clip(cust.name, 60) + " (ID " + clip(cust.id, 20) + ")"; let sent = 0, err = ""; const sentNames = [];
    for (const p of list) {
      if (sent || err) await wait(700);
      const buf = await productPhotoBuf(p);
      try { await post(actor, g, buf, soldCaption(p, cust, note, by)); }
      catch (e) { err = e.message; log(actor, "sold", p.model || p.desc || "Product", p.code, cust.name, false, e.message); continue; }
      sent++; sentNames.push((p.code || "") + (p.model ? "-" + p.model : ""));
      const r = typeof R().wsSoldOut === "function" ? R().wsSoldOut(p.id, by, who) : { ok: false, error: "Reports is not ready." };
      log(actor, "sold", p.model || p.desc || "Product", p.code, cust.name, true, r.ok ? "" : "Posted, but not marked Sold Out: " + (r.error || ""));
    }
    if (sentNames.length && typeof ctx.onSold === "function") { try { await ctx.onSold(cust.id, sentNames.join(", "), by); } catch (e) { console.warn("Workshop: customer info not updated:", e.message); } } // the customer becomes "Customer" and the sale is written in the customer's info
    return { ok: sent > 0, sent, error: err };
  }
  // ── v188 catalog: saved Standard / Custom models; ordering one makes real products (Reports → Workflow) ──
  const catItem = c => ({ id: c.id, kind: c.kind, model: c.model, ptype: c.ptype, size: c.size, sizes: Array.isArray(c.sizes) && c.sizes.length ? c.sizes : (c.size ? [c.size] : []), photos: Array.isArray(c.photos) && c.photos.length ? c.photos : (c.photo ? [c.photo] : []), material: c.material, color: c.color, handle: c.handle, capacity: c.capacity, note: c.note, photo: c.photo || "", at: c.at, by: c.by, ordered: db.psent && Object.values(db.jobs).filter(j => j.cat === c.id).length });
  const catalogOf = actor => db.catalog.filter(c => isOwnerA(actor) || actor?.viewer || c.key === keyOf(actor)).map(catItem);
  // v189: ONE Telegram post per order (all the same pieces together). The workshop man presses "Finished product", chooses which pieces are finished (repeat until all are done);
  // the chosen pieces go to the finishing group as one post, where the same choice is made before they enter Stock.
  const pendingIdx = b => b.pieces.map((x, i) => (x.done ? -1 : i)).filter(i => i >= 0);
  function newBatch({ stage, info, pieces, parent, by, key, fin }) {
    const b = { id: uid(), stage, info, pieces, parent: parent || "", by: by || "", key: key || "", fin: fin || null, mode: "main", sel: [], ts: Date.now() };
    db.batches[b.id] = b;
    const ids = Object.keys(db.batches); if (ids.length > 500) ids.sort((x, y) => (db.batches[x].ts || 0) - (db.batches[y].ts || 0)).slice(0, ids.length - 500).forEach(k => delete db.batches[k]);
    return b;
  }
  function syncBatch(b) { // a piece that was deleted or already moved on (Products page) is closed
    for (const x of b.pieces) { if (x.done) continue; const st = typeof R().wsStatus === "function" ? R().wsStatus(x.id) : null; if (!st || st.status !== "workflow") { x.done = true; x.gone = true; } }
  }
  function batchCaption(b) {
    const i = b.info || {}, total = b.pieces.length, finishing = b.stage === "finishing";
    const wait = b.pieces.filter(x => !x.done).map(x => x.code), done = b.pieces.filter(x => x.done && !x.gone).map(x => x.code), gone = b.pieces.filter(x => x.gone).map(x => x.code);
    return capLines(["<b>AMBAR FURNITURE</b>", (finishing ? "🎨 <b>FINISHING</b> · " : "🛠 <b>WORKSHOP</b> · ") + (i.custom ? "CUSTOM" : "STANDARD"), "",
      "<b>" + esc(clip(i.model || b.pieces[0]?.code || "Product", 40)) + "</b>" + (total > 1 ? " · ×" + total : ""),
      wait.length ? "⏳ Waiting (" + wait.length + "): " + esc(wait.join(", ")) : false,
      done.length ? (finishing ? "📦 In Stock (" : "✅ Finished (") + done.length + "): " + esc(done.join(", ")) : false,
      gone.length ? "⚠️ Removed / already moved (" + gone.length + "): " + esc(gone.join(", ")) : false,
      "", i.ptype ? "Type: " + esc(clip(i.ptype, 40)) : false, "Measurement: " + esc(fmtSize(i.desc) || "—"),
      i.material ? "🧱 Material: " + esc(clip(i.material, 60)) : false, i.color ? "🎨 Color: " + esc(clip(i.color, 40)) : false, i.handle ? "🔧 Handle: " + esc(clip(i.handle, 60)) : false, i.capacity ? "👟 Capacity: " + esc(clip(i.capacity, 40)) : false,
      i.note ? "📝 " + esc(clip(i.note, 300)) : false, "", b.by ? (finishing ? "Finished in workshop by " : "Sent by ") + esc(clip(b.by, 60)) : false], 1000);
  }
  const kbMain = b => {
    const n = pendingIdx(b).length;
    if (!n) return { inline_keyboard: [[{ text: b.stage === "finishing" ? "✔ All finished · in Stock" : "✔ All finished · sent to finishing", callback_data: "ws:n:" }]] };
    return { inline_keyboard: [[{ text: (b.stage === "finishing" ? "✅ Finished" : "✅ Finished product") + (b.pieces.length > 1 ? " (" + n + " left)" : ""), callback_data: "ws:" + (b.stage === "finishing" ? "d" : "f") + ":" + b.id }]] };
  };
  const kbPick = b => {
    const sel = new Set(b.sel || []), rows = []; let row = [];
    b.pieces.forEach((x, i) => { if (x.done) return; row.push({ text: (sel.has(i) ? "☑️ " : "⬜ ") + x.code, callback_data: "ws:t:" + b.id + ":" + i }); if (row.length === 3) { rows.push(row); row = []; } });
    if (row.length) rows.push(row);
    const n = pendingIdx(b).length;
    rows.push([{ text: sel.size >= n ? "⬜ Clear all" : "☑️ Select all", callback_data: "ws:a:" + b.id }]);
    rows.push([{ text: "✅ Done" + (sel.size ? " (" + sel.size + ")" : ""), callback_data: "ws:k:" + b.id }, { text: "↩ Back", callback_data: "ws:x:" + b.id }]);
    return { inline_keyboard: rows };
  };
  async function editBatchMsg(cb, b, withCaption) {
    const chat = cb.message?.chat?.id, mid = cb.message?.message_id; if (!chat || !mid) return;
    const markup = b.mode === "pick" ? kbPick(b) : kbMain(b);
    try {
      if (!withCaption) await tg("editMessageReplyMarkup", { chat_id: chat, message_id: mid, reply_markup: markup });
      else if (cb.message.photo) await tg("editMessageCaption", { chat_id: chat, message_id: mid, caption: batchCaption(b), parse_mode: "HTML", reply_markup: markup });
      else await tg("editMessageText", { chat_id: chat, message_id: mid, text: batchCaption(b), parse_mode: "HTML", reply_markup: markup });
    } catch (e) { if (!/not modified/i.test(String(e?.message || e))) console.warn("Workshop: could not edit the post:", e?.message || e); }
  }
  async function orderFromCatalog(c, actor, { qty, size, note }) {
    const g = groupOf(actor), fg = finGroupOf(actor);
    if (!g) return { ok: false, error: noGroup };
    if (!fg) return { ok: false, error: "First choose the finishing group (Workshop page → Telegram groups → Finishing group)." };
    qty = Math.max(1, Math.min(parseInt(qty, 10) || 1, 20));
    const by = clip(actor?.name || "Admin", 60), measure = fmtSize(size) || c.size, custom = c.kind === "custom";
    let buf = null; try { buf = c.photo ? await R().wsPhotoBuf(c.photo) : null; } catch {}
    const made = [];
    try {
      for (let i = 0; i < qty; i++) {
        const p = await R().wsAddProduct({ ptype: c.ptype, model: c.model, desc: measure, seqId: true, orderType: "READYMADE", priority: "MEDIUM", handle: c.handle, note: clip(note, 300) || c.note, photoBuf: buf, salesName: by, custom, wsSaved: true, color: c.color, capacity: c.capacity, material: c.material }, by);
        made.push(p.id);
      }
    } catch (e) { if (made.length) R().wsRemove(made); return { ok: false, error: "Could not create the products: " + e.message }; }
    const all = allProducts().filter(p => made.includes(p.id));
    const info = { model: c.model, ptype: c.ptype, desc: measure, material: c.material, color: c.color, handle: c.handle, capacity: c.capacity, note: clip(note, 300) || c.note, custom, photo: all[0]?.photo || "" };
    const b = newBatch({ stage: "workshop", info, pieces: all.map(p => ({ id: p.id, code: p.code })), by, key: keyOf(actor), fin: fg });
    try { await botPost(g, buf, batchCaption(b), kbMain(b)); }
    catch (e) { const err = botFriendly(e); delete db.batches[b.id]; R().wsRemove(made); for (const p of all) log(actor, "readymade", c.model, p.code, "", false, err); persist(); return { ok: false, error: err }; } // nothing reached the workshop → nothing is kept in Workflow
    for (const p of all) {
      db.jobs[p.id] = { cat: c.id, key: keyOf(actor), fin: fg, stage: "workshop", by, at: stamp(), batch: b.id };
      db.psent[p.id] = { at: stamp(), ts: Date.now(), by, key: keyOf(actor), count: 1 };
      R().wsSetStage(p.id, "workshop", by); R().wsMarkSent(p.id, by);
      log(actor, "readymade", c.model, p.code, "", true, "");
    }
    persist();
    return { ok: true, sent: all.length, error: "", codes: all.map(p => p.code) };
  }
  // Telegram buttons: "ws:f:<id>" (workshop → finishing group) and "ws:d:<id>" (finishing → Stock)
  let cbChain = Promise.resolve(); // one button press at a time (two people can press the same post)
  function handleCallback(cb) { const run = cbChain.then(() => handleCallbackNow(cb)); cbChain = run.catch(() => {}); return run; }
  async function batchPress(cb, b, op, idx, answer, who) {
    syncBatch(b);
    const pend = pendingIdx(b), finishing = b.stage === "finishing";
    if (!pend.length) { b.mode = "main"; b.sel = []; persist(); await editBatchMsg(cb, b, true); await answer("Everything in this post is already done."); return true; }
    if (op === "f" || op === "d") {
      if ((op === "d") !== finishing) { await answer("This button is old. Use the newest post.", true); return true; }
      if (pend.length === 1) return completeBatch(cb, b, pend, who, answer); // one piece left → no choice needed
      b.mode = "pick"; b.sel = []; persist(); await editBatchMsg(cb, b, false);
      await answer("Select the pieces that are finished, then press ✅ Done."); return true;
    }
    if (op === "x") { b.mode = "main"; b.sel = []; persist(); await editBatchMsg(cb, b, true); await answer(""); return true; }
    if (op === "t") {
      b.mode = "pick"; const s = new Set((b.sel || []).filter(i => pend.includes(i)));
      if (pend.includes(idx)) { if (s.has(idx)) s.delete(idx); else s.add(idx); }
      b.sel = [...s]; persist(); await editBatchMsg(cb, b, false); await answer(""); return true;
    }
    if (op === "a") { b.mode = "pick"; const have = (b.sel || []).filter(i => pend.includes(i)).length; b.sel = have >= pend.length ? [] : pend.slice(); persist(); await editBatchMsg(cb, b, false); await answer(""); return true; }
    if (op === "k") {
      const sel = (b.sel || []).filter(i => pend.includes(i));
      if (!sel.length) { await answer("Select at least one finished piece first.", true); return true; }
      return completeBatch(cb, b, sel, who, answer);
    }
    await answer(""); return true;
  }
  async function completeBatch(cb, b, sel, who, answer) {
    const chosen = sel.map(i => b.pieces[i]).filter(Boolean);
    if (b.stage === "workshop") { // workshop → finishing group (the chosen pieces become one finishing post)
      if (!b.fin) { await answer("The finishing group is not set for this post.", true); return true; }
      const fb = newBatch({ stage: "finishing", info: b.info, pieces: chosen.map(x => ({ id: x.id, code: x.code })), parent: b.id, by: who, key: b.key });
      let buf = null; try { buf = b.info?.photo && typeof R().wsPhotoBuf === "function" ? await R().wsPhotoBuf(b.info.photo) : null; } catch {}
      try { await botPost(b.fin, buf, batchCaption(fb), kbMain(fb)); }
      catch (e) { delete db.batches[fb.id]; await answer("Could not post in the finishing group: " + botFriendly(e), true); return true; }
      for (const x of chosen) { x.done = true; const j = db.jobs[x.id]; if (j) { j.stage = "finishing"; j.finBy = who; j.finAt = stamp(); } R().wsSetStage(x.id, "finishing", who); }
      b.mode = "main"; b.sel = []; persist();
      await editBatchMsg(cb, b, true);
      await answer("✅ " + chosen.length + " piece" + (chosen.length === 1 ? "" : "s") + " sent to the finishing group");
      return true;
    }
    let ok = 0, err = ""; // finishing → Stock
    for (const x of chosen) { const r = R().wsFinish(x.id, who); if (r.ok) { ok++; x.done = true; const j = db.jobs[x.id]; if (j) { j.stage = "done"; j.doneBy = who; j.doneAt = stamp(); } } else if (!err) err = r.error || "Could not finish."; }
    b.mode = "main"; b.sel = []; persist();
    await editBatchMsg(cb, b, true);
    if (!ok) await answer(err || "Could not finish.", true); else await answer("✅ " + ok + " piece" + (ok === 1 ? "" : "s") + " finished — now in Stock" + (err ? " (some failed: " + err + ")" : ""));
    return true;
  }
  async function handleCallbackNow(cb) {
    const m = /^ws:([fdntakx]):([0-9a-f]{6,32})?(?::(\d{1,3}))?$/.exec(String(cb?.data || "")); if (!m) return false;
    const answer = (text, alert) => ctx.tgApi.call("answerCallbackQuery", { callback_query_id: cb.id, text: String(text || "").slice(0, 190), ...(alert ? { show_alert: true } : {}) }).catch(() => {});
    if (m[1] === "n") { await answer(""); return true; }
    const who = clip([cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") || cb.from?.username || "Workshop", 60);
    const batch = m[2] && db.batches[m[2]];
    if (batch) return batchPress(cb, batch, m[1], m[3] === undefined ? -1 : parseInt(m[3], 10), answer, who);
    if (m[1] !== "f" && m[1] !== "d") { await answer("This button is old. Use the newest post.", true); return true; }
    // ── v188 posts (one product per post) keep working ──
    const id = m[2], job = db.jobs[id], st = typeof R().wsStatus === "function" ? R().wsStatus(id) : null;
    const chat = cb.message?.chat?.id, mid = cb.message?.message_id;
    const mark = text => { if (chat && mid) ctx.tgApi.call("editMessageReplyMarkup", { chat_id: chat, message_id: mid, reply_markup: { inline_keyboard: [[{ text, callback_data: "ws:n:" }]] } }).catch(() => {}); };
    if (!job || !st) { await answer("This product was not found any more.", true); return true; }
    if (st.status !== "workflow") { await answer("Already done — this product is in " + (st.status === "stock" ? "Stock" : "the " + st.status + " list") + ".", true); mark("✔ Already in Stock"); return true; }
    if (m[1] === "f") {
      if (job.stage === "finishing") { await answer("Already sent to the finishing group."); mark("✔ Sent to finishing"); return true; }
      const p = allProducts().find(x => x.id === id); if (!p) { await answer("Product not found.", true); return true; }
      try { await botPost(job.fin, await productPhotoBuf(p), jobCaption(p, "finishing", 1, 1, who), jobButton("finishing", id)); }
      catch (e) { await answer("Could not post in the finishing group: " + botFriendly(e), true); return true; }
      job.stage = "finishing"; job.finBy = who; job.finAt = stamp(); persist();
      R().wsSetStage(id, "finishing", who);
      await answer("✅ Sent to the finishing group"); mark("✔ Finished product · sent to finishing (" + who + ")");
      return true;
    }
    if (job.stage !== "finishing") { await answer("This product has not passed the workshop yet.", true); return true; }
    const r = R().wsFinish(id, who);
    if (!r.ok) { await answer(r.error || "Could not finish.", true); return true; }
    job.stage = "done"; job.doneBy = who; job.doneAt = stamp(); persist();
    await answer("✅ Finished — now in Stock"); mark("✔ Finished · now in Stock (" + who + ")");
    return true;
  }

  // ── compact views ───────────────────────────────────────────────────────────────────────────
  const compactOrder = o => { const c = customerOfOrder(o); return { id: o.id, orderId: o.orderId || "", product: clip(o.product, 80), size: fmtSize(sizeOfOrder(o)), status: clip(o.status, 20), confirmed: o.status === "Confirmed", customerId: c?.id || clip(o.customerId, 20), customerName: clip(c?.name || o.customerName, 60), createdAt: o.createdAt || "", photo: o.photo || "", sent: o.workshopSent || null, sentTs: (o.workshopSent && o.workshopSent.ts) || 0 }; };
  const stockList = () => (typeof R().wsStockView === "function" ? R().wsStockView() : []);
  const compactProduct = p => ({ id: p.id, code: p.code, model: p.model, ptype: p.ptype, desc: p.desc, handle: p.handle, photo: p.photo, status: p.status, capacity: p.capacity, material: p.material || "", note: p.note, custom: !!p.custom, color: p.color || "", stage: p.stage || "", sent: db.psent[p.id] || null });
  const allProducts = () => (typeof R().wsProductsAll === "function" ? R().wsProductsAll() : []);
  const senderInfo = actor => { const acc = accountOf(actor); return { ready: !!acc?.ready, label: clip(acc?.label, 60) }; };
  const orderList = actor => (ctx.getOrders() || []).filter(o => mineOnly(actor, o)).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  function view(actor) {
    const g = groupOf(actor), owner = isOwnerA(actor);
    return {
      ok: true, me: { name: clip(actor?.name, 60), owner }, group: g, groupName: groupName(g), finGroup: finGroupOf(actor), finGroupName: groupName(finGroupOf(actor)), soldGroup: soldGroupOf(actor), soldGroupName: groupName(soldGroupOf(actor)), can: { catalog: canDo(actor, "workshop", "catalog"), order: canDo(actor, "workshop", "order"), groups: canDo(actor, "workshop", "groups"), sold: canDo(actor, "workshop", "sold") }, catalog: catalogOf(actor), sender: senderInfo(actor),
      orders: orderList(actor).slice(0, 200).map(compactOrder),
      sold: stockList().filter(p => p.status === "sold").slice(-80).reverse().map(compactProduct), // v184: Sold Out products (each has a ♻️ Restock button)
      stock: allProducts().filter(p => (p.status === "workflow" || p.status === "stock") && p.wsSaved).map(compactProduct), // v187: the products prepared in Workshop (Standard / Custom), in Workflow or already in Stock
      sentProducts: allProducts().filter(p => db.psent[p.id] && (owner || db.psent[p.id].key === keyOf(actor)) && Number(db.psent[p.id].ts || 0) >= sentFromOf(actor)).map(compactProduct).sort((a, b) => Number(b.sent.ts || 0) - Number(a.sent.ts || 0)).slice(0, 150),
      workflow: (typeof R().inProgress === "function" ? R().inProgress() : []).filter(p => !/CUS|ORD/i.test(String(p.orderType || ""))).map(p => ({ id: p.id, code: p.code, model: p.model, desc: p.desc, ptype: p.ptype, photo: p.photo })),
      ptypes: PTYPES, presets: presetsView(), nextIds: Object.fromEntries(PTYPES.map(t => [t, peekIds(1, t)[0] || ""])),
      sentFrom: sentFromOf(actor),
      sent: db.sent.filter(x => (owner || x.key === keyOf(actor)) && Number(x.ts || 0) >= sentFromOf(actor)).slice(-80).reverse()
    };
  }

  // ── routes ──────────────────────────────────────────────────────────────────────────────────
  const router = express.Router();
  router.use(requireAccess);
  router.use((req, res, next) => hasPerm(req.actor, "workshop") ? next() : res.status(403).json({ ok: false, error: "The main admin has not given you the Workshop section. Ask them to turn it on in Manage Admins." }));
  router.use(express.json({ limit: "30mb" }));
  // v191: what each route needs (the main admin turns these on/off per admin)
  const NEED = { "/catalog/add": "catalog", "/catalog/update": "catalog", "/catalog/delete": "catalog", "/to-standard": "catalog", "/catalog/order": "order", "/send-order": "order", "/product/finish": "order", "/settings": "groups", "/settings/clear": "groups", "/dialogs": "groups", "/topics": "groups", "/resolve": "groups", "/test": "groups", "/restock": "sold", "/send-sold": "sold", "/product/sold": "sold" };
  router.use((req, res, next) => { const need = req.method === "POST" ? NEED[req.path.replace(/\/+$/, "")] : null; return !need || canDo(req.actor, "workshop", need) ? next() : res.status(403).json({ ok: false, code: "NO_RIGHT", error: NO_RIGHT }); });
  router.get("/state", (req, res) => res.json(view(req.actor)));
  router.get("/peek", (req, res) => res.json({ ok: true, codes: peekIds(parseInt(req.query.n, 10) || 1, clip(req.query.ptype, 40)) })); // the Product IDs the next pieces will get

  // the customer-details button: one customer's orders + the stock, and whether the group is chosen
  router.get("/customer/:id", (req, res) => {
    const c = customerById(req.params.id); if (!c) return res.json({ ok: false, error: "Customer not found." });
    const orders = orderList(req.actor).filter(o => { const oc = customerOfOrder(o); return oc ? String(oc.id) === String(c.id) : String(o.customerId || "") === String(c.id); }).slice(0, 60).map(compactOrder);
    res.json({ ok: true, customer: { id: c.id, name: clip(c.name, 60), phone: clip(c.phone, 30), location: clip(c.location, 120) }, group: groupName(groupOf(req.actor)), soldGroup: groupName(soldGroupOf(req.actor)), orders, stock: stockList().filter(p => p.status === "stock").map(compactProduct) });
  });

  router.post("/settings", (req, res) => {
    const g = cleanGroup(req.body?.group); if (!g) return res.json({ ok: false, error: "Choose a Telegram group first." });
    const k = keyOf(req.actor), old = db.admins[k] || {};
    if (req.body?.kind === "finish") { db.admins[k] = { ...old, finGroup: g, updatedAt: stamp() }; persist(); return res.json({ ...view(req.actor), message: "✅ Saved. Products finished in the workshop will be posted in " + groupName(g) + "." }); }
    if (req.body?.kind === "sold") { db.admins[k] = { ...old, soldGroup: g, updatedAt: stamp() }; persist(); return res.json({ ...view(req.actor), message: "✅ Saved. Products found in stock and sold to a customer will be posted in " + groupName(g) + "." }); }
    db.admins[k] = { ...old, group: g, updatedAt: stamp() }; persist();
    res.json({ ...view(req.actor), message: "✅ Saved. Products will be sent to " + groupName(g) + "." });
  });
  router.post("/settings/clear", (req, res) => {
    const k = keyOf(req.actor), old = db.admins[k] || {}, kind = req.body?.kind;
    if (kind === "sold") delete old.soldGroup; else if (kind === "finish") delete old.finGroup; else delete old.group;
    if (old.group || old.soldGroup || old.finGroup) db.admins[k] = old; else delete db.admins[k];
    persist(); res.json({ ...view(req.actor), message: kind === "sold" ? "Sold Out group removed." : kind === "finish" ? "Finishing group removed." : "Workshop group removed." });
  });

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
    const kind = req.body?.kind === "sold" ? "sold" : req.body?.kind === "finish" ? "finish" : "work";
    const g = kind === "sold" ? soldGroupOf(req.actor) : kind === "finish" ? finGroupOf(req.actor) : groupOf(req.actor); if (!g) return res.json({ ok: false, error: kind === "sold" ? noSoldGroup : kind === "finish" ? "First choose the finishing group." : noGroup });
    try { const via = await post(req.actor, g, null, `<b>AMBAR ${kind === "sold" ? "SOLD OUT" : kind === "finish" ? "FINISHING" : "WORKSHOP"} TEST</b>\nThis group receives products from ${esc(clip(req.actor?.name || "the admin", 60))}.`); res.json({ ok: true, message: "✅ Test message posted in " + groupName(g) + " (sent by " + via + ")." }); }
    catch (e) { res.json({ ok: false, error: e.message }); }
  });

  router.post("/send-order", async (req, res) => {
    const o = findOrder(req.body?.id);
    if (!o || !mineOnly(req.actor, o)) return res.json({ ok: false, error: "Order not found." });
    const r = await sendOrder(o, req.actor, { note: req.body?.note, again: !!req.body?.again });
    res.json({ ...view(req.actor), ok: r.ok, code: r.code, error: r.error, message: r.ok ? `✅ Order ${o.orderId || o.id} sent to the workshop group.` : undefined });
  });
  router.post("/sent/reset", (req, res) => { const k = keyOf(req.actor); db.admins[k] = { ...(db.admins[k] || {}), sentFrom: Date.now() }; persist(); res.json({ ...view(req.actor), ok: true, message: "✅ The Sent list now starts from now." }); });
  // ♻️ Restock: a Sold Out product returns to In Stock
  router.post("/restock", (req, res) => {
    const r = typeof R().wsRestock === "function" ? R().wsRestock(String(req.body?.id || ""), clip(req.actor?.name || "Admin", 60)) : { ok: false, error: "Reports is not ready." };
    res.json({ ...view(req.actor), ok: !!r.ok, error: r.error, message: r.ok ? "♻️ Restocked — the product is back In Stock." : undefined });
  });
  // Customer ID → Send to workshop, product IN STOCK: product info + customer info → the Sold Out group (and the product becomes Sold Out)
  router.post("/send-sold", async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 30) : [];
    const list = stockList().filter(p => ids.includes(p.id) && p.status === "stock");
    if (!list.length) return res.json({ ...view(req.actor), ok: false, error: "Choose at least one product that is in stock." });
    const r = await sendSold(list, req.actor, String(req.body?.customerId || ""), req.body?.note);
    res.json({ ...view(req.actor), ok: r.ok, error: r.error, message: r.ok ? `✅ ${r.sent} product${r.sent === 1 ? "" : "s"} posted in the Sold Out group, marked Sold Out and written in the customer's info.` + (r.error ? " Not sent: " + r.error : "") : undefined });
  });
  // v188 catalog: save a Standard / Custom model (no sending here)
  const sizesOf = b => { const raw = Array.isArray(b.sizes) ? b.sizes : [b.size]; const out = []; for (const x of raw) { const v = fmtSize(x); if (v && !out.includes(v)) out.push(v); } return out.slice(0, 12); };
  async function savePhotos(list) { // data URLs → saved photo ids (max 6)
    const ids = [];
    for (const d of (Array.isArray(list) ? list : []).filter(Boolean).slice(0, 6)) {
      const buf = photoFromDataUrl(d); const id = buf ? await R().wsSavePhoto(buf) : ""; if (id) ids.push(id);
    }
    return ids;
  }
  const canEditCat = (actor, c) => isOwnerA(actor) || c.key === keyOf(actor);
  function catFields(b) { return { ptype: clip(b.ptype, 40), size: sizesOf(b)[0] || "", sizes: sizesOf(b), material: clip(b.material, 60), color: clip(b.color, 40), handle: clip(b.handle, 60), capacity: clip(b.capacity, 40), note: clip(b.note, 300) }; }
  // v189: a saved model can have several photos and several measurements
  router.post("/catalog/add", async (req, res) => {
    const b = req.body || {}, kind = b.custom === true || b.custom === "true" ? "custom" : "standard", model = clip(b.model, 40);
    if (!model) return res.json({ ok: false, error: kind === "custom" ? "Type the custom model name." : "Type the product model / name." });
    if (!clip(b.ptype, 40)) return res.json({ ok: false, error: "Choose the product type." });
    if (typeof R().wsSavePhoto !== "function") return res.json({ ok: false, error: "Reports is not ready." });
    let photos = []; try { photos = await savePhotos(Array.isArray(b.photos) ? b.photos : [b.photo]); } catch (e) { return res.json({ ok: false, error: e.message }); }
    db.catalog.unshift({ id: uid(), kind, model, ...catFields(b), photo: photos[0] || "", photos, at: stamp(), by: clip(req.actor?.name || "Admin", 60), key: keyOf(req.actor) });
    if (db.catalog.length > 500) db.catalog.length = 500;
    persist(); res.json({ ...view(req.actor), ok: true, message: `✅ ${kind === "custom" ? "Custom model" : "Standard product"} “${model}” saved. Select it to order.` });
  });
  router.post("/catalog/update", async (req, res) => {
    const b = req.body || {}, c = db.catalog.find(x => x.id === String(b.id || "")); if (!c) return res.json({ ...view(req.actor), ok: false, error: "Not found." });
    if (!canEditCat(req.actor, c)) return res.json({ ...view(req.actor), ok: false, error: "Only the one who saved it (or the main admin) can edit it." });
    const model = clip(b.model, 40); if (!model) return res.json({ ...view(req.actor), ok: false, error: "Type the product model / name." });
    if (!clip(b.ptype, 40)) return res.json({ ...view(req.actor), ok: false, error: "Choose the product type." });
    const old = Array.isArray(c.photos) && c.photos.length ? c.photos : (c.photo ? [c.photo] : []);
    const keep = (Array.isArray(b.keepPhotos) ? b.keepPhotos.map(String) : old).filter(x => old.includes(x));
    let added = []; try { added = await savePhotos(b.newPhotos); } catch (e) { return res.json({ ...view(req.actor), ok: false, error: e.message }); }
    const photos = [...keep, ...added].slice(0, 6);
    for (const id of old.filter(x => !photos.includes(x))) { if (typeof R().wsDropPhoto === "function") { try { await R().wsDropPhoto(id); } catch {} } }
    Object.assign(c, { model }, catFields(b), { photo: photos[0] || "", photos });
    persist(); res.json({ ...view(req.actor), ok: true, message: `✅ “${model}” updated. Products already ordered keep their old info.` });
  });
  router.post("/catalog/delete", async (req, res) => {
    const c = db.catalog.find(x => x.id === String(req.body?.id || "")); if (!c) return res.json({ ...view(req.actor), ok: false, error: "Not found." });
    if (!canEditCat(req.actor, c)) return res.json({ ...view(req.actor), ok: false, error: "Only the one who saved it (or the main admin) can delete it." });
    db.catalog = db.catalog.filter(x => x !== c); persist();
    for (const id of (Array.isArray(c.photos) && c.photos.length ? c.photos : [c.photo]).filter(Boolean)) { if (typeof R().wsDropPhoto === "function") { try { await R().wsDropPhoto(id); } catch {} } }
    res.json({ ...view(req.actor), ok: true, message: "🗑 Deleted from the catalog (products already ordered stay)." });
  });
  // Custom → Standard (the model changes section)
  router.post("/to-standard", (req, res) => {
    const c = db.catalog.find(x => x.id === String(req.body?.id || "") && x.kind === "custom"); if (!c) return res.json({ ...view(req.actor), ok: false, error: "Custom model not found." });
    c.kind = "standard"; persist(); res.json({ ...view(req.actor), ok: true, message: "✅ Moved to Standard." });
  });
  // select a saved model, type the quantity + measurement → products appear in Products → Workshop and are posted to the workshop group
  // v189: choose one or several saved measurements (each with its own quantity) → one workshop post per measurement
  router.post("/catalog/order", async (req, res) => {
    const c = db.catalog.find(x => x.id === String(req.body?.id || "")); if (!c) return res.json({ ...view(req.actor), ok: false, error: "Model not found." });
    let items = Array.isArray(req.body?.items) ? req.body.items : [{ size: req.body?.size, qty: req.body?.qty }];
    items = items.map(x => ({ size: fmtSize(x?.size), qty: Math.max(0, Math.min(parseInt(x?.qty, 10) || 0, 20)) })).filter(x => x.qty > 0).slice(0, 12);
    if (!items.length) return res.json({ ...view(req.actor), ok: false, error: "Choose a measurement and type its quantity." });
    if (items.some(x => !x.size)) return res.json({ ...view(req.actor), ok: false, error: "Type the measurement." });
    let sent = 0, err = ""; const codes = [];
    for (const it of items) {
      const r = await orderFromCatalog(c, req.actor, { qty: it.qty, size: it.size, note: req.body?.note });
      if (r.ok) { sent += r.sent; codes.push(...r.codes); } else { err = r.error; break; }
    }
    res.json({ ...view(req.actor), ok: sent > 0, error: sent ? "" : err, warning: sent && err ? "Some were not sent: " + err : "", message: sent ? `✅ ${sent} product${sent === 1 ? "" : "s"} (${codes.join(", ")}) sent to the workshop group and added to Products → Workshop.` : undefined });
  });
  router.post("/product/finish", (req, res) => { const r = typeof R().wsFinish === "function" ? R().wsFinish(String(req.body?.id || ""), clip(req.actor?.name, 60)) : { ok: false, error: "Reports is not ready." }; res.json({ ...view(req.actor), ok: !!r.ok, error: r.error, message: r.ok ? `✅ ${r.code} is now in Stock.` : undefined }); });
  router.post("/product/sold", async (req, res) => { // v189: a product is never Sold Out without its customer
    const cust = customerById(req.body?.customerId); if (!cust) return res.json({ ...view(req.actor), ok: false, error: "First choose the customer this product is sold to." });
    const by = clip(req.actor?.name, 60), id = String(req.body?.id || ""), p = allProducts().find(x => x.id === id);
    const r = R().wsSoldOut(id, by, clip(cust.name, 60) + " (ID " + clip(cust.id, 20) + ")");
    if (r.ok && !r.already && typeof ctx.onSold === "function") { try { await ctx.onSold(cust.id, (p?.code || r.code) + (p?.model ? "-" + p.model : ""), by); } catch {} }
    res.json({ ...view(req.actor), ok: !!r.ok, error: r.error, message: r.ok ? `✅ ${r.code} marked Sold Out to ${clip(cust.name, 60)}.` : undefined });
  });
  router.post("/product/delete", async (req, res) => {
    if (!isOwnerA(req.actor)) return res.json({ ...view(req.actor), ok: false, error: "Only the main admin can delete a product." });
    const r = await R().wsOp("/product/delete", { id: String(req.body?.id || "") }, req.actor);
    res.json({ ...view(req.actor), ok: r.ok, error: r.error, message: r.ok ? "🗑 Product deleted." : undefined });
  });
  app.get("/api/workshop-version", (req, res) => res.json({ ok: true, workshop: "v191" }));

  // v187 Products page (Home → beside Stock view): Workshop · Stock · Sold Out products with ALL their info.
  // Viewing: Stock view / Reports / Workshop access. Advancing and restocking: Workshop or Reports access (view-only admins are blocked by requireAccess).
  const productsView = () => {
    const all = allProducts(), keep = st => all.filter(p => p.status === st).map(p => ({ ...compactProduct(p), ptype: p.ptype, category: p.category, location: p.location, priority: p.priority, orderType: p.orderType, orderRef: p.orderRef, salesName: p.salesName, deliveryDate: p.deliveryDate, added: p.added, finished: p.finished, stage: p.stage, soldInfo: p.sold }));
    const w = keep("workflow"), st = keep("stock"), so = keep("sold");
    return { ok: true, now: nowEth(), counts: { workshop: w.length, stock: st.length, sold: so.length }, workshop: w, stock: st, sold: so };
  };
  app.get("/api/products", requireAccess, (req, res) => res.json({ ...productsView(), can: { advance: canDo(req.actor, "products", "advance"), sold: canDo(req.actor, "products", "sold") } }));
  app.post("/api/products/advance", requireAccess, express.json({ limit: "1mb" }), async (req, res) => {
    if (!hasPerm(req.actor, "products")) return res.status(403).json({ ok: false, error: "The main admin has not given you the Products section. Ask them to turn it on in Manage Admins." });
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id]).map(x => String(x || "")).filter(Boolean).slice(0, 200);
    if (!ids.length) return res.json({ ...productsView(), ok: false, error: "Choose at least one product." });
    if (typeof R().wsAdvance !== "function") return res.json({ ...productsView(), ok: false, error: "Reports is not ready." });
    const by = clip(req.actor?.name || "Admin", 60), byId = new Map(allProducts().map(p => [p.id, p]));
    // v191: moving to Stock needs "advance"; Sold / Restock needs "sold" (chosen per admin)
    if (ids.some(id => byId.get(id)?.status === "workflow") && !canDo(req.actor, "products", "advance")) return res.status(403).json({ ...productsView(), ok: false, error: NO_RIGHT });
    if (ids.some(id => ["stock", "sold"].includes(byId.get(id)?.status)) && !canDo(req.actor, "products", "sold")) return res.status(403).json({ ...productsView(), ok: false, error: NO_RIGHT });
    // v189: Stock → Sold Out needs the customer first (the customer is attached to the product and the sale is written in the customer's info)
    const selling = ids.filter(id => byId.get(id)?.status === "stock");
    let cust = null, who = "";
    if (selling.length) {
      cust = customerById(req.body?.customerId);
      if (!cust) return res.json({ ...productsView(), ok: false, error: "First choose the customer this product is sold to." });
      who = clip(cust.name, 60) + " (ID " + clip(cust.id, 20) + ")";
    }
    let done = 0, err = ""; const soldNames = [];
    for (const id of ids) {
      const wasStock = byId.get(id)?.status === "stock", r = R().wsAdvance(id, by, wasStock ? who : undefined);
      if (r.ok && !r.already) { done++; if (wasStock) { const p = byId.get(id); soldNames.push((p.code || "") + (p.model ? "-" + p.model : "")); } } else if (!r.ok && !err) err = r.error || "Could not advance.";
    }
    if (cust && soldNames.length && typeof ctx.onSold === "function") { try { await ctx.onSold(cust.id, soldNames.join(", "), by); } catch (e) { console.warn("Products: customer info not updated:", e.message); } }
    const word = { workshop: "now in Stock", stock: "marked Sold Out" + (cust ? " to " + clip(cust.name, 60) : ""), sold: "restocked (back In Stock)" }[String(req.body?.from || "")] || "advanced";
    res.json({ ...productsView(), ok: done > 0, error: done ? "" : err, warning: done && err ? "Done for " + done + ", but: " + err : "", message: done ? `✅ ${done} product${done === 1 ? "" : "s"} ${word}.` : undefined });
  });
  // v189: 🗑 delete products from the Products page (main admin only)
  app.post("/api/products/delete", requireAccess, express.json({ limit: "1mb" }), async (req, res) => {
    if (!isOwnerA(req.actor)) return res.json({ ...productsView(), ok: false, error: "Only the main admin can delete a product." });
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id]).map(x => String(x || "")).filter(Boolean).slice(0, 200);
    if (!ids.length) return res.json({ ...productsView(), ok: false, error: "Choose at least one product." });
    let n = 0, err = "";
    for (const id of ids) { const r = await R().wsOp("/product/delete", { id }, req.actor); if (r.ok) { n++; delete db.jobs[id]; delete db.psent[id]; } else if (!err) err = r.error || "Could not delete."; }
    persist();
    res.json({ ...productsView(), ok: n > 0, error: n ? "" : err, warning: n && err ? "Deleted " + n + ", but: " + err : "", message: n ? `🗑 ${n} product${n === 1 ? "" : "s"} deleted.` : undefined });
  });
  // v189: the customer list for "Sold → choose the customer"
  app.get("/api/products/customers", requireAccess, (req, res) => {
    if (!hasPerm(req.actor, "products")) return res.status(403).json({ ok: false, error: "The main admin has not given you the Products section." });
    const q = clip(req.query.q, 60).toLowerCase();
    const list = customers().filter(c => !q || [c.id, c.name, c.phone, c.username, c.location].join(" ").toLowerCase().includes(q)).slice().sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0)).slice(0, 40);
    res.json({ ok: true, customers: list.map(c => ({ id: clip(c.id, 20), name: clip(c.name, 60), phone: clip(c.phone, 30), location: clip(c.location, 80), username: clip(c.username, 40), status: clip(c.customerStatus, 30) })) });
  });

  // Home → Stock view: every in-stock product with all its info (any assigned admin may look)
  app.get("/api/stock", requireAccess, (req, res) => {
    const items = stockList().filter(p => p.status === "stock");
    res.json({ ok: true, now: nowEth(), total: items.length, items });
  });

  app.use("/api/workshop", router);
  // v191 START FROM ZERO / backup: the saved models, the sent list and the production jobs. The admins' Telegram groups stay connected.
  const zeroSnapshot = () => JSON.parse(JSON.stringify({ catalog: db.catalog, sent: db.sent, psent: db.psent, jobs: db.jobs, batches: db.batches }));
  async function zeroWipe() { const n = { models: db.catalog.length, sent: db.sent.length }; db.catalog = []; db.sent = []; db.psent = {}; db.jobs = {}; db.batches = {}; await persist(); return n; }
  async function zeroRestore(snap) { if (!snap || typeof snap !== "object") return false; db.catalog = Array.isArray(snap.catalog) ? snap.catalog : []; db.sent = Array.isArray(snap.sent) ? snap.sent : []; db.psent = snap.psent && typeof snap.psent === "object" ? snap.psent : {}; db.jobs = snap.jobs && typeof snap.jobs === "object" ? snap.jobs : {}; db.batches = snap.batches && typeof snap.batches === "object" ? snap.batches : {}; await persist(); return true; }
  return { load, handleCallback, zeroSnapshot, zeroWipe, zeroRestore };
}
module.exports = { register };
