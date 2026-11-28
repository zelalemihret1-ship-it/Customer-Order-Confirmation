// v178: ALERT to the main admin (Telegram message with ✅ Approve / ❌ Reject buttons + red alert on Home and on the Material page) · the sender sees ⏳ Waiting confirmation and gets a Telegram message when it is decided.
// ── MATERIAL v177 (module + page: /material.html) ───────────────────────────────────────────────
// The Material section of the Home screen. Same materials and same movement log as Reports → Material (view-only there).
//   ✂️ Cut · ➕ Add (new material or more stock) · ✏️ Edit (name, type, unit, low-stock alert, stock correction)
// CONFIRMATION: the main admin's own changes apply at once. Every change made by any other admin waits in "Confirmation"
// until the main admin approves it (nothing reaches the stock before that) or rejects it.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const uid = () => crypto.randomBytes(6).toString("hex");
const numOf = v => { const n = Number(String(v == null ? "" : v).replace(/,/g, "").trim()); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN; };

function register(app, ctx) {
  const { requireAccess, supabase, baseDir, helpers } = ctx;
  const esc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const owners = () => [...new Set((ctx.ownerIds || []).map(String).filter(x => /^\d+$/.test(x)))];
  const R = () => ctx.reports || {};
  const DATA_FILE = path.join(baseDir, "material-data.json");
  let db = { editRequests: [], confirmGroup: null, rights: {}, savedAt: "" }; // cut + add requests live in Reports (v165 / v175); the edit requests live here

  // ── storage (file + Supabase), same pattern as the other modules ────────────────────────────
  let chain = Promise.resolve();
  const persist = () => (chain = chain.then(async () => {
    db.savedAt = new Date().toISOString();
    try { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch {}
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "material_data", value: db, updated_at: new Date().toISOString() }); } catch {} }
  }).catch(() => {}));
  async function load() {
    let d = null;
    if (supabase) { try { const { data } = await supabase.from("app_settings").select("value").eq("key", "material_data").maybeSingle(); if (data?.value && typeof data.value === "object") d = data.value; } catch {} }
    if (!d) { try { d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch {} }
    if (d && typeof d === "object") db = { editRequests: [], confirmGroup: null, rights: {}, savedAt: "", ...d };
    if (!db.rights || typeof db.rights !== "object" || Array.isArray(db.rights)) db.rights = {};
    if (!Array.isArray(db.editRequests)) db.editRequests = [];
  }

  const isOwnerA = a => a?.role === "owner" || a?.role === "open";
  const nowEth = () => { const g = new Date().toLocaleString("sv-SE", { timeZone: helpers.TZ || "Africa/Addis_Ababa" }); return { d: helpers.ethDate(g.slice(0, 10)), t: g.slice(11, 16) }; };
  const stamp = () => { const n = nowEth(); return n.d + " " + n.t; };
  const by = a => clip(a?.name || "Admin", 60);
  const tid = a => String(a?.telegramId || "");
  const mine = (a, r) => isOwnerA(a) || String(r.telegramId || "") === tid(a);
  const label = r => (r.material || "") + (r.mtype ? " " + r.mtype : "");
  const reports = () => (typeof R().wsMaterials === "function" ? R().wsMaterials() : { materials: [], groups: [] });
  const findMat = id => reports().materials.find(m => m.id === String(id || ""));

  // ── the three kinds of waiting request, in one common shape for the page ───────────────────
  const shape = (kind, r) => ({ kind, id: r.id, materialId: r.materialId || "", material: r.material, mtype: r.mtype || "", unit: r.unit || "", qty: r.qty, before: r.before, after: r.after, note: r.note || "", by: r.by || "", telegramId: r.telegramId || "", created: r.created || "", status: r.status, decidedBy: r.decidedBy || "", decidedAt: r.decidedAt || "", decisionNote: r.decisionNote || "", addKind: r.kind || "", changes: r.changes || null });
  function allRequests(actor) {
    const out = [];
    for (const r of (typeof R().wsCutRequests === "function" ? R().wsCutRequests() : [])) out.push(shape("cut", r));
    for (const r of (typeof R().wsAddRequests === "function" ? R().wsAddRequests() : [])) out.push(shape("add", r));
    for (const r of db.editRequests) if (r.status === "pending") out.push(shape("edit", r));
    const pending = out.filter(r => mine(actor, r)).sort((a, b) => String(b.created).localeCompare(String(a.created)));
    const hist = [];
    for (const r of (typeof R().wsAddHistory === "function" ? R().wsAddHistory(isOwnerA(actor) ? "" : tid(actor), 15) : [])) hist.push(shape("add", r));
    for (const r of db.editRequests) if (r.status !== "pending" && mine(actor, r)) hist.push(shape("edit", r));
    hist.sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)));
    return { pending, history: hist.slice(0, 15) };
  }
  // Reports keeps no history list of decided CUT requests, so the page shows decided adds and edits; cuts leave a trace in the movement log.

  function view(actor) {
    const r = reports(), q = allRequests(actor), owner = isOwnerA(actor);
    return {
      ok: true, me: { name: by(actor), owner }, materials: r.materials, groups: r.groups,
      pending: q.pending, history: q.history, waitingCount: q.pending.length,
      can: { cut: can(actor, "cut"), add: can(actor, "add"), edit: can(actor, "edit") }, confirmGroup: cg(), confirmGroupName: cgName(),
      admins: owner ? adminList().map(a => ({ telegramId: String(a.telegramId), name: clip(a.name, 60) || "Admin " + a.telegramId, cut: can({ telegramId: a.telegramId }, "cut"), add: can({ telegramId: a.telegramId }, "add"), edit: can({ telegramId: a.telegramId }, "edit") })) : [] // main admin: everything waiting · other admins: their own requests
    };
  }


  // ── v178 ALERTS ─────────────────────────────────────────────────────────────────────────────
  const ICON = { cut: "✂️ Cut", add: "➕ Add", edit: "✏️ Edit" };
  const fnum = n => { n = Number(n); return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "—"; };
  function reqText(q) { // plain description of a waiting request (shape())
    const n = q.material + (q.mtype ? " " + q.mtype : "");
    const L = [];
    if (q.kind === "cut") L.push(`${ICON.cut} · ${n}`, `Quantity: ${fnum(q.qty)} ${q.unit}`, `Stock: ${fnum(q.before)} → ${fnum(q.after)} ${q.unit}`);
    else if (q.kind === "add") L.push(q.addKind === "new" ? `🆕 New material · ${n}` : `${ICON.add} · ${n}`, `Quantity: +${fnum(q.qty)} ${q.unit}`, `Stock: ${fnum(q.before)} → ${fnum(q.after)} ${q.unit}`);
    else {
      L.push(`${ICON.edit} · ${n}`);
      const c = q.changes || {};
      if (c.name && c.name !== q.material) L.push(`Name: ${q.material} → ${c.name}`);
      if ((c.type || "") !== (q.mtype || "")) L.push(`Type: ${q.mtype || "—"} → ${c.type || "—"}`);
      if (c.unit && c.unit !== q.unit) L.push(`Unit: ${q.unit || "—"} → ${c.unit}`);
      if (c.min) L.push(`Low-stock alert: ${fnum(c.min)}`);
      if (c.qty !== null && c.qty !== undefined) L.push(`Stock: ${fnum(q.before)} → ${fnum(c.qty)}`);
    }
    return L;
  }
  // 🔔 a waiting request → posted in the Telegram group TOPIC the main admin selected (Material page → Confirmation group). Nothing is sent to private chats.
  const cg = () => db.confirmGroup && db.confirmGroup.chat ? db.confirmGroup : null;
  const cgName = () => { const g = cg(); return g ? (g.title || g.chat) + (g.topic ? " › " + (g.topicTitle || "topic " + g.topic) : "") : ""; };
  const chatKey = g => /^-?\d+$/.test(String(g.chat)) ? String(g.chat) : "@" + String(g.chat).replace(/^@/, "");
  const tgSend = async (text, markup) => {
    const g = cg(); if (!g || !ctx.tgApi) return null;
    try { return await ctx.tgApi.call("sendMessage", { chat_id: chatKey(g), ...(g.topic > 1 ? { message_thread_id: g.topic } : {}), text: text.slice(0, 4000), parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) }); } catch (e) { console.warn("Material: could not post in the confirmation topic:", e.message); return null; }
  };
  function alertOwners(q) {
    const txt = ["🔔 <b>MATERIAL — needs main admin confirmation</b>", "", ...reqText(q).map(esc), "", "👤 " + esc(q.by) + (q.created ? " · " + esc(q.created) : ""), q.note ? "📝 " + esc(q.note) : "", "⏳ The stock does NOT change until the main admin approves."].filter(x => x !== "" || true).join("\n");
    tgSend(txt, { inline_keyboard: [[{ text: "✅ Approve", callback_data: `mat:y:${q.kind}:${q.id}` }, { text: "❌ Reject", callback_data: `mat:n:${q.kind}:${q.id}` }]] });
  }
  // the decision is posted in the same topic
  function tellSender(q, approved, r, by) {
    if (!q) return;
    const head = approved && r.ok ? "✅ <b>MATERIAL — approved</b>" : "❌ <b>MATERIAL — " + (approved ? "could not be applied" : "rejected") + "</b>";
    tgSend([head, "", ...reqText(q).map(esc), "", "👤 " + esc(q.by), (approved && r.ok ? "Approved" : "Decided") + " by " + esc(by), r.ok ? "" : esc(r.error || "")].join("\n").trim());
  }
  // ── v179 who may Cut / Add (selected by the main admin). No selection yet = allowed (as before).
  const adminList = () => ((typeof ctx.getAppAdmins === "function" ? ctx.getAppAdmins() : []) || []).filter(a => a && /^\d+$/.test(String(a.telegramId)) && !owners().includes(String(a.telegramId)) && (!Array.isArray(a.perms) || a.perms.includes("material") || a.perms.includes("workshop")));
  const can = (a, what) => { if (isOwnerA(a)) return true; const r = db.rights[tid(a)]; if (!r) return true; if (what === "edit" && r.edit === undefined) return r.add !== false; /* older selections: Edit followed Add */ return r[what] !== false; };
  const noRight = what => ({ ok: false, error: `The main admin has not given you ${what === "cut" ? "✂️ Cut" : what === "edit" ? "✏️ Edit" : "➕ Add"} in Material.` });
  const alertView = () => ({ owners: owners().length });

  // ✅ / ❌ one decision, used by the page and by the Telegram buttons
  async function decideReq(kind, id, approve, a, note) {
    const actor = { name: by(a), telegramId: tid(a), role: a.role };
    let snap = null, r;
    if (kind === "cut") { const f = (R().wsCutRequests() || []).find(x => String(x.id) === id); if (f) snap = shape("cut", f); r = R().wsApproveCut(id, approve, actor, note); }
    else if (kind === "add") { const f = (R().wsAddRequests() || []).find(x => String(x.id) === id); if (f) snap = shape("add", f); r = R().wsApproveAdd(id, approve, actor, note); }
    else if (kind === "edit") {
      const rq = db.editRequests.find(x => x.id === id);
      if (!rq) r = { ok: false, error: "Request not found." };
      else if (rq.status !== "pending") r = { ok: false, error: "This request was already decided." };
      else {
        snap = shape("edit", rq);
        rq.decidedBy = by(a); rq.decidedAt = stamp(); rq.decisionNote = clip(note, 200);
        if (!approve) { rq.status = "rejected"; persist(); r = { ok: true, message: `❌ Edit rejected: ${label(rq)}. Nothing changed.` }; }
        else {
          const m = findMat(rq.materialId);
          if (!m) { rq.status = "rejected"; rq.decisionNote = "Material no longer exists."; persist(); r = { ok: false, error: "The material no longer exists. The request was closed." }; }
          else {
            const e = cleanEdit({ id: m.id, name: rq.changes.name, type: rq.changes.type, unit: rq.changes.unit, min: rq.changes.min, qty: rq.changes.qty == null ? "" : rq.changes.qty });
            if (e.error) { rq.status = "rejected"; rq.decisionNote = clip("Could not be applied: " + e.error, 200); persist(); r = { ok: false, error: "Could not apply it: " + e.error + " The request was closed." }; }
            else {
              const out = await applyEdit(e, { name: rq.by, telegramId: rq.telegramId, role: "admin" }, (rq.note ? rq.note + " · " : "") + "Approved by " + by(a));
              if (!out.ok) { rq.status = "rejected"; rq.decisionNote = clip("Could not be applied: " + out.error, 200); persist(); r = { ok: false, error: "Could not apply it: " + out.error + " The request was closed." }; }
              else { rq.status = "approved"; persist(); r = { ok: true, message: `✅ Approved: ${label(rq)} edited.` }; }
            }
          }
        }
      }
    } else r = { ok: false, error: "Unknown request." };
    if (snap && !/already decided|not found/i.test(r.error || "")) tellSender(snap, approve, r, by(a));
    return r;
  }
  // Telegram button (called from server.js for callback data "mat:y|n:kind:id")
  async function handleCallback(cb) {
    const m = /^mat:([yn]):(cut|add|edit):([0-9a-f]{6,32})$/.exec(String(cb?.data || "")); if (!m) return false;
    const answer = (text, alert) => ctx.tgApi.call("answerCallbackQuery", { callback_query_id: cb.id, text: String(text || "").slice(0, 190), ...(alert ? { show_alert: true } : {}) }).catch(() => {});
    const from = String(cb.from?.id || "");
    if (!owners().includes(from)) { await answer("Only the main admin can approve or reject.", true); return true; }
    const name = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") || "Main admin";
    const approve = m[1] === "y", r = await decideReq(m[2], m[3], approve, { name, telegramId: from, role: "owner" }, "");
    await answer(r.ok ? (approve ? "✅ Approved" : "❌ Rejected") : (r.error || "Could not apply."), !r.ok);
    if (cb.message?.chat?.id && cb.message?.message_id) {
      const done = r.ok ? (approve ? "✅ Approved by " : "❌ Rejected by ") + name : (/already decided/i.test(r.error || "") ? "ℹ️ Already decided." : "⚠️ " + (r.error || "Not applied."));
      ctx.tgApi.call("editMessageText", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: String(cb.message.text || "Material request").slice(0, 3800) + "\n\n" + done, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    }
    return true;
  }

  // ── routes ──────────────────────────────────────────────────────────────────────────────────
  const router = express.Router();
  router.use(requireAccess);
  // the Material section is open to admins who have "material" — the main admin always
  router.use((req, res, next) => {
    const a = req.actor, ok = isOwnerA(a) || (a?.perms || []).includes("material"); // v191: its own switch (admins saved before v191 who had Workshop were given it automatically)
    return ok ? next() : res.status(403).json({ ok: false, error: "The main admin has not given you the Material section. Ask them to turn it on in Manage Admins." });
  });
  router.use(express.json({ limit: "1mb" }));
  router.get("/state", (req, res) => res.json(view(req.actor)));

  // ✂️ CUT
  router.post("/cut", (req, res) => {
    const a = req.actor, b = req.body || {};
    if (!can(a, "cut")) return res.json({ ...view(a), ...noRight("cut") });
    if (isOwnerA(a)) {
      const r = R().wsCutNow({ id: b.id, qty: b.qty }, { name: by(a), telegramId: tid(a) }, clip(b.note, 200) || "Cut");
      return res.json({ ...view(a), ok: !!r.ok, error: r.error, message: r.ok ? `✂️ Cut ${r.qty} ${r.unit} of ${r.material}. Left: ${r.after}.` : undefined });
    }
    const r = R().wsRequestCut({ id: b.id, qty: b.qty, note: b.note }, { name: by(a), telegramId: tid(a) });
    if (r.ok) alertOwners(shape("cut", r.request));
    res.json({ ...view(a), ok: !!r.ok, error: r.error, pendingConfirmation: !!r.ok, message: r.ok ? `⏳ Cut request sent for confirmation: ${r.request.material}${r.request.mtype ? " " + r.request.mtype : ""} ${r.request.qty} ${r.request.unit}. The stock changes only after the main admin approves.` : undefined });
  });

  // ➕ ADD (kind "new" = a new material, kind "add" = more stock on an existing material)
  router.post("/add", (req, res) => {
    const a = req.actor, b = req.body || {}, kind = b.kind === "new" ? "new" : "add";
    if (!can(a, "add")) return res.json({ ...view(a), ...noRight("add") });
    if (isOwnerA(a)) {
      const r = R().wsMaterial(kind === "new" ? "add" : "move", kind === "new" ? { name: b.name, type: b.type, unit: b.unit, group: b.group, qty: b.qty, min: b.min, note: b.note } : { id: b.id, type: "add", qty: b.qty, note: b.note }, by(a));
      return res.json({ ...view(a), ok: r.ok, error: r.error, message: r.ok ? r.message : undefined });
    }
    const r = R().wsRequestAdd(kind, b, { name: by(a), telegramId: tid(a) });
    if (r.ok) alertOwners(shape("add", r.request));
    res.json({ ...view(a), ok: !!r.ok, error: r.error, pendingConfirmation: !!r.ok, message: r.ok ? r.message : undefined });
  });

  // ✏️ EDIT (name · type · unit · low-stock alert · and, if wanted, the real stock quantity)
  function cleanEdit(b) {
    const m = findMat(b.id); if (!m) return { error: "Material not found." };
    const name = clip(b.name, 100), type = clip(b.type, 30), unit = clip(b.unit, 20) || "pcs";
    if (!name) return { error: "Write the material name." };
    const min = (b.min === "" || b.min == null) ? 0 : numOf(b.min);
    if (Number.isNaN(min) || min < 0) return { error: "The low-stock alert must be a number." };
    let qty = null;
    if (!(b.qty === "" || b.qty == null)) { qty = numOf(b.qty); if (Number.isNaN(qty) || qty < 0) return { error: "Write the correct quantity (0 or more)." }; if (qty === m.qty) qty = null; }
    const same = (m.name === name && (m.type || "") === type && (m.unit || "") === unit && (m.min || 0) === min && qty === null);
    if (same) return { error: "Nothing was changed." };
    const key = (n, t) => (clip(n, 100) + "|" + clip(t, 30)).toLowerCase();
    if (reports().materials.some(x => x.id !== m.id && key(x.name, x.type) === key(name, type))) return { error: `“${name}${type ? " " + type : ""}” already exists.` };
    return { m, name, type, unit, min, qty, group: m.group };
  }
  async function applyEdit(e, actor, note) { // runs the same Reports handlers the old Workshop used → same log and same Google Sheet backup
    const body = { id: e.m.id, name: e.name, type: e.type, unit: e.unit, min: e.min, group: e.group };
    if (e.name !== e.m.name || (e.type || "") !== (e.m.type || "") || (e.unit || "") !== (e.m.unit || "") || (e.min || 0) !== (e.m.min || 0)) {
      const r = await R().wsOp("/material/edit", body, actor); if (!r.ok) return r;
    }
    if (e.qty !== null) {
      const r = await R().wsOp("/material/correct", { id: e.m.id, qty: e.qty, note: clip(note, 160) || "Edited in Material" }, actor); if (!r.ok) return r;
    }
    return { ok: true };
  }
  router.post("/edit", async (req, res) => {
    const a = req.actor, b = req.body || {};
    if (!can(a, "edit")) return res.json({ ...view(a), ...noRight("edit") });
    const e = cleanEdit(b);
    if (e.error) return res.json({ ...view(a), ok: false, error: e.error });
    if (isOwnerA(a)) {
      const r = await applyEdit(e, { name: by(a), telegramId: tid(a), role: a.role }, b.note);
      return res.json({ ...view(a), ok: !!r.ok, error: r.error, message: r.ok ? `✅ ${e.name}${e.type ? " " + e.type : ""} saved.` : undefined });
    }
    if (db.editRequests.some(x => x.status === "pending" && x.materialId === e.m.id)) return res.json({ ...view(a), ok: false, error: `${e.m.name}${e.m.type ? " " + e.m.type : ""} already has an edit waiting for confirmation.` });
    const changes = { name: e.name, type: e.type, unit: e.unit, min: e.min, qty: e.qty };
    const rq = { id: uid(), materialId: e.m.id, material: e.m.name, mtype: e.m.type || "", unit: e.m.unit || "", qty: e.qty === null ? 0 : e.qty, before: e.m.qty, after: e.qty === null ? e.m.qty : e.qty, note: clip(b.note, 200), by: by(a), telegramId: tid(a), created: stamp(), status: "pending", decidedBy: "", decidedAt: "", decisionNote: "", changes };
    db.editRequests.push(rq); if (db.editRequests.length > 300) db.editRequests.splice(0, db.editRequests.length - 300);
    persist(); alertOwners(shape("edit", rq));
    res.json({ ...view(a), ok: true, pendingConfirmation: true, message: `⏳ Edit of ${label(rq)} sent for confirmation. Nothing changes until the main admin approves it.` });
  });

  // ✅ / ❌ the main admin decides
  // main admin: the Telegram group + topic where confirmations are posted, and who may Cut / Add
  const ownerOnly = (req, res) => isOwnerA(req.actor) ? true : (res.json({ ...view(req.actor), ok: false, error: "Only the main admin can change this." }), false);
  router.post("/confirm-group", (req, res) => {
    if (!ownerOnly(req, res)) return;
    const g = req.body?.group || {}, chat = String(g.chat || "").trim().replace(/^https?:\/\/t\.me\//i, "").replace(/^@+/, "");
    if (!(/^-?\d{5,20}$/.test(chat) || /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(chat))) return res.json({ ...view(req.actor), ok: false, error: "Choose a Telegram group first." });
    const t = Number(g.topic);
    db.confirmGroup = { chat, title: clip(g.title, 80), topic: Number.isInteger(t) && t > 1 ? t : 0, topicTitle: clip(g.topicTitle, 80) };
    persist(); res.json({ ...view(req.actor), ok: true, message: "✅ Saved. Material confirmations are posted in " + cgName() + "." });
  });
  router.post("/confirm-group/clear", (req, res) => { if (!ownerOnly(req, res)) return; db.confirmGroup = null; persist(); res.json({ ...view(req.actor), ok: true, message: "Confirmation group removed." }); });
  router.post("/confirm-group/test", async (req, res) => {
    if (!ownerOnly(req, res)) return;
    if (!cg()) return res.json({ ...view(req.actor), ok: false, error: "Choose the confirmation group first." });
    const r = await tgSend("<b>AMBAR MATERIAL TEST</b>\nMaterial confirmations are posted here. The bot must be in this group.");
    res.json({ ...view(req.actor), ok: !!r, error: r ? undefined : "The AMBAR bot could not post there. Add the bot to the group (as admin) and check the topic.", message: r ? "✅ Test posted in " + cgName() + "." : undefined });
  });
  router.post("/rights", (req, res) => {
    if (!ownerOnly(req, res)) return;
    const id = String(req.body?.telegramId || "");
    if (!adminList().some(a => String(a.telegramId) === id)) return res.json({ ...view(req.actor), ok: false, error: "Admin not found." });
    const cur = db.rights[id] || {};
    const was = k => can({ telegramId: id }, k), pick = k => req.body?.[k] === undefined ? was(k) : !!req.body[k];
    db.rights[id] = { cut: pick("cut"), add: pick("add"), edit: pick("edit") };
    persist(); res.json({ ...view(req.actor), ok: true });
  });
  router.post("/decide", async (req, res) => {
    const a = req.actor, b = req.body || {};
    if (!isOwnerA(a)) return res.json({ ...view(a), ok: false, error: "Only the main admin can approve or reject." });
    const r = await decideReq(String(b.kind || ""), String(b.id || ""), b.approve === true || b.approve === "true", a, b.note);
    res.json({ ...view(a), ok: !!r.ok, error: r.error, message: r.ok ? r.message : undefined });
  });

  app.get("/api/material-version", (req, res) => res.json({ ok: true, material: "v181" }));
  app.use("/api/material", router);
  // v191 START FROM ZERO / backup: only the edit requests are cleared; the admins\' rights and the confirmation group stay.
  const zeroSnapshot = () => JSON.parse(JSON.stringify({ editRequests: db.editRequests }));
  async function zeroWipe() { const n = { editRequests: db.editRequests.length }; db.editRequests = []; await persist(); return n; }
  async function zeroRestore(snap) { if (!snap || typeof snap !== "object") return false; db.editRequests = Array.isArray(snap.editRequests) ? snap.editRequests : []; await persist(); return true; }
  return { load, handleCallback, pending: () => allRequests({ role: "owner" }).pending.length, zeroSnapshot, zeroWipe, zeroRestore };
}
module.exports = { register };
