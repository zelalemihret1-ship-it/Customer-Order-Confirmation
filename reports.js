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
// Access: owner (main admin) only. Assigned admins get 403 on every endpoint; view-only admins are refused on writes by requireAccess.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const num = v => { const n = Number(String(v == null ? "" : v).replace(/,/g, "").trim()); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN; };
const uid = () => crypto.randomBytes(6).toString("hex");

function register(app, ctx) {
  const { requireAccess, supabase, baseDir, tgApi, helpers, log } = ctx;
  const audit = (event, detail, actor) => { try { log && log(event, detail, actor?.name || "Main admin"); } catch {} };
  const CFG_FILE = path.join(baseDir, "reports-sheet.json");   // backup link (same file as v118, so the link survives the update)
  const DATA_FILE = path.join(baseDir, "reports-data.json");   // the real data
  let cfg = { scriptUrl: String(process.env.REPORTS_SCRIPT_URL || "").trim(), scriptKey: String(process.env.REPORTS_SCRIPT_KEY || "").trim(), sheetName: "", sheetUrl: "", backup: { at: "", d: "", t: "", ok: null, error: "", count: 0 } };
  let db = { products: [], materials: [], log: [], savedAt: "" };

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
    for (const p of db.products) { if (!p.desc && !p.model && p.name) p.desc = p.name; p.orderType = p.orderType || "READYMADE"; p.priority = p.priority || "LOW"; p.category = p.category || "OTHERS"; }
    for (const m of db.materials) { m.type = m.type || ""; m.group = m.group || "MATERIAL"; }
    if (c && typeof c === "object") cfg = { ...cfg, scriptUrl: c.scriptUrl || cfg.scriptUrl, scriptKey: c.scriptKey || cfg.scriptKey, sheetName: c.sheetName || "", sheetUrl: c.sheetUrl || "", backup: { ...cfg.backup, ...(c.backup || {}) } };
    if (process.env.REPORTS_SCRIPT_URL) { cfg.scriptUrl = String(process.env.REPORTS_SCRIPT_URL).trim(); if (process.env.REPORTS_SCRIPT_KEY) cfg.scriptKey = String(process.env.REPORTS_SCRIPT_KEY).trim(); }
    if (cfg.scriptUrl) scheduleBackup(8000); // a restart / redeploy refreshes the backup once
    // New Ethiopian month → the backup runs by itself so the next month's Workflow / Stock / Material tabs appear (checked every 20 minutes)
    const t = setInterval(() => { if (cfg.scriptUrl && cfg.backup.month !== nowEth().d.slice(0, 7)) backupNow().catch(() => {}); }, 20 * 60 * 1000);
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
  const snapshot = () => ({ products: db.products, materials: db.materials, log: db.log.slice(0, 3000), app: "AMBAR Furniture mini app", now: nowEth() });
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
  const view = () => ({ cats: ["SHOE SHELF", "OTHERS", "GADGETS"], products: db.products, materials: db.materials, log: db.log.slice(0, 400), backup: backupInfo(), now: nowEth(), nextCode: nextCode() });
  const done = (res, message) => { persist(); scheduleBackup(); res.json({ ok: true, message, ...view() }); };

  // ── routes ─────────────────────────────────────────────────────────────────────────────────
  const router = express.Router();
  router.use(requireAccess);
  router.use((req, res, next) => req.actor?.role === "owner" ? next() : res.status(403).json({ ok: false, error: "Reports are for main admins only." }));
  router.use(express.json({ limit: "200kb" }));

  router.get("/state", (req, res) => res.json({ ok: true, ...view() }));

  // WORKFLOW → STOCK → SOLD  (same columns as the Google Sheet: Prod Id · Model · Description · Order Type · Priority · Start Date · Status · Finished · Delivery · Sales Name · Location · Changes · Correction)
  const CATS = ["SHOE SHELF", "OTHERS", "GADGETS"];
  const lab = p => [p.model, p.desc].filter(Boolean).join(" ") || p.code;
  const up = (v, n) => clip(v, n).toUpperCase();
  const orderTypeOf = v => /CUS|ORD/i.test(String(v || "")) ? "CUSTOM" : "READYMADE";
  const priorityOf2 = v => { const x = String(v || "").toUpperCase(); return x.startsWith("H") ? "HIGH" : x.startsWith("M") ? "MEDIUM" : "LOW"; };
  const dateOk = v => !v || /^\d{4}\/\d{2}\/\d{2}$/.test(v);
  function readProduct(b) {
    return { code: clip(b.code, 30), sno: clip(b.sno, 20), model: up(b.model, 40), desc: clip(b.desc, 160), orderType: orderTypeOf(b.orderType), priority: priorityOf2(b.priority),
      category: up(b.category, 30) || "OTHERS", salesName: clip(b.salesName, 80), location: clip(b.location, 80), deliveryDate: clip(b.deliveryDate, 10), changes: clip(b.changes, 200), note: clip(b.note, 300) };
  }
  const readErr = f => (!f.model && !f.desc) ? "Write the model or the description." : !dateOk(f.deliveryDate) ? "The delivery date must look like 2019/03/25 (year/month/day, Ethiopian)." : "";
  router.post("/product/add", (req, res) => {
    const f = readProduct(req.body || {}), err = readErr(f);
    if (err) return fail(res, err);
    f.code = f.code || nextCode();
    if (codeTaken(f.code)) return fail(res, `Prod ID “${f.code}” is already used. Choose another.`);
    const p = { id: uid(), ...f, status: "workflow", added: stamp(req), history: [] };
    hist(p, "Added to Workflow", req);
    db.products.unshift(p);
    audit("Report: product added", `${p.code} ${lab(p)}`, req.actor);
    done(res, `✅ ${p.code} added to Workflow.`);
  });
  router.post("/product/edit", (req, res) => {
    const b = req.body || {}, p = findP(b.id);
    if (!p) return fail(res, "Product not found.");
    const f = readProduct(b), err = readErr(f);
    if (err) return fail(res, err);
    if (!f.code) return fail(res, "The Prod ID is needed.");
    if (codeTaken(f.code, p.id)) return fail(res, `Prod ID “${f.code}” is already used.`);
    const changed = p.code !== f.code || lab(p) !== lab({ ...f });
    Object.assign(p, f);
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
    if (clip(b.salesName, 80)) p.salesName = clip(b.salesName, 80);
    p.status = "sold"; p.sold = { ...stamp(req), salesInfo: up(b.salesInfo, 12), note: clip(b.note, 300) };
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
    audit("Report: product deleted", `${p.code} ${lab(p)}`, req.actor);
    done(res, `🗑 ${p.code} deleted.`);
  });

  // MATERIAL: new · add · cut   (Material · Type · Unit · Available · Opening stock · daily use · Total used · Note)
  const matKey = (n, t) => (clip(n, 100) + "|" + clip(t, 30)).toLowerCase();
  const matName = m => m.name + (m.type ? " " + m.type : "");
  router.post("/material/add", (req, res) => {
    const b = req.body || {}, name = clip(b.name, 100), type = clip(b.type, 30), unit = clip(b.unit, 20) || "pcs", group = up(b.group, 30) || "MATERIAL";
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
  router.post("/material/delete", (req, res) => {
    const m = findM(req.body?.id);
    if (!m) return fail(res, "Material not found.");
    db.materials = db.materials.filter(x => x !== m);
    audit("Report: material deleted", matName(m), req.actor);
    done(res, `🗑 ${matName(m)} deleted. Its movements stay in the log.`);
  });

  // BACKUP sheet
  router.post("/backup/connect", async (req, res) => {
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
  router.post("/backup/disconnect", async (req, res) => {
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
