// ── REPORTS (separate module + page: /reports.html) — MAIN ADMINS ONLY ───────────────────────
// Workflow Follow-up · Stock · Material reports, read LIVE from a SECOND Google Sheet (not the order sheet).
// The old order sheet / google-sheet-script.gs is not touched by this file at all.
//
//  • reports-sheet-script.gs is pasted into the NEW sheet (read-only Apps Script web app).
//  • The main admin pastes its /exec link + secret word once; the link is saved (file + Supabase) and restored on every start.
//  • Each report (wf / st / mt) is mapped to one or more tabs of that sheet (auto-guessed from the tab names, changeable).
//  • The page shows every tab exactly as it looks in the sheet (colours, merged cells) and makes the PDF in the phone.
//  • The finished PDF can also be sent to the admin's own Telegram chat by the bot (the reliable way inside Telegram).
//
// Render: set ONLY REPORTS_SCRIPT_URL (the …/exec link). REPORTS_SCRIPT_KEY is optional.
// Access: owner (main admin) only. Assigned admins and view-only admins get 403 on every endpoint.
const fs = require("fs");
const path = require("path");
const express = require("express");

const TYPES = {
  wf: { title: "Workflow Follow-up", guess: /work\s*-?\s*flow|follow/i },
  st: { title: "Stock Report", guess: /stock|shelf|gadget|other|finished/i },
  mt: { title: "Material Report", guess: /material/i }
};
const CACHE_MS = 45 * 1000;

