const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
let createClient = null;
try { ({ createClient } = require("@supabase/supabase-js")); } catch (e) { console.error("Supabase library unavailable, continuing without it:", e.message); }
const crypto = require("crypto");


const ALLOWED_UPDATES = [
  "message", "callback_query", "business_connection", "business_message",
  "edited_business_message", "deleted_business_messages"
];

// Tokens pasted into hosting dashboards often carry quotes, spaces or a stray "bot" prefix.
function cleanToken(raw = "") {
  return String(raw).trim().replace(/^["']|["']$/g, "").trim().replace(/^bot(?=\d+:)/i, "");
}

// Telegram only accepts secret tokens made of A-Z a-z 0-9 _ - (1..256 chars). A secret with any
// other character makes setWebhook fail, which silently leaves the OLD webhook in place and
// breaks every Business update. Anything invalid is hashed into a valid token; the same
// function is used for registering and for verifying, so the two always agree.
function normalizeSecret(raw = "") {
  const s = String(raw).trim();
  if (!s) return "";
  if (/^[A-Za-z0-9_-]{1,256}$/.test(s)) return s;
  return crypto.createHash("sha256").update(s).digest("hex");
}

// Bot API 7.2 – 8.x exposed BusinessConnection.can_reply; newer versions use rights.can_reply.
function canReply(connection) {
  if (!connection) return false;
  if (connection.rights && typeof connection.rights.can_reply === "boolean") return connection.rights.can_reply;
  if (typeof connection.can_reply === "boolean") return connection.can_reply;
  return connection.rights ? false : true; // unknown shape: let Telegram decide at send time
}
function isUsable(connection) {
  return !!connection && connection.is_enabled !== false && canReply(connection);
}

function friendlyError(message = "") {
  const m = String(message);
  if (/BUSINESS_PEER_USAGE_MISSING/i.test(m))
    return "Telegram refused: the admin account has not chatted with this customer recently. Ask the customer to send a message to the admin account first, then try again.";
  if (/BUSINESS_PEER_INVALID|chat not found|PEER_ID_INVALID/i.test(m))
    return "Telegram could not find that customer chat. Check the numeric Customer Telegram Chat ID and make sure the customer has messaged the admin account.";
  if (/BUSINESS_CONNECTION_INVALID|BUSINESS_CONNECTION_NOT_ALLOWED|business connection (not found|is invalid)/i.test(m))
    return "The Telegram Business connection is no longer valid. In Telegram: Settings → Business → Chatbots, remove and re-add the bot with Reply permission, then press Refresh.";
  if (/not enough rights|CHAT_WRITE_FORBIDDEN|BOT_ACCESS_FORBIDDEN/i.test(m))
    return "The bot has no permission to reply in that chat. Enable \"Reply to messages\" for the bot in Telegram Business → Chatbots.";
  if (/bot was blocked/i.test(m)) return "The customer has blocked the bot.";
  if (/Unauthorized/i.test(m)) return "BOT_TOKEN is invalid or revoked. Copy the current token from @BotFather into the BOT_TOKEN environment variable.";
  return m;
}

function createTelegram({ token, publicBaseUrl, secret, apiBase, log = console }) {
  const TOKEN = cleanToken(token);
  const BASE = String(apiBase || process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
  const SECRET = normalizeSecret(secret);
  const PUBLIC = String(publicBaseUrl || "").trim().replace(/\/+$/, "");
  const WEBHOOK_URL = PUBLIC ? `${PUBLIC}/api/telegram/webhook` : "";
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function request(method, makeInit, { retry = true, timeoutMs = 25000 } = {}) {
    if (!TOKEN) throw new Error("BOT_TOKEN is not configured on the server.");
    let lastError;
    const attempts = retry ? 3 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(`${BASE}/bot${TOKEN}/${method}`, { ...makeInit(), signal: AbortSignal.timeout(timeoutMs) });
        let data;
        try { data = await response.json(); } catch { throw Object.assign(new Error(`Telegram ${method} returned a non-JSON response (HTTP ${response.status}).`), { transient: response.status >= 500 }); }
        if (data.ok) return data.result;
        const err = new Error(data.description || `Telegram ${method} failed.`);
        err.code = data.error_code;
        err.retryAfter = data.parameters?.retry_after;
        if (data.error_code === 429 && attempt < attempts) { await sleep(Math.min((err.retryAfter || 1) * 1000, 10000)); lastError = err; continue; }
        if (data.error_code >= 500 && attempt < attempts) { await sleep(500 * attempt); lastError = err; continue; }
        throw err;
      } catch (error) {
        if (error.code) throw error; // a real Telegram API answer: do not retry
        lastError = error;
        if (attempt < attempts && (retry || false)) { await sleep(500 * attempt); continue; }
        if (error.name === "TimeoutError" || error.name === "AbortError") throw new Error(`Telegram ${method} timed out.`);
        throw error;
      }
    }
    throw lastError;
  }

  const call = (method, body = {}, opts) => request(method, () => ({
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  }), opts);

  // Sending is not retried on network errors: a lost response could otherwise deliver the card twice.
  const sendForm = (method, buildForm) => request(method, () => ({ method: "POST", body: buildForm() }), { retry: false, timeoutMs: 60000 });

  async function configureWebhook() {
    if (!TOKEN || !PUBLIC) {
      log.log("Telegram webhook auto-configuration skipped: set BOT_TOKEN and PUBLIC_BASE_URL (or use RENDER_EXTERNAL_URL).");
      return { ok: false, reason: "missing BOT_TOKEN or PUBLIC_BASE_URL" };
    }
    if (!/^https:\/\//i.test(PUBLIC)) {
      const reason = `PUBLIC_BASE_URL must start with https:// (got "${PUBLIC}"). Telegram only delivers webhooks to HTTPS URLs.`;
      log.error("Telegram webhook configuration failed:", reason);
      return { ok: false, reason };
    }
    const payload = { url: WEBHOOK_URL, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false };
    if (SECRET) payload.secret_token = SECRET;
    let lastError;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        // setWebhook atomically replaces any previous webhook (no deleteWebhook gap where updates are lost).
        await call("setWebhook", payload, { retry: false });
        log.log("Telegram webhook configured:", WEBHOOK_URL);
        return { ok: true, url: WEBHOOK_URL };
      } catch (error) {
        lastError = error;
        log.error(`Telegram webhook configuration attempt ${attempt} failed:`, error.message);
        if (error.code && error.code < 429 && error.code !== 408) break; // 4xx (bad token/url): retrying cannot help
        await sleep(2000 * attempt);
      }
    }
    return { ok: false, reason: lastError?.message || "unknown error" };
  }

  let lastHeal = 0;
  // Called from the status endpoint: if Telegram points anywhere else than this server, repair it.
  async function healWebhookIfNeeded(info) {
    const wrongUrl = !info || info.url !== WEBHOOK_URL;
    const missing = !info || !ALLOWED_UPDATES.filter(x => x.startsWith("business")).every(x => (info.allowed_updates || []).includes(x));
    const erroring = info?.last_error_message && /401|unauthorized|wrong response|forbidden/i.test(info.last_error_message);
    if (!(wrongUrl || missing || erroring) || !WEBHOOK_URL) return false;
    if (Date.now() - lastHeal < 60000) return false;
    lastHeal = Date.now();
    return (await configureWebhook()).ok;
  }

  return { call, sendForm, configureWebhook, healWebhookIfNeeded, webhookUrl: WEBHOOK_URL, secret: SECRET, hasToken: !!TOKEN };
}



