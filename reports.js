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
  const { requireAccess, hasPerm, supabase, baseDir, tgApi, helpers, log } = ctx;
  const ownerIdsLive = () => (ctx.ownerIds || []).map(String);
  const appAdminsLive = () => (ctx.getAppAdmins ? ctx.getAppAdmins() : []) || [];
  const audit = (event, detail, actor) => { try { log && log(event, detail, actor?.name || "Main admin"); } catch {} };
  const CFG_FILE = path.join(baseDir, "reports-sheet.json");   // backup link (same file as v118, so the link survives the update)
  const DATA_FILE = path.join(baseDir, "reports-data.json");   // the real data
  let cfg = { scriptUrl: String(process.env.REPORTS_SCRIPT_URL || "").trim(), scriptKey: String(process.env.REPORTS_SCRIPT_KEY || "").trim(), sheetName: "", sheetUrl: "", backup: { at: "", d: "", t: "", ok: null, error: "", count: 0 } };
  const TG0 = { on: false, time: "08:00", sendAs: "", to: null, lastDate: "", lastAt: "", ok: null, error: "", results: [] };
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
    for (const p of db.products) { if (!p.desc && !p.model && p.name) p.desc = p.name; p.orderType = p.orderType || "READYMADE"; p.priority = p.priority || "LOW"; p.category = p.category || "OTHERS"; p.handle = p.handle || ""; p.photo = p.photo || ""; p.capacity = p.capacity || ""; if (p.orderType === "CUSTOM") p.orderType = "ORDER"; }
    for (const m of db.materials) { m.type = m.type || ""; m.group = m.group || "MATERIAL"; }
    layoutMaterials();
    if (c && typeof c === "object") cfg = { ...cfg, scriptUrl: c.scriptUrl || cfg.scriptUrl, scriptKey: c.scriptKey || cfg.scriptKey, sheetName: c.sheetName || "", sheetUrl: c.sheetUrl || "", backup: { ...cfg.backup, ...(c.backup || {}) } };
    if (process.env.REPORTS_SCRIPT_URL) { cfg.scriptUrl = String(process.env.REPORTS_SCRIPT_URL).trim(); if (process.env.REPORTS_SCRIPT_KEY) cfg.scriptKey = String(process.env.REPORTS_SCRIPT_KEY).trim(); }
    if (cfg.scriptUrl) scheduleBackup(8000);
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
  const view = () => ({ tg: tgInfo(), sales: salesNames(), handles: [...new Set(db.products.map(p => p.handle).filter(Boolean))].sort(), cats: ["SHOE SHELF", "OTHERS", "GADGETS"], products: db.products, materials: orderedMaterials(), matGroups: groupsOrdered(), log: db.log.slice(0, 400), backup: backupInfo(), now: nowEth(), nextCode: nextCode() });
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
    for (const p of L) { const k = normK(p.model || p.desc || p.code) + "|" + normK(p.handle); let g = m.get(k); if (!g) { g = { key: k, model: p.model || p.desc || p.code, handle: p.handle || "", items: [] }; m.set(k, g); } g.items.push(p); }
    return [...m.values()].map(g => { g.photo = (g.items.find(p => p.photo) || {}).photo || ""; return g; }).sort((a, b) => a.model.localeCompare(b.model, undefined, { numeric: true }) || a.handle.localeCompare(b.handle));
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
  const senderAcc = () => db.tg.sendAs ? ctx.accountFor({ role: "owner", telegramId: String(db.tg.sendAs) }) : null;
  const nameOfAdmin = id => { const a = appAdminsLive().find(x => String(x.telegramId) === String(id)); return clip(a?.name, 60) || (ownerIdsLive().includes(String(id)) ? "Main admin" : "Admin " + id); };
  function recipients() {
    const ids = [...new Set([...ownerIdsLive(), ...appAdminsLive().map(a => String(a.telegramId))].filter(x => /^\d+$/.test(x)))];
    const sel = Array.isArray(db.tg.to) && db.tg.to.length ? db.tg.to.map(String) : null; // null = every admin; otherwise only the admins the main admin picked
    return ids.filter(id => id !== String(db.tg.sendAs) && (!sel || sel.includes(id))).map(id => ({ id, name: nameOfAdmin(id) }));
  }
  function candidates() {
    const ids = [...new Set([...ownerIdsLive(), ...appAdminsLive().map(a => String(a.telegramId))].filter(x => /^\d+$/.test(x)))];
    return ids.filter(id => id !== String(db.tg.sendAs)).map(id => ({ id, name: nameOfAdmin(id) }));
  }
  // main admins whose OWN Telegram account is connected: the stock can be sent from any of them
  const senders = () => ownerIdsLive().filter(x => /^\d+$/.test(String(x))).map(id => ({ id: String(id), name: nameOfAdmin(id), ready: !!ctx.accountFor({ role: "owner", telegramId: String(id) })?.ready }));
  const setSender = (req, wanted) => { // returns an error text or ""
    const id = String(wanted || "");
    if (!id) return "";
    if (!senders().some(x => x.id === id)) return "That sender is not a main admin.";
    if (!ctx.accountFor({ role: "owner", telegramId: id })?.ready) return nameOfAdmin(id) + "'s Telegram account is not connected. Connect it first (Settings → Connect my Telegram account).";
    db.tg.sendAs = id; return "";
  };
  const cleanTo = v => Array.isArray(v) ? [...new Set(v.map(String).filter(x => /^\d+$/.test(x)))].slice(0, 100) : null;
  function tgInfo() {
    const t = db.tg, acc = senderAcc();
    return { on: !!t.on, time: t.time, sendAs: t.sendAs || "", sendAsName: t.sendAs ? nameOfAdmin(t.sendAs) : "", senderReady: !!acc?.ready, lastDate: t.lastDate || "", lastAt: t.lastAt || "", ok: t.ok, error: t.error || "", results: t.results || [], recipients: recipients().map(r => r.name), candidates: candidates(), senders: senders(), to: Array.isArray(t.to) ? t.to : [] };
  }
  const tgFriendly = e => { const m = String(e?.errorMessage || e?.message || e || ""); if (/FLOOD_WAIT|PEER_FLOOD/i.test(m)) return "Telegram asked to slow down. It will try again tomorrow."; if (/PEER_ID_INVALID|Cannot find any entity|not found/i.test(m)) return "The main admin's Telegram account has no chat with this admin yet. Open a chat with them once from that account, then press Send now."; if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(m)) return "The main admin's Telegram login expired. Connect it again."; return m.slice(0, 200) || "Could not send."; };
  let tgBusy = false;
  async function sendDaily() {
    if (tgBusy) return { ok: false, error: "A send is already running." };
    tgBusy = true;
    const t = db.tg;
    try {
      let acc = senderAcc();
      if (!t.sendAs || !acc?.ready) { // the chosen sender is not connected: use any main admin whose own Telegram account is connected
        const alt = senders().find(x => x.ready);
        if (alt) { t.sendAs = alt.id; acc = senderAcc(); persist(); }
      }
      if (!t.sendAs || !acc?.ready) throw new Error("The sender (main admin) Telegram account is not connected. Connect it in Settings → Connect my Telegram account, then switch Daily Telegram on again.");
      const to = recipients();
      if (!to.length) throw new Error("There is no other admin to send to.");
      const stock = db.products.filter(p => p.status === "stock"), groups = stockGroups(stock).slice(0, 60), n = nowEth();
      const head = `📦 AMBAR STOCK — ${n.d}\n${stock.length} product${stock.length === 1 ? "" : "s"} in stock · ${groups.length} model${groups.length === 1 ? "" : "s"}` + (stock.length ? "" : "\nNothing is in stock today.");
      const photos = new Map();
      for (const g of groups) if (g.photo) { const b = await photoBuf(g.photo); if (b) photos.set(g.key, b); }
      const results = [];
      for (const r of to) {
        try {
          let entity; try { entity = await acc.client.getEntity(BigInt(r.id)); } catch { entity = await acc.client.getInputEntity(BigInt(r.id)); }
          await acc.client.sendMessage(entity, { message: head });
          for (const g of groups) {
            await new Promise(x => setTimeout(x, 800));
            const buf = photos.get(g.key);
            if (buf) {
              const f = path.join(os.tmpdir(), "stk-" + uid() + ".jpg");
              fs.writeFileSync(f, buf);
              try { await acc.client.sendFile(entity, { file: f, caption: groupCaption(g), forceDocument: false }); } finally { try { fs.unlinkSync(f); } catch {} }
            } else await acc.client.sendMessage(entity, { message: groupCaption(g) });
          }
          results.push({ name: r.name, ok: true, count: groups.length });
        } catch (e) { results.push({ name: r.name, ok: false, error: tgFriendly(e) }); }
      }
      const okN = results.filter(x => x.ok).length;
      Object.assign(t, { lastDate: todayAddis(), lastAt: n.d + " " + n.t, results, ok: okN > 0, error: okN ? (okN < results.length ? "Some admins could not be reached." : "") : (results[0]?.error || "Nobody could be reached.") });
      persist();
      return { ok: okN > 0, results, error: t.error };
    } catch (e) {
      Object.assign(t, { lastDate: todayAddis(), lastAt: nowEth().d + " " + nowEth().t, ok: false, error: e.message, results: [] });
      persist();
      return { ok: false, error: e.message };
    } finally { tgBusy = false; }
  }
  async function tgTick() {
    const t = db.tg;
    if (!t.on || !t.sendAs || tgBusy || t.lastDate === todayAddis() || timeAddis() < (t.time || "08:00")) return;
    await sendDaily();
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
    p.status = "sold"; p.sold = { ...stamp(req), salesName: seller, salesInfo: seller, note: clip(b.note, 300) };
    hist(p, "Sold", req);
    audit("Report: product sold", `${p.code} ${p.sold.d} ${p.sold.t}`, req.actor);
    done(res, `💰 ${p.code} sold — ${p.sold.d} · ${ethClock(p.sold.t)}.`);
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
  router.post("/product/delete", (req, res) => {
    const p = findP(req.body?.id);
    if (!p) return fail(res, "Product not found.");
    db.products = db.products.filter(x => x !== p);
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
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.time || "")) ? String(b.time) : (t.time || "08:00");
    if (on) {
      const id = String(b.sendAs || req.actor?.telegramId || "");
      if (!id) return fail(res, "Open the app from Telegram so the sender is known.");
      const er = setSender(req, id);
      if (er) return fail(res, er);
    }
    if (b.to !== undefined) { const to = cleanTo(b.to); t.to = to && to.length ? to : null; }
    t.on = on; t.time = time; persist();
    done(res, on ? `🟢 Daily stock is ON — every day at ${time} (Addis Ababa clock), sent from ${nameOfAdmin(t.sendAs)}'s Telegram account.` : "⚪ Daily stock is OFF.");
  });
  router.post("/tg/to", ownerOnly, (req, res) => { // choose which admins receive the stock message
    if (req.body?.sendAs) { const er = setSender(req, req.body.sendAs); if (er) return fail(res, er); }
    const to = cleanTo(req.body?.to); db.tg.to = to && to.length ? to : null; persist();
    done(res, db.tg.to ? `✅ The stock goes to ${recipients().length} selected admin(s).` : "✅ The stock goes to every admin.");
  });
  router.post("/tg/send", ownerOnly, async (req, res) => {
    const t = db.tg;
    if (req.body?.sendAs) { const er = setSender(req, req.body.sendAs); if (er) return fail(res, er); }
    else { const me = String(req.actor?.telegramId || ""); if (me && ctx.accountFor({ role: "owner", telegramId: me })?.ready) t.sendAs = me; else if (!t.sendAs && me) t.sendAs = me; }
    persist();
    const r = await sendDaily();
    res.json({ ...(r.ok ? { ok: true, message: "✅ Stock sent to the admins' Telegram." + (r.error ? " " + r.error : "") } : { ok: false, error: r.error || "Could not send." }), ...view() });
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

  return { load };
}
module.exports = { register };