function register(app, ctx) {
  const { requireAccess, supabase, baseDir, tgApi, helpers, log } = ctx;
  const audit = (event, detail, actor) => { try { log && log(event, detail, actor?.name || "Main admin"); } catch {} };
  const FILE = path.join(baseDir, "reports-sheet.json");
  let cfg = { scriptUrl: String(process.env.REPORTS_SCRIPT_URL || "").trim(), scriptKey: String(process.env.REPORTS_SCRIPT_KEY || "").trim(), tabs: { wf: [], st: [], mt: [] }, sheetName: "", sheetUrl: "", allTabs: [], savedAt: "" };
  const cache = new Map(); // tab name → { at, data }

  async function load() {
    let d = null;
    if (supabase) { try { const { data } = await supabase.from("app_settings").select("value").eq("key", "reports_sheet").maybeSingle(); if (data?.value && typeof data.value === "object") d = data.value; } catch {} }
    if (!d) { try { d = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {} }
    if (d && typeof d === "object") cfg = { ...cfg, ...d, tabs: { wf: [], st: [], mt: [], ...(d.tabs || {}) } };
    // Render variable REPORTS_SCRIPT_URL is the master link; the key is optional (like the old sheet).
    if (process.env.REPORTS_SCRIPT_URL) { cfg.scriptUrl = String(process.env.REPORTS_SCRIPT_URL).trim(); if (process.env.REPORTS_SCRIPT_KEY) cfg.scriptKey = String(process.env.REPORTS_SCRIPT_KEY).trim(); }
    autoSetup().catch(() => {});
  }
  // Link only (e.g. from Render): read the tab list and guess which tab is which, once.
  async function autoSetup() {
    if (!cfg.scriptUrl) return;
    if (cfg.allTabs?.length && Object.values(cfg.tabs).some(a => a.length)) return;
    const p = await callScript({ action: "ping" });
    cfg.allTabs = p.tabs || []; cfg.sheetName = p.name || ""; cfg.sheetUrl = p.url || "";
    if (!Object.values(cfg.tabs).some(a => a.length)) cfg.tabs = guessTabs(cfg.allTabs);
    await save();
  }
  async function save() {
    cfg.savedAt = new Date().toISOString();
    try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(cfg)); } catch {}
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "reports_sheet", value: cfg, updated_at: new Date().toISOString() }); } catch {} }
  }

  // ── talk to the reports script (same redirect handling as the order script) ──────────────────
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
    let r = await fetch(at, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...payload, key: key != null ? key : (cfg.scriptKey || "") }), redirect: "manual", signal: AbortSignal.timeout(60000) });
    for (let hop = 0; hop < 5 && r.status >= 300 && r.status < 400 && r.headers.get("location"); hop++) { at = new URL(r.headers.get("location"), at).href; r = await fetch(at, { redirect: "manual", signal: AbortSignal.timeout(60000) }); }
    const t = await r.text();
    let d;
    try { d = JSON.parse(t); } catch {
      const low = t.toLowerCase();
      if (low.includes("accounts.google.com") || low.includes("sign in") || r.status === 401 || r.status === 403) throw new Error("Google is asking visitors to sign in. Deploy the script again: Deploy → New deployment → Web app → Who has access: Anyone.");
      if (r.status === 404 || low.includes("page not found")) throw new Error("The Web app link was not found. Copy it again from Deploy → Manage deployments (it must end with /exec).");
      throw new Error(`The Google script did not answer correctly (HTTP ${r.status}). Make sure reports-sheet-script.gs is pasted in the NEW sheet, saved, and deployed as a Web app.`);
    }
    if (!d.ok) throw new Error(String(d.error || "The Google script refused the request."));
    return d;
  }

  function guessTabs(all) {
    const used = new Set(), out = { wf: [], st: [], mt: [] };
    for (const type of ["wf", "mt", "st"]) for (const name of all) if (!used.has(name) && TYPES[type].guess.test(name)) { out[type].push(name); used.add(name); }
    return out;
  }

  async function getGrid(tab, fresh) {
    const hit = cache.get(tab);
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    const d = await callScript({ action: "grid", tab });
    const data = { name: tab, rows: d.rows || [], merges: d.merges || [], colW: d.colW || [], rowH: d.rowH || [], rowNo: d.rowNo || [], colNo: d.colNo || [] };
    cache.set(tab, { at: Date.now(), data });
    return data;
  }

  // ── routes ─────────────────────────────────────────────────────────────────────────────────
  const router = express.Router();
  router.use(requireAccess);
  router.use((req, res, next) => req.actor?.role === "owner" ? next() : res.status(403).json({ ok: false, error: "Reports are for main admins only." }));

  const statusJson = () => ({
    ok: true, configured: !!cfg.scriptUrl, sheetName: cfg.sheetName || "", sheetUrl: cfg.sheetUrl || "",
    tabs: cfg.tabs, allTabs: cfg.allTabs || [], types: Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v.title])), savedAt: cfg.savedAt || ""
  });
  router.get("/status", async (req, res) => {
    if (cfg.scriptUrl && !cfg.allTabs?.length && !req.query.refresh) { try { await autoSetup(); } catch (e) { return res.json({ ...statusJson(), error: e.message }); } }
    if (req.query.refresh && cfg.scriptUrl) {
      try { const p = await callScript({ action: "ping" }); cfg.allTabs = p.tabs || []; cfg.sheetName = p.name || cfg.sheetName; cfg.sheetUrl = p.url || cfg.sheetUrl; await save(); } catch (e) { return res.json({ ...statusJson(), error: e.message }); }
    }
    res.json(statusJson());
  });
  router.post("/connect", async (req, res) => {
    try {
      const url = scriptUrl(req.body?.scriptUrl), key = String(req.body?.scriptKey || "").trim();
      const p = await callScript({ action: "ping" }, { url, key });
      cfg.scriptUrl = url; cfg.scriptKey = key; cfg.sheetName = p.name || ""; cfg.sheetUrl = p.url || ""; cfg.allTabs = p.tabs || [];
      cfg.tabs = guessTabs(cfg.allTabs); cache.clear();
      await save();
      res.json({ ...statusJson(), message: `✅ Connected to "${cfg.sheetName}". ${cfg.allTabs.length} tab(s) found.` });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });
  router.post("/map", async (req, res) => {
    const known = new Set(cfg.allTabs || []);
    for (const k of Object.keys(TYPES)) if (Array.isArray(req.body?.[k])) cfg.tabs[k] = req.body[k].map(String).filter(n => known.has(n));
    cache.clear(); await save();
    res.json({ ...statusJson(), message: "✅ Saved." });
  });
  router.post("/disconnect", async (req, res) => {
    cfg = { ...cfg, scriptUrl: "", scriptKey: "", tabs: { wf: [], st: [], mt: [] }, sheetName: "", sheetUrl: "", allTabs: [] }; cache.clear(); await save();
    res.json({ ...statusJson(), message: "Reports sheet disconnected. The order Google Sheet was not touched." });
  });
  // Step-by-step self check shown in the app: link → script → tabs → rows read from each chosen tab.
  router.get("/check", async (req, res) => {
    const steps = [], add = (ok, label, detail = "") => steps.push({ ok, label, detail });
    if (!cfg.scriptUrl) { add(false, "Link saved", "No link yet. Put the /exec link in Render as REPORTS_SCRIPT_URL (or paste it on the Reports page) and redeploy."); return res.json({ ok: true, steps }); }
    add(true, "Link saved", cfg.scriptUrl.replace(/^(.{38}).*(.{12})$/, "$1…$2"));
    let ping;
    try { ping = await callScript({ action: "ping" }); } catch (e) { add(false, "Google script answers", e.message); return res.json({ ok: true, steps }); }
    add(true, "Google script answers", `Sheet "${ping.name}" · script ${ping.version || "?"}`);
    cfg.allTabs = ping.tabs || []; cfg.sheetName = ping.name || cfg.sheetName; cfg.sheetUrl = ping.url || cfg.sheetUrl;
    add(cfg.allTabs.length > 0, "Tabs found", cfg.allTabs.join(" · ") || "The sheet has no tabs.");
    if (!Object.values(cfg.tabs).some(a => a.length)) { cfg.tabs = guessTabs(cfg.allTabs); }
    await save();
    for (const [k, v] of Object.entries(TYPES)) {
      const names = cfg.tabs[k] || [];
      if (!names.length) { add(false, v.title, "No tab chosen. Choose the tab on the Reports page."); continue; }
      for (const n of names) {
        try { const g = await getGrid(n, true); const cols = g.colW.length; add(g.rows.length > 0, `${v.title} → "${n}"`, g.rows.length ? `${g.rows.length} rows × ${cols} columns read` : "This tab is empty (no data and no colours were found). Choose another tab."); }
        catch (e) { add(false, `${v.title} → "${n}"`, e.message); }
      }
    }
    res.json({ ok: true, steps });
  });
  router.get("/data", async (req, res) => {
    const type = String(req.query.type || "");
    if (!TYPES[type]) return res.status(400).json({ ok: false, error: "Unknown report." });
    if (!cfg.scriptUrl) return res.json({ ok: false, code: "NOT_CONNECTED", error: "The reports sheet is not connected yet." });
    const names = cfg.tabs[type] || [];
    if (!names.length) return res.json({ ok: false, code: "NO_TAB", error: `No tab is chosen for ${TYPES[type].title}. Open ⚙ and choose the tab(s).` });
    try {
      const tabs = await Promise.all(names.map(n => getGrid(n, !!req.query.fresh)));
      res.json({ ok: true, type, title: TYPES[type].title, tabs, fetchedAt: new Date().toISOString(), sheetName: cfg.sheetName });
    } catch (e) { res.json({ ok: false, error: e.message }); }
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
  // ── EDIT inside the mini app (main admins only): change cells, insert a row, delete a row. Saved straight into the sheet. ──
  const allowedTab = tab => Object.values(cfg.tabs).some(a => a.includes(tab));
  const int = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : 0; };
  const editRoute = (name, build) => router.post("/" + name, async (req, res) => {
    try {
      const tab = String(req.body?.tab || "");
      if (!allowedTab(tab)) return res.json({ ok: false, error: "That tab is not part of a report." });
      const payload = build(req.body || {});
      if (typeof payload === "string") return res.json({ ok: false, error: payload });
      const d = await callScript({ ...payload, tab });
      cache.delete(tab);
      audit("Report edited", `${tab}: ${name}`, req.actor);
      res.json({ ok: true, ...d, message: d.skipped?.length ? "⚠ Not saved: " + d.skipped.join(", ") : "✅ Saved to the sheet." });
    } catch (e) { res.json({ ok: false, error: /Unknown action/i.test(e.message) ? "The Google script is the old version. Paste the new reports-sheet-script.gs and deploy a New version." : e.message }); }
  });
  editRoute("edit", b => {
    const cells = (Array.isArray(b.cells) ? b.cells : []).slice(0, 100).map(c => ({ r: int(c.r), c: int(c.c), v: String(c.v == null ? "" : c.v).slice(0, 2000) })).filter(c => c.r && c.c);
    return cells.length ? { action: "set", cells } : "Nothing to save.";
  });
  editRoute("add-row", b => int(b.row) ? { action: "addRow", row: int(b.row) } : "Choose a row.");
  editRoute("del-row", b => int(b.row) ? { action: "delRow", row: int(b.row) } : "Choose a row.");

  // The Apps Script text, so it can be copied from the page.
  router.get("/script", (req, res) => {
    try { res.type("text/plain; charset=utf-8").send(fs.readFileSync(path.join(__dirname, "reports-sheet-script.gs"), "utf8")); }
    catch { res.status(404).type("text/plain").send("reports-sheet-script.gs was not found on the server."); }
  });
  app.use("/api/reports", router);

  return { load };
}
module.exports = { register };