const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim().replace(/^["']|["']$/g, "").trim();
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/+$/, "");
const BUSINESS_CONNECTION_ID = (process.env.ADMIN_BUSINESS_CONNECTION_ID || "").trim();
const BUSINESS_STORE_DIR = process.env.BUSINESS_STORE_DIR || path.join(__dirname, "data");
const BUSINESS_STORE = path.join(BUSINESS_STORE_DIR, "business-connections.json");
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "order-images";
const tgApi = createTelegram({ token: BOT_TOKEN, publicBaseUrl: PUBLIC_BASE_URL, secret: WEBHOOK_SECRET });
const supabase = createClient && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (req, res) => res.status(200).json({ ok: true, service: "ambar-furniture-mini-app" }));

const uploadDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 15 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) => {
    if (["productPhoto", "cardImage"].includes(file.fieldname) && file.mimetype?.startsWith("image/")) return cb(null, true);
    cb(new Error("Please upload a valid image file."));
  }
});

let orders = [];
let nextId = 1;
let supabaseReady = Promise.resolve();

async function persistBusinessConnections() {
  // Always keep a local copy, and mirror to Supabase when configured.
  saveBusinessConnections();
  if (!supabase) return;
  try {
    const enabled = [...businessConnections.values()].filter(c => c?.is_enabled !== false);
    const { error } = await supabase.from("app_settings").upsert({ key: "telegram_business_connections", value: enabled, updated_at: new Date().toISOString() });
    if (error) console.error("Supabase business connection save failed:", error.message);
  } catch (error) { console.error("Supabase business connection save failed:", error.message); }
}
async function restoreBusinessConnections() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from("app_settings").select("value").eq("key", "telegram_business_connections").maybeSingle();
    if (error) { console.error("Supabase business connection restore failed:", error.message); return; }
    // Merge (never clear): a connection that arrived by webhook during startup must not be wiped.
    if (Array.isArray(data?.value)) for (const c of data.value) if (c?.id && c.is_enabled !== false && !businessConnections.has(String(c.id))) businessConnections.set(String(c.id), c);
  } catch (error) { console.error("Supabase business connection restore failed:", error.message); }
}
async function uploadToSupabase(file, folder, contentType) {
  if (!supabase) return `/uploads/${file.filename}`;
  const objectPath = `${folder}/${Date.now()}-${file.filename}`;
  const bytes = await fs.promises.readFile(file.path);
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(objectPath, bytes, { contentType: contentType || file.mimetype || "application/octet-stream", upsert: true });
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
  const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}
