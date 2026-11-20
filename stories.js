// ── WEEKLY STORY PLANNER (separate page: /stories.html, opened from the ⚙ Settings icon) ─────────────
// An admin uploads 7 items ONCE — each one a PHOTO or a VIDEO, whatever the admin wants (mixed is fine).
// Day 1 = item 1, Day 2 = item 2 … Day 7 = item 7: every item is posted as a Telegram story exactly once,
// on its own day, and never again. (For a video day the saved "photo" file is its small preview picture.)
//
// Every person works separately:
//  • assigned admin  → own plans only, posted ONLY from their own connected Telegram account;
//  • main admin      → own plans (own account or the shared Telegram Business connection)
//                      PLUS a team view: sees every admin's plans, can CREATE plans for an admin, EDIT them
//                      (captions, dates, replace photo / video), pause / resume / delete them and POST them
//                      for that admin — the story then goes out from THAT admin's own Telegram account.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const express = require("express");
const multer = require("multer");
const storyVideo = require("./storyvideo");

const DAYS = 7;
const MEDIA_SECRET = crypto.createHash("sha256").update(String(process.env.BOT_TOKEN || process.env.ADMIN_SETUP_KEY || "") + "|story-media|" + crypto.randomBytes(16).toString("hex")).digest();
const MAX_CAPTION = 200;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // per video or photo file
const MAX_VIDEO_SECONDS = 60;             // Telegram story video limit
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
  // photos[i] = the photo itself, or (for a video day) the small preview picture of that video.
  async function savePhotos(id, buffers) {
    fs.mkdirSync(DIR, { recursive: true });
    buffers.forEach((b, i) => fs.writeFileSync(photoFile(id, i + 1), b));
    if (supabase) { try { await supabase.from("app_settings").upsert({ key: "story_photos_" + id, value: { photos: buffers.map(b => b.toString("base64")) }, updated_at: new Date().toISOString() }); } catch (e) { console.warn("Story photos backup failed:", e.message); } }
  }
  // ── videos: file on disk + backup copy in Supabase Storage (too big for a settings row) ──
  const videoFile = (id, n) => path.join(DIR, `${id}-${n}.mp4`);
  const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "order-images";
  const videoKey = (id, n) => `stories/${id}-${n}.mp4`;
  const MAX_REMOTE_BACKUP = 60 * 1024 * 1024; // a bigger file is never loaded into memory for the backup copy
  // remote: false = keep it on disk only for now (the converted, much smaller copy is backed up later)
  async function saveVideo(id, n, srcPath, { remote = true, link = false } = {}) {
    fs.mkdirSync(DIR, { recursive: true });
    const dest = videoFile(id, n), part = dest + ".part";
    try { fs.unlinkSync(part); } catch {}
    if (path.resolve(srcPath) !== path.resolve(dest)) { try { fs.unlinkSync(dest); } catch {} } // never write through a shared (hard-linked) file
    let done = false;
    if (link) { try { fs.linkSync(srcPath, dest); done = true; } catch {} } // same video for several admins: no second copy on disk
    if (!done && path.resolve(srcPath) !== path.resolve(dest)) { fs.copyFileSync(srcPath, part); fs.renameSync(part, dest); }
    if (remote && supabase) {
      try {
        if (fs.statSync(dest).size > MAX_REMOTE_BACKUP) { console.warn("Story video too big for the backup copy; it stays on the server disk only."); return; }
        const { error } = await supabase.storage.from(BUCKET).upload(videoKey(id, n), fs.readFileSync(dest), { contentType: "video/mp4", upsert: true }); if (error) throw error;
      } catch (e) { console.warn("Story video backup failed:", e.message); }
    }
  }
  // Streams a video from the backup to disk (never the whole file in memory). Returns the file path or null.
  const dlLocks = new Map();
  function ensureVideoFile(id, n) {
    const f = videoFile(id, n);
    if (fs.existsSync(f)) return Promise.resolve(f);
    if (!supabase) return Promise.resolve(null);
    if (dlLocks.has(f)) return dlLocks.get(f);
    const job = (async () => {
      const part = f + ".dl";
      try {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(videoKey(id, n), 900);
        if (error || !data?.signedUrl) return null;
        const r = await fetch(data.signedUrl); if (!r.ok || !r.body) return null;
        fs.mkdirSync(DIR, { recursive: true });
        await require("stream/promises").pipeline(require("stream").Readable.fromWeb(r.body), fs.createWriteStream(part));
        fs.renameSync(part, f); return f;
      } catch (e) { try { fs.unlinkSync(part); } catch {} return null; }
      finally { dlLocks.delete(f); }
    })();
    dlLocks.set(f, job); return job;
  }
  async function hashFile(file) {
    return new Promise((resolve, reject) => { const h = crypto.createHash("sha1"); fs.createReadStream(file).on("data", c => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject); });
  }
  // Videos saved before the converter existed (MOV / HEVC / odd codecs) are converted ONCE, the first time they are opened.
  const normLocks = new Map();
  let normChain = Promise.resolve();
  function ensureNorm(p, d) {
    if (d.norm || d.type !== "video") return Promise.resolve();
    const key = p.id + ":" + d.n;
    if (normLocks.has(key)) return normLocks.get(key);
    const job = (async () => {
      try {
        await normChain.catch(() => {}); // one conversion at a time (keeps a small server responsive)
        if (d.norm) return;
        const nv = await storyVideo.normalize(videoFile(p.id, d.n), { maxSeconds: MAX_VIDEO_SECONDS });
        if (nv.ok) {
          await saveVideo(p.id, d.n, nv.path); try { fs.unlinkSync(nv.path); } catch {} d.norm = true; d.duration = Math.min(MAX_VIDEO_SECONDS, nv.duration); d.vw = nv.w; d.vh = nv.h;
          // the same video assigned to other admins: hand them this converted file, so it is converted only ONCE
          for (const q of plans) for (const e of q.days) {
            if ((q === p && e === d) || e.type !== "video" || e.norm || !e.hash || e.hash !== d.hash || e.status === "posted" || e.status === "posting") continue;
            try { await saveVideo(q.id, e.n, videoFile(p.id, d.n)); e.norm = true; e.duration = d.duration; e.vw = d.vw; e.vh = d.vh; } catch (er) { console.warn("Story video share failed:", er.message); }
          }
          await save();
        }
        else if (nv.missing) { try { if (supabase && fs.statSync(videoFile(p.id, d.n)).size <= MAX_REMOTE_BACKUP) await saveVideo(p.id, d.n, videoFile(p.id, d.n), { link: false }); } catch {} }
        else { d.norm = true; await save(); } // unreadable: don't retry forever
      } catch (e) { console.warn("Story video convert failed:", e.message); }
      finally { normLocks.delete(key); }
    })();
    normChain = job; normLocks.set(key, job); return job;
  }
  // Replace ONE day's picture (used by Edit): disk copy + backup copy, without touching the other days.
  async function savePhotoOne(id, n, buf) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(photoFile(id, n), buf);
    if (supabase) {
      try {
        const { data } = await supabase.from("app_settings").select("value").eq("key", "story_photos_" + id).maybeSingle();
        let arr = Array.isArray(data?.value?.photos) ? data.value.photos.slice() : null;
        if (!arr) { arr = []; for (let i = 1; i <= DAYS; i++) { try { arr.push(fs.readFileSync(photoFile(id, i)).toString("base64")); } catch { arr.push(""); } } }
        while (arr.length < DAYS) arr.push("");
        arr[n - 1] = buf.toString("base64");
        await supabase.from("app_settings").upsert({ key: "story_photos_" + id, value: { photos: arr }, updated_at: new Date().toISOString() });
      } catch (e) { console.warn("Story photo backup failed:", e.message); }
    }
  }
  async function dropVideoOne(id, n) {
    try { fs.unlinkSync(videoFile(id, n)); } catch {}
    if (supabase) { try { await supabase.storage.from(BUCKET).remove([videoKey(id, n)]); } catch {} }
  }
  async function getVideo(id, n) { // Buffer or null (only used at posting time, after the video was converted to a small file)
    const f = await ensureVideoFile(id, n);
    if (!f) return null;
    try { return fs.readFileSync(f); } catch { return null; }
  }
  async function getPhoto(id, n) {
    try { return fs.readFileSync(photoFile(id, n)); } catch {}
    if (supabase) {
      try {
        const { data } = await supabase.from("app_settings").select("value").eq("key", "story_photos_" + id).maybeSingle();
        const arr = data?.value?.photos;
        if (Array.isArray(arr)) { fs.mkdirSync(DIR, { recursive: true }); arr.forEach((b, i) => { if (!b) return; try { fs.writeFileSync(photoFile(id, i + 1), Buffer.from(b, "base64")); } catch {} }); if (arr[n - 1]) return Buffer.from(arr[n - 1], "base64"); }
      } catch {}
    }
    return null;
  }
  async function dropPhotos(id) {
    for (let n = 1; n <= DAYS; n++) { try { fs.unlinkSync(photoFile(id, n)); } catch {} try { fs.unlinkSync(videoFile(id, n)); } catch {} }
    if (supabase) {
      try { await supabase.from("app_settings").delete().eq("key", "story_photos_" + id); } catch {}
      try { await supabase.storage.from(BUCKET).remove(Array.from({ length: DAYS }, (_, i) => videoKey(id, i + 1))); } catch {}
    }
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
  const canManage = (a, p) => isOwner(a) || p.ownerKey === actorKey(a); // edit / post: the plan's admin or ANY main admin
  const ownerKeyIsMain = id => ownerIds.includes(String(id || ""));
  const personName = id => { const r = (ctx.getAppAdmins() || []).find(x => String(x.telegramId) === String(id)); return (r && r.name) || ""; };
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
  const isVideo = d => d.type === "video";
  async function sendViaAccount(account, p, day, buf, caption) {
    const { Api } = require("telegram");
    const { CustomFile } = require("telegram/client/uploads");
    const { generateRandomBigInt } = require("telegram/Helpers");
    const video = isVideo(day);
    const file = await account.client.uploadFile({ file: new CustomFile(video ? `story-${day.n}.mp4` : `story-${day.n}.jpg`, buf.length, "", buf), workers: 1 });
    const media = video
      ? new Api.InputMediaUploadedDocument({ file, mimeType: "video/mp4", attributes: [new Api.DocumentAttributeVideo({ duration: Math.max(1, Math.round(day.duration || 1)), w: day.vw || 720, h: day.vh || 1280, supportsStreaming: true })] })
      : new Api.InputMediaUploadedPhoto({ file });
    const params = {
      peer: new Api.InputPeerSelf(),
      media,
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
      if (isVideo(day)) {
        f.append("content", JSON.stringify({ type: "video", video: "attach://story", duration: Math.min(MAX_VIDEO_SECONDS, Math.max(1, day.duration || 1)) }));
        f.append("story", new Blob([buf], { type: "video/mp4" }), "story.mp4");
      } else {
        f.append("content", JSON.stringify({ type: "photo", photo: "attach://story" }));
        f.append("story", new Blob([buf], { type: "image/jpeg" }), "story.jpg");
      }
      f.append("active_period", String(p.period));
      if (caption) f.append("caption", caption);
      if (p.pinned) f.append("post_to_chat_page", "true");
      return f;
    });
    return r?.id != null ? String(r.id) : "";
  }
  // Story bot messages are switched OFF (v116). Status (posted / failed) is shown inside the Weekly Story page instead.
  // To turn the messages back on, set the Render variable STORY_BOT_MESSAGES=1.
  const STORY_BOT_MESSAGES = process.env.STORY_BOT_MESSAGES === "1";
  async function notify(p, text) {
    if (!STORY_BOT_MESSAGES) return;
    const targets = new Set([p.ownerTelegramId, ...ownerIds].filter(Boolean).map(String));
    for (const id of targets) { try { await tgApi.call("sendMessage", { chat_id: id, text }, { retry: false }); } catch {} }
  }
  // Posts ONE day's photo. Returns { ok, waiting?, error? }. A day that is already "posted" is never posted again.
  async function postDay(p, day, manual, byName) {
    const key = p.id + ":" + day.n;
    if (day.status === "posted") return { ok: true, already: true };
    if (posting.has(key)) return { ok: false, error: "Already posting this photo." };
    posting.add(key);
    try {
      let account = null, conn = null;
      if (p.via === "business") { conn = ownerConnection(); if (!conn) return { ok: false, waiting: true, error: "No active Telegram Business connection with the \"Manage stories\" permission." }; }
      else { account = pickAccount(p); if (!account) return { ok: false, waiting: true, error: `${p.ownerName || "The admin"}'s Telegram account is not connected. Open the app and tap Connect Telegram.` }; }
      if (isVideo(day)) await ensureNorm(p, day); // make sure it is in the format Telegram accepts
      const buf = isVideo(day) ? await getVideo(p.id, day.n) : await getPhoto(p.id, day.n);
      if (!buf) { day.status = "failed"; day.error = isVideo(day) ? "The saved video could not be found." : "The saved photo could not be found."; day.attempts = MAX_ATTEMPTS; await save(); return { ok: false, error: day.error }; }
      day.status = "posting"; day.error = ""; await save(); // saved BEFORE sending: a crash can never cause a second copy
      const caption = String(day.caption || p.caption || "").slice(0, MAX_CAPTION);
      try {
        day.storyId = conn ? await sendViaBusiness(conn, p, day, buf, caption) : await sendViaAccount(account, p, day, buf, caption);
        day.status = "posted"; day.postedAt = nowLocal(); day.error = ""; if (byName) day.postedBy = byName; else delete day.postedBy; await save();
        return { ok: true };
      } catch (e) {
        day.attempts = (day.attempts || 0) + 1; day.error = friendly(e);
        day.status = "failed"; day.nextTry = addMinutes(RETRY_MIN);
        await save();
        if (day.attempts >= MAX_ATTEMPTS && !manual) notify(p, `⚠️ Story ${day.n}/${p.days.length} (${isVideo(day) ? "video" : "photo"}) of "${p.title}" could not be posted: ${day.error}\nOpen ⚙ Settings → Weekly Story and press Post now.`);
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
  // Files go to a temporary folder (videos are big), never all into memory at once.
  const memUpload = multer({ storage: multer.diskStorage({ destination: os.tmpdir() }), limits: { fileSize: MAX_VIDEO_BYTES, files: DAYS * 2 } });
  const router = express.Router();
  router.use(requireAccess);

  const view = (p, a) => ({
    id: p.id, title: p.title, status: p.status, via: p.via, period: p.period, privacy: p.privacy, pinned: !!p.pinned,
    caption: p.caption, startDate: p.startDate, postTime: p.postTime, createdAt: p.createdAt,
    ownerName: p.ownerName, ownerRole: p.ownerRole, ownerTelegramId: p.ownerTelegramId || "", createdByName: p.createdByName || "",
    mine: p.ownerKey === actorKey(a), canEdit: canManage(a, p),
    accountReady: !!(pickAccount(p)), 
    days: p.days.map(d => ({ n: d.n, v: d.v || 0, type: isVideo(d) ? "video" : "photo", date: d.date, eth: eth(d.date), caption: d.caption || "", status: d.status, postedAt: d.postedAt || "", postedBy: d.postedBy || "", error: d.error || "", attempts: d.attempts || 0, duration: d.duration || 0 }))
  });

  router.get("/", (req, res) => {
    const a = req.actor, mine = plans.filter(p => p.ownerKey === actorKey(a));
    const out = { ok: true, now: nowLocal(), tz: TZ, me: { role: a.role, name: a.name || "", telegramId: a.telegramId || "" }, limits: { days: DAYS, caption: MAX_CAPTION, videoMb: MAX_VIDEO_BYTES / 1048576, videoSeconds: MAX_VIDEO_SECONDS },
      accountReady: !!(accountFor(a) || {}).ready, canBusiness: isOwner(a) && !!ownerConnection(),
      mine: mine.map(p => view(p, a)).sort((x, y) => y.createdAt.localeCompare(x.createdAt)) };
    if (isOwner(a)) {
      const others = plans.filter(p => p.ownerKey !== actorKey(a));
      out.team = others.map(p => view(p, a)).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      const today = todayLocal();
      const roster = (ctx.getAppAdmins() || []).filter(x => String(x.telegramId) !== actorKey(a));
      for (const id of ownerIds) if (id !== actorKey(a) && !roster.some(x => String(x.telegramId) === String(id))) roster.push({ telegramId: id, name: "Main admin " + id });
      const people = roster.map(x => {
        const acc = admins.get("u" + String(x.telegramId));
        const theirs = plans.filter(p => p.ownerKey === String(x.telegramId));
        return { name: x.name || x.telegramId, telegramId: String(x.telegramId), main: ownerKeyIsMain(x.telegramId), connected: !!acc?.ready,
          activePlans: theirs.filter(p => p.status === "active").length,
          postedToday: theirs.reduce((s, p) => s + p.days.filter(d => d.status === "posted" && (d.postedAt || "").startsWith(today)).length, 0),
          failed: theirs.reduce((s, p) => s + p.days.filter(d => d.status === "failed").length, 0) };
      });
      out.people = people;
    }
    res.json(out);
  });

  // Short-lived signed link so a <video> / <img> tag (which cannot send headers) can play a saved item.
  const sign = (id, n, exp) => crypto.createHmac("sha256", MEDIA_SECRET).update(`${id}:${n}:${exp}`).digest("hex").slice(0, 32);
  router.get("/:id/media-url/:n", async (req, res) => {
    const p = plans.find(x => x.id === req.params.id);
    if (!p || !canSee(req.actor, p)) return res.status(404).json({ ok: false, error: "Not found." });
    const n = Number(req.params.n), d = p.days.find(x => x.n === n); if (!d) return res.status(404).json({ ok: false, error: "Not found." });
    const exp = Date.now() + 2 * 3600 * 1000;
    res.json({ ok: true, type: isVideo(d) ? "video" : "photo", url: `/api/stories/media/${p.id}/${n}?v=${d.v || 0}&e=${exp}&s=${sign(p.id, n, exp)}`, caption: d.caption || p.caption || "" });
  });
  router.get("/:id/photo/:n", async (req, res) => {
    const p = plans.find(x => x.id === req.params.id);
    if (!p || !canSee(req.actor, p)) return res.status(404).end();
    const n = Number(req.params.n); if (!(n >= 1 && n <= DAYS)) return res.status(404).end();
    const buf = await getPhoto(p.id, n); if (!buf) return res.status(404).end();
    res.set("Cache-Control", "private, max-age=3600").type("image/jpeg").send(buf);
  });

  // "photos" = the 7 chosen files in day order (each a photo OR a video); "posters" = one preview picture per video, in order.
  router.post("/", memUpload.fields([{ name: "photos", maxCount: DAYS }, { name: "posters", maxCount: DAYS }]), async (req, res) => {
    const files = (req.files && req.files.photos) || [], posters = (req.files && req.files.posters) || [];
    const extraTmp = []; // converted copies made by the video converter
    const cleanup = () => { for (const f of [...files, ...posters]) { try { fs.unlinkSync(f.path); } catch {} } for (const x of extraTmp) { try { fs.unlinkSync(x); } catch {} } };
    try {
      const a = req.actor, b = req.body || {};
      if (!actorKey(a)) return res.status(400).json({ ok: false, error: "Open the app from Telegram so your admin identity is known." });
      const need = DAYS;
      if (files.length !== need) return res.status(400).json({ ok: false, error: `Please add exactly ${DAYS} items (photos or videos, one for each day). You added ${files.length}.` });
      let meta = []; try { meta = JSON.parse(b.dayMeta || "[]"); } catch {}
      const kinds = files.map((f, i) => {
        if (/^image\/(jpeg|png|webp)$/i.test(f.mimetype)) return "photo";
        if (meta[i]?.type === "video") return "video"; // any video format: the converter below checks the real content
        return "";
      });
      if (kinds.some(k => !k)) return res.status(400).json({ ok: false, error: "Only photos (JPG, PNG, WebP …) or video files are accepted." });
      const hashes = []; for (const f of files) hashes.push(await hashFile(f.path));
      for (let i = 0; i < hashes.length; i++) { const j = hashes.indexOf(hashes[i]); if (j !== i) return res.status(400).json({ ok: false, error: `Item ${j + 1} and item ${i + 1} are the same file. Each day needs a different photo or video, so none repeats.` }); }
      const today = todayLocal();
      const startDate = String(b.startDate || today); if (!validDate(startDate)) return res.status(400).json({ ok: false, error: "Start date is not valid." });
      const postTime = String(b.postTime || "09:00"); if (!validTime(postTime)) return res.status(400).json({ ok: false, error: "Post time is not valid (use HH:MM)." });
      if (startDate < today) return res.status(400).json({ ok: false, error: "The start date is in the past. Choose today or a later day." });
      const period = Number(b.period) || 86400; if (!PERIODS.includes(period)) return res.status(400).json({ ok: false, error: "Story duration is not valid." });
      const owner = isOwner(a);
      // ONE plan can be ASSIGNED to several admins at once (main admin only). Every chosen admin gets their OWN copy of the
      // same plan — it is posted from THAT admin's own Telegram account. "me" = the person who is creating it.
      let wanted = [];
      try { const arr = JSON.parse(b.forAdmins || "null"); if (Array.isArray(arr)) wanted = arr; } catch {}
      if (!wanted.length && b.forAdmin) wanted = [b.forAdmin];       // older single-admin field
      if (!wanted.length) wanted = ["me"];
      const targets = [], seen = new Set();
      for (const raw of wanted) {
        const w = String(raw || "").trim();
        const isMe = !w || w === "me" || w === actorKey(a);
        const key = isMe ? actorKey(a) : w;
        if (seen.has(key)) continue; seen.add(key);
        if (isMe) { targets.push({ telegramId: a.telegramId || "", key, name: a.name || "Admin", role: a.role, self: true }); continue; }
        if (!owner) return res.status(403).json({ ok: false, error: "Only a main admin can assign a plan to other admins." });
        const rec = (ctx.getAppAdmins() || []).find(x => String(x.telegramId) === w);
        if (!rec && !ownerIds.includes(w)) return res.status(400).json({ ok: false, error: "One of the chosen admins was not found. Refresh the page and choose again." });
        targets.push({ telegramId: w, key: w, name: (rec && rec.name) || ("Admin " + w), role: ownerIds.includes(w) ? "owner" : "admin", self: false });
      }
      if (!targets.length) return res.status(400).json({ ok: false, error: "Choose at least one admin for this plan." });
      if (targets.length > 50) return res.status(400).json({ ok: false, error: "Too many admins chosen at once (maximum 50)." });
      const wantsBusiness = b.via === "business";
      if (wantsBusiness && targets.some(t => t.role === "owner")) {
        if (!owner) return res.status(403).json({ ok: false, error: "Only the main admin can post through the shared Business connection." });
        if (!ownerConnection()) return res.status(400).json({ ok: false, error: "No active Telegram Business connection with the \"Manage stories\" permission was found." });
      }
      // Videos (any format): only a FAST check here (real video? how long? preview picture). The conversion to the
      // format every phone plays happens right after saving, in the background, so the upload never times out.
      const vpost = {}, vidx = kinds.map((k, i) => k === "video" ? i : -1).filter(i => i >= 0), useClientPosters = posters.length === vidx.length;
      for (let q = 0; q < vidx.length; q++) {
        const i = vidx[q], cpAny = useClientPosters && posters[q] && posters[q].size > 0 ? posters[q] : null, cp = cpAny && !meta[i]?.unknown ? cpAny : null;
        const qi = await storyVideo.quickInfo(files[i].path, { maxSeconds: MAX_VIDEO_SECONDS });
        if (qi.ok) { meta[i] = { type: "video", duration: qi.duration, w: qi.w, h: qi.h }; vpost[i] = cp ? fs.readFileSync(cp.path) : qi.poster; }
        else if (qi.missing) { // no ffmpeg on this server: accept MP4 / MOV as they are
          if (!cpAny || !/^video\/(mp4|quicktime)$/i.test(files[i].mimetype || "")) return res.status(400).json({ ok: false, error: `Video ${i + 1}: this format needs the server's video converter (ffmpeg), which is not installed. Please use an MP4 video.` });
          if (Number(meta[i]?.duration) > MAX_VIDEO_SECONDS + 0.5) return res.status(400).json({ ok: false, error: `Video ${i + 1} is longer than ${MAX_VIDEO_SECONDS} seconds. Telegram stories allow up to ${MAX_VIDEO_SECONDS} seconds.` });
          if (!(Number(meta[i]?.duration) > 0)) meta[i] = { ...meta[i], type: "video", duration: 30 };
          vpost[i] = fs.readFileSync(cpAny.path);
        } else return res.status(400).json({ ok: false, error: `Video ${i + 1} ${qi.error}` });
      }
      let dayCaps = []; try { dayCaps = JSON.parse(b.dayCaptions || "[]"); } catch {}
      const clean = s => String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, MAX_CAPTION);
      // the picture saved for each day: the photo itself, or the preview picture of the video
      const images = files.map((f, i) => kinds[i] === "photo" ? fs.readFileSync(f.path) : vpost[i]);
      const created = [];
      for (const t of targets) {
        const id = crypto.randomBytes(6).toString("hex");
        const via = wantsBusiness && t.role === "owner" ? "business" : "account"; // only a main admin's own plan can use the shared Business account
        const p = {
          id, ownerKey: t.key, ownerTelegramId: t.telegramId, ownerRole: t.role, ownerName: t.name,
          createdByName: t.self ? "" : (a.name || "Main admin"),
          title: clean(b.title).slice(0, 80) || `Week of ${startDate}`, caption: clean(b.caption), via, period,
          privacy: b.privacy === "contacts" ? "contacts" : "all", pinned: b.pinned === "1" || b.pinned === "true",
          startDate, postTime, status: "active", createdAt: new Date().toISOString(),
          days: Array.from({ length: need }, (_, i) => {
            const d = { n: i + 1, type: kinds[i], date: addDays(startDate, i), caption: clean(dayCaps[i]), hash: hashes[i], status: "pending", attempts: 0, error: "" };
            if (kinds[i] === "video") { d.duration = Math.min(MAX_VIDEO_SECONDS, Math.max(1, Number(meta[i]?.duration) || 1)); d.vw = Math.min(4096, Number(meta[i]?.w) || 720); d.vh = Math.min(4096, Number(meta[i]?.h) || 1280); }
            return d;
          })
        };
        await savePhotos(id, images);
        const firstCopy = created.length === 0;
        for (let i = 0; i < need; i++) if (kinds[i] === "video") {
          if (firstCopy) await saveVideo(id, i + 1, files[i].path, { remote: files[i].size <= 25 * 1024 * 1024 }); // big originals are backed up AFTER conversion (small)
          else await saveVideo(id, i + 1, videoFile(created[0].p.id, i + 1), { remote: false, link: true });
        }
        plans.push(p); created.push({ p, t });
      }
      await save();
      for (const { p, t } of created) {
        p.days.forEach(d => { if (d.type === "video") ensureNorm(p, d); }); // convert in the background, one video at a time
        if (!t.self) notify(p, `📸 ${a.name || "The main admin"} assigned a weekly story plan to you: "${p.title}" (${p.startDate} → ${p.days[p.days.length - 1].date} at ${postTime}). It is posted from your own Telegram account.`);
      }
      const mineP = created.find(c => c.t.self) || created[0];
      const first = mineP.p.days[0].type === "video" ? "Video" : "Photo";
      const lastDay = mineP.p.days[DAYS - 1].date;
      const others = created.filter(c => !c.t.self).map(c => c.t.name);
      const forTxt = others.length === 0 ? "" : created.length === 1 ? ` for ${others[0]} (it goes out from ${others[0]}'s own Telegram account)` : ` for ${created.length} admins (${created.map(c => c.t.self ? "you" : c.t.name).join(", ")}). Each one posts from their own Telegram account`;
      res.json({ ok: true, plan: view(mineP.p, a), count: created.length, message: `✅ Saved${forTxt}. ${first} 1 will be posted on ${mineP.p.days[0].date} at ${postTime}, then one new item each day until ${lastDay}.` });
    } catch (e) { console.error("Story plan failed:", e); res.status(500).json({ ok: false, error: e.message || "Could not save the plan." }); }
    finally { cleanup(); }
  });

  const find = (req, res) => {
    const p = plans.find(x => x.id === req.params.id);
    if (!p || !canSee(req.actor, p)) { res.status(404).json({ ok: false, error: "Plan not found." }); return null; }
    return p;
  };
  // ── EDIT a plan (✏️): settings, captions, dates, and replacing a day's photo / video. Only the plan's own admin. ──
  const cleanText = s => String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, MAX_CAPTION);
  const ownPlan = (req, res) => {
    const p = find(req, res); if (!p) return null;
    if (!canManage(req.actor, p)) { res.status(403).json({ ok: false, error: "Only the admin who made this plan or a main admin can edit it." }); return null; }
    if (p.days.some(d => d.status === "posting")) { res.status(409).json({ ok: false, error: "A story of this plan is being posted right now. Try again in a moment." }); return null; }
    return p;
  };
  router.patch("/:id", async (req, res) => {
    try {
      const p = ownPlan(req, res); if (!p) return;
      const b = req.body || {}, today = todayLocal(), owner = isOwner(req.actor);
      const anyPosted = p.days.some(d => d.status === "posted");
      let startDate = p.startDate;
      if (b.startDate != null && String(b.startDate) !== p.startDate) {
        startDate = String(b.startDate);
        if (anyPosted) return res.status(400).json({ ok: false, error: "The start date can't be changed after the first story was posted." });
        if (!validDate(startDate)) return res.status(400).json({ ok: false, error: "Start date is not valid." });
        if (startDate < today) return res.status(400).json({ ok: false, error: "The start date is in the past. Choose today or a later day." });
      }
      const postTime = b.postTime != null ? String(b.postTime) : p.postTime;
      if (!validTime(postTime)) return res.status(400).json({ ok: false, error: "Post time is not valid (use HH:MM)." });
      const period = b.period != null ? Number(b.period) : p.period;
      if (!PERIODS.includes(period)) return res.status(400).json({ ok: false, error: "Story duration is not valid." });
      let via = b.via != null ? (b.via === "business" ? "business" : "account") : p.via;
      if (via === "business" && via !== p.via) {
        if (!owner || p.ownerRole !== "owner") return res.status(403).json({ ok: false, error: "Only a main admin's own plan can post through the shared Business connection." });
        if (!ownerConnection()) return res.status(400).json({ ok: false, error: "No active Telegram Business connection with the \"Manage stories\" permission was found." });
      }
      // everything is valid — apply
      if (b.title != null) p.title = cleanText(b.title).slice(0, 80) || `Week of ${startDate}`;
      if (b.caption != null) p.caption = cleanText(b.caption);
      if (b.privacy != null) p.privacy = b.privacy === "contacts" ? "contacts" : "all";
      if (b.pinned != null) p.pinned = b.pinned === true || b.pinned === "1" || b.pinned === "true";
      p.postTime = postTime; p.period = period; p.via = via;
      if (startDate !== p.startDate) { // nothing posted yet: move the whole week, every day starts fresh
        p.startDate = startDate;
        p.days.forEach((d, i) => { d.date = addDays(startDate, i); d.status = "pending"; d.error = ""; d.attempts = 0; delete d.nextTry; });
      }
      if (Array.isArray(b.dayCaptions)) p.days.forEach((d, i) => { if (d.status !== "posted") d.caption = cleanText(b.dayCaptions[i]); });
      refreshStatus(p); await save();
      res.json({ ok: true, plan: view(p, req.actor), message: "✅ Plan updated. Stories already posted are not changed." });
    } catch (e) { console.error("Story plan edit failed:", e); res.status(500).json({ ok: false, error: e.message || "Could not save the changes." }); }
  });
  // Replace the photo / video of ONE day that was not posted yet.
  router.post("/:id/day/:n/media", memUpload.fields([{ name: "file", maxCount: 1 }, { name: "poster", maxCount: 1 }]), async (req, res) => {
    const f = req.files && req.files.file && req.files.file[0], po = req.files && req.files.poster && req.files.poster[0];
    const extraTmp = [];
    try {
      const p = ownPlan(req, res); if (!p) return;
      const n = Number(req.params.n), d = p.days.find(x => x.n === n);
      if (!d) return res.status(400).json({ ok: false, error: "Choose a day." });
      if (d.status === "posted") return res.status(400).json({ ok: false, error: "That story was already posted, so it can't be replaced." });
      if (!f) return res.status(400).json({ ok: false, error: "No file received." });
      let meta = {}; try { meta = JSON.parse(req.body?.meta || "{}"); } catch {}
      const kind = /^image\/(jpeg|png|webp)$/i.test(f.mimetype) ? "photo" : (meta.type === "video" ? "video" : "");
      if (!kind) return res.status(400).json({ ok: false, error: "Only photos (JPG, PNG, WebP …) or video files are accepted." });
      const hash = await hashFile(f.path);
      const same = p.days.find(x => x.n !== n && x.hash === hash);
      if (same) return res.status(400).json({ ok: false, error: `This is the same file as Day ${same.n}. Each day needs a different photo or video, so none repeats.` });
      let posterBuf = null;
      if (kind === "video") {
        const cpAny = po && po.size > 0 ? po : null, cp = cpAny && !meta.unknown ? cpAny : null;
        const qi = await storyVideo.quickInfo(f.path, { maxSeconds: MAX_VIDEO_SECONDS });
        if (qi.ok) { meta = { type: "video", duration: qi.duration, w: qi.w, h: qi.h }; posterBuf = cp ? fs.readFileSync(cp.path) : qi.poster; }
        else if (qi.missing) {
          if (!cpAny || !/^video\/(mp4|quicktime)$/i.test(f.mimetype || "")) return res.status(400).json({ ok: false, error: "This format needs the server's video converter (ffmpeg), which is not installed. Please use an MP4 video." });
          if (Number(meta.duration) > MAX_VIDEO_SECONDS + 0.5) return res.status(400).json({ ok: false, error: `The video is longer than ${MAX_VIDEO_SECONDS} seconds. Telegram stories allow up to ${MAX_VIDEO_SECONDS} seconds.` });
          if (!(Number(meta.duration) > 0)) meta = { ...meta, type: "video", duration: 30 };
          posterBuf = fs.readFileSync(cpAny.path);
        } else return res.status(400).json({ ok: false, error: `The video ${qi.error}` });
      }
      await savePhotoOne(p.id, n, kind === "video" ? posterBuf : fs.readFileSync(f.path));
      if (kind === "video") await saveVideo(p.id, n, f.path, { remote: f.size <= 25 * 1024 * 1024 }); else await dropVideoOne(p.id, n);
      d.type = kind; d.hash = hash; d.v = (d.v || 0) + 1; delete d.norm;
      if (kind === "video") { d.duration = Math.min(MAX_VIDEO_SECONDS, Math.max(1, Number(meta.duration) || 1)); d.vw = Math.min(4096, Number(meta.w) || 720); d.vh = Math.min(4096, Number(meta.h) || 1280); }
      else { delete d.duration; delete d.vw; delete d.vh; }
      d.attempts = 0; delete d.nextTry;
      if (d.date >= todayLocal()) { d.status = "pending"; d.error = ""; }
      refreshStatus(p); await save();
      if (kind === "video") ensureNorm(p, d);
      res.json({ ok: true, plan: view(p, req.actor), message: `✅ Day ${n} now uses the new ${kind}.` });
    } catch (e) { console.error("Story media replace failed:", e); res.status(500).json({ ok: false, error: e.message || "Could not replace the file." }); }
    finally { for (const x of [f, po]) if (x) { try { fs.unlinkSync(x.path); } catch {} } for (const x of extraTmp) { try { fs.unlinkSync(x); } catch {} } }
  });
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
    if (!canManage(req.actor, p)) return res.status(403).json({ ok: false, error: "Only the admin who made this plan or a main admin can post it." });
    const n = Number(req.body?.day), day = p.days.find(d => d.n === n);
    if (!day) return res.status(400).json({ ok: false, error: "Choose a day." });
    if (day.status === "posted") return res.status(400).json({ ok: false, error: "That story was already posted. It is never posted twice." });
    const forOther = p.ownerKey !== actorKey(req.actor);
    if (forOther && p.via !== "business" && !pickAccount(p)) return res.status(400).json({ ok: false, error: `${p.ownerName || "That admin"} has not connected their Telegram account yet, so the story can't be posted from their account. Ask them to open the app and tap Connect Telegram.` });
    const r = await postDay(p, day, true, forOther ? (req.actor.name || "Main admin") : ""); refreshStatus(p); await save();
    if (r.ok && forOther) notify({ ownerTelegramId: p.ownerTelegramId, title: p.title }, `📸 ${req.actor.name || "A main admin"} posted Day ${n} ("${p.title}") as a story from your Telegram account.`);
    res.json(r.ok ? { ok: true, message: forOther ? `✅ ${isVideo(day) ? "Video" : "Photo"} ${n} posted from ${p.ownerName || "the admin"}'s account.` : `✅ ${isVideo(day) ? "Video" : "Photo"} ${n} posted as a story.` } : { ok: false, error: r.error });
  });
  router.use((err, req, res, next) => { // e.g. a video over the size limit
    const big = err && err.code === "LIMIT_FILE_SIZE";
    res.status(400).json({ ok: false, error: big ? `A file is too big. Videos can be up to ${MAX_VIDEO_BYTES / 1048576} MB each.` : (err && err.message) || "Upload failed." });
  });
  // Media stream (no login header, signed link). Supports Range so videos start at once and can be scrubbed.
  app.get("/api/stories/media/:id/:n", async (req, res) => {
    try {
      const n = Number(req.params.n), exp = Number(req.query.e) || 0, sg = String(req.query.s || "");
      const good = sign(req.params.id, n, exp);
      if (!exp || exp < Date.now() || sg.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sg), Buffer.from(good))) return res.status(403).end();
      const p = plans.find(x => x.id === req.params.id), d = p && p.days.find(x => x.n === n);
      if (!d) return res.status(404).end();
      res.set("Cache-Control", "private, max-age=3600");
      if (!isVideo(d)) { const buf = await getPhoto(p.id, n); if (!buf) return res.status(404).end(); return res.type("image/jpeg").send(buf); }
      const file = await ensureVideoFile(p.id, n);
      if (!file) return res.status(404).end();
      // wait a little for the conversion, but never leave the phone waiting for a long queue: play the saved file as it is
      await Promise.race([ensureNorm(p, d), new Promise(r => setTimeout(r, 6000))]);
      if (!fs.existsSync(file)) return res.status(404).end();
      const size = fs.statSync(file).size, range = String(req.headers.range || "");
      res.set("Accept-Ranges", "bytes").type("video/mp4");
      const m = range.match(/^bytes=(\d*)-(\d*)$/);
      if (m && (m[1] || m[2])) {
        let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])), end = m[1] && m[2] ? Number(m[2]) : size - 1;
        end = Math.min(end, size - 1);
        if (start > end || start >= size) return res.status(416).set("Content-Range", `bytes */${size}`).end();
        res.status(206).set({ "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.set("Content-Length", size); fs.createReadStream(file).pipe(res);
    } catch (e) { if (!res.headersSent) res.status(500).end(); }
  });
  app.use("/api/stories", router);
  return { start, tick };
}
module.exports = { register };
