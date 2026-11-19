// ── WEEKLY STORY PLANNER (separate page: /stories.html, opened from the ⚙ Settings icon) ─────────────
// An admin uploads 7 photos ONCE. Day 1 = photo 1, Day 2 = photo 2 … Day 7 = photo 7: every photo is
// posted as a Telegram story exactly once, on its own day, and never again.
//
// Every person works separately:
//  • assigned admin  → own plans only, posted ONLY from their own connected Telegram account;
//  • main admin      → own plans (own account or the shared Telegram Business connection)
//                      PLUS a team view: sees every admin's plans, can pause / resume / delete them
//                      (but never posts through another admin's account).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");

const DAYS = 7;
const MAX_CAPTION = 200;
const PERIODS = [6 * 3600, 12 * 3600, 86400, 2 * 86400];
const TICK_MS = 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_MIN = 10;

function register(app, ctx) {
  const { requireAccess, accountFor, admins, businessConnections, isUsable, ownerIds, tgApi, supabase, helpers, baseDir } = ctx;
  const TZ = helpers.TZ;
  const DIR = path.join(baseDir, "stories");
  const DB_FILE = path.join(baseDir, "story-plans.json");
  let plans = [];
  const posting = new Set(); // "planId:day" currently being posted — never post the same photo twice at once

  // ── storage ────────────────────────────────────────────────────────────────────
  async function load() {
    let list = null;
    if (supabase) { try { const { data } = await supabase.from("app_settings").select("value").eq("key", "story_plans").maybeSingle(); if (Array.isArray(data?.value)) list = data.value; } catch {} }
    if (!list) { try { const f = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); if (Array.isArray(f)) list = f; } catch {} }
    plans = list || [];
    // A post that was interrupted by a restart is NOT retried automatically (it may already be on Telegram).
    let changed = false;
    for (const p of plans) for (const d of p.days) if (d.status === "posting") { d.status = "failed"; d.error = "Interrupted by a restart. Check your Telegram stories; press Post now only if this photo is not there."; d.attempts = MAX_ATTEMPTS; changed = true; }
    if (changed) await save();
  }
  async function save() {
    try { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); fs.writeFileSync(DB_FILE, JSON.stringify(plans)); } catch {}
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "story_plans", value: plans, updated_at: new Date().toISOString() }); } catch {} }
  }
  const photoFile = (id, n) => path.join(DIR, `${id}-${n}.jpg`);
  async function savePhotos(id, buffers) {
    fs.mkdirSync(DIR, { recursive: true });
    buffers.forEach((b, i) => fs.writeFileSync(photoFile(id, i + 1), b));
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "story_photos_" + id, value: { photos: buffers.map(b => b.toString("base64")) }, updated_at: new Date().toISOString() }); } catch (e) { console.warn("Story photos backup failed:", e.message); } }
  }
  async function getPhoto(id, n) {
    try { return fs.readFileSync(photoFile(id, n)); } catch {}
    if (supabase) {
      try {
        const { data } = await supabase.from("app_settings").select("value").eq("key", "story_photos_" + id).maybeSingle();
        const arr = data?.value?.photos;
        if (Array.isArray(arr)) { fs.mkdirSync(DIR, { recursive: true }); arr.forEach((b, i) => { try { fs.writeFileSync(photoFile(id, i + 1), Buffer.from(b, "base64")); } catch {} }); if (arr[n - 1]) return Buffer.from(arr[n - 1], "base64"); }
      } catch {}
    }
    return null;
  }
  async function dropPhotos(id) {
    for (let n = 1; n <= DAYS; n++) { try { fs.unlinkSync(photoFile(id, n)); } catch {} }
    if (supabase) { try { await supabase.from("app_settings").delete().eq("key", "story_photos_" + id); } catch {} }
  }

  // ── time helpers (the shop's own time zone) ─────────────────────────────────────
  const nowLocal = () => new Date().toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 16); // "YYYY-MM-DD HH:MM"
  const todayLocal = () => nowLocal().slice(0, 10);
  const addDays = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
  const validTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const eth = ymd => { try { return helpers.ethDate(ymd); } catch { return ""; } };

  // ── who is who ──────────────────────────────────────────────────────────────────
  const actorKey = a => a?.telegramId ? String(a.telegramId) : (a?.role === "owner" ? "owner" : "");
  const isOwner = a => a?.role === "owner";
  const canSee = (a, p) => isOwner(a) || p.ownerKey === actorKey(a);
  const ownerConnection = () => [...businessConnections.values()].find(c => isUsable(c) && ownerIds.includes(String(c.user?.id || "")) && c.rights?.can_manage_stories !== false) || null;
  const accountOf = p => accountFor({ role: p.ownerRole, telegramId: p.ownerTelegramId });
  function pickAccount(p) { // ONLY the plan owner's own account — never another admin's session
    const a = accountOf(p);
    return a && a.ready ? a : null;
  }

  // ── posting ─────────────────────────────────────────────────────────────────────
  function friendly(e) {
    const m = String(e?.errorMessage || e?.message || e || "");
    if (/PREMIUM_ACCOUNT_REQUIRED|STORY_PERIOD_INVALID/i.test(m)) return "Telegram only allows this story duration on a Premium account. Use 24 hours.";
    if (/STORIES_TOO_MUCH|STORY_SEND_FLOOD/i.test(m)) return "Telegram's story limit was reached (too many stories today). It will be tried again.";
    if (/can_manage_stories|BUSINESS_PEER_INVALID|not enough rights/i.test(m)) return "The Telegram Business connection has no permission to manage stories. In Telegram → Settings → Business → Chatbots, allow \"Manage stories\" for the bot.";
    if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(m)) return "The Telegram account login expired. Connect your Telegram account again.";
    return m.slice(0, 240) || "Telegram refused the story.";
  }
  async function sendViaAccount(account, p, day, buf, caption) {
    const { Api } = require("telegram");
    const { CustomFile } = require("telegram/client/uploads");
    const { generateRandomBigInt } = require("telegram/Helpers");
    const file = await account.client.uploadFile({ file: new CustomFile(`story-${day.n}.jpg`, buf.length, "", buf), workers: 1 });
    const params = {
      peer: new Api.InputPeerSelf(),
      media: new Api.InputMediaUploadedPhoto({ file }),
      privacyRules: [p.privacy === "contacts" ? new Api.InputPrivacyValueAllowContacts() : new Api.InputPrivacyValueAllowAll()],
      randomId: generateRandomBigInt(),
      period: p.period,
      pinned: !!p.pinned
    };
    if (caption) params.caption = caption;
    const res = await account.client.invoke(new Api.stories.SendStory(params));
    let storyId = "";
    try { for (const u of res.updates || []) if (u instanceof Api.UpdateStory && u.story?.id != null) storyId = String(u.story.id); } catch {}
    return storyId;
  }
  async function sendViaBusiness(conn, p, day, buf, caption) {
    const r = await tgApi.sendForm("postStory", () => {
      const f = new FormData();
      f.append("business_connection_id", String(conn.id));
      f.append("content", JSON.stringify({ type: "photo", photo: "attach://story" }));
      f.append("story", new Blob([buf], { type: "image/jpeg" }), "story.jpg");
      f.append("active_period", String(p.period));
      if (caption) f.append("caption", caption);
      if (p.pinned) f.append("post_to_chat_page", "true");
      return f;
    });
    return r?.id != null ? String(r.id) : "";
  }
  async function notify(p, text) {
    const targets = new Set([p.ownerTelegramId, ...ownerIds].filter(Boolean).map(String));
    for (const id of targets) { try { await tgApi.call("sendMessage", { chat_id: id, text }, { retry: false }); } catch {} }
  }
  // Posts ONE day's photo. Returns { ok, waiting?, error? }. A day that is already "posted" is never posted again.
  async function postDay(p, day, manual) {
    const key = p.id + ":" + day.n;
    if (day.status === "posted") return { ok: true, already: true };
    if (posting.has(key)) return { ok: false, error: "Already posting this photo." };
    posting.add(key);
    try {
      let account = null, conn = null;
      if (p.via === "business") { conn = ownerConnection(); if (!conn) return { ok: false, waiting: true, error: "No active Telegram Business connection with the \"Manage stories\" permission." }; }
      else { account = pickAccount(p); if (!account) return { ok: false, waiting: true, error: "Your Telegram account is not connected. Open ⚙ Settings → Connect my Telegram account." }; }
      const buf = await getPhoto(p.id, day.n);
      if (!buf) { day.status = "failed"; day.error = "The saved photo could not be found."; day.attempts = MAX_ATTEMPTS; await save(); return { ok: false, error: day.error }; }
      day.status = "posting"; day.error = ""; await save(); // saved BEFORE sending: a crash can never cause a second copy
      const caption = String(day.caption || p.caption || "").slice(0, MAX_CAPTION);
      try {
        day.storyId = conn ? await sendViaBusiness(conn, p, day, buf, caption) : await sendViaAccount(account, p, day, buf, caption);
        day.status = "posted"; day.postedAt = nowLocal(); day.error = ""; await save();
        return { ok: true };
      } catch (e) {
        day.attempts = (day.attempts || 0) + 1; day.error = friendly(e);
        day.status = "failed"; day.nextTry = addMinutes(RETRY_MIN);
        await save();
        if (day.attempts >= MAX_ATTEMPTS && !manual) notify(p, `⚠️ Story ${day.n}/${DAYS} of "${p.title}" could not be posted: ${day.error}\nOpen ⚙ Settings → Weekly Story and press Post now.`);
        return { ok: false, error: day.error };
      }
    } finally { posting.delete(key); }
  }
  const addMinutes = n => { const d = new Date(Date.now() + n * 60000); return d.toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 16); };

  function refreshStatus(p) {
    if (p.status === "paused" || p.status === "cancelled") return;
    p.status = p.days.every(d => d.status === "posted" || d.status === "missed") ? "done" : "active";
  }
  let ticking = false;
  async function tick() {
    if (ticking) return; ticking = true;
    try {
      const now = nowLocal(), today = now.slice(0, 10);
      for (const p of plans) {
        if (p.status !== "active") continue;
        let dirty = false;
        for (const d of p.days) {
          if ((d.status === "pending" || d.status === "failed") && d.date < today) { // its day is over: never post it late
            d.status = "missed"; d.error = d.error || "Missed: the day passed before it could be posted. Use Post now if you still want it."; dirty = true;
          }
        }
        // the earliest due day of this plan goes first; one story per plan per tick
        const due = p.days.find(d => (d.status === "pending" && `${d.date} ${p.postTime}` <= now) || (d.status === "failed" && (d.attempts || 0) < MAX_ATTEMPTS && (d.nextTry || "") <= now && d.date >= today));
        if (due) await postDay(p, due, false);
        refreshStatus(p);
        if (dirty) await save();
      }
      await save();
    } catch (e) { console.warn("Story scheduler:", e.message); }
    finally { ticking = false; }
  }
  let timer = null;
  async function start() { await load(); if (!timer) { timer = setInterval(tick, TICK_MS); setTimeout(tick, 15000); } }

  // ── API ─────────────────────────────────────────────────────────────────────────
  const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: DAYS } });
  const router = express.Router();
  router.use(requireAccess);

  const view = (p, a) => ({
    id: p.id, title: p.title, status: p.status, via: p.via, period: p.period, privacy: p.privacy, pinned: !!p.pinned,
    caption: p.caption, startDate: p.startDate, postTime: p.postTime, createdAt: p.createdAt,
    ownerName: p.ownerName, ownerRole: p.ownerRole, mine: p.ownerKey === actorKey(a),
    days: p.days.map(d => ({ n: d.n, date: d.date, eth: eth(d.date), caption: d.caption || "", status: d.status, postedAt: d.postedAt || "", error: d.error || "", attempts: d.attempts || 0 }))
  });

  router.get("/", (req, res) => {
    const a = req.actor, mine = plans.filter(p => p.ownerKey === actorKey(a));
    const out = { ok: true, now: nowLocal(), tz: TZ, me: { role: a.role, name: a.name || "", telegramId: a.telegramId || "" }, limits: { days: DAYS, caption: MAX_CAPTION },
      accountReady: !!(accountFor(a) || {}).ready, canBusiness: isOwner(a) && !!ownerConnection(),
      mine: mine.map(p => view(p, a)).sort((x, y) => y.createdAt.localeCompare(x.createdAt)) };
    if (isOwner(a)) {
      const others = plans.filter(p => p.ownerKey !== actorKey(a));
      out.team = others.map(p => view(p, a)).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      const today = todayLocal();
      const people = (ctx.getAppAdmins() || []).map(x => {
        const acc = admins.get("u" + String(x.telegramId));
        const theirs = plans.filter(p => p.ownerKey === String(x.telegramId));
        return { name: x.name || x.telegramId, telegramId: String(x.telegramId), connected: !!acc?.ready,
          activePlans: theirs.filter(p => p.status === "active").length,
          postedToday: theirs.reduce((s, p) => s + p.days.filter(d => d.status === "posted" && (d.postedAt || "").startsWith(today)).length, 0),
          failed: theirs.reduce((s, p) => s + p.days.filter(d => d.status === "failed").length, 0) };
      });
      out.people = people;
    }
    res.json(out);
  });

  router.get("/:id/photo/:n", async (req, res) => {
    const p = plans.find(x => x.id === req.params.id);
    if (!p || !canSee(req.actor, p)) return res.status(404).end();
    const n = Number(req.params.n); if (!(n >= 1 && n <= DAYS)) return res.status(404).end();
    const buf = await getPhoto(p.id, n); if (!buf) return res.status(404).end();
    res.set("Cache-Control", "private, max-age=3600").type("image/jpeg").send(buf);
  });

  router.post("/", memUpload.array("photos", DAYS), async (req, res) => {
    try {
      const a = req.actor, b = req.body || {}, files = req.files || [];
      if (!actorKey(a)) return res.status(400).json({ ok: false, error: "Open the app from Telegram so your admin identity is known." });
      if (files.length !== DAYS) return res.status(400).json({ ok: false, error: `Please add exactly ${DAYS} photos (one for each day). You added ${files.length}.` });
      for (const f of files) if (!/^image\/(jpeg|png|webp)$/i.test(f.mimetype)) return res.status(400).json({ ok: false, error: "Only JPG, PNG or WebP photos are accepted." });
      const hashes = files.map(f => crypto.createHash("sha1").update(f.buffer).digest("hex"));
      for (let i = 0; i < hashes.length; i++) { const j = hashes.indexOf(hashes[i]); if (j !== i) return res.status(400).json({ ok: false, error: `Photo ${j + 1} and photo ${i + 1} are the same picture. Each day needs a different photo, so none repeats.` }); }
      const today = todayLocal();
      const startDate = String(b.startDate || today); if (!validDate(startDate)) return res.status(400).json({ ok: false, error: "Start date is not valid." });
      const postTime = String(b.postTime || "09:00"); if (!validTime(postTime)) return res.status(400).json({ ok: false, error: "Post time is not valid (use HH:MM)." });
      if (startDate < today) return res.status(400).json({ ok: false, error: "The start date is in the past. Choose today or a later day." });
      const period = Number(b.period) || 86400; if (!PERIODS.includes(period)) return res.status(400).json({ ok: false, error: "Story duration is not valid." });
      const owner = isOwner(a);
      let via = b.via === "business" ? "business" : "account";
      if (via === "business") { if (!owner) return res.status(403).json({ ok: false, error: "Only the main admin can post through the shared Business connection." }); if (!ownerConnection()) return res.status(400).json({ ok: false, error: "No active Telegram Business connection with the \"Manage stories\" permission was found." }); }
      let dayCaps = []; try { dayCaps = JSON.parse(b.dayCaptions || "[]"); } catch {}
      const clean = s => String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, MAX_CAPTION);
      const id = crypto.randomBytes(6).toString("hex");
      const p = {
        id, ownerKey: actorKey(a), ownerTelegramId: a.telegramId || "", ownerRole: a.role, ownerName: a.name || "Admin",
        title: clean(b.title).slice(0, 80) || `Week of ${startDate}`, caption: clean(b.caption), via, period,
        privacy: b.privacy === "contacts" ? "contacts" : "all", pinned: b.pinned === "1" || b.pinned === "true",
        startDate, postTime, status: "active", createdAt: new Date().toISOString(),
        days: Array.from({ length: DAYS }, (_, i) => ({ n: i + 1, date: addDays(startDate, i), caption: clean(dayCaps[i]), hash: hashes[i], status: "pending", attempts: 0, error: "" }))
      };
      await savePhotos(id, files.map(f => f.buffer));
      plans.push(p); await save();
      res.json({ ok: true, plan: view(p, a), message: `✅ Saved. Photo 1 will be posted on ${p.days[0].date} at ${postTime}, then one new photo each day until ${p.days[DAYS - 1].date}.` });
    } catch (e) { console.error("Story plan failed:", e); res.status(500).json({ ok: false, error: e.message || "Could not save the plan." }); }
  });

  const find = (req, res) => {
    const p = plans.find(x => x.id === req.params.id);
    if (!p || !canSee(req.actor, p)) { res.status(404).json({ ok: false, error: "Plan not found." }); return null; }
    return p;
  };
  router.post("/:id/pause", async (req, res) => { const p = find(req, res); if (!p) return; if (p.status === "active") p.status = "paused"; await save(); res.json({ ok: true, message: "Paused. Nothing will be posted until you resume." }); });
  router.post("/:id/resume", async (req, res) => {
    const p = find(req, res); if (!p) return;
    if (p.status === "paused") { p.status = "active"; refreshStatus(p); }
    await save(); res.json({ ok: true, message: "Resumed. Days that already passed are not posted late." });
  });
  router.delete("/:id", async (req, res) => {
    const p = find(req, res); if (!p) return;
    plans = plans.filter(x => x !== p); await save(); await dropPhotos(p.id);
    res.json({ ok: true, message: "Plan deleted. Stories already on Telegram stay there until they expire." });
  });
  // Posting is only ever done by the plan's own admin, through their own account.
  router.post("/:id/post-now", async (req, res) => {
    const p = find(req, res); if (!p) return;
    if (p.ownerKey !== actorKey(req.actor)) return res.status(403).json({ ok: false, error: "Only the admin who made this plan can post it (from their own Telegram account)." });
    const n = Number(req.body?.day), day = p.days.find(d => d.n === n);
    if (!day) return res.status(400).json({ ok: false, error: "Choose a day." });
    if (day.status === "posted") return res.status(400).json({ ok: false, error: "That photo was already posted. It is never posted twice." });
    const r = await postDay(p, day, true); refreshStatus(p); await save();
    res.json(r.ok ? { ok: true, message: `✅ Photo ${n} posted as a story.` } : { ok: false, error: r.error });
  });
  app.use("/api/stories", router);
  return { start, tick };
}
module.exports = { register };
