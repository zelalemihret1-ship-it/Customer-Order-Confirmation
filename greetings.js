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
  let db = { templates: {}, log: [] };
  const busy = new Set(); // customer ids being greeted right now

  async function load() {
    let d = null;
    if (supabase) { try { const { data } = await supabase.from("app_settings").select("value").eq("key", "greetings").maybeSingle(); if (data?.value && Array.isArray(data.value.log)) d = data.value; } catch {} }
    if (!d) { try { const f = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); if (f && Array.isArray(f.log)) d = f; } catch {} }
    if (d) db = { templates: d.templates || {}, log: d.log };
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
  const sentRec = id => db.log.find(l => l.customerId === id && l.status === "sent");
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
      canSend: !!accountFor(a)?.ready || (owner && !!ownerConn()), accountReady: !!accountFor(a)?.ready, customers, log };
    if (owner) {
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
  return { load };
}
module.exports = { register };
