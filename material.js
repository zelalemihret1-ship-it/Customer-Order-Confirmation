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
  const R = () => ctx.reports || {};
  const DATA_FILE = path.join(baseDir, "material-data.json");
  let db = { editRequests: [], savedAt: "" }; // cut + add requests live in Reports (v165 / v175); the edit requests live here

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
    if (d && typeof d === "object") db = { editRequests: [], savedAt: "", ...d };
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
      pending: q.pending, history: q.history // main admin: everything waiting · other admins: their own requests
    };
  }

  // ── routes ──────────────────────────────────────────────────────────────────────────────────
  const router = express.Router();
  router.use(requireAccess);
  // the Material section is open to admins who have "material" (or the older "workshop" section) — the main admin always
  router.use((req, res, next) => {
    const a = req.actor, ok = isOwnerA(a) || (a?.perms || []).includes("material") || (a?.perms || []).includes("workshop");
    return ok ? next() : res.status(403).json({ ok: false, error: "The main admin has not given you the Material section. Ask them to turn it on in Manage Admins." });
  });
  router.use(express.json({ limit: "1mb" }));
  router.get("/state", (req, res) => res.json(view(req.actor)));

  // ✂️ CUT
  router.post("/cut", (req, res) => {
    const a = req.actor, b = req.body || {};
    if (isOwnerA(a)) {
      const r = R().wsCutNow({ id: b.id, qty: b.qty }, { name: by(a), telegramId: tid(a) }, clip(b.note, 200) || "Cut");
      return res.json({ ...view(a), ok: !!r.ok, error: r.error, message: r.ok ? `✂️ Cut ${r.qty} ${r.unit} of ${r.material}. Left: ${r.after}.` : undefined });
    }
    const r = R().wsRequestCut({ id: b.id, qty: b.qty, note: b.note }, { name: by(a), telegramId: tid(a) });
    res.json({ ...view(a), ok: !!r.ok, error: r.error, pendingConfirmation: !!r.ok, message: r.ok ? `⏳ Cut request sent for confirmation: ${r.request.material}${r.request.mtype ? " " + r.request.mtype : ""} ${r.request.qty} ${r.request.unit}. The stock changes only after the main admin approves.` : undefined });
  });

  // ➕ ADD (kind "new" = a new material, kind "add" = more stock on an existing material)
  router.post("/add", (req, res) => {
    const a = req.actor, b = req.body || {}, kind = b.kind === "new" ? "new" : "add";
    if (isOwnerA(a)) {
      const r = R().wsMaterial(kind === "new" ? "add" : "move", kind === "new" ? { name: b.name, type: b.type, unit: b.unit, group: b.group, qty: b.qty, min: b.min, note: b.note } : { id: b.id, type: "add", qty: b.qty, note: b.note }, by(a));
      return res.json({ ...view(a), ok: r.ok, error: r.error, message: r.ok ? r.message : undefined });
    }
    const r = R().wsRequestAdd(kind, b, { name: by(a), telegramId: tid(a) });
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
    const a = req.actor, b = req.body || {}, e = cleanEdit(b);
    if (e.error) return res.json({ ...view(a), ok: false, error: e.error });
    if (isOwnerA(a)) {
      const r = await applyEdit(e, { name: by(a), telegramId: tid(a), role: a.role }, b.note);
      return res.json({ ...view(a), ok: !!r.ok, error: r.error, message: r.ok ? `✅ ${e.name}${e.type ? " " + e.type : ""} saved.` : undefined });
    }
    if (db.editRequests.some(x => x.status === "pending" && x.materialId === e.m.id)) return res.json({ ...view(a), ok: false, error: `${e.m.name}${e.m.type ? " " + e.m.type : ""} already has an edit waiting for confirmation.` });
    const changes = { name: e.name, type: e.type, unit: e.unit, min: e.min, qty: e.qty };
    const rq = { id: uid(), materialId: e.m.id, material: e.m.name, mtype: e.m.type || "", unit: e.m.unit || "", qty: e.qty === null ? 0 : e.qty, before: e.m.qty, after: e.qty === null ? e.m.qty : e.qty, note: clip(b.note, 200), by: by(a), telegramId: tid(a), created: stamp(), status: "pending", decidedBy: "", decidedAt: "", decisionNote: "", changes };
    db.editRequests.push(rq); if (db.editRequests.length > 300) db.editRequests.splice(0, db.editRequests.length - 300);
    persist();
    res.json({ ...view(a), ok: true, pendingConfirmation: true, message: `⏳ Edit of ${label(rq)} sent for confirmation. Nothing changes until the main admin approves it.` });
  });

  // ✅ / ❌ the main admin decides
  router.post("/decide", async (req, res) => {
    const a = req.actor, b = req.body || {};
    if (!isOwnerA(a)) return res.json({ ...view(a), ok: false, error: "Only the main admin can approve or reject." });
    const approve = b.approve === true || b.approve === "true", actor = { name: by(a), telegramId: tid(a), role: a.role }, id = String(b.id || "");
    let r;
    if (b.kind === "cut") r = R().wsApproveCut(id, approve, actor, b.note);
    else if (b.kind === "add") r = R().wsApproveAdd(id, approve, actor, b.note);
    else if (b.kind === "edit") {
      const rq = db.editRequests.find(x => x.id === id);
      if (!rq) r = { ok: false, error: "Request not found." };
      else if (rq.status !== "pending") r = { ok: false, error: "This request was already decided." };
      else {
        rq.decidedBy = by(a); rq.decidedAt = stamp(); rq.decisionNote = clip(b.note, 200);
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
    res.json({ ...view(a), ok: !!r.ok, error: r.error, message: r.ok ? r.message : undefined });
  });

  app.get("/api/material-version", (req, res) => res.json({ ok: true, material: "v177" }));
  app.use("/api/material", router);
  return { load, pending: () => allRequests({ role: "owner" }).pending.length };
}
module.exports = { register };