async function saveOrderRecord(order) {
  if (!supabase) {
    const index = orders.findIndex(x => String(x.id) === String(order.id));
    if (index >= 0) orders[index] = order; else orders.push(order);
    return order;
  }
  const row = { id: order.id, order_id: order.orderId, status: order.status || "Pending", telegram_chat_id: String(order.telegramChatId || ""), business_connection_id: order.businessConnectionId || null, telegram_message_id: order.telegramMessageId || null, sent: !!order.sent, photo_url: order.photo || null, card_image_url: order.cardImage || null, comments: order.comments || [], order_data: order };
  const { error } = await supabase.from("orders").upsert(row, { onConflict: "id" });
  if (error) throw new Error(`Supabase order save failed: ${error.message}`);
  return order;
}
async function loadOrders() {
  if (!supabase) return;
  const { data, error } = await supabase.from("orders").select("order_data,id,status,comments,photo_url,card_image_url,business_connection_id,telegram_message_id,sent").order("id", { ascending: true });
  if (error) { console.error("Supabase order restore failed:", error.message); return; }
  orders = (data || []).map(row => ({ ...(row.order_data || {}), id: row.id, status: row.status, comments: row.comments || [], photo: row.photo_url || row.order_data?.photo, cardImage: row.card_image_url || row.order_data?.cardImage, businessConnectionId: row.business_connection_id, telegramMessageId: row.telegram_message_id, sent: row.sent }));
  nextId = Math.max(0, ...orders.map(o => Number(o.id) || 0)) + 1;
}

// Telegram sends this object when the admin connects/disconnects the bot in Telegram Business.
// Persisting the connection prevents a normal server restart from making the dashboard say
// "Not connected". ADMIN_BUSINESS_CONNECTION_ID can also be supplied as a production fallback.
let businessConnections = new Map();
try { fs.mkdirSync(BUSINESS_STORE_DIR, { recursive: true }); } catch {}

function loadBusinessConnections() {
  try {
    if (fs.existsSync(BUSINESS_STORE)) {
      const saved = JSON.parse(fs.readFileSync(BUSINESS_STORE, "utf8"));
      if (Array.isArray(saved)) {
        for (const connection of saved) {
          if (connection?.id && connection.is_enabled !== false) {
            businessConnections.set(String(connection.id), connection);
          }
        }
      }
    }
  } catch (error) {
    console.error("Could not load Telegram Business connections:", error.message);
  }
}
function saveBusinessConnections() {
  try {
    const enabled = [...businessConnections.values()].filter(c => c?.is_enabled !== false);
    fs.writeFileSync(BUSINESS_STORE, JSON.stringify(enabled, null, 2));
  } catch (error) {
    console.error("Could not persist Telegram Business connections:", error.message);
  }
}
loadBusinessConnections();

// Customers who have chatted with the admin account (learned from business_message updates).
// Lets the admin pick the recipient by name/@username instead of typing a numeric chat ID.
const customers = new Map();
const CUSTOMER_STORE = path.join(BUSINESS_STORE_DIR, "customers.json");
try { for (const c of JSON.parse(fs.readFileSync(CUSTOMER_STORE, "utf8"))) customers.set(String(c.id), c); } catch {}
async function persistCustomers() {
  const list = [...customers.values()];
  try { fs.writeFileSync(CUSTOMER_STORE, JSON.stringify(list)); } catch {}
  if (supabase) { try { await supabase.from("app_settings").upsert({ key: "telegram_customers", value: list, updated_at: new Date().toISOString() }); } catch {} }
}
async function restoreCustomers() {
  if (!supabase) return;
  try {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "telegram_customers").maybeSingle();
    if (Array.isArray(data?.value)) for (const c of data.value) if (c?.id && !customers.has(String(c.id))) customers.set(String(c.id), c);
  } catch {}
}
function rememberCustomer(chat = {}, from = {}, businessConnectionId = "") {
  if (!chat.id || String(from.id ?? chat.id) !== String(chat.id)) return;
  const name = [chat.first_name || from.first_name, chat.last_name || from.last_name].filter(Boolean).join(" ");
  const previous = customers.get(String(chat.id)) || {};
  customers.set(String(chat.id), {
    ...previous,
    id: String(chat.id),
    name: name || previous.name || "",
    username: chat.username || from.username || previous.username || "",
    // A customer belongs to the Business connection that delivered their chat update.
    // Reusing a different connection can make Telegram return BUSINESS_PEER_INVALID,
    // even when the numeric customer chat ID itself is correct.
    businessConnectionId: String(businessConnectionId || previous.businessConnectionId || ""),
    at: new Date().toISOString()
  });
  persistCustomers();
}

