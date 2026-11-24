// ── CUSTOMER RATING (separate page: /rating.html, opened from the ⚙ Settings icon) ─────────────
// After an order is DELIVERED, the customer gets ONE message with a private rating link (/rate/<token>).
// On that page the customer taps 1–5 stars and may write a comment. One rating per order, never twice.
//
// How an order becomes "delivered":
//  • manual (default): the admin opens /rating.html and presses "✅ Delivered · send rating link" on the order;
//  • automatic (ON/OFF switch, per admin): when the order's Delivery Date has arrived the link is sent by itself
//    (only orders created by that admin; orders whose Delivery Date is older than AUTO_MAX_AGE_DAYS are ignored,
//    so switching it on never floods old customers).
//
// Every person works separately:
//  • assigned admin → sees and sends ONLY the orders they created, own message text, own ON/OFF switch;
//  • main admin     → sees every order + a team overview; own message text and switch (covers the orders the main admin created).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const MAX_TEXT = 1000;
const MAX_COMMENT = 1000;
const AUTO_TICK_MS = 30 * 60 * 1000;
const AUTO_MAX_AGE_DAYS = 14;
const DEFAULT_TEXT = "Hello {name} 👋\nYour order {order} ({product}) has been delivered. Thank you for choosing Ambar Furniture!\n\n⭐ How was it? Please rate your order — it takes 10 seconds:\n{link}";

