// ── REPORTS (module + page: /reports.html) — MAIN ADMINS ONLY ─────────────────────────────────
// v119: the MINI APP is the main source. Workflow · Stock · Material are kept inside the app
// (file data/reports-data.json + Supabase app_settings.reports_data). The Google Sheet is only a BACKUP:
// after every change the app sends a full snapshot to the sheet (tabs "Backup …"). Nothing is ever read back from the sheet.
//
//  • Workflow: add a product with a PRODUCT CODE → "Finished" sends it to IN STOCK → "Sold" records the sale
//    with the ETHIOPIAN date + time (Addis Ababa clock).
//  • Material: add a new material, ➕ add more, ✂️ cut (use) — every movement is logged with Ethiopian date + time.
//  • Backup: one tab per section per ETHIOPIAN MONTH (Workflow · Stock · Material); a new month creates its tabs by itself. reports-sheet-script.gs (script version reports-5) is pasted in the reports Google Sheet; the /exec link is saved
//    (file + Supabase) or set in Render as REPORTS_SCRIPT_URL. The old order sheet is never touched.
// v121: products have a HANDLE TYPE and an uploaded PHOTO (stored as small JPEG files + Supabase app_settings rows "rphoto_<id>"); the app's Stock view groups in-stock products by model + handle.
// Access: main admins, plus any assigned admin the main admin gave the "Reports" section (Manage Admins). View-only admins are refused on writes by requireAccess.
// Connecting the backup sheet, disconnecting it and "Start from ZERO" stay main-admin only.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const express = require("express");

const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const num = v => { const n = Number(String(v == null ? "" : v).replace(/,/g, "").trim()); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN; };
const uid = () => crypto.randomBytes(6).toString("hex");