async function businessConnectionForCustomer(chatId) {
  const customer = customers.get(String(chatId));
  const customerConnectionId = customer?.businessConnectionId;
  if (customerConnectionId) {
    const cached = businessConnections.get(String(customerConnectionId));
    if (cached && isUsable(cached)) return cached;
    // Refresh the exact connection associated with this customer rather than accidentally
    // sending through another connected Business account.
    try {
      const fresh = await telegram("getBusinessConnection", { business_connection_id: String(customerConnectionId) });
      if (isUsable(fresh)) {
        businessConnections.set(String(fresh.id || customerConnectionId), fresh);
        await persistBusinessConnections();
        return fresh;
      }
    } catch (error) {
      console.error("Could not refresh customer's Telegram Business connection:", error.message);
    }
  }
  return activeBusinessConnection();
}
// Accepts "123456789", " 123 456 789 ", "ID: 123456789", "tg://user?id=123456789" and strips
// invisible characters (RTL marks, zero-width spaces) that Telegram clients add when copying.
function sanitizeChatId(input = "") {
  let raw = String(input).normalize("NFKC").replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "").trim();
  if (!raw) return "";
  const fromLink = raw.match(/[?&]id=(-?\d+)/);
  if (fromLink) return fromLink[1];
  if (/^-?\d+$/.test(raw)) return raw;
  const compact = raw.replace(/[\s,._]/g, "");
  if (/^-?\d{5,}$/.test(compact)) return compact;
  const labelled = raw.match(/(?:id|chat)\D{0,6}(-?\d{5,})/i);
  return labelled ? labelled[1] : "";
}
function resolveChatId(input = "", username = "") {
  const numeric = sanitizeChatId(input);
  if (numeric) return numeric;
  const handle = String(input || username).trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "").toLowerCase();
  if (!handle) return "";
  return [...customers.values()].find(c => (c.username || "").toLowerCase() === handle)?.id || "";
}
function isAdminOwnId(chatId) {
  const id = String(chatId);
  return [...businessConnections.values()].some(c => String(c.user?.id || "") === id || String(c.user_chat_id || "") === id);
}
function candidateConnections(chatId, primary) {
  const list = [];
  const add = c => { if (c?.id && !list.some(x => String(x.id) === String(c.id))) list.push(c); };
  add(primary);
  add(businessConnections.get(String(customers.get(String(chatId))?.businessConnectionId || "")));
  for (const c of businessConnections.values()) if (isUsable(c)) add(c);
  if (BUSINESS_CONNECTION_ID) add({ id: BUSINESS_CONNECTION_ID, is_enabled: true, rights: { can_reply: true }, configured: true });
  return list;
}
app.get("/api/customers", (req, res) => res.json([...customers.values()].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 200)));

