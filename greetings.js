// ── FIRST GREETING (separate page: /greeting.html, opened from the ⚙ Settings icon) ─────────────
// Sends a customer their FIRST message: one plain TEXT greeting, nothing else (no photo, no card, no buttons).
// A customer who already received a first greeting is never greeted again.
//
// Every person works separately:
//  • assigned admin → own greeting text, sends ONLY from their own connected Telegram account, sees their own log;
//  • main admin     → own greeting text + overview of every admin's greetings; may also send through the
//                     shared Telegram Business connection when no personal account is connected.
const fs = require("fs");
const path = require("path");
const express = require("express");

const MAX_TEXT = 1000;
const MAX_BATCH = 30;
const GAP_MS = 1500; // pause between messages so Telegram does not rate-limit the account
const DEFAULT_TEXT = "Hello {name} 👋\nWelcome to Ambar Furniture! Thank you for contacting us. This is {admin} — how can I help you today?";

function register(app, ctx) {
  const { requireAccess, accountFor, resolveUser, getCallers, businessConnections, isUsable, ownerIds, telegram, resolveChatId, supabase, helpers, baseDir } = ctx;
  const DB_FILE = path.join(baseDir, "greetings.json");
  let db = { templates: {}, log: [], auto: {} };
  const busy = new Set(); // customer ids being greeted right now

  async function load() {
    let d = null;
    if (supabase) { try { const { data } = await supabase.from("app_settings").select("value").eq("key", "greetings").maybeSingle(); if (data?.value && Array.isArray(data.value.log)) d = data.value; } catch {} }
    if (!d) { try { const f = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); if (f && Array.isArray(f.log)) d = f; } catch {} }
    if (d) db = { templates: d.templates || {}, log: d.log, auto: d.auto || {} };
  }
  async function save() {
    db.log = db.log.slice(-3000);
    try { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch {}
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "greetings", value: db, updated_at: new Date().toISOString() }); } catch {} }
  }

  const stamp = () => new Date().toLocaleString("sv-SE", { timeZone: helpers.TZ }).slice(0, 16);
  const actorKey = a => a?.telegramId ? String(a.telegramId) : (a?.role === "owner" ? "owner" : "");
  const isOwner = a => a?.role === "owner";
  const clean = s => String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  const sentRec = id => db.log.find(l => (l.customerId === id || (l.tgId && l.tgId === id)) && l.status === "sent");
  const ownerConn = () => [...businessConnections.values()].find(c => isUsable(c) && ownerIds.includes(String(c.user?.id || ""))) || null;
  const firstName = n => clean(n).split(/\s+/)[0] || "there";
  const render = (text, cust, actor) => text.replace(/\{name\}/gi, firstName(cust.name)).replace(/\{fullname\}/gi, clean(cust.name) || "there").replace(/\{admin\}/gi, clean(actor.name) || "Ambar Furniture");
  const myTemplate = a => db.templates[actorKey(a)] || DEFAULT_TEXT;

  function friendly(e) {
    const m = String(e?.errorMessage || e?.message || e || "");
    if (/FLOOD_WAIT|PEER_FLOOD|SLOWMODE/i.test(m)) return "Telegram asked to slow down (too many messages). Wait a while and send fewer at a time.";
    if (/USER_PRIVACY|PRIVACY/i.test(m)) return "This customer's privacy settings do not allow messages from you.";
    if (/not on Telegram|USERNAME_NOT_OCCUPIED|No user has/i.test(m)) return "This customer could not be found on Telegram. Check the @username or phone number in Customers Data.";
    if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(m)) return "Your Telegram login expired. Connect your Telegram account again.";
    return m.slice(0, 220) || "Could not send.";
  }

  // Sends ONE plain text message. Returns { via }.
  async function sendText(actor, cust, text) {
    const account = accountFor(actor);
    if (account?.ready) {
      const base = { telegramUsername: cust.username, phone: cust.phone, customerName: cust.name };
      let entity, last;
      for (const rec of [base, cust.additionalPhone ? { ...base, telegramUsername: "", phone: cust.additionalPhone } : null]) {
        if (!rec) continue;
        try { entity = await resolveUser(account.client, rec); break; } catch (e) { last = e; }
      }
      if (!entity) throw last || new Error("Customer not found on Telegram.");
      await account.client.sendMessage(entity, { message: text });
      return { via: "own account" };
    }
    if (isOwner(actor)) { // main admin without a personal account: shared Telegram Business connection
      const conn = ownerConn();
      const chatId = resolveChatId("", cust.username);
      if (conn && chatId) { await telegram("sendMessage", { business_connection_id: String(conn.id), chat_id: String(chatId), text }, { retry: false }); return { via: "business account" }; }
      throw new Error(conn ? "To greet through the Business account the customer must have opened the AMBAR bot. Connect your own Telegram account in ⚙ Settings to greet anyone." : "Connect your Telegram account in ⚙ Settings first.");
    }
    throw new Error("Your Telegram account is not connected. Open ⚙ Settings → Connect my Telegram account.");
  }


  // ── AUTOMATIC first greeting (the ON/OFF switch) ─────────────────────────────────
  // When an admin switches it ON, the first time a NEW person writes to that admin in a private chat,
  // a single plain-text greeting is sent back automatically. Nobody is ever greeted twice.
  const autoOn = key => !!db.auto[String(key || "")];
  const matchCustomer = (username, phone) => {
    const u = String(username || "").replace(/^@/, "").toLowerCase(), p = String(phone || "").replace(/\D/g, "").replace(/^0+/, "").replace(/^251/, "");
    return getCallers().list.find(c => (u && String(c.username || "").replace(/^@/, "").toLowerCase() === u) || (p.length >= 7 && [c.phone, c.additionalPhone].some(x => String(x || "").replace(/\D/g, "").replace(/^0+/, "").replace(/^251/, "") === p))) || null;
  };
  const humanDelay = () => new Promise(r => setTimeout(r, 2000 + Math.random() * 2500));
  async function autoSend({ key, adminName, tgId, name, username, via, send }) {
    const lockKey = "tg:" + tgId;
    if (busy.has(lockKey)) return;
    const cust = matchCustomer(username, "");
    const custId = cust ? cust.id : lockKey;
    if (sentRec(custId) || sentRec(lockKey)) return; // already greeted: only the FIRST text, once
    busy.add(lockKey);
    try {
      const text = render(db.templates[key] || DEFAULT_TEXT, { name: name || (cust && cust.name) || "" }, { name: adminName });
      await humanDelay();
      await send(text);
      db.log.push({ customerId: custId, tgId: lockKey, name: name || (cust && cust.name) || username || String(tgId), by: adminName || "Admin", byKey: key, at: stamp(), status: "sent", via: via + " · automatic", auto: true, saved: !!cust, text });
      await save();
    } catch (e) {
      db.log.push({ customerId: custId, tgId: lockKey, name: name || username || String(tgId), by: adminName || "Admin", byKey: key, at: stamp(), status: "failed", error: "Automatic: " + friendly(e), auto: true });
      await save();
    } finally { busy.delete(lockKey); }
  }
  // 1) someone writes to an admin's own connected Telegram account
  async function autoPersonal(admin, msg) {
    const key = String(admin.ownerTelegramId || ownerIds[0] || "");
    if (!autoOn(key) || !msg || msg.out || !msg.isPrivate) return;
    const sender = await msg.getSender();
    if (!sender || sender.bot || sender.self || sender.deleted) return;
    const peer = await msg.getInputChat();
    const hist = await admin.client.getMessages(peer, { limit: 3 });
    if (hist.length > 1) return; // there was a conversation before: this is not a first message
    const name = [sender.firstName, sender.lastName].filter(Boolean).join(" ");
    await autoSend({ key, adminName: admin.label, tgId: String(sender.id), name, username: sender.username ? "@" + sender.username : "", via: "own account",
      send: text => admin.client.sendMessage(peer, { message: text }) });
  }
  // 2) someone writes to the main admin through the shared Telegram Business connection
  async function autoBusiness(bm, isNewChat) {
    const conn = businessConnections.get(String(bm?.business_connection_id || ""));
    const key = String(conn?.user?.id || "");
    if (!isNewChat || !autoOn(key) || !bm?.chat || bm.chat.type !== "private" || bm.from?.is_bot) return;
    if (bm.from?.id !== undefined && String(bm.from.id) !== String(bm.chat.id)) return; // the admin's own message
    const name = [bm.chat.first_name, bm.chat.last_name].filter(Boolean).join(" ");
    await autoSend({ key, adminName: ownerName(key), tgId: String(bm.chat.id), name, username: bm.chat.username ? "@" + bm.chat.username : "", via: "business account",
      send: text => telegram("sendMessage", { business_connection_id: String(conn.id), chat_id: String(bm.chat.id), text }, { retry: false }) });
  }
  // 3) someone writes to the AMBAR bot itself (covered by the main admin's switch)
  async function autoBot(m, isNewChat) {
    const key = ownerIds.find(autoOn);
    if (!key || !isNewChat || !m?.chat || m.chat.type !== "private" || m.from?.is_bot) return;
    const id = String(m.chat.id);
    if (ownerIds.includes(id) || (ctx.getAppAdmins() || []).some(a => String(a.telegramId) === id)) return; // never greet the admins themselves
    const name = [m.chat.first_name, m.chat.last_name].filter(Boolean).join(" ");
    await autoSend({ key, adminName: ownerName(key), tgId: id, name, username: m.chat.username ? "@" + m.chat.username : "", via: "AMBAR bot",
      send: text => telegram("sendMessage", { chat_id: id, text }, { retry: false }) });
  }
  const ownerName = key => { const a = (ctx.getAppAdmins() || []).find(x => String(x.telegramId) === String(key)); return a?.name || "Ambar Furniture"; };

  const router = express.Router();
  router.use(requireAccess);

  router.get("/", (req, res) => {
    const a = req.actor, key = actorKey(a), owner = isOwner(a);
    const customers = [...getCallers().list].sort((x, y) => (y.seq || 0) - (x.seq || 0)).map(c => {
      const g = sentRec(c.id);
      return { id: c.id, name: c.name, phone: c.phone, username: c.username || "", greeted: g ? { by: g.by, at: g.at } : null };
    });
    const log = (owner ? db.log : db.log.filter(l => l.byKey === key)).slice(-200).reverse();
    const out = { ok: true, me: { role: a.role, name: a.name || "" }, template: myTemplate(a), defaultTemplate: DEFAULT_TEXT, limits: { text: MAX_TEXT, batch: MAX_BATCH },
      auto: autoOn(key), autoLocked: !owner, canSend: !!accountFor(a)?.ready || (owner && !!ownerConn()), accountReady: !!accountFor(a)?.ready, customers, log };
    if (owner) {
      // v121: the main admin switches the automatic greeting ON / OFF for every admin (assigned admins cannot)
      const seen = new Set(), team = [];
      for (const id of [...ownerIds, ...(ctx.getAppAdmins() || []).map(x => x.telegramId)].map(String).filter(Boolean)) {
        if (seen.has(id)) continue; seen.add(id);
        const isMain = ownerIds.includes(id);
        team.push({ key: id, name: ownerName(id) === "Ambar Furniture" && isMain ? "Main admin" : ownerName(id), main: isMain, on: autoOn(id), connected: !!accountFor({ role: isMain ? "owner" : "admin", telegramId: id })?.ready });
      }
      out.team = team;
      const by = {};
      for (const l of db.log) { const k = l.byKey || "?"; by[k] = by[k] || { name: l.by, sent: 0, failed: 0 }; by[k][l.status === "sent" ? "sent" : "failed"]++; by[k].name = l.by || by[k].name; }
      out.people = Object.values(by);
    }
    res.json(out);
  });

  router.post("/template", async (req, res) => {
    const t = clean(req.body?.text).slice(0, MAX_TEXT);
    if (!t) return res.status(400).json({ ok: false, error: "Write the greeting text." });
    db.templates[actorKey(req.actor)] = t; await save();
    res.json({ ok: true, message: "Greeting text saved." });
  });

  router.post("/auto", async (req, res) => {
    const a = req.actor, own = actorKey(a);
    if (!isOwner(a)) return res.status(403).json({ ok: false, error: "Only the main admin can switch the automatic greeting ON or OFF. Ask the main admin." });
    const target = String(req.body?.target || own || "");
    if (!target || target === "owner") return res.status(400).json({ ok: false, error: "Open the app from Telegram so your admin identity is known." });
    const known = ownerIds.map(String).includes(target) || (ctx.getAppAdmins() || []).some(x => String(x.telegramId) === target);
    if (!known) return res.status(400).json({ ok: false, error: "That admin was not found." });
    const on = req.body?.on === true || req.body?.on === "true";
    const t = clean(req.body?.text).slice(0, MAX_TEXT);
    if (t && target === own) db.templates[own] = t;
    if (on && !db.templates[target]) db.templates[target] = DEFAULT_TEXT;
    if (on && target === own && !(accountFor(a)?.ready || ownerConn())) return res.status(400).json({ ok: false, error: "Connect your Telegram account first (⚙ Settings → Connect my Telegram account), then switch this on." });
    db.auto[target] = on; await save();
    const who = target === own ? "your" : ownerName(target) + "'s";
    res.json({ ok: true, on, target, message: on ? `🟢 Automatic greeting is ON for ${target === own ? "you" : ownerName(target)}.` : `⚪ Automatic greeting is OFF for ${target === own ? "you" : ownerName(target)}.` });
  });

  router.post("/send", async (req, res) => {
    const a = req.actor, key = actorKey(a);
    if (!key) return res.status(400).json({ ok: false, error: "Open the app from Telegram so your admin identity is known." });
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String))].slice(0, MAX_BATCH);
    if (!ids.length) return res.status(400).json({ ok: false, error: "Select at least one customer." });
    const text = clean(req.body?.text || myTemplate(a)).slice(0, MAX_TEXT);
    if (!text) return res.status(400).json({ ok: false, error: "Write the greeting text." });
    const results = [];
    for (const id of ids) {
      const cust = getCallers().list.find(c => c.id === id);
      if (!cust) { results.push({ id, ok: false, error: "Customer not found." }); continue; }
      const prev = sentRec(id);
      if (prev) { results.push({ id, name: cust.name, ok: false, skipped: true, error: `Already greeted by ${prev.by} on ${prev.at}. The first greeting is sent only once.` }); continue; }
      if (busy.has(id)) { results.push({ id, name: cust.name, ok: false, skipped: true, error: "Being greeted right now." }); continue; }
      busy.add(id);
      try {
        const body = render(text, cust, a);
        const r = await sendText(a, cust, body);
        db.log.push({ customerId: id, name: cust.name, by: a.name || "Admin", byKey: key, at: stamp(), status: "sent", via: r.via, text: body });
        await save();
        results.push({ id, name: cust.name, ok: true });
      } catch (e) {
        const msg = friendly(e);
        db.log.push({ customerId: id, name: cust.name, by: a.name || "Admin", byKey: key, at: stamp(), status: "failed", error: msg });
        await save();
        results.push({ id, name: cust.name, ok: false, error: msg });
        if (/slow down/i.test(msg)) break;
      } finally { busy.delete(id); }
      if (id !== ids[ids.length - 1]) await new Promise(r => setTimeout(r, GAP_MS));
    }
    const sent = results.filter(r => r.ok).length;
    res.json({ ok: true, sent, results, message: `✅ ${sent} greeting(s) sent` + (results.length - sent ? `, ${results.length - sent} not sent.` : ".") });
  });

  app.use("/api/greetings", router);
  return { load, autoPersonal, autoBusiness, autoBot };
}
module.exports = { register };