function register(app, ctx) {
  const { requireAccess, supabase, baseDir, tgApi, helpers, log } = ctx;
  let workshopDeleteProducts = null;
  // safe even when an older server.js does not pass hasPerm: main admin / open mode = yes, otherwise the admin must have the section in his list
  const hasPerm = typeof ctx.hasPerm === "function" ? ctx.hasPerm : (actor, key) => actor?.role === "owner" || actor?.role === "open" || (actor?.perms || []).includes(key);
  const ownerIdsLive = () => (ctx.ownerIds || []).map(String);
  const appAdminsLive = () => (ctx.getAppAdmins ? ctx.getAppAdmins() : []) || [];
  const audit = (event, detail, actor) => { try { log && log(event, detail, actor?.name || "Main admin"); } catch {} };
  const CFG_FILE = path.join(baseDir, "reports-sheet.json");   // backup link (same file as v118, so the link survives the update)
  const DATA_FILE = path.join(baseDir, "reports-data.json");   // the real data
  let cfg = { scriptUrl: String(process.env.REPORTS_SCRIPT_URL || "").trim(), scriptKey: String(process.env.REPORTS_SCRIPT_KEY || "").trim(), sheetName: "", sheetUrl: "", backup: { at: "", d: "", t: "", ok: null, error: "", count: 0 } };
  const TG0 = { on: false, time: "08:00", sendAs: "", to: null, dm: true, targets: [], senders: [], channels: [], lastBy: "", lastDate: "", lastAt: "", ok: null, error: "", results: [] };
  let db = { products: [], materials: [], log: [], matGroups: [], matLayout: 0, savedAt: "", tg: { ...TG0 } };

  // ── Ethiopian date + time (Addis Ababa clock) ───────────────────────────────────────────────
  const nowEth = () => {
    const g = new Date().toLocaleString("sv-SE", { timeZone: helpers.TZ || "Africa/Addis_Ababa" }); // 2026-11-22 14:05:09
    return { d: helpers.ethDate(g.slice(0, 10)), t: g.slice(11, 16) };
  };
  // Ethiopian clock: the day starts at sunrise (06:00 Addis = 12:00 ቀን). 13:15 → 7:15 ቀን · 21:00 → 3:00 ሌሊት
  const ethClock = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); if (!m) return String(t || ""); const h = +m[1]; return (((h + 6) % 12) || 12) + ":" + m[2] + " " + (h >= 6 && h < 18 ? "ቀን" : "ሌሊት"); };
  const who = req => clip(req.actor?.name || "Main admin", 60);

  // ── storage (file + Supabase, restored on every start) ──────────────────────────────────────
  let chain = Promise.resolve();
  const persist = () => (chain = chain.then(async () => {
    db.savedAt = new Date().toISOString();
    try { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch {}
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "reports_data", value: db, updated_at: new Date().toISOString() }); } catch {} }
  }).catch(() => {}));
  async function saveCfg() {
    try { fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(cfg)); } catch {}
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "reports_sheet", value: cfg, updated_at: new Date().toISOString() }); } catch {} }
  }
  async function load() {
    let d = null, c = null;
    if (supabase) {
      try { const { data } = await supabase.from("app_settings").select("value").eq("key", "reports_data").maybeSingle(); if (data?.value && typeof data.value === "object") d = data.value; } catch {}
      try { const { data } = await supabase.from("app_settings").select("value").eq("key", "reports_sheet").maybeSingle(); if (data?.value && typeof data.value === "object") c = data.value; } catch {}
    }
    if (!d) { try { d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch {} }
    if (!c) { try { c = JSON.parse(fs.readFileSync(CFG_FILE, "utf8")); } catch {} }
    if (d && typeof d === "object") db = { products: [], materials: [], log: [], savedAt: "", ...d };
    db.tg = { ...TG0, ...(db.tg || {}) };
    if (!Array.isArray(db.tg.targets)) db.tg.targets = [];
    if (Array.isArray(db.tg.channels) && db.tg.channels.length) { for (const u of db.tg.channels) if (!db.tg.targets.some(x => x.chat === u)) db.tg.targets.push({ chat: u, title: "@" + u, topic: 0, topicTitle: "" }); db.tg.channels = []; }
    db.tg.dm = db.tg.dm !== false;
    if (!Array.isArray(db.tg.senders)) db.tg.senders = [];
    if (!db.tg.senders.length && db.tg.sendAs) db.tg.senders = [{ id: String(db.tg.sendAs), time: db.tg.time || "08:00", lastDate: db.tg.lastDate || "" }];
    for (const p of db.products) { if (!p.desc && !p.model && p.name) p.desc = p.name; p.orderType = p.orderType || "READYMADE"; p.priority = p.priority || "LOW"; p.category = p.category || "OTHERS"; p.handle = p.handle || ""; p.photo = p.photo || ""; p.capacity = p.capacity || ""; if (p.orderType === "CUSTOM") p.orderType = "ORDER"; }
    for (const m of db.materials) { m.type = m.type || ""; m.group = m.group || "MATERIAL"; }
    layoutMaterials();
    if (c && typeof c === "object") cfg = { ...cfg, scriptUrl: c.scriptUrl || cfg.scriptUrl, scriptKey: c.scriptKey || cfg.scriptKey, sheetName: c.sheetName || "", sheetUrl: c.sheetUrl || "", backup: { ...cfg.backup, ...(c.backup || {}) } };
    if (process.env.REPORTS_SCRIPT_URL) { cfg.scriptUrl = String(process.env.REPORTS_SCRIPT_URL).trim(); if (process.env.REPORTS_SCRIPT_KEY) cfg.scriptKey = String(process.env.REPORTS_SCRIPT_KEY).trim(); }
    if (cfg.scriptUrl) scheduleBackup(8000);
    try { console.log("[reports] module build v149 loaded"); } catch {}
    const tg = setInterval(() => { tgTick().catch(() => {}); }, 60 * 1000); if (tg.unref) tg.unref();
    setTimeout(() => { tgTick().catch(() => {}); }, 20000); // a restart / redeploy refreshes the backup once
    // New Ethiopian month → the backup runs by itself so the next month's Workflow / Stock / Material tabs appear (checked every 20 minutes)
    // New Ethiopian day → S.TODAY turns into SOLD in the sheet (checked every 5 minutes); a new month also creates its tabs.
    const t = setInterval(() => { if (cfg.scriptUrl && cfg.backup.d !== nowEth().d) backupNow().catch(() => {}); }, 5 * 60 * 1000);
    if (t.unref) t.unref();
  }

  // ── Google Sheet BACKUP (one-way: app → sheet) ──────────────────────────────────────────────
  function scriptUrl(raw = cfg.scriptUrl) {
    let url = String(raw || "").replace(/["'`\s]/g, "");
    const found = url.match(/https:\/\/script\.google(?:usercontent)?\.com\/[^\s]*/i);
    if (found) url = found[0];
    else if (/^[A-Za-z0-9_-]{20,}$/.test(url)) url = `https://script.google.com/macros/s/${url}/exec`;
    if (!/^https:\/\/script\.google(usercontent)?\.com\//i.test(url)) throw new Error("That is not a Google Web app link. In Apps Script press Deploy → Manage deployments and copy the Web app URL (it ends with /exec).");
    if (/\/dev(\?|$)/.test(url)) throw new Error("That link ends with /dev (test link). Use the Web app URL that ends with /exec.");
    return url;
  }
  async function callScript(payload, { url, key } = {}) {
    const start = scriptUrl(url);
    let at = start;
    let r = await fetch(at, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...payload, key: key != null ? key : (cfg.scriptKey || "") }), redirect: "manual", signal: AbortSignal.timeout(120000) });
    for (let hop = 0; hop < 5 && r.status >= 300 && r.status < 400 && r.headers.get("location"); hop++) { at = new URL(r.headers.get("location"), at).href; r = await fetch(at, { redirect: "manual", signal: AbortSignal.timeout(120000) }); }
    const t = await r.text();
    let d;
    try { d = JSON.parse(t); } catch {
      const low = t.toLowerCase();
      if (low.includes("accounts.google.com") || low.includes("sign in") || r.status === 401 || r.status === 403) throw new Error("Google is asking visitors to sign in. Deploy the script again: Deploy → New deployment → Web app → Who has access: Anyone.");
      if (r.status === 404 || low.includes("page not found")) throw new Error("The Web app link was not found. Copy it again from Deploy → Manage deployments (it must end with /exec).");
      throw new Error(`The Google script did not answer correctly (HTTP ${r.status}). Paste the newest reports-sheet-script.gs, save, and deploy a New version.`);
    }
    if (!d.ok) throw new Error(/Unknown action/i.test(String(d.error || "")) ? "The Google script is the OLD version. Paste the new reports-sheet-script.gs in the reports sheet and deploy a New version." : String(d.error || "The Google script refused the request."));
    return d;
  }
  const snapshot = () => ({ products: db.products, materials: orderedMaterials(), matGroups: groupsOrdered(), log: db.log.slice(0, 3000), app: "AMBAR Furniture mini app", now: nowEth() });
  let backing = false, again = false, timer = null;
  async function backupNow() {
    if (!cfg.scriptUrl) return { ok: false, error: "The backup sheet is not connected yet." };
    if (backing) { again = true; return { ok: true, queued: true }; }
    backing = true;
    try {
      const d = await callScript({ action: "backup", data: snapshot() });
      const n = nowEth();
      cfg.backup = { at: new Date().toISOString(), d: n.d, t: n.t, ok: true, error: "", count: d.rows || 0, month: n.d.slice(0, 7) };
      if (d.url) cfg.sheetUrl = d.url;
      if (d.name) cfg.sheetName = d.name;
      await saveCfg();
      return { ok: true };
    } catch (e) {
      cfg.backup = { ...cfg.backup, ok: false, error: e.message };
      await saveCfg();
      return { ok: false, error: e.message };
    } finally { backing = false; if (again) { again = false; scheduleBackup(2000); } }
  }
  function scheduleBackup(ms = 4000) {
    if (!cfg.scriptUrl) return;
    clearTimeout(timer); timer = setTimeout(() => { backupNow().catch(() => {}); }, ms);
  }

  // ── helpers on the data ─────────────────────────────────────────────────────────────────────
  const stamp = req => ({ ...nowEth(), by: who(req) });
  const hist = (p, ev, req, extra = {}) => { p.history = (p.history || []).concat({ ev, ...stamp(req), ...extra }).slice(-60); };
  const findP = id => db.products.find(p => p.id === String(id || ""));
  const findM = id => db.materials.find(m => m.id === String(id || ""));
  const codeTaken = (code, exceptId) => db.products.some(p => p.id !== exceptId && p.code.toLowerCase() === code.toLowerCase());
  const nextCode = () => {
    let max = 0; for (const p of db.products) { const m = /^P-(\d+)$/i.exec(p.code); if (m) max = Math.max(max, +m[1]); }
    return "P-" + String(max + 1).padStart(4, "0");
  };
  const addLog = (req, m, type, qty, balance, note) => {
    db.log.unshift({ id: uid(), matId: m.id, material: m.name, mtype: m.type || "", group: m.group || "MATERIAL", unit: m.unit, type, qty, balance, note: clip(note, 200), ...stamp(req) });
    if (db.log.length > 6000) db.log.length = 6000;
  };
  const fail = (res, error) => res.json({ ok: false, error });
  const backupInfo = () => ({ configured: !!cfg.scriptUrl, sheetName: cfg.sheetName || "", sheetUrl: cfg.sheetUrl || "", at: cfg.backup.at || "", d: cfg.backup.d || "", t: cfg.backup.t || "", ok: cfg.backup.ok, error: cfg.backup.error || "", count: cfg.backup.count || 0 });
  const salesNames = () => [...new Set([...appAdminsLive().map(a => a.name), ...db.products.map(p => p.salesName), ...db.products.map(p => p.sold && p.sold.by)].map(x => clip(x, 80)).filter(Boolean))].sort();
  const view = () => ({ appBuild: "v154", tg: tgInfo(), sales: salesNames(), handles: [...new Set(db.products.map(p => p.handle).filter(Boolean))].sort(), cats: ["SHOE SHELF", "OTHERS", "GADGETS"], products: db.products, materials: orderedMaterials(), matGroups: groupsOrdered(), log: db.log.slice(0, 400), backup: backupInfo(), now: nowEth(), nextCode: nextCode() });
  const done = (res, message) => { persist(); scheduleBackup(); res.json({ ok: true, message, ...view() }); };

  // ── product photos (small JPEGs made in the phone; file + Supabase copy, served at /api/reports-photo/<id>.jpg) ──
  const PHOTO_DIR = path.join(baseDir, "report-photos");
  const photoFile = id => path.join(PHOTO_DIR, id + ".jpg");
  async function savePhoto(dataUrl) {
    const m = /^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
    if (!m) throw new Error("The photo could not be read. Choose it again.");
    const buf = Buffer.from(m[1], "base64");
    if (buf.length < 200) throw new Error("The photo is empty. Choose it again.");
    if (buf.length > 1.5 * 1024 * 1024) throw new Error("The photo is too big (max 1.5 MB after shrinking).");
    const id = crypto.randomBytes(12).toString("hex");
    try { fs.mkdirSync(PHOTO_DIR, { recursive: true }); fs.writeFileSync(photoFile(id), buf); } catch {}
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "rphoto_" + id, value: { b64: m[1] }, updated_at: new Date().toISOString() }); } catch {} }
    return id;
  }
  async function dropPhoto(id) {
    if (!id || db.products.some(p => p.photo === id)) return;
    try { fs.unlinkSync(photoFile(id)); } catch {}
    if (supabase) { try { await supabase.from("app_settings").delete().eq("key", "rphoto_" + id); } catch {} }
  }
  app.get("/api/reports-photo/:id.jpg", async (req, res) => {
    const id = String(req.params.id || "");
    if (!/^[a-f0-9]{24}$/.test(id)) return res.status(404).end();
    const buf = await photoBuf(id);
    if (!buf) return res.status(404).end();
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" });
    res.end(buf);
  });


  // ── DAILY STOCK → TELEGRAM (every day, to every admin, sent FROM the main admin's own Telegram account — not the bot, not the mini app) ──
  async function photoBuf(id) {
    if (!/^[a-f0-9]{24}$/.test(String(id || ""))) return null;
    try { return fs.readFileSync(photoFile(id)); } catch {}
    if (supabase) { try { const { data } = await supabase.from("app_settings").select("value").eq("key", "rphoto_" + id).maybeSingle(); if (data?.value?.b64) return Buffer.from(data.value.b64, "base64"); } catch {} }
    return null;
  }
  const normK = v => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
  function stockGroups(L) {
    const m = new Map();
    for (const p of L) { const k = normK(p.model || p.desc || p.code) + "|" + normK(p.handle) + "|" + normK(p.desc); let g = m.get(k); if (!g) { g = { key: k, model: p.model || p.desc || p.code, handle: p.handle || "", desc: p.desc || "", items: [] }; m.set(k, g); } g.items.push(p); }
    return [...m.values()].map(g => { g.photo = (g.items.find(p => p.photo) || {}).photo || ""; return g; }).sort((a, b) => a.model.localeCompare(b.model, undefined, { numeric: true }) || a.handle.localeCompare(b.handle) || a.desc.localeCompare(b.desc, undefined, { numeric: true }));
  }
  const uniq = a => [...new Set(a.map(x => clip(x, 80)).filter(Boolean))];
  function groupCaption(g) {
    const sizes = uniq(g.items.map(p => p.desc)), caps = uniq(g.items.map(p => p.capacity));
    const pt = uniq(g.items.map(p => p.ptype)).join(" / ");
    const L = [`🛋 ${pt ? pt + " · " : ""}${g.model}  ×${g.items.length}`];
    if (sizes.length) L.push("📏 Size: " + sizes.join(" / "));
    if (caps.length) L.push("👟 Shoe capacity: " + caps.join(" / "));
    L.push("🔧 Handle: " + (g.handle || "—"));
    L.push("🏷 " + g.items.map(p => p.code).join(", "));
    return L.join("\n").slice(0, 1000);
  }
  const todayAddis = () => new Date().toLocaleString("sv-SE", { timeZone: helpers.TZ || "Africa/Addis_Ababa" }).slice(0, 10);
  const timeAddis = () => new Date().toLocaleString("sv-SE", { timeZone: helpers.TZ || "Africa/Addis_Ababa" }).slice(11, 16);
  const isOwnerId = id => ownerIdsLive().includes(String(id));
  // the Telegram account that belongs to this person (a main admin, an assigned main admin or an assigned admin) — never someone else's
  const accFor = id => id && typeof ctx.accountFor === "function" ? ctx.accountFor({ role: isOwnerId(id) ? "owner" : "admin", telegramId: String(id) }) : null;
  const senderAcc = () => accFor(db.tg.sendAs);
  const nameOfAdmin = id => { const a = appAdminsLive().find(x => String(x.telegramId) === String(id)); return clip(a?.name, 60) || (ownerIdsLive().includes(String(id)) ? "Main admin" : "Admin " + id); };
  function recipients() {
    const ids = [...new Set([...ownerIdsLive(), ...appAdminsLive().map(a => String(a.telegramId))].filter(x => /^\d+$/.test(x)))];
    const sel = Array.isArray(db.tg.to) && db.tg.to.length ? db.tg.to.map(String) : null; // null = every admin; otherwise only the admins the main admin picked
    return ids.filter(id => id !== String(db.tg.sendAs) && (!sel || sel.includes(id))).map(id => ({ id, name: nameOfAdmin(id) }));
  }
  function candidates() {
    const ids = [...new Set([...ownerIdsLive(), ...appAdminsLive().map(a => String(a.telegramId))].filter(x => /^\d+$/.test(x)))];
    return ids.map(id => ({ id, name: nameOfAdmin(id) }));
  }
  // main admins whose OWN Telegram account is connected: the stock can be sent from any of them
  const senders = () => [...new Set([...ownerIdsLive(), ...appAdminsLive().map(a => String(a.telegramId))].filter(x => /^\d+$/.test(String(x))))].map(id => ({ id: String(id), name: nameOfAdmin(id), ready: !!accFor(id)?.ready }));
  const setSender = (req, wanted) => { // returns an error text or ""
    const id = String(wanted || "");
    if (!id) return "";
    if (!senders().some(x => x.id === id)) return "That sender is not an admin of this app.";
    if (!accFor(id)?.ready) return nameOfAdmin(id) + "'s Telegram account is not connected. Connect it first (Settings → Connect my Telegram account).";
    db.tg.sendAs = id; return "";
  };
  // group / channel targets: a public @username, a private group id (-100…), or a link — plus an optional forum TOPIC inside it
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
  const cleanTargets = v => {
    const arr = Array.isArray(v) ? v : String(v || "").split(/[\s,;\n]+/), out = [];
    for (const x of arr) {
      let o = null;
      if (x && typeof x === "object") { const pl = parseTgLink(x.chat); if (pl) o = { chat: pl.chat, title: clip(x.title, 80), topic: Number.isInteger(Number(x.topic)) && Number(x.topic) > 0 ? Number(x.topic) : pl.topic, topicTitle: clip(x.topicTitle, 80) }; }
      else { const pl = parseTgLink(x); if (pl) o = { chat: pl.chat, title: /^\d/.test(pl.chat) || pl.chat[0] === "-" ? "" : "@" + pl.chat, topic: pl.topic, topicTitle: "" }; }
      if (o && !out.some(y => y.chat.toLowerCase() === o.chat.toLowerCase() && y.topic === o.topic)) out.push(o);
    }
    return out.slice(0, 20);
  };
  const targetName = g => (g.title || (/^-/.test(g.chat) ? "Group " + g.chat : "@" + g.chat)) + (g.topic ? " › " + (g.topicTitle || "topic " + g.topic) : "");
  async function resolveTarget(acc, g) {
    const key = /^-?\d+$/.test(g.chat) ? BigInt(g.chat) : "@" + g.chat;
    try { return await acc.client.getEntity(key); }
    catch (e) { if (typeof key === "bigint") { await acc.client.getDialogs({ limit: 500 }); return await acc.client.getEntity(key); } throw e; }
  }
  const cleanTo = v => Array.isArray(v) ? [...new Set(v.map(String).filter(x => /^\d+$/.test(x)))].slice(0, 100) : null;
  function tgInfo() {
    const t = db.tg, acc = senderAcc();
    return { on: !!t.on, time: t.time, sendAs: t.sendAs || "", sendAsName: t.sendAs ? nameOfAdmin(t.sendAs) : "", senderReady: !!acc?.ready, lastDate: t.lastDate || "", lastAt: t.lastAt || "", ok: t.ok, error: t.error || "", results: t.results || [], recipients: t.dm === false ? [] : recipients().map(r => r.name), candidates: candidates(), senders: senders(), to: Array.isArray(t.to) ? t.to : [], assigned: (t.senders || []).map(e => ({ id: e.id, name: nameOfAdmin(e.id), time: e.time, ready: !!accFor(e.id)?.ready, lastDate: e.lastDate || "", lastAt: e.lastAt || "", ok: e.ok === undefined ? null : e.ok, error: e.error || "" })), dm: t.dm !== false, targets: (t.targets || []).map(g => ({ ...g, name: targetName(g) })), lastBy: t.lastBy || "" };
  }
  const tgFriendly = e => { const m = String(e?.errorMessage || e?.message || e || ""); if (/FLOOD_WAIT|PEER_FLOOD/i.test(m)) return "Telegram asked to slow down. Try again in a few minutes."; if (/USERNAME_NOT_OCCUPIED|USERNAME_INVALID/i.test(m)) return "No Telegram group or channel with this username exists. Check the spelling."; if (/CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED|USER_BANNED_IN_CHANNEL|CHANNEL_PRIVATE|CHAT_SEND_PHOTOS_FORBIDDEN|CHAT_SEND_MEDIA_FORBIDDEN/i.test(m)) return "This Telegram account is not allowed to post there. Join the group/channel with this account (as admin for a channel) and try again."; if (/PEER_ID_INVALID|Cannot find any entity|not found/i.test(m)) return "The sender's Telegram account has no chat with this admin yet. Open a chat with them once from that account, then press Send now."; if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(m)) return "The sender's Telegram login expired. Connect it again."; return m.slice(0, 200) || "Could not send."; };
  let tgBusy = false;
  async function sendDaily(opt = {}) { // opt.by = { id, name, acc } → sent from THAT person's own Telegram account; opt.to / opt.targets / opt.dm override the saved choice for this send only
    if (tgBusy) return { ok: false, error: "A send is already running." };
    tgBusy = true;
    const t = db.tg;
    try {
      let acc, senderId, senderName;
      if (opt.by) { acc = opt.by.acc; senderId = String(opt.by.id || ""); senderName = opt.by.name || nameOfAdmin(senderId); if (!acc?.ready) throw new Error("Your own Telegram account is not connected. Connect it in Settings → Connect my Telegram account, then press Send now again."); }
      else {
        acc = senderAcc();
        if (!t.sendAs || !acc?.ready) { // the chosen sender is not connected: use any admin whose own Telegram account is connected
          const alt = senders().find(x => x.ready);
          if (alt) { t.sendAs = alt.id; acc = senderAcc(); persist(); }
        }
        if (!t.sendAs || !acc?.ready) throw new Error("The sender's Telegram account is not connected. Connect it in Settings → Connect my Telegram account, then switch Daily Telegram on again.");
        senderId = String(t.sendAs); senderName = nameOfAdmin(senderId);
      }
      const selTo = Array.isArray(opt.to) ? (opt.to.length ? opt.to.map(String) : null) : (Array.isArray(t.to) && t.to.length ? t.to.map(String) : null);
      const allIds = [...new Set([...ownerIdsLive(), ...appAdminsLive().map(a => String(a.telegramId))].filter(x => /^\d+$/.test(x)))];
      const dm = opt.dm !== undefined ? !!opt.dm : t.dm !== false;
      const to = dm ? allIds.filter(id => id !== senderId && (!selTo || selTo.includes(id))).map(id => ({ id, name: nameOfAdmin(id) })) : [];
      const chans = (Array.isArray(opt.targets) ? cleanTargets(opt.targets) : (t.targets || [])).map(g => ({ id: null, tg: g, name: targetName(g) }));
      if (!to.length && !chans.length) throw new Error(dm ? "There is no other admin to send to. Add a Telegram group (and topic) below, or add admins." : "Add a Telegram group (and topic) to send to, or switch on sending to admins.");
      const stock = db.products.filter(p => p.status === "stock" && !/CUS|ORD/i.test(String(p.orderType || ""))), groups = stockGroups(stock).slice(0, 60), n = nowEth();
      const head = `📦 AMBAR STOCK — ${n.d}\n${stock.length} readymade product${stock.length === 1 ? "" : "s"} in stock · ${groups.length} model${groups.length === 1 ? "" : "s"}` + (stock.length ? "" : "\nNothing is in stock today.");
      const photos = new Map();
      for (const g of groups) if (g.photo) { const b = await photoBuf(g.photo); if (b) photos.set(g.key, b); }
      const results = [];
      for (const r of [...to, ...chans]) {
        try {
          let entity;
          const reply = r.tg && r.tg.topic ? { replyTo: r.tg.topic } : {};
          if (r.tg) entity = await resolveTarget(acc, r.tg);
          else { try { entity = await acc.client.getEntity(BigInt(r.id)); } catch { entity = await acc.client.getInputEntity(BigInt(r.id)); } }
          await acc.client.sendMessage(entity, { message: head, ...reply });
          for (const g of groups) {
            await new Promise(x => setTimeout(x, 800));
            const buf = photos.get(g.key);
            if (buf) {
              const f = path.join(os.tmpdir(), "stk-" + uid() + ".jpg");
              fs.writeFileSync(f, buf);
              try { await acc.client.sendFile(entity, { file: f, caption: groupCaption(g), forceDocument: false, ...reply }); } finally { try { fs.unlinkSync(f); } catch {} }
            } else await acc.client.sendMessage(entity, { message: groupCaption(g), ...reply });
          }
          results.push({ name: r.name, ok: true, count: groups.length });
        } catch (e) { results.push({ name: r.name, ok: false, error: tgFriendly(e) }); }
      }
      const okN = results.filter(x => x.ok).length;
      Object.assign(t, { lastDate: todayAddis(), lastAt: n.d + " " + n.t, lastBy: senderName, results, ok: okN > 0, error: okN ? (okN < results.length ? "Some admins / groups could not be reached." : "") : (results[0]?.error || "Nobody could be reached.") });
      persist();
      return { ok: okN > 0, results, error: t.error };
    } catch (e) {
      Object.assign(t, { lastDate: todayAddis(), lastAt: nowEth().d + " " + nowEth().t, ok: false, error: e.message, results: [] });
      persist();
      return { ok: false, error: e.message };
    } finally { tgBusy = false; }
  }
  // every assigned sender account sends the stock once a day at ITS OWN assigned time, from its own Telegram account
  async function tgTick() {
    const t = db.tg;
    if (!t.on || tgBusy) return;
    const today = todayAddis(), now = timeAddis();
    for (const e of t.senders || []) {
      if (tgBusy || e.lastDate === today || now < (e.time || "08:00")) continue;
      const acc = accFor(e.id);
      e.lastDate = today;
      if (!acc?.ready) { Object.assign(e, { ok: false, error: nameOfAdmin(e.id) + "'s Telegram account is not connected.", lastAt: nowEth().d + " " + nowEth().t }); persist(); continue; }
      const r = await sendDaily({ by: { id: e.id, name: nameOfAdmin(e.id), acc } });
      Object.assign(e, { ok: !!r.ok, error: r.ok ? (r.error || "") : (r.error || "Could not send."), lastAt: nowEth().d + " " + nowEth().t });
      persist();
    }
  }


  // ── MATERIAL LAYOUT: two tables like the reference sheet, and the order can be changed by hold + drag ──
  const MAT_G1 = "OAK & NORMAL MDF", MAT_G2 = "LAMINATE, PLYWOOD & OTHERS";
  const MAT_REF = [ // [table, material, type, unit] — the arrangement of the reference Material Report
    [MAT_G1, "OAK", "6", "244-122"], [MAT_G1, "OAK", "18", "244-122"],
    [MAT_G1, "NORMAL MDF", "6", "244-122"], [MAT_G1, "NORMAL MDF", "10", "244-122"], [MAT_G1, "NORMAL MDF", "12", "244-122"], [MAT_G1, "NORMAL MDF", "18", "244-122"],
    [MAT_G2, "LAMINATE", "18 GRAY", "244-122"], [MAT_G2, "LAMINATE", "18 RED/WOOD", "244-122"],
    [MAT_G2, "plywood/suf", "6", "244-122"], [MAT_G2, "plywood/suf", "8", "244-122"], [MAT_G2, "plywood/suf", "12", "244-122"],
    [MAT_G2, "chipped", "12", "244-122"], [MAT_G2, "LAMINATE", "6 white", "244-122"],
    [MAT_G2, "LAMINATE WHITE/cream", "18", "244-122"], [MAT_G2, "LAMINATE WHITE", "18", "244-123"],
    [MAT_G2, "AUSTRALIA", "4 BY 5", "4 BY 5"], [MAT_G2, "AUSTRALIA", "7 BY 5", "7 BY 5"],
    [MAT_G2, "MORALE", "4 BY 5", "4 BY 5"], [MAT_G2, "MORALE", "7 BY 5", "7 BY 5"],
    [MAT_G2, "uv", "black 18", "244-122"]
  ];
  // The tables in display order (saved order first, then any other table found on a material).
  function groupsOrdered() {
    const out = [];
    for (const g of (db.matGroups || [])) if (g && !out.includes(g)) out.push(g);
    for (const m of db.materials) { const g = m.group || "MATERIAL"; if (!out.includes(g)) out.push(g); }
    return out;
  }
  // Materials as shown: table by table, inside a table in the saved (dragged) order.
  function orderedMaterials() {
    const gs = groupsOrdered();
    return db.materials.map((m, i) => ({ m, i, g: gs.indexOf(m.group || "MATERIAL") })).sort((a, b) => a.g - b.g || a.i - b.i).map(o => o.m);
  }
  // Runs once (and again after "Start from 0"): puts the reference materials on top in the two tables; every other material stays, after them.
  function layoutMaterials() {
    if (db.matLayout === 2) return;
    const key = (n, t) => (clip(n, 100) + "|" + clip(t, 30)).toLowerCase(), have = new Map();
    for (const m of db.materials) have.set(key(m.name, m.type), m);
    const first = [], n = nowEth();
    for (const [g, name, type, unit] of MAT_REF) {
      let m = have.get(key(name, type));
      if (!m) { m = { id: uid(), name, type, unit, group: g, qty: 0, min: 0, created: { ...n, by: "Reference layout" } }; db.materials.push(m); }
      m.group = g; first.push(m);
    }
    const rest = db.materials.filter(m => !first.includes(m));
    for (const m of rest) if (!m.group || m.group === "MATERIAL") m.group = MAT_G2;
    db.materials = [...first, ...rest];
    db.matGroups = [MAT_G1, MAT_G2];
    db.matLayout = 2;
    persist();
  }

  // ── routes ─────────────────────────────────────────────────────────────────────────────────
  const router = express.Router();
  router.use(requireAccess);
  router.use((req, res, next) => hasPerm(req.actor, "reports") ? next() : res.status(403).json({ ok: false, error: "Reports are only for admins the main admin gave the Reports section." }));
  const ownerOnly = (req, res, next) => req.actor?.role === "owner" ? next() : res.status(403).json({ ok: false, error: "Only a main admin can do this." });
  router.use(express.json({ limit: "200kb" }));

  router.get("/state", (req, res) => res.json({ ok: true, ...view() }));

  // WORKFLOW → STOCK → SOLD  (same columns as the Google Sheet: Prod Id · Model · Description · Order Type · Priority · Start Date · Status · Finished · Delivery · Sales Name · Location · Changes · Correction)
  const CATS = ["SHOE SHELF", "OTHERS", "GADGETS"];
  const lab = p => [p.ptype, p.model, p.desc].filter(Boolean).join(" ") || p.code;
  const up = (v, n) => clip(v, n).toUpperCase();
  const orderTypeOf = v => /CUS|ORD/i.test(String(v || "")) ? "ORDER" : "READYMADE"; // READYMADE or ORDER
  const priorityOf2 = v => { const x = String(v || "").toUpperCase(); return x.startsWith("H") ? "HIGH" : x.startsWith("M") ? "MEDIUM" : "LOW"; };
  const dateOk = v => !v || /^\d{4}\/\d{2}\/\d{2}$/.test(v);
  const timeOk = v => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v || ""));
  const hhmm = v => { const m = /^(\d{1,2}):(\d{2})/.exec(String(v || "")); return m ? String(m[1]).padStart(2, "0") + ":" + m[2] : ""; };
  const soldTypeIn = v => { const x = String(v || "").toUpperCase().replace(/\s/g, ""); return x === "S.TODAY" || x === "STODAY" || x === "TODAY" ? "S.TODAY" : x === "SOLD" ? "SOLD" : ""; }; // "" = automatic
  function readProduct(b) {
    const ptype = clip(String(b.ptype || "").toLowerCase() === "other" ? b.ptypeOther : b.ptype, 40);
    return { ptype, code: clip(b.code, 30), sno: clip(b.sno, 20), model: up(b.model, 40), desc: clip(b.desc, 160), orderType: orderTypeOf(b.orderType), priority: priorityOf2(b.priority),
      category: up(b.category, 30) || "OTHERS", handle: clip(b.handle, 60), capacity: clip(b.capacity, 40), salesName: clip(b.salesName, 80), location: clip(b.location, 80), deliveryDate: clip(b.deliveryDate, 10), changes: clip(b.changes, 200), note: clip(b.note, 300) };
  }
  const readErr = f => (!f.model && !f.desc && !f.ptype) ? "Write the model or the description." : !dateOk(f.deliveryDate) ? "The delivery date must look like 2019/03/25 (year/month/day, Ethiopian)." : "";
  router.post("/product/add", async (req, res) => {
    const f = readProduct(req.body || {}), err = readErr(f);
    if (err) return fail(res, err);
    if (!f.ptype) return fail(res, "Choose the product type.");
    f.code = f.code || nextCode();
    if (codeTaken(f.code)) return fail(res, `Prod ID “${f.code}” is already used. Choose another.`);
    let photo = "";
    if (req.body?.photo) { try { photo = await savePhoto(req.body.photo); } catch (e) { return fail(res, e.message); } }
    const p = { id: uid(), ...f, photo, status: "workflow", added: stamp(req), history: [] };
    hist(p, "Added to Workflow", req);
    db.products.unshift(p);
    audit("Report: product added", `${p.code} ${lab(p)}`, req.actor);
    done(res, `✅ ${p.code} added to Workflow.`);
  });
  router.post("/product/edit", async (req, res) => {
    const b = req.body || {}, p = findP(b.id);
    if (!p) return fail(res, "Product not found.");
    const f = readProduct(b), err = readErr(f);
    if (err) return fail(res, err);
    if (!f.code) return fail(res, "The Prod ID is needed.");
    if (codeTaken(f.code, p.id)) return fail(res, `Prod ID “${f.code}” is already used.`);
    let newPhoto = null, oldPhoto = p.photo || "";
    if (b.photo) { try { newPhoto = await savePhoto(b.photo); } catch (e) { return fail(res, e.message); } }
    else if (b.removePhoto) newPhoto = "";
    const changed = p.code !== f.code || lab(p) !== lab({ ...f }) || (p.handle || "") !== f.handle;
    Object.assign(p, f);
    if (newPhoto !== null) { p.photo = newPhoto; hist(p, newPhoto ? "Photo changed" : "Photo removed", req); await dropPhoto(oldPhoto); }
    if (changed) hist(p, "Edited", req);
    audit("Report: product edited", `${p.code} ${lab(p)}`, req.actor);
    done(res, "✅ Saved.");
  });
  router.post("/product/finish", (req, res) => { // Workflow → In Stock
    const p = findP(req.body?.id);
    if (!p) return fail(res, "Product not found.");
    if (p.status !== "workflow") return fail(res, "This product is not in Workflow.");
    p.status = "stock"; p.finished = stamp(req); hist(p, "Finished → In Stock", req);
    audit("Report: product finished", `${p.code} → In Stock`, req.actor);
    done(res, `✅ ${p.code} is finished and now IN STOCK.`);
  });
  router.post("/product/sold", (req, res) => { // In Stock → Sold (Ethiopian date + time recorded)
    const b = req.body || {}, p = findP(b.id);
    if (!p) return fail(res, "Product not found.");
    if (p.status !== "stock") return fail(res, "Only a product that is IN STOCK can be sold.");
    // Sales info = the REAL salesperson of the mini app (the Sales Name; empty = the admin who presses Sold)
    const seller = clip(b.salesName, 80) || p.salesName || who(req);
    p.salesName = seller;
    const st = stamp(req);
    if (b.d) { if (!dateOk(b.d)) return fail(res, "The sold date must look like 2019/03/25 (year/month/day, Ethiopian)."); st.d = b.d; }
    if (b.t) { if (!timeOk(b.t)) return fail(res, "The sold time must look like 14:30 (24-hour Addis Ababa clock)."); st.t = hhmm(b.t); }
    p.status = "sold"; p.sold = { ...st, salesName: seller, salesInfo: seller, note: clip(b.note, 300) };
    const sty = soldTypeIn(b.soldType); if (sty) p.sold.type = sty; // empty = automatic (S.TODAY on the sale day, SOLD afterwards)
    hist(p, "Sold", req, sty ? { soldType: sty } : {});
    audit("Report: product sold", `${p.code} ${p.sold.d} ${p.sold.t}`, req.actor);
    done(res, `💰 ${p.code} sold — ${p.sold.d} · ${ethClock(p.sold.t)}.`);
  });
  router.post("/product/restock", (req, res) => {
    const p = findP(req.body?.id);
    if (!p) return fail(res, "Product not found.");
    if (p.status !== "sold") return fail(res, "Only a Sold Out product can be restocked.");
    const previous = p.sold ? { ...p.sold } : null;
    p.status = "stock"; delete p.sold;
    hist(p, "Restocked → In Stock", req, { previousSale: previous ? previous.d + " " + previous.t : "" });
    audit("Report: product restocked", `${p.code} returned to stock`, req.actor);
    done(res, `♻️ ${p.code} restocked and returned to In Stock.`);
  });

  router.post("/product/times", (req, res) => { // adjust the Ethiopian dates + clock times (Started · Finished/jumped to stock · Sold) and the Sold type
    const b = req.body || {}, p = findP(b.id);
    if (!p) return fail(res, "Product not found.");
    const parts = [["added", "Start"], ["finished", "Finished (moved to Stock)"], ["sold", "Sold"]], applied = [];
    for (const [k, label] of parts) {
      if (!p[k]) continue;
      const d = String(b[k + "D"] ?? "").trim(), t = String(b[k + "T"] ?? "").trim();
      if (d && !dateOk(d)) return fail(res, `${label} date must look like 2019/03/25 (year/month/day, Ethiopian).`);
      if (t && !timeOk(t)) return fail(res, `${label} time must look like 14:30 (24-hour Addis Ababa clock).`);
      const nd = d || p[k].d, nt = t ? hhmm(t) : p[k].t;
      if (nd !== p[k].d || nt !== p[k].t) { applied.push(`${label} ${p[k].d} ${p[k].t} → ${nd} ${nt}`); p[k] = { ...p[k], d: nd, t: nt }; }
    }
    if (p.sold) {
      const sty = soldTypeIn(b.soldType), old = p.sold.type || "";
      if (sty !== old) { if (sty) p.sold.type = sty; else delete p.sold.type; applied.push(`Sold type ${old || "auto"} → ${sty || "auto"}`); }
    }
    if (!applied.length) return done(res, "Nothing changed.");
    hist(p, "Dates / times adjusted", req, { change: applied.join(" · ").slice(0, 300) });
    audit("Report: dates adjusted", `${p.code} ${applied.join(" · ")}`, req.actor);
    done(res, `🕒 ${p.code}: dates and times saved.`);
  });
  router.post("/product/undo", (req, res) => { // fix a mistake: Sold → In Stock, In Stock → Workflow
    const p = findP(req.body?.id);
    if (!p) return fail(res, "Product not found.");
    if (p.status === "sold") { p.status = "stock"; delete p.sold; hist(p, "Sale cancelled → In Stock", req); }
    else if (p.status === "stock") { p.status = "workflow"; delete p.finished; hist(p, "Moved back → Workflow", req); }
    else return fail(res, "Nothing to undo.");
    audit("Report: product undo", `${p.code} → ${p.status}`, req.actor);
    done(res, `↩ ${p.code} moved back to ${p.status === "stock" ? "In Stock" : "Workflow"}.`);
  });
  router.post("/product/delete", ownerOnly, (req, res) => {
    const p = findP(req.body?.id);
    if (!p) return fail(res, "Product not found.");
    db.products = db.products.filter(x => x !== p);
    if (typeof workshopDeleteProducts === "function") workshopDeleteProducts([p.id]);
    dropPhoto(p.photo).catch(() => {});
    audit("Report: product deleted", `${p.code} ${lab(p)}`, req.actor);
    done(res, `🗑 ${p.code} deleted.`);
  });

  // MATERIAL: new · add · cut   (Material · Type · Unit · Available · Opening stock · daily use · Total used · Note)
  const matKey = (n, t) => (clip(n, 100) + "|" + clip(t, 30)).toLowerCase();
  const matName = m => m.name + (m.type ? " " + m.type : "");
  router.post("/material/add", (req, res) => {
    const b = req.body || {}, name = clip(b.name, 100), type = clip(b.type, 30), unit = clip(b.unit, 20) || "pcs", group = up(b.group, 30) || (groupsOrdered()[1] || groupsOrdered()[0] || MAT_G2);
    if (!name) return fail(res, "Write the material name.");
    if (db.materials.some(m => matKey(m.name, m.type) === matKey(name, type))) return fail(res, `“${name} ${type}” already exists. Use ➕ Add on it.`);
    const qty = (b.qty === "" || b.qty == null) ? 0 : num(b.qty), min = (b.min === "" || b.min == null) ? 0 : num(b.min);
    if (Number.isNaN(qty) || qty < 0) return fail(res, "The quantity must be a number (0 or more).");
    if (Number.isNaN(min) || min < 0) return fail(res, "The low-stock alert must be a number.");
    const m = { id: uid(), name, type, unit, group, qty, min, created: stamp(req) };
    db.materials.push(m);
    addLog(req, m, "new", qty, qty, clip(b.note, 200) || "New material");
    audit("Report: material added", `${matName(m)} ${qty} ${unit}`, req.actor);
    done(res, `✅ ${matName(m)} added.`);
  });
  router.post("/material/move", (req, res) => {
    const b = req.body || {}, m = findM(b.id), type = b.type === "cut" ? "cut" : "add";
    if (!m) return fail(res, "Material not found.");
    const qty = num(b.qty);
    if (Number.isNaN(qty) || qty <= 0) return fail(res, "Write a quantity bigger than 0.");
    if (type === "cut" && qty > m.qty) return fail(res, `Only ${m.qty} left of ${matName(m)}. You cannot cut ${qty}.`);
    m.qty = Math.round((type === "cut" ? m.qty - qty : m.qty + qty) * 1000) / 1000;
    addLog(req, m, type, qty, m.qty, b.note);
    audit("Report: material " + type, `${matName(m)} ${qty} → ${m.qty}`, req.actor);
    done(res, type === "cut" ? `✂️ Cut ${qty} of ${matName(m)}. Left: ${m.qty}.` : `➕ Added ${qty} to ${matName(m)}. Now: ${m.qty}.`);
  });
  // STOCK EDIT (correction): wrong quantity typed by mistake → set the real quantity. Recorded as a "fix" movement (signed difference) with the reason.
  router.post("/material/correct", (req, res) => {
    const b = req.body || {}, m = findM(b.id);
    if (!m) return fail(res, "Material not found.");
    const to = num(b.qty);
    if (b.qty === "" || b.qty == null || Number.isNaN(to) || to < 0) return fail(res, "Write the correct quantity (0 or more).");
    const old = m.qty, diff = Math.round((to - old) * 1000) / 1000;
    if (diff === 0) return fail(res, `The quantity is already ${old}. Nothing to correct.`);
    m.qty = to;
    addLog(req, m, "fix", diff, m.qty, clip(b.note, 160) ? `Correction ${old} → ${to}: ${clip(b.note, 160)}` : `Correction ${old} → ${to}`);
    audit("Report: material corrected", `${matName(m)} ${old} → ${to}`, req.actor);
    done(res, `✏️ ${matName(m)} corrected: ${old} → ${to}.`);
  });
  router.post("/material/edit", (req, res) => {
    const b = req.body || {}, m = findM(b.id);
    if (!m) return fail(res, "Material not found.");
    const name = clip(b.name, 100), type = clip(b.type, 30), unit = clip(b.unit, 20) || "pcs", group = up(b.group, 30) || "MATERIAL", min = (b.min === "" || b.min == null) ? 0 : num(b.min);
    if (!name) return fail(res, "Write the material name.");
    if (Number.isNaN(min) || min < 0) return fail(res, "The low-stock alert must be a number.");
    if (db.materials.some(x => x.id !== m.id && matKey(x.name, x.type) === matKey(name, type))) return fail(res, `“${name} ${type}” already exists.`);
    Object.assign(m, { name, type, unit, group, min });
    db.log.forEach(l => { if (l.matId === m.id) { l.material = name; l.mtype = type; l.unit = unit; } });
    done(res, "✅ Saved.");
  });
  // HOLD + DRAG: the app sends the new arrangement — the tables in order and, inside each table, the materials in order.
  router.post("/material/arrange", (req, res) => {
    const b = req.body || {}, list = Array.isArray(b.order) ? b.order : [], gl = Array.isArray(b.groups) ? b.groups : [];
    const byId = new Map(db.materials.map(m => [m.id, m])), seen = new Set(), next = [];
    for (const it of list) {
      const m = it && byId.get(String(it.id || ""));
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      const g = up(it.group, 30); if (g) m.group = g;
      next.push(m);
    }
    for (const m of db.materials) if (!seen.has(m.id)) next.push(m); // anything the app did not know about keeps its place at the end
    db.materials = next;
    const gs = []; for (const g of gl.map(x => up(x, 30)).filter(Boolean)) if (!gs.includes(g)) gs.push(g);
    db.matGroups = gs;
    audit("Report: materials rearranged", `${next.length} material(s)`, req.actor);
    done(res, "✅ Arrangement saved.");
  });
  router.post("/material/delete", (req, res) => {
    const m = findM(req.body?.id);
    if (!m) return fail(res, "Material not found.");
    db.materials = db.materials.filter(x => x !== m);
    audit("Report: material deleted", matName(m), req.actor);
    done(res, `🗑 ${matName(m)} deleted. Its movements stay in the log.`);
  });

  // START FROM ZERO: the current data is first saved in the Google Sheet (the month tabs are kept as "Archive …" tabs),
  // then every product, material and movement is cleared. If the sheet backup fails, NOTHING is deleted.
  router.post("/reset", ownerOnly, async (req, res) => {
    try {
      if (req.body?.confirm !== "ZERO") return fail(res, "Not confirmed. Type ZERO to confirm.");
      const had = db.products.length + db.materials.length + db.log.length;
      let note = " (The backup sheet is not connected, so nothing was saved in Google Sheets.)";
      if (cfg.scriptUrl && had) {
        clearTimeout(timer);
        const b = await backupNow();
        if (!b.ok && !b.queued) return fail(res, "The Google Sheet backup failed, so nothing was deleted: " + b.error);
        const a = await callScript({ action: "archive", data: { now: nowEth() } });
        note = ` The old report is kept in the Google Sheet (${a.archived || 0} tab${a.archived === 1 ? "" : "s"} saved as “Archive …”).`;
      }
      const oldPhotos = db.products.map(x => x.photo).filter(Boolean);
      db.products = []; db.materials = []; db.log = []; db.matGroups = []; db.matLayout = 0; layoutMaterials();
      oldPhotos.forEach(id => dropPhoto(id).catch(() => {}));
      audit("Report: START FROM ZERO", `${had} record(s) cleared`, req.actor);
      persist();
      if (cfg.scriptUrl) scheduleBackup(1500);
      res.json({ ok: true, message: "✅ Reports started from 0." + note, ...view() });
    } catch (e) { fail(res, "Could not start from zero: " + e.message + " — nothing was deleted."); }
  });

  // DAILY STOCK → TELEGRAM (main admin only)
  router.post("/tg/config", ownerOnly, async (req, res) => {
    const b = req.body || {}, t = db.tg, on = b.on === true || b.on === "true";
    const okTime = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ""));
    if (Array.isArray(b.senders)) { // every admin account that should send the stock every day, each at its own time
      const known = new Set(senders().map(x => x.id)), out = [];
      for (const x of b.senders) { const id = String(x?.id || ""); if (!known.has(id) || out.some(o => o.id === id)) continue; const old = (t.senders || []).find(o => o.id === id); out.push({ id, time: okTime(x.time) ? String(x.time) : (old?.time || "08:00"), lastDate: old?.lastDate || "", lastAt: old?.lastAt || "", ok: old?.ok, error: old?.error || "" }); }
      t.senders = out; t.sendAs = out[0]?.id || ""; t.time = out[0]?.time || t.time || "08:00";
    }
    if (on && !(t.senders || []).length) return fail(res, "Tick at least one admin account that sends the stock every day.");
    if (b.to !== undefined) { const to = cleanTo(b.to); t.to = to && to.length ? to : null; }
    if (b.targets !== undefined) t.targets = cleanTargets(b.targets);
    if (b.dm !== undefined) t.dm = b.dm === true || b.dm === "true";
    t.on = on; persist();
    const off = (t.senders || []).filter(e => !accFor(e.id)?.ready).map(e => nameOfAdmin(e.id));
    done(res, on ? `🟢 Daily stock is ON — ${(t.senders || []).map(e => nameOfAdmin(e.id) + " at " + e.time).join(" · ")} (Addis Ababa clock), each from their own Telegram account.` + (off.length ? ` ⚠️ Not connected yet: ${off.join(", ")}.` : "") : "⚪ Daily stock is OFF.");
  });
  router.post("/tg/to", ownerOnly, (req, res) => { // choose which admins receive the stock message
    if (req.body?.sendAs) { const er = setSender(req, req.body.sendAs); if (er) return fail(res, er); }
    const to = cleanTo(req.body?.to); db.tg.to = to && to.length ? to : null;
    if (req.body?.targets !== undefined) db.tg.targets = cleanTargets(req.body.targets);
    if (req.body?.dm !== undefined) db.tg.dm = req.body.dm === true || req.body.dm === "true";
    persist();
    done(res, (db.tg.dm === false ? "✅ Not sent privately to admins." : db.tg.to ? `✅ The stock goes to ${recipients().length} selected admin(s).` : "✅ The stock goes to every admin.") + (db.tg.targets.length ? ` + ${db.tg.targets.length} group(s).` : ""));
  });
  // The groups / channels the person's OWN Telegram account is in (so a private group can be picked without typing anything) + the topics of a forum group
  router.get("/tg/groups", async (req, res) => {
    try {
      const acc = accFor(req.actor?.telegramId);
      if (!acc?.ready) return res.json({ ok: false, error: "Your own Telegram account is not connected. Connect it in Settings → Connect my Telegram account." });
      const ds = await acc.client.getDialogs({ limit: 300 });
      const list = ds.filter(d => d.isGroup || d.isChannel).map(d => ({ id: String(d.id), title: clip(d.title || d.name, 80), username: d.entity?.username || "", forum: !!d.entity?.forum, mega: !!(d.entity?.megagroup || d.entity?.forum), broadcast: !!d.entity?.broadcast })).filter(x => /^-?\d+$/.test(x.id));
      res.json({ ok: true, groups: list });
    } catch (e) { res.json({ ok: false, error: tgFriendly(e) }); }
  });
  router.get("/tg/topics", async (req, res) => {
    try {
      const acc = accFor(req.actor?.telegramId);
      if (!acc?.ready) return res.json({ ok: false, error: "Your own Telegram account is not connected." });
      const g = parseTgLink(String(req.query.chat || "")); if (!g) return res.json({ ok: false, error: "Unknown group." });
      const { Api } = require("telegram");
      const ent = await resolveTarget(acc, g);
      const r = await acc.client.invoke(new Api.channels.GetForumTopics({ channel: ent, offsetDate: 0, offsetId: 0, offsetTopic: 0, limit: 100 }));
      res.json({ ok: true, topics: (r.topics || []).filter(t => t.className === "ForumTopic").map(t => ({ id: Number(t.id), title: clip(t.title, 80) })) });
    } catch (e) { res.json({ ok: false, error: /CHANNEL_FORUM_MISSING|not a forum/i.test(String(e?.errorMessage || e?.message)) ? "This group has no topics." : tgFriendly(e) }); }
  });
  // SEND NOW — any admin who may open Reports (main admin, assigned main admin or assigned admin) sends FROM HIS OWN Telegram account.
  router.post("/tg/send", async (req, res) => {
    const me = String(req.actor?.telegramId || "");
    if (!me) return res.json({ ok: false, error: "Open the app from Telegram so your own account can be used.", ...view() });
    const acc = accFor(me);
    if (!acc?.ready) return res.json({ ok: false, error: "Your own Telegram account is not connected. Connect it in Settings → Connect my Telegram account, then press Send now again.", ...view() });
    const b = req.body || {};
    const r = await sendDaily({ by: { id: me, name: clip(req.actor?.name, 60) || nameOfAdmin(me), acc }, to: Array.isArray(b.to) ? (cleanTo(b.to) || []) : undefined, targets: b.targets !== undefined ? cleanTargets(b.targets) : undefined, dm: b.dm !== undefined ? (b.dm === true || b.dm === "true") : undefined });
    res.json({ ...(r.ok ? { ok: true, message: "✅ Stock sent from your Telegram account." + (r.error ? " " + r.error : "") } : { ok: false, error: r.error || "Could not send." }), ...view() });
  });

  // BACKUP sheet
  router.post("/backup/connect", ownerOnly, async (req, res) => {
    try {
      const url = scriptUrl(req.body?.scriptUrl), key = String(req.body?.scriptKey || "").trim();
      const p = await callScript({ action: "ping" }, { url, key });
      cfg.scriptUrl = url; cfg.scriptKey = key; cfg.sheetName = p.name || ""; cfg.sheetUrl = p.url || "";
      await saveCfg();
      const r = await backupNow();
      res.json({ ...(r.ok ? { ok: true, message: `✅ Connected to “${cfg.sheetName}”. Backup sent.` } : { ok: false, error: "Connected, but the first backup failed: " + r.error }), ...view() });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });
  router.post("/backup/now", async (req, res) => {
    const r = await backupNow();
    res.json({ ...(r.ok ? { ok: true, message: "✅ Backup saved in the Google Sheet." } : { ok: false, error: r.error }), ...view() });
  });
  router.post("/backup/disconnect", ownerOnly, async (req, res) => {
    cfg = { ...cfg, scriptUrl: "", scriptKey: "", sheetName: "", sheetUrl: "", backup: { at: "", d: "", t: "", ok: null, error: "", count: 0 } };
    await saveCfg();
    res.json({ ok: true, message: "Backup sheet disconnected. The data stays in the app.", ...view() });
  });

  // The PDF is built in the phone; this puts a copy into the admin's own Telegram chat.
  router.post("/send-pdf", express.raw({ type: ["application/pdf", "application/octet-stream"], limit: "30mb" }), async (req, res) => {
    try {
      const chatId = String(req.actor?.telegramId || "");
      if (!chatId) return res.json({ ok: false, error: "Open the app from Telegram (not a browser) to receive the PDF in your chat." });
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buf.length < 100 || buf.slice(0, 4).toString() !== "%PDF") return res.json({ ok: false, error: "The PDF was not received. Try again." });
      const name = String(req.query.name || "report").replace(/[^\w.\- ]+/g, "").trim().slice(0, 80) || "report";
      await tgApi.sendForm("sendDocument", () => {
        const body = new FormData();
        body.append("chat_id", chatId);
        body.append("caption", `📄 ${name}`);
        body.append("document", new Blob([buf], { type: "application/pdf" }), name.replace(/\.pdf$/i, "") + ".pdf");
        return body;
      });
      res.json({ ok: true, message: "✅ Sent to your Telegram chat with the bot. If you don't see it, open the AMBAR bot chat and press Start once." });
    } catch (e) { res.json({ ok: false, error: /chat not found|bot can't initiate|blocked/i.test(e.message) ? "Open the AMBAR bot chat once and press Start, then try again." : e.message }); }
  });

  // The Apps Script text, so it can be copied from the page.
  router.get("/script", (req, res) => {
    try { res.type("text/plain; charset=utf-8").send(fs.readFileSync(path.join(__dirname, "reports-sheet-script.gs"), "utf8")); }
    catch { res.status(404).type("text/plain").send("reports-sheet-script.gs was not found on the server."); }
  });
  app.use("/api/reports", router);

  // v150: the Workshop module reads the readymade (in-stock, not ORDER) products from here
  const readymade = () => ({ groups: stockGroups(db.products.filter(p => p.status === "stock" && !/CUS|ORD/i.test(String(p.orderType || "")))), photoBuf, caption: groupCaption });
  // v152: UNFINISHED readymade products (still in Workflow, not ORDER) — shown (not sent) on the Workshop page
  const inProgress = () => db.products
    .filter(p => p.status === "workflow" && !/CUS|ORD/i.test(String(p.orderType || "")))
    .map(p => ({ id: p.id, code: p.code || "", model: p.model || "", desc: p.desc || "", ptype: p.ptype || "", handle: p.handle || "", priority: p.priority || "LOW", started: p.added ? [p.added.d, p.added.t].filter(Boolean).join(" ") : "", photo: p.photo || "" }))
    .sort((a, b) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.priority] ?? 2) - ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[b.priority] ?? 2));
  // v153: used by the Workshop module (Telegram buttons "Finished workshop" → "Finished").
  // A product sent to the workshop is put into the Workflow (so Reports shows it); the final "Finished" button moves it to STOCK.
  const wsReq = name => ({ actor: { name: clip(name, 60) || "Workshop" } });
  async function wsAddProduct(f, byName) {
    const req = wsReq(byName);
    let photo = "";
    if (f.photoBuf && f.photoBuf.length > 200 && f.photoBuf.length <= 1.5 * 1024 * 1024) { try { photo = await savePhoto("data:image/jpeg;base64," + f.photoBuf.toString("base64")); } catch {} }
    const p = { id: uid(), ptype: "", code: nextCode(), sno: "", model: up(f.model, 40), desc: clip(f.desc, 160), orderType: f.orderType === "ORDER" ? "ORDER" : "READYMADE", priority: priorityOf2(f.priority || "MEDIUM"),
      category: "OTHERS", handle: clip(f.handle, 60), capacity: "", salesName: clip(f.salesName, 80), location: "", deliveryDate: dateOk(f.deliveryDate) ? clip(f.deliveryDate, 10) : "", changes: "", note: clip(f.note, 300),
      photo, status: "workflow", added: stamp(req), history: [], orderRef: clip(f.orderRef, 60), jobId: clip(f.jobId, 40) };
    hist(p, "Added to Workflow (sent to the workshop)", req);
    db.products.unshift(p); persist(); scheduleBackup();
    audit("Report: product added", `${p.code} ${lab(p)} (workshop)`, req.actor);
    return { id: p.id, code: p.code };
  }
  function wsFinish(id, byName) { // Workflow → In Stock (same as the Finished button of Reports)
    const p = findP(id); if (!p) return { ok: false, error: "The product is not in Reports any more." };
    if (p.status !== "workflow") return { ok: true, already: true, code: p.code };
    const req = wsReq(byName);
    p.status = "stock"; p.finished = stamp(req); hist(p, "Finished (workshop button) → In Stock", req);
    persist(); scheduleBackup(); audit("Report: product finished", `${p.code} → In Stock (workshop)`, req.actor);
    return { ok: true, code: p.code };
  }
  function wsRemove(ids) { // roll back products made for a send that failed
    const set = new Set((ids || []).map(String)); const gone = db.products.filter(p => set.has(p.id) && p.status === "workflow");
    if (!gone.length) return; db.products = db.products.filter(p => !gone.includes(p)); persist(); scheduleBackup();
    for (const g of gone) dropPhoto(g.photo).catch(() => {});
  }
  const wsStatus = id => { const p = findP(id); return p ? { code: p.code, status: p.status } : null; };
  return { load, readymade, inProgress, wsAddProduct, wsFinish, wsRemove, wsStatus, setWorkshopDeleteProducts(fn) { workshopDeleteProducts = typeof fn === "function" ? fn : null; } };
}
module.exports = { register };