function esc(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function keyboard(id) {
  return { inline_keyboard: [
    [{ text: "✅ Confirm Order", callback_data: `confirm:${id}` }, { text: "❌ Reject Order", callback_data: `reject:${id}` }],
    [{ text: "💬 Comment", callback_data: `comment:${id}` }]
  ] };
}
function activeBusinessConnection() {
  // Prefer the explicitly configured connection when present.
  if (BUSINESS_CONNECTION_ID) {
    const configured = businessConnections.get(String(BUSINESS_CONNECTION_ID));
    if (configured) return isUsable(configured) ? configured : null;
    // No update received since the last restart: trust the configured ID; Telegram validates it at send time.
    return { id: String(BUSINESS_CONNECTION_ID), is_enabled: true, rights: { can_reply: true }, configured: true };
  }
  return [...businessConnections.values()].find(isUsable);
}
const telegram = (method, body, opts) => tgApi.call(method, body, opts);
async function sendCardAsAdmin(chatId, filePath, order, connection) {
  const bytes = await fs.promises.readFile(filePath);
  const caption = `<b>AMBAR FURNITURE — ORDER CARD</b>\n<b>Order:</b> ${esc(order.orderId)}\n<b>Product:</b> ${esc(order.product || "Furniture order")}\n<b>Customer:</b> ${esc(order.customerName)}\n<b>Status:</b> Pending\nPlease review the attached order card.`;
  const peerProblem = /BUSINESS_PEER_INVALID|chat not found|PEER_ID_INVALID|BUSINESS_PEER_USAGE_MISSING/i;
  const attempts = candidateConnections(chatId, connection);
  let lastError;
  for (const conn of attempts) {
    try {
      const sent = await tgApi.sendForm("sendPhoto", () => {
        const body = new FormData();
        body.append("business_connection_id", String(conn.id));
        body.append("chat_id", String(chatId).trim());
        body.append("photo", new Blob([bytes], { type: "image/png" }), path.basename(filePath) + ".png");
        body.append("caption", caption);
        body.append("parse_mode", "HTML");
        body.append("reply_markup", JSON.stringify(keyboard(order.id)));
        return body;
      });
      // Remember which connection really worked for this customer.
      const known = customers.get(String(chatId));
      if (known && known.businessConnectionId !== String(conn.id)) { known.businessConnectionId = String(conn.id); persistCustomers(); }
      order.businessConnectionId = String(conn.id);
      return sent;
    } catch (error) {
      lastError = error;
      console.warn(`sendPhoto via connection ${conn.id} failed:`, error.message);
      if (!peerProblem.test(error.message) && !/BUSINESS_CONNECTION_INVALID/i.test(error.message)) break; // other errors: another connection will not help
    }
  }
  const base = friendlyError(lastError?.message);
  const checklist = " Checklist: (1) use the customer's own numeric user ID (not the admin's, not the bot's); (2) the customer must have sent a message to the admin account recently (Telegram allows replies for ~24h after their last message); (3) in Telegram → Settings → Business → Chatbots, the bot must be allowed to access this chat (not excluded) with 'Reply to messages' on. Best fix: pick the customer from the dropdown after they message the admin account.";
  const err = new Error(base + checklist);
  err.raw = lastError?.message || "unknown";
  err.tried = attempts.length;
  throw err;
}

function adminContactLink(order) {
  const conn = activeBusinessConnection();
  const user = (process.env.ADMIN_USERNAME || conn?.user?.username || "").replace(/^@/, "");
  const text = encodeURIComponent(`Order ${order.orderId}`);
  return user ? `https://t.me/${user}?text=${text}` : "";
}
async function cardFileFor(order) {
  if (order.cardImage && order.cardImage.startsWith("/uploads/")) return path.join(__dirname, "public", order.cardImage);
  const resp = await fetch(order.cardImage);
  const filePath = path.join(uploadDir, `card-${order.id}.png`);
  await fs.promises.writeFile(filePath, Buffer.from(await resp.arrayBuffer()));
  return filePath;
}
// Deliver a waiting order through the admin's Business account once the customer's real chat is known.
async function deliverPendingOrder(order, chatId, connectionId) {
  const conn = businessConnections.get(String(connectionId)) || { id: String(connectionId), is_enabled: true, rights: { can_reply: true } };
  order.telegramChatId = String(chatId);
  const file = await cardFileFor(order);
  const sent = await sendCardAsAdmin(chatId, file, order, conn);
  order.sent = true; order.sender = "admin_business_account"; order.telegramMessageId = sent.message_id;
  await saveOrderRecord(order);
  if (ADMIN_CHAT_ID) await safely("Admin notification", () => telegram("sendMessage", { chat_id: ADMIN_CHAT_ID, text: `✅ ${order.orderId} delivered from your admin account to chat ${chatId}.` }));
}
async function sendCardViaBot(chatId, filePath, order, extraCaption = "", withKeyboard = true) {
  const bytes = await fs.promises.readFile(filePath);
  const caption = `<b>AMBAR FURNITURE — ORDER CARD</b>\n<b>Order:</b> ${esc(order.orderId)}\n<b>Product:</b> ${esc(order.product || "Furniture order")}\n<b>Customer:</b> ${esc(order.customerName)}\n<b>Status:</b> Pending${extraCaption}`;
  return tgApi.sendForm("sendPhoto", () => {
    const body = new FormData();
    body.append("chat_id", String(chatId).trim());
    body.append("photo", new Blob([bytes], { type: "image/png" }), path.basename(filePath) + ".png");
    body.append("caption", caption);
    body.append("parse_mode", "HTML");
    if (withKeyboard) body.append("reply_markup", JSON.stringify(keyboard(order.id)));
    return body;
  });
}

app.get("/api/business/status", async (req, res) => {
  await supabaseReady;
  let connection = activeBusinessConnection();
  let botBusinessEnabled = false, botUsername = null, webhook = null;
  if (!BOT_TOKEN) {
    return res.json({ connected: false, canReply: false, botBusinessEnabled: false, botUsername: null, webhookReady: false, error: "BOT_TOKEN is not configured on the server (Render → Environment)." });
  }
  try {
    const bot = await telegram("getMe", {});
    botBusinessEnabled = !!bot.can_connect_to_business;
    botUsername = bot.username || null;
    webhook = await telegram("getWebhookInfo", {});
  } catch (error) {
    return res.json({ connected: false, canReply: false, botBusinessEnabled: false, botUsername, webhookReady: false, error: friendlyError(error.message) });
  }
  // Repair the webhook automatically if Telegram points somewhere else (old URL, lost secret, missing update types).
  try {
    if (await tgApi.healWebhookIfNeeded(webhook)) webhook = await telegram("getWebhookInfo", {});
  } catch (error) { console.warn("Webhook self-heal failed:", error.message); }

  let refreshError = null;
  if (connection?.id) {
    try {
      const fresh = await telegram("getBusinessConnection", { business_connection_id: connection.id });
      if (fresh.is_enabled === false) {
        businessConnections.delete(String(connection.id)); await persistBusinessConnections(); connection = null;
      } else {
        businessConnections.set(String(fresh.id || connection.id), fresh); await persistBusinessConnections(); connection = fresh;
      }
    } catch (error) {
      // A temporary Telegram/network failure must NOT make a valid connection look disconnected.
      console.warn("Business connection status refresh failed:", error.message);
      if (/BUSINESS_CONNECTION_INVALID|not found|invalid/i.test(error.message) && !connection.configured) {
        businessConnections.delete(String(connection.id)); await persistBusinessConnections(); connection = null;
      } else refreshError = friendlyError(error.message);
    }
  }
  const webhookReady = !!webhook && webhook.url === tgApi.webhookUrl &&
    ["business_connection", "business_message"].every(x => (webhook.allowed_updates || []).includes(x));
  res.json({
    connected: !!connection,
    sender: connection?.user ? [connection.user.first_name, connection.user.last_name].filter(Boolean).join(" ") : null,
    canReply: connection ? canReply(connection) : false,
    connectionId: connection?.id || null,
    botBusinessEnabled,
    botUsername,
    webhookReady,
    webhookUrl: webhook?.url || null,
    webhookLastError: webhook?.last_error_message || null,
    webhookPending: webhook?.pending_update_count || 0,
    needsReconnect: !connection,
    warning: refreshError,
    instructions: !botBusinessEnabled
      ? "Business/Secretary Mode is not enabled for this bot. Open @BotFather → your bot → Bot Settings/Business Mode (Secretary Mode) and enable it, then reconnect the bot from Telegram Business."
      : !connection
        ? "The bot is Business-enabled, but Telegram has not supplied a Business connection to this server yet. Reconnect the bot from the administrator's Telegram Business → Chatbots, grant Reply to messages, then send a customer message."
        : null
  });
});

app.post("/api/business/refresh", async (req, res) => {
  try {
    await supabaseReady;
    const connection = activeBusinessConnection();
    if (!connection?.id) return res.status(409).json({ ok: false, error: "No Telegram Business connection ID is known yet. Connect the bot in Telegram Business and send/receive a message once." });
    const fresh = await telegram("getBusinessConnection", { business_connection_id: connection.id });
    if (fresh.is_enabled === false) {
      businessConnections.delete(String(fresh.id || connection.id));
      await persistBusinessConnections();
      return res.json({ ok: true, connected: false });
    }
    businessConnections.set(String(fresh.id || connection.id), fresh);
    await persistBusinessConnections();
    res.json({ ok: true, connected: true, sender: [fresh.user?.first_name, fresh.user?.last_name].filter(Boolean).join(" "), canReply: canReply(fresh) });
  } catch (error) {
    res.status(400).json({ ok: false, error: friendlyError(error.message) });
  }
});

app.get("/api/business/diagnostics", async (req, res) => {
  try {
    await supabaseReady;
    const webhook = await telegram("getWebhookInfo", {});
    const me = await telegram("getMe", {});
    const connections = [...businessConnections.values()].map(c => ({
      id: c.id,
      enabled: c.is_enabled !== false,
      canReply: canReply(c),
      user: c.user?.username || c.user?.first_name || null
    }));
    res.json({
      ok: true,
      webhook: {
        url: webhook.url || null,
        expectedUrl: tgApi.webhookUrl || null,
        urlMatches: webhook.url === tgApi.webhookUrl,
        hasCustomCertificate: !!webhook.has_custom_certificate,
        pendingUpdateCount: webhook.pending_update_count || 0,
        lastErrorDate: webhook.last_error_date || null,
        lastErrorMessage: webhook.last_error_message || null,
        allowedUpdates: webhook.allowed_updates || []
      },
      bot: { id: me.id, username: me.username || null, canConnectToBusiness: !!me.can_connect_to_business },
      configuredBusinessConnectionId: BUSINESS_CONNECTION_ID || null,
      savedConnections: connections,
      publicBaseUrl: PUBLIC_BASE_URL || null
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: friendlyError(error.message) });
  }
});

app.post("/api/business/reconfigure-webhook", async (req, res) => {
  try {
    const result = await tgApi.configureWebhook();
    const webhook = await telegram("getWebhookInfo", {});
    res.status(result.ok ? 200 : 500).json({ ok: result.ok, error: result.reason || undefined, webhook });
  } catch (error) {
    res.status(500).json({ ok: false, error: friendlyError(error.message) });
  }
});

app.post("/api/orders", upload.fields([{ name: "productPhoto", maxCount: 1 }, { name: "cardImage", maxCount: 1 }]), async (req, res) => {
  try {
    await supabaseReady;
    const order = { ...req.body };
    const productPhoto = req.files?.productPhoto?.[0];
    const cardImage = req.files?.cardImage?.[0];
    if (!productPhoto) return res.status(400).json({ ok: false, error: "Product photo is missing. Please select it again." });
    if (!cardImage) return res.status(400).json({ ok: false, error: "Generated PNG card is missing. Please try again." });
    order.telegramChatId = resolveChatId(order.telegramChatId, order.telegramUsername);
    if (!order.telegramChatId) return res.status(400).json({ ok: false, error: "Select the customer from the list, or enter their numeric Telegram chat ID. A @username only works for customers who have already messaged the admin account." });
    if (!BOT_TOKEN) return res.status(500).json({ ok: false, error: "BOT_TOKEN is not configured on the server." });
    if (isAdminOwnId(order.telegramChatId)) return res.status(400).json({ ok: false, error: "That chat ID belongs to the administrator's own Telegram account. Enter the CUSTOMER's numeric ID (pick them from the customer list)." });
    const connection = await businessConnectionForCustomer(order.telegramChatId);

    if (supabase) await loadOrders(); // another instance may have created orders; avoid id collisions
    order.id = nextId++;
    order.orderId = order.orderId || `Z-${String(order.id).padStart(3, "0")}`;
    order.status = "Pending";
    order.comments = [];
    order.photo = await uploadToSupabase(productPhoto, "products", productPhoto.mimetype);
    order.cardImage = await uploadToSupabase(cardImage, "cards", "image/png");
    order.sender = "admin_business_account";
    order.businessConnectionId = connection?.id || null;
    // Persist before sending so a failed Telegram request does not erase the submitted order.
    await saveOrderRecord(order);

    let sentMessage = null, via = "", warning = "", businessError = "", rawError = "", triedCount = 0;
    // 1) Preferred: as the administrator through Telegram Business.
    if (connection) {
      try { sentMessage = await sendCardAsAdmin(order.telegramChatId, cardImage.path, order, connection); via = "admin_business_account"; }
      catch (error) { businessError = error.message; rawError = error.raw || error.message; triedCount = error.tried || 0; }
    } else businessError = "No usable Telegram Business connection.";
    // 3) Last resort: keep the order and hand the card to the admin to forward manually.
    if (!sentMessage) {
      order.sent = false;
      await saveOrderRecord(order);
      let adminCopy = false;
      const startLink = adminContactLink(order);
      if (ADMIN_CHAT_ID) {
        try {
          await sendCardViaBot(ADMIN_CHAT_ID, cardImage.path, order, `\n\n⚠️ NOT delivered to customer chat ${esc(order.telegramChatId)}.\nAsk the customer to open this link and send the message — the card is then sent from YOUR account automatically:\n${startLink}`, false);
          adminCopy = true;
        } catch (error) { console.warn("Admin copy failed:", error.message); }
      }
      return res.json({ ok: true, delivered: false, order, cardUrl: order.cardImage, adminCopy, startLink,
        warning: `Order ${order.orderId} was saved, but Telegram would not let your admin account message that ID. Ask the customer to open this link and send the pre-filled message to your account; the card is then sent from your admin account automatically: ${startLink || "(set ADMIN_USERNAME in Render to your @username)"}` + (adminCopy ? " A copy of the card was also sent to your admin chat." : "") +
          ` | DIAGNOSIS — Telegram said: "${rawError || "no Business connection available"}"; connections tried: ${triedCount}; customer ${customers.has(String(order.telegramChatId)) ? "IS" : "is NOT"} in your known-customers list (${customers.size} known).` });
    }
    order.sent = true;
    order.telegramMessageId = sentMessage.message_id;
    await saveOrderRecord(order);
    res.json({ ok: true, delivered: true, order, sentAs: via, warning: warning || undefined, cardUrl: order.cardImage });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    await supabaseReady;
    if (supabase) await loadOrders();
    res.json(orders);
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});
app.post("/api/orders/:id/comment", async (req, res) => {
  try {
    await supabaseReady;
    if (supabase) await loadOrders();
    const order = orders.find(item => String(item.id) === String(req.params.id));
    if (!order) return res.status(404).json({ error: "Order not found" });
    const comment = String(req.body.comment || "").trim();
    if (!comment) return res.status(400).json({ error: "Comment is required" });
    order.comments.push({ comment, at: new Date().toISOString() });
    await saveOrderRecord(order);
    res.json({ ok: true, order });
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

async function safely(label, fn) {
  try { return await fn(); } catch (error) { console.warn(`${label} failed:`, error.message); return null; }
}

app.post("/api/telegram/webhook", async (req, res) => {
  // Acknowledge first: Telegram retries (and eventually disables) webhooks that answer slowly or with errors.
  if (tgApi.secret && req.get("X-Telegram-Bot-Api-Secret-Token") !== tgApi.secret) return res.sendStatus(401);
  res.sendStatus(200);
  try {
    const update = req.body || {};

    if (update.business_connection) {
      const connection = update.business_connection;
      if (connection.is_enabled !== false) businessConnections.set(String(connection.id), connection);
      else businessConnections.delete(String(connection.id));
      await persistBusinessConnections();
      console.log("Telegram Business connection update:", {
        id: connection.id,
        enabled: connection.is_enabled !== false,
        canReply: canReply(connection),
        user: connection.user?.username || connection.user?.first_name || null
      });
    }

    const callback = update.callback_query;
    if (callback) {
      const [action, id] = String(callback.data || "").split(":");
      await supabaseReady;
      if (supabase) await loadOrders();
      const order = orders.find(item => String(item.id) === String(id));
      if (!order) {
        await safely("answerCallbackQuery", () => telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "This order was not found." }));
      } else {
        const connectionId = callback.message?.business_connection_id || (order.sender === "bot" ? null : order.businessConnectionId);
        const chatId = callback.message?.chat?.id;
        if (action === "confirm" || action === "reject") {
          order.status = action === "confirm" ? "Confirmed" : "Rejected";
          await saveOrderRecord(order);
          await safely("answerCallbackQuery", () => telegram("answerCallbackQuery", { callback_query_id: callback.id, text: `Order ${order.status}.` }));
          if (chatId) {
            await safely("editMessageReplyMarkup", () => telegram("editMessageReplyMarkup", { ...(connectionId ? { business_connection_id: connectionId } : {}), chat_id: chatId,
              message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } }));
            await safely("sendMessage", () => telegram("sendMessage", { ...(connectionId ? { business_connection_id: connectionId } : {}), chat_id: chatId,
              text: `<b>${esc(order.orderId)}</b> is now <b>${esc(order.status)}</b>.`, parse_mode: "HTML" }));
          }
        } else if (action === "comment") {
          await safely("answerCallbackQuery", () => telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Please reply in this chat with your comment." }));
          if (chatId) await safely("sendMessage", () => telegram("sendMessage", { ...(connectionId ? { business_connection_id: connectionId } : {}), chat_id: chatId,
            text: `Please reply with your comment for <b>${esc(order.orderId)}</b>.`, parse_mode: "HTML" }));
        }
      }
    }


    // Business messages are messages exchanged in the admin's chats with customers.
    const businessMessage = update.business_message;
    if (businessMessage) {
      const connectionId = businessMessage.business_connection_id;
      const chatId = businessMessage.chat?.id;
      rememberCustomer(businessMessage.chat, businessMessage.from, connectionId);

      // A business message is a reliable way to learn the connection ID after a redeploy,
      // even when Telegram did not resend the original business_connection update.
      if (connectionId && !businessConnections.has(String(connectionId))) {
        await safely("Business connection refresh", async () => {
          const fresh = await telegram("getBusinessConnection", { business_connection_id: connectionId });
          if (fresh.is_enabled !== false && canReply(fresh)) { businessConnections.set(String(fresh.id || connectionId), fresh); await persistBusinessConnections(); }
        });
      }

      // Only customer messages count as comments (ignore the admin's own messages in that chat).
      const fromCustomer = businessMessage.from?.id === undefined || String(businessMessage.from.id) === String(chatId);

      // A customer just wrote to the admin account: send any waiting order card from the admin account.
      if (fromCustomer && connectionId) {
        await supabaseReady;
        if (supabase) await loadOrders();
        const uname = String(businessMessage.chat?.username || "").toLowerCase();
        const typed = String(businessMessage.text || "");
        const waiting = orders.filter(o => !o.sent && o.sender !== "bot" && (
          (typed && typed.toLowerCase().includes(String(o.orderId).toLowerCase())) ||
          (uname && String(o.telegramUsername || "").replace(/^@/, "").toLowerCase() === uname) ||
          String(o.telegramChatId) === String(chatId)));
        for (const o of waiting) {
          try { await deliverPendingOrder(o, chatId, connectionId); } catch (error) { console.warn(`Auto-delivery of ${o.orderId} failed:`, error.message); }
        }
      }
      if (businessMessage.text && fromCustomer) {
        await supabaseReady;
        if (supabase) await loadOrders();
        const list = orders.filter(item => String(item.telegramChatId).trim() === String(chatId));
        const order = list[list.length - 1];
        if (order) {
          order.comments = order.comments || [];
          order.comments.push({ comment: businessMessage.text, at: new Date().toISOString(), from: chatId });
          await saveOrderRecord(order);
          if (ADMIN_CHAT_ID) await safely("Admin notification", () => telegram("sendMessage", { chat_id: ADMIN_CHAT_ID,
            text: `💬 Comment on ${order.orderId} from customer ${chatId}:\n${businessMessage.text}` }));
        }
      }
    }
  } catch (error) {
    console.error("Telegram webhook error:", error);
  }
});

app.use((error, req, res, next) => res.status(400).json({ ok: false, error: error.message || "Upload failed." }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

process.on("unhandledRejection", error => console.error("Unhandled rejection:", error));
process.on("uncaughtException", error => console.error("Uncaught exception:", error));

if (require.main === module) app.listen(PORT, "0.0.0.0", () => {
  console.log(`Ambar Furniture app running on port ${PORT}`);
  supabaseReady = supabase
    ? Promise.all([loadOrders(), restoreBusinessConnections(), restoreCustomers()]).then(() => console.log("Supabase data restored."), error => console.error("Supabase restore failed:", error.message))
    : Promise.resolve();
  tgApi.configureWebhook();
});
module.exports = app;