function register(app, ctx) {
  const { requireAccess, getOrders, loadOrders, saveOrderRecord, telegram, admins, accountFor, resolveUser, businessConnections, isUsable, ownerIds,
    notifyAdminsText, supabase, helpers, baseDir, publicBaseUrl, noZoomHead, getAppAdmins, getCallers } = ctx;
  const DB_FILE = path.join(baseDir, "ratings.json");
  // links[orderId] = { token, sentAt, by, byKey, via, status:"sent"|"failed", error, auto, stars, comment, ratedAt }
  let db = { templates: {}, auto: {}, links: {}, log: [], base: "" };
  const busy = new Set();

  const BAK_FILE = path.join(baseDir, "ratings.bak.json");
  const norm = d => ({ templates: d?.templates || {}, auto: d?.auto || {}, links: d?.links || {}, log: d?.log || [], base: d?.base || "" });
  // Merge two copies of the data. A rated link always wins over an unrated one, so a rating can never be lost by an older / emptier copy.
  function mergeDb(a, b) {
    const out = norm(a), o = norm(b);
    for (const [id, r] of Object.entries(o.links)) {
      const cur = out.links[id];
      if (!cur || (!cur.stars && r.stars) || (!cur.stars && !r.stars && String(r.sentAt || "") > String(cur.sentAt || ""))) out.links[id] = r;
    }
    out.templates = { ...o.templates, ...out.templates }; out.auto = { ...o.auto, ...out.auto };
    out.base = out.base || o.base;
    const seen = new Set(out.log.map(x => x.orderId + "|" + x.at + "|" + x.status));
    for (const x of o.log) if (!seen.has(x.orderId + "|" + x.at + "|" + x.status)) out.log.push(x);
    return out;
  }
  async function load() {
    const parts = [];
    if (supabase) { try { const { data } = await supabase.from("app_settings").select("value").eq("key", "ratings").maybeSingle(); if (data?.value && data.value.links) parts.push(data.value); } catch {} }
    for (const f of [DB_FILE, BAK_FILE]) { try { const x = JSON.parse(fs.readFileSync(f, "utf8")); if (x && x.links) parts.push(x); } catch {} }
    if (parts.length) db = parts.reduce((acc, x) => mergeDb(acc, x), norm(parts[0]));
    if (parts.length > 1) save(); // write the merged result back everywhere
  }
  async function save() {
    db.log = db.log.slice(-2000);
    try { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); if (fs.existsSync(DB_FILE)) { try { fs.copyFileSync(DB_FILE, BAK_FILE); } catch {} } fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch {}
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "ratings", value: db, updated_at: new Date().toISOString() }); } catch {} }
  }

  // ── small helpers ──────────────────────────────────────────────────────────────
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clean = s => String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  const stamp = () => new Date().toLocaleString("sv-SE", { timeZone: helpers.TZ }).slice(0, 16);
  const actorKey = a => a?.telegramId ? String(a.telegramId) : (a?.role === "owner" ? "owner" : "");
  const isOwner = a => a?.role === "owner" || a?.role === "open";
  const isHttps = u => /^https:\/\//i.test(u || "");
  const baseUrl = () => isHttps(publicBaseUrl) ? publicBaseUrl : (isHttps(db.base) ? db.base : "");
  const rememberBase = req => {
    try {
      const host = req.get("x-forwarded-host") || req.get("host"), proto = (req.get("x-forwarded-proto") || req.protocol || "").split(",")[0].trim();
      if (host && proto === "https" && db.base !== proto + "://" + host) { db.base = proto + "://" + host; save(); }
    } catch {}
  };
  const myTemplate = a => db.templates[actorKey(a)] || DEFAULT_TEXT;
  const firstName = n => clean(n).split(/\s+/)[0] || "there";
  const render = (text, order, link, adminName) => text
    .replace(/\{name\}/gi, firstName(order.customerName)).replace(/\{fullname\}/gi, clean(order.customerName) || "there")
    .replace(/\{order\}/gi, order.orderId || "").replace(/\{product\}/gi, order.product || "furniture")
    .replace(/\{admin\}/gi, clean(adminName) || "Ambar Furniture").replace(/\{link\}/gi, link);
  const ensureLink = text => /\{link\}/i.test(text) ? text : text.trim() + "\n\n{link}"; // the link can never be forgotten
  const findOrder = id => getOrders().find(o => String(o.id) === String(id));
  const mine = (o, a) => isOwner(a) || (a?.telegramId && String(o.createdByTelegramId || "") === String(a.telegramId));
  const orderKeyOf = o => String(o.createdByTelegramId || "") || "owner";
  const ownerName = key => { const x = (getAppAdmins?.() || []).find(p => String(p.telegramId) === String(key)); return x?.name || "Ambar Furniture"; };

  function friendly(e) {
    const m = String(e?.errorMessage || e?.message || e || "");
    if (/FLOOD_WAIT|PEER_FLOOD|SLOWMODE/i.test(m)) return "Telegram asked to slow down (too many messages). Try again in a while.";
    if (/USER_PRIVACY|PRIVACY/i.test(m)) return "This customer's privacy settings do not allow messages from you.";
    if (/not on Telegram|USERNAME_NOT_OCCUPIED|No user has/i.test(m)) return "This customer could not be found on Telegram. Check the @username or phone number.";
    if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(m)) return "The admin's Telegram login expired. Connect the Telegram account again.";
    if (/chat not found|bot was blocked|Forbidden/i.test(m)) return "The customer has not opened the AMBAR bot (or blocked it), and no connected Telegram account could reach them.";
    return m.slice(0, 220) || "Could not send.";
  }

  // ── sending ────────────────────────────────────────────────────────────────────
  // Same route as the order card: the admin who created the order (own account) → Telegram Business → the AMBAR bot.
  async function sendToCustomer(order, text, link) {
    const errors = [];
    const acct = admins.get(String(order.adminId || ""));
    if (acct?.ready) {
      try { const entity = await resolveUser(acct.client, order); await acct.client.sendMessage(entity, { message: text }); return { via: acct.label || "admin account" }; }
      catch (e) { errors.push(friendly(e)); }
    }
    const chatId = /^\d{5,}$/.test(String(order.telegramChatId || "")) ? String(order.telegramChatId) : "";
    if (chatId) {
      const conn = [...businessConnections.values()].find(c => isUsable(c) && (String(c.user?.id || "") === String(order.createdByTelegramId || "") || (!order.createdByTelegramId && ownerIds.includes(String(c.user?.id || "")))));
      if (conn) {
        try { await telegram("sendMessage", { business_connection_id: String(conn.id), chat_id: chatId, text }, { retry: false }); return { via: "business account" }; }
        catch (e) { errors.push(friendly(e)); }
      }
      try {
        const body = { chat_id: chatId, text };
        if (link) body.reply_markup = { inline_keyboard: [[{ text: "⭐ Rate your order", url: link }]] };
        await telegram("sendMessage", body, { retry: false });
        return { via: "AMBAR bot" };
      } catch (e) { errors.push(friendly(e)); }
    }
    throw new Error(errors[0] || "No way to reach this customer: connect the Telegram account that created the order, or ask the customer to press Start in the AMBAR bot.");
  }

  // Marks the order delivered and sends (or re-sends) the rating link. opts: { by, byKey, auto, resend }
  async function deliverAndSend(order, opts) {
    const key = "o" + order.id;
    if (busy.has(key)) return { ok: false, skipped: true, error: "Being sent right now." };
    const rec0 = db.links[order.id];
    if (rec0?.stars) return { ok: false, skipped: true, error: "The customer already rated this order." };
    if (rec0?.status === "sent" && !opts.resend) return { ok: false, skipped: true, error: `The rating link was already sent (${rec0.sentAt}).` };
    const base = baseUrl();
    if (!base) return { ok: false, error: "No public https address yet. Set PUBLIC_BASE_URL (your https site address) in Render, redeploy, then try again." };
    busy.add(key);
    try {
      const rec = rec0 || (db.links[order.id] = { token: crypto.randomBytes(12).toString("hex") });
      const link = `${base}/rate/${rec.token}`;
      const adminName = opts.by || order.createdByName || "Ambar Furniture";
      const tpl = db.templates[opts.byKey] || db.templates[orderKeyOf(order)] || DEFAULT_TEXT;
      const text = render(ensureLink(tpl), order, link, adminName);
      try {
        const r = await sendToCustomer(order, text, link);
        Object.assign(rec, { orderCode: order.orderId || "", customerName: order.customerName || "", product: order.product || "", sentAt: stamp(), by: adminName, byKey: opts.byKey || orderKeyOf(order), via: r.via + (opts.auto ? " · automatic" : ""), status: "sent", error: "", auto: !!opts.auto });
        db.log.push({ orderId: order.id, order: order.orderId, name: order.customerName, at: rec.sentAt, by: adminName, via: rec.via, status: "sent" });
        if (!order.goodsDelivered) { order.goodsDelivered = true; order.goodsDeliveredAt = new Date().toISOString(); try { await saveOrderRecord(order); } catch (e) { console.warn("Delivered flag not saved:", e.message); } }
        await save();
        return { ok: true, via: rec.via };
      } catch (e) {
        const msg = friendly(e);
        Object.assign(rec, { status: "failed", error: msg, auto: !!opts.auto, by: adminName, byKey: opts.byKey || orderKeyOf(order), failedAt: stamp() });
        db.log.push({ orderId: order.id, order: order.orderId, name: order.customerName, at: stamp(), by: adminName, status: "failed", error: msg });
        await save();
        return { ok: false, error: msg };
      }
    } finally { busy.delete(key); }
  }

  // ── automatic sending when the Delivery Date has arrived ───────────────────────
  const autoOn = key => !!db.auto[String(key || "")];
  const todayEth = () => helpers.ethDate(new Date().toLocaleString("sv-SE", { timeZone: helpers.TZ }).slice(0, 10));
  // Ethiopian yyyy/mm/dd → approximate day number (enough to compare dates and count days; 30-day months)
  const dayNo = s => { const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(String(s || "")); return m ? (+m[1]) * 365 + (+m[2] - 1) * 30 + (+m[3]) : null; };
  let ticking = false;
  async function autoTick() {
    if (ticking || !Object.values(db.auto).some(Boolean)) return;
    ticking = true;
    try {
      if (supabase) { try { await loadOrders(); } catch {} }
      const today = dayNo(todayEth());
      for (const order of getOrders()) {
        const key = orderKeyOf(order);
        if (!autoOn(key) || !order.sent || order.status === "Rejected" || order.goodsDelivered || db.links[order.id]) continue;
        const dd = dayNo(helpers.ethDate(order.deliveryDate)); if (dd == null || today == null) continue;
        if (dd > today || today - dd > AUTO_MAX_AGE_DAYS) continue;
        await deliverAndSend(order, { by: ownerName(key), byKey: key, auto: true });
        await new Promise(r => setTimeout(r, 2500));
      }
    } catch (e) { console.warn("Auto rating tick:", e.message); } finally { ticking = false; }
  }
  function start() { setTimeout(autoTick, 20000).unref?.(); setInterval(autoTick, AUTO_TICK_MS).unref?.(); }

  // ── PUBLIC customer page (no login: the token in the link is the key) ──────────
  const byToken = t => { const id = Object.keys(db.links).find(k => db.links[k].token === t); return id ? { id, rec: db.links[id], order: findOrder(id) } : null; };
  function ratePage(order, rec) {
    const done = rec.stars ? `Thank you! You rated this order ${"★".repeat(rec.stars)}${"☆".repeat(5 - rec.stars)}.` : "";
    return `<!doctype html><html><head><meta charset="utf-8">${noZoomHead}<title>Rate your order — Ambar Furniture</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#e9e5da;color:#153a2e}.wrap{max-width:520px;margin:auto;padding:14px}.card{background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 14px 40px #0f2a2133}
.head{background:linear-gradient(135deg,#0f2f25,#1b4d3d);padding:18px 20px;border-bottom:4px solid #ffa939}.head b{color:#ffa939;font-size:22px;letter-spacing:1px}.head div{color:#f4efe3;font-size:12px;margin-top:4px;letter-spacing:1px}
.pad{padding:20px 18px 24px;text-align:center}h2{margin:0 0 6px;font-size:20px}.sub{color:#6d675d;font-size:14px;margin-bottom:14px}
.stars{display:flex;justify-content:center;gap:6px;margin:10px 0 4px}.stars button{background:none;border:0;font-size:46px;line-height:1;color:#d6d1c7;cursor:pointer;padding:4px}.stars button.on{color:#ffa939}
.lbl{min-height:22px;font-weight:800;margin-bottom:10px}textarea{width:100%;border:1px solid #cfd8d3;border-radius:12px;padding:12px;font-size:16px;min-height:96px;font-family:inherit}
.go{width:100%;border:0;border-radius:14px;padding:16px;font-size:16px;font-weight:800;margin-top:12px;cursor:pointer;background:#1f8a4c;color:#fff}.go:disabled{opacity:.45;cursor:not-allowed}
.msg{background:#f4f1ea;border-radius:12px;padding:14px;text-align:center;font-weight:700;margin-top:12px}</style></head><body><div class="wrap"><div class="card">
<div class="head"><b>AMBAR FURNITURE</b><div>ORDER ${esc(order?.orderId || "")}</div></div>
<div class="pad"><h2>How was your order?</h2><div class="sub">${esc(order?.product || "Your furniture")} — tap the stars to rate</div>
<div id="box" style="${done ? "display:none" : ""}"><div class="stars" id="st">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}</div><div class="lbl" id="lb"></div>
<textarea id="cm" maxlength="${MAX_COMMENT}" placeholder="Tell us more (optional)…"></textarea><button class="go" id="go" disabled>Send my rating</button></div>
<div class="msg" id="out" style="display:${done ? "block" : "none"}">${esc(done)}</div></div></div></div>
<script>const T=${JSON.stringify(rec.token)};let n=0;const L=["","😞 Very bad","😕 Bad","😐 OK","🙂 Good","🤩 Excellent"];
const st=document.getElementById("st"),lb=document.getElementById("lb"),go=document.getElementById("go"),out=document.getElementById("out");
function paint(){[...st.children].forEach((b,i)=>b.classList.toggle("on",i<n));lb.textContent=L[n]||"";go.disabled=!n;}
st.addEventListener("click",e=>{const b=e.target.closest("button[data-n]");if(!b)return;n=+b.dataset.n;paint();});
go.addEventListener("click",async()=>{go.disabled=true;try{const r=await fetch("/rate/"+T,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stars:n,comment:document.getElementById("cm").value})});const d=await r.json();out.style.display="block";out.textContent=d.message||d.error||"Done";if(d.ok){document.getElementById("box").style.display="none";}else go.disabled=false;}catch(e){out.style.display="block";out.textContent="Network error, please try again.";go.disabled=false;}});</script></body></html>`;
  }
  app.get("/rate/:token", async (req, res) => {
    const f = byToken(String(req.params.token || ""));
    if (!f) return res.status(404).send("Rating link not found.");
    if (!f.order && supabase) { try { await loadOrders(); f.order = findOrder(f.id); } catch {} }
    res.set("Cache-Control", "no-store").send(ratePage(f.order || {}, f.rec));
  });
  app.post("/rate/:token", express.json({ limit: "20kb" }), async (req, res) => {
    try {
      const f = byToken(String(req.params.token || ""));
      if (!f) return res.status(404).json({ ok: false, error: "Rating link not found." });
      if (f.rec.stars) return res.json({ ok: true, message: "Your rating was already received. Thank you!" });
      const stars = Math.round(Number(req.body?.stars));
      if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ ok: false, error: "Please tap 1 to 5 stars first." });
      const comment = clean(req.body?.comment).slice(0, MAX_COMMENT);
      Object.assign(f.rec, { stars, comment, ratedAt: stamp(), orderCode: f.order?.orderId || f.rec.orderCode || "", customerName: f.order?.customerName || f.rec.customerName || "", product: f.order?.product || f.rec.product || "" });
      await save();
      const o = f.order || {};
      notifyAdminsText({ ...o, createdByTelegramId: o.createdByTelegramId }, `⭐ <b>New rating ${stars}/5</b> ${"★".repeat(stars)}${"☆".repeat(5 - stars)}\n<b>Order:</b> ${esc(o.orderId || "")}\n<b>Customer:</b> ${esc(o.customerName || "")}${comment ? "\n\n" + esc(comment) : ""}`).catch(() => {});
      res.json({ ok: true, message: "✅ Thank you for rating Ambar Furniture!" });
    } catch (e) { res.status(500).json({ ok: false, error: "Server error, please try again." }); }
  });

  // ── ADMIN API ──────────────────────────────────────────────────────────────────
  const router = express.Router();
  router.use(requireAccess);
  router.use((req, res, next) => { rememberBase(req); next(); });

  const stateOf = o => {
    const r = db.links[o.id];
    if (r?.stars) return "rated";
    if (r?.status === "sent") return "sent";
    if (r?.status === "failed") return "failed";
    return o.goodsDelivered ? "delivered" : "waiting";
  };
  // A rating is tied to its order. If the order record got a new internal id (restore / reset / re-import), find it again by its Order ID code.
  function reattach() {
    let n = 0; const orders = getOrders(), ids = new Set(orders.map(o => String(o.id)));
    for (const [id, r] of Object.entries(db.links)) {
      if (ids.has(String(id))) continue;
      const code = r.orderCode || (db.log.find(x => String(x.orderId) === String(id) && x.order) || {}).order; // old data: the send log remembers the order code
      if (!code) continue;
      const o = orders.find(x => String(x.orderId || "") === String(code) && !db.links[x.id]);
      if (o) { db.links[o.id] = r; delete db.links[id]; n++; }
    }
    const live = new Set(Object.entries(db.links).filter(([id]) => ids.has(String(id))).map(([, r]) => r.token));
    for (const [id, r] of Object.entries(db.links)) if (!ids.has(String(id)) && live.has(r.token)) { delete db.links[id]; n++; }
    if (n) save();
  }
  router.get("/", async (req, res) => {
    const a = req.actor, key = actorKey(a), owner = isOwner(a);
    if (supabase) { try { await loadOrders(); } catch {} }
    try { reattach(); } catch {}
    for (const o of getOrders()) { const r = db.links[o.id]; if (r && !r.orderCode && o.orderId) r.orderCode = o.orderId; }
    const rows = getOrders().filter(o => mine(o, a) && (o.sent || db.links[o.id]?.stars)).sort((x, y) => (Number(y.id) || 0) - (Number(x.id) || 0)).map(o => {
      const r = db.links[o.id] || {};
      return { id: o.id, orderId: o.orderId, product: o.product || "", customer: o.customerName || "", deliveryDate: helpers.ethDate(o.deliveryDate) || "", status: o.status || "",
        state: stateOf(o), sentAt: r.sentAt || "", via: r.via || "", by: r.by || "", error: r.status === "failed" ? r.error : "", stars: r.stars || 0, comment: r.comment || "", ratedAt: r.ratedAt || "", owner: o.createdByName || "" };
    });
    // Ratings whose order record no longer exists (orders cleared / re-imported) are still shown, from what the rating itself remembers.
    const have = new Set(getOrders().map(o => String(o.id)));
    const tokens = new Set(Object.entries(db.links).filter(([id]) => have.has(String(id))).map(([, r]) => r.token));
    for (const [id, r] of Object.entries(db.links)) {
      if (!r.stars || have.has(String(id))) continue;
      if (tokens.has(r.token)) continue; // same rating already shown under its order
      tokens.add(r.token);
      if (!owner && String(r.byKey || "") !== key) continue;
      const lg = db.log.find(x => String(x.orderId) === String(id)) || {};
      rows.push({ id, orderId: r.orderCode || lg.order || "—", product: r.product || "", customer: r.customerName || lg.name || "Customer", deliveryDate: "", status: "", state: "rated", sentAt: r.sentAt || "", via: r.via || "", by: r.by || "",
        error: "", stars: r.stars, comment: r.comment || "", ratedAt: r.ratedAt || "", owner: r.by || "", orphan: true });
    }
    const rated = rows.filter(r => r.stars);
    const out = { ok: true, me: { role: a.role, name: a.name || "" }, template: myTemplate(a), defaultTemplate: DEFAULT_TEXT, auto: autoOn(key), https: !!baseUrl(),
      stats: { orders: rows.length, sent: rows.filter(r => r.state === "sent" || r.state === "rated").length, rated: rated.length, avg: rated.length ? Math.round(rated.reduce((s, r) => s + r.stars, 0) / rated.length * 10) / 10 : 0 }, orders: rows };
    if (owner) {
      const by = {};
      for (const o of getOrders()) { const r = db.links[o.id]; if (!r?.stars) continue; const k = o.createdByName || "Main admin"; by[k] = by[k] || { name: k, count: 0, sum: 0 }; by[k].count++; by[k].sum += r.stars; }
      out.people = Object.values(by).map(p => ({ name: p.name, count: p.count, avg: Math.round(p.sum / p.count * 10) / 10 }));
    }
    res.json(out);
  });
  // Full customer info for a rated order: the customer record + this order's details + every order of that customer with its rating.
  router.get("/customer/:id", async (req, res) => {
    const a = req.actor;
    if (supabase) { try { await loadOrders(); } catch {} }
    const o = findOrder(req.params.id);
    if (!o || !mine(o, a)) return res.status(404).json({ ok: false, error: "Order not found." });
    const list = (getCallers?.()?.list) || [];
    const c = list.find(x => String(x.id) === String(o.customerId || "")) || null;
    const rt = id => { const r = db.links[id] || {}; return { stars: r.stars || 0, comment: r.comment || "", ratedAt: r.ratedAt || "" }; };
    const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k] == null ? "" : obj[k]]));
    const order = pick(o, ["orderId", "product", "length", "width", "height", "material", "color", "style", "design", "handle", "door", "partition", "drawer", "additionalFeatures",
      "payment", "advance", "orderDate", "completionDate", "deliveryType", "deliveryService", "deliveryFee", "deliveryDate", "status", "createdByName", "location", "phone", "telegramUsername", "customerName"]);
    order.deliveryDate = helpers.ethDate(o.deliveryDate) || o.deliveryDate || "";
    const others = getOrders().filter(x => mine(x, a) && String(x.customerId || "") === String(o.customerId || "") && o.customerId).sort((x, y) => (Number(y.id) || 0) - (Number(x.id) || 0))
      .map(x => ({ id: x.id, orderId: x.orderId, product: x.product || "", status: x.status || "", ...rt(x.id) }));
    res.json({ ok: true, order, rating: rt(o.id), customer: c ? pick(c, ["id", "name", "phone", "additionalPhone", "username", "location", "customerStatus", "source", "salesName", "totalSpend", "orderId", "lastConversation", "date", "time", "createdBy"]) : null, orders: others });
  });
  router.post("/template", async (req, res) => {
    const t = clean(req.body?.text).slice(0, MAX_TEXT);
    if (!t) return res.status(400).json({ ok: false, error: "Write the message text." });
    db.templates[actorKey(req.actor)] = t; await save();
    res.json({ ok: true, message: "Message text saved." });
  });
  router.post("/auto", async (req, res) => {
    const key = actorKey(req.actor);
    if (!key) return res.status(400).json({ ok: false, error: "Open the app from Telegram so your admin identity is known." });
    const on = req.body?.on === true || req.body?.on === "true";
    const t = clean(req.body?.text).slice(0, MAX_TEXT); if (t) db.templates[key] = t;
    if (on && !baseUrl()) return res.status(400).json({ ok: false, error: "Set PUBLIC_BASE_URL (your https site address) in Render first." });
    db.auto[key] = on; await save();
    if (on) autoTick();
    res.json({ ok: true, on, message: on ? `🟢 Automatic rating link is ON. When an order's Delivery Date arrives, the customer gets the link once (orders up to ${AUTO_MAX_AGE_DAYS} days past their Delivery Date).` : "⚪ Automatic rating link is OFF." });
  });
  router.post("/send", async (req, res) => {
    const a = req.actor, key = actorKey(a);
    if (supabase) { try { await loadOrders(); } catch {} }
    const order = findOrder(req.body?.id);
    if (!order || !mine(order, a)) return res.status(404).json({ ok: false, error: "Order not found." });
    if (!order.sent) return res.status(400).json({ ok: false, error: "This order card was never delivered to the customer, so there is nobody to send the rating link to yet." });
    const r = await deliverAndSend(order, { by: a.name || "Admin", byKey: key || orderKeyOf(order), resend: req.body?.resend === true });
    if (r.ok) return res.json({ ok: true, message: `✅ Marked delivered. Rating link sent to ${order.customerName || "the customer"} (${r.via}).` });
    res.status(r.skipped ? 200 : 400).json({ ok: false, error: r.error });
  });

  // Main admin: download every rating as a file, and restore (merge) from such a file. Restoring never deletes anything.
  const ownerOnlyR = (req, res, next) => isOwner(req.actor) ? next() : res.status(403).json({ ok: false, error: "Only a main admin can do this." });
  router.get("/backup", ownerOnlyR, (req, res) => {
    res.set({ "Content-Type": "application/json", "Content-Disposition": `attachment; filename="ratings-backup-${stamp().slice(0, 10)}.json"` }).send(JSON.stringify(db));
  });
  router.post("/restore", ownerOnlyR, express.json({ limit: "20mb" }), async (req, res) => {
    const x = req.body?.data && typeof req.body.data === "object" ? req.body.data : req.body;
    if (!x || typeof x !== "object" || !x.links || typeof x.links !== "object") return res.status(400).json({ ok: false, error: "This is not a ratings backup file." });
    const before = Object.values(db.links).filter(r => r.stars).length;
    db = mergeDb(db, x); try { reattach(); } catch {} await save();
    const after = Object.values(db.links).filter(r => r.stars).length;
    res.json({ ok: true, message: `✅ Restored. Ratings: ${before} → ${after}.` });
  });

  // Main admin: re-enter a rating by hand (for example from the bot's "⭐ New rating" Telegram message) when a rating was lost.
  router.post("/manual", ownerOnlyR, async (req, res) => {
    if (supabase) { try { await loadOrders(); } catch {} }
    const order = findOrder(req.body?.id);
    if (!order) return res.status(404).json({ ok: false, error: "Order not found." });
    const stars = Math.round(Number(req.body?.stars));
    if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ ok: false, error: "Choose 1 to 5 stars." });
    const comment = clean(req.body?.comment).slice(0, MAX_COMMENT);
    const rec = db.links[order.id] || (db.links[order.id] = { token: crypto.randomBytes(12).toString("hex"), status: "sent", sentAt: stamp(), by: req.actor.name || "Admin", byKey: orderKeyOf(order), via: "restored by admin" });
    Object.assign(rec, { stars, comment, ratedAt: clean(req.body?.ratedAt).slice(0, 20) || stamp(), orderCode: order.orderId || "", customerName: order.customerName || "", product: order.product || "", manual: true });
    if (!order.goodsDelivered) { order.goodsDelivered = true; order.goodsDeliveredAt = new Date().toISOString(); try { await saveOrderRecord(order); } catch {} }
    await save();
    res.json({ ok: true, message: `⭐ Rating ${stars}/5 saved for ${order.orderId || "the order"}.` });
  });

  app.use("/api/ratings", router);
  return { load, start, autoTick };
}
module.exports = { register };
