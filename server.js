const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
const BUSINESS_CONNECTION_ID = process.env.ADMIN_BUSINESS_CONNECTION_ID || "";
const BUSINESS_STORE_DIR = process.env.BUSINESS_STORE_DIR || path.join(__dirname, "data");
const BUSINESS_STORE = path.join(BUSINESS_STORE_DIR, "business-connections.json");
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "order-images";
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
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
  if (!supabase) { saveBusinessConnections(); return; }
  const enabled = [...businessConnections.values()].filter(c => c?.is_enabled !== false);
  const { error } = await supabase.from("app_settings").upsert({ key: "telegram_business_connections", value: enabled, updated_at: new Date().toISOString() });
  if (error) console.error("Supabase business connection save failed:", error.message);
}
async function restoreBusinessConnections() {
  if (!supabase) return;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", "telegram_business_connections").maybeSingle();
  if (error) { console.error("Supabase business connection restore failed:", error.message); return; }
  if (Array.isArray(data?.value)) {
    businessConnections.clear();
    for (const c of data.value) if (c?.id && c.is_enabled !== false) businessConnections.set(String(c.id), c);
  }
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
    if (configured?.is_enabled && configured?.rights?.can_reply !== false) return configured;
    // We may not have received a business_connection update after a server restart.
    return { id: String(BUSINESS_CONNECTION_ID), is_enabled: true, rights: { can_reply: true } };
  }
  return [...businessConnections.values()].find(c =>
    c?.is_enabled && c?.rights?.can_reply === true
  );
}
async function telegram(method, body) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not configured on the server.");
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || `Telegram ${method} failed.`);
  return data.result;
}
async function sendCardAsAdmin(chatId, filePath, order, connection) {
  const bytes = await fs.promises.readFile(filePath);
  const body = new FormData();
  body.append("business_connection_id", connection.id);
  body.append("chat_id", String(chatId));
  body.append("photo", new Blob([bytes], { type: "image/png" }), path.basename(filePath));
  body.append("caption", `<b>AMBAR FURNITURE — ORDER CARD</b>\n<b>Order:</b> ${esc(order.orderId)}\n<b>Product:</b> ${esc(order.product || "Furniture order")}\n<b>Customer:</b> ${esc(order.customerName)}\n<b>Status:</b> Pending\nPlease review the attached order card.`);
  body.append("parse_mode", "HTML");
  body.append("reply_markup", JSON.stringify(keyboard(order.id)));
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: "POST", body });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || "Telegram Business photo delivery failed.");
  return data.result;
}

app.get("/api/business/status", async (req, res) => {
  await supabaseReady;
  let connection = activeBusinessConnection();
  let bot = null;
  let botBusinessEnabled = false;
  let botUsername = null;
  let webhook = null;
  try {
    if (BOT_TOKEN) {
      bot = await telegram("getMe", {});
      botBusinessEnabled = !!bot.can_connect_to_business;
      botUsername = bot.username || null;
      webhook = await telegram("getWebhookInfo", {});
    }
  } catch (error) {
    return res.json({ connected:false, canReply:false, botBusinessEnabled:false, botUsername:null, error:error.message, webhookConfigured:false });
  }
  if (connection?.id && BOT_TOKEN) {
    try {
      const fresh = await telegram("getBusinessConnection", { business_connection_id: connection.id });
      if (fresh.is_enabled && fresh.rights?.can_reply) {
        businessConnections.set(String(fresh.id), fresh); await persistBusinessConnections(); connection = fresh;
      } else { businessConnections.delete(String(connection.id)); await persistBusinessConnections(); connection = null; }
    } catch (error) { console.warn("Business connection status refresh failed:", error.message); }
  }
  const webhookReady = !!webhook && webhook.url === `${PUBLIC_BASE_URL}/api/telegram/webhook` &&
    ["business_connection","business_message"].every(x => (webhook.allowed_updates || []).includes(x));
  res.json({
    connected: !!connection,
    sender: connection?.user ? [connection.user.first_name, connection.user.last_name].filter(Boolean).join(" ") : null,
    canReply: !!connection?.rights?.can_reply,
    connectionId: connection?.id || null,
    botBusinessEnabled,
    botUsername,
    webhookReady,
    webhookUrl: webhook?.url || null,
    webhookLastError: webhook?.last_error_message || null,
    webhookPending: webhook?.pending_update_count || 0,
    needsReconnect: !connection,
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
    if (!fresh.is_enabled) {
      businessConnections.delete(String(fresh.id));
      await persistBusinessConnections();
      return res.json({ ok: true, connected: false });
    }
    businessConnections.set(String(fresh.id), fresh);
    await persistBusinessConnections();
    res.json({ ok: true, connected: true, sender: [fresh.user?.first_name, fresh.user?.last_name].filter(Boolean).join(" "), canReply: !!fresh.rights?.can_reply });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/business/diagnostics", async (req, res) => {
  try {
    await supabaseReady;
    const webhook = await telegram("getWebhookInfo", {});
    const me = await telegram("getMe", {});
    const connections = [...businessConnections.values()].map(c => ({
      id: c.id,
      enabled: !!c.is_enabled,
      canReply: !!c.rights?.can_reply,
      user: c.user?.username || c.user?.first_name || null
    }));
    res.json({
      ok: true,
      webhook: {
        url: webhook.url || null,
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
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/business/reconfigure-webhook", async (req, res) => {
  try {
    await configureTelegramWebhook();
    const webhook = await telegram("getWebhookInfo", {});
    res.json({ ok: true, webhook });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

async function configureTelegramWebhook() {
  if (!BOT_TOKEN || !PUBLIC_BASE_URL) {
    console.log("Telegram webhook auto-configuration skipped: set BOT_TOKEN and PUBLIC_BASE_URL (or use RENDER_EXTERNAL_URL).");
    return;
  }
  try {
    // Replace any old webhook configuration so Business updates are not trapped by an older URL.
    await telegram("deleteWebhook", { drop_pending_updates: false });
    const payload = {
      url: `${PUBLIC_BASE_URL}/api/telegram/webhook`,
      allowed_updates: ["message", "callback_query", "business_connection", "business_message", "edited_business_message", "deleted_business_messages"]
    };
    if (WEBHOOK_SECRET) payload.secret_token = WEBHOOK_SECRET;
    const result = await telegram("setWebhook", payload);
    console.log("Telegram webhook configured:", result);
  } catch (error) {
    console.error("Telegram webhook configuration failed:", error.message);
  }
}

app.post("/api/orders", upload.fields([{ name: "productPhoto", maxCount: 1 }, { name: "cardImage", maxCount: 1 }]), async (req, res) => {
  try {
    await supabaseReady;
    const order = { ...req.body };
    const productPhoto = req.files?.productPhoto?.[0];
    const cardImage = req.files?.cardImage?.[0];
    if (!productPhoto) return res.status(400).json({ ok: false, error: "Product photo is missing. Please select it again." });
    if (!cardImage) return res.status(400).json({ ok: false, error: "Generated PNG card is missing. Please try again." });
    if (!order.telegramChatId?.trim()) return res.status(400).json({ ok: false, error: "Enter the customer's Telegram private chat ID." });
    if (!BOT_TOKEN) return res.status(500).json({ ok: false, error: "BOT_TOKEN is not configured on the server." });
    const connection = activeBusinessConnection();
    if (!connection) return res.status(409).json({ ok: false, error: "Admin Telegram Business is not connected. Connect this bot in Telegram Business and grant permission to reply. The app will not send the card from the bot account." });

    order.id = nextId++;
    order.orderId = order.orderId || `Z-${String(order.id).padStart(3, "0")}`;
    order.status = "Pending";
    order.comments = [];
    order.photo = await uploadToSupabase(productPhoto, "products", productPhoto.mimetype);
    order.cardImage = await uploadToSupabase(cardImage, "cards", "image/png");
    order.sender = "admin_business_account";
    order.businessConnectionId = connection.id;
    // Persist before sending so a failed Telegram request does not erase the submitted order.
    await saveOrderRecord(order);
    const sentMessage = await sendCardAsAdmin(order.telegramChatId, cardImage.path, order, connection);
    order.sent = true;
    order.telegramMessageId = sentMessage.message_id;
    await saveOrderRecord(order);
    res.json({ ok: true, order, sentAs: "admin_business_account" });
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

app.post("/api/telegram/webhook", async (req, res) => {
  try {
    // Require Telegram webhook authentication whenever a secret is configured.
    if (WEBHOOK_SECRET && req.get("X-Telegram-Bot-Api-Secret-Token") !== WEBHOOK_SECRET) return res.sendStatus(401);
    const update = req.body;

    if (update.business_connection) {
      const connection = update.business_connection;
      if (connection.is_enabled) businessConnections.set(String(connection.id), connection);
      else businessConnections.delete(String(connection.id));
      await persistBusinessConnections();
      console.log("Telegram Business connection update:", {
        id: connection.id,
        enabled: connection.is_enabled,
        canReply: !!connection.rights?.can_reply,
        user: connection.user?.username || connection.user?.first_name || null
      });
    }

    const callback = update.callback_query;
    if (callback) {
      const [action, id] = String(callback.data || "").split(":");
      await supabaseReady;
      if (supabase) await loadOrders();
      const order = orders.find(item => String(item.id) === String(id));
      if (order) {
        const connectionId = callback.message?.business_connection_id || order.businessConnectionId;
        if (action === "confirm" || action === "reject") {
          order.status = action === "confirm" ? "Confirmed" : "Rejected";
          await saveOrderRecord(order);
          await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: `Order ${order.status}.` });
          if (connectionId) {
            await telegram("editMessageReplyMarkup", { business_connection_id: connectionId, chat_id: callback.message.chat.id,
              message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
            await telegram("sendMessage", { business_connection_id: connectionId, chat_id: callback.message.chat.id,
              text: `<b>${esc(order.orderId)}</b> is now <b>${esc(order.status)}</b>.`, parse_mode: "HTML" });
          }
        } else if (action === "comment") {
          await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "Please reply in this chat with your comment." });
          if (connectionId) await telegram("sendMessage", { business_connection_id: connectionId, chat_id: callback.message.chat.id,
            text: `Please reply with your comment for <b>${esc(order.orderId)}</b>.`, parse_mode: "HTML" });
        }
      }
    }

    // Business messages are messages sent by customers to the admin account.
    const businessMessage = update.business_message;
    if (businessMessage) {
      const connectionId = businessMessage.business_connection_id;
      const chatId = businessMessage.chat?.id;

      // A business message is also a reliable way to learn the connection ID after a
      // redeploy, even when Telegram did not resend the original business_connection update.
      if (connectionId) {
        try {
          const fresh = await telegram("getBusinessConnection", { business_connection_id: connectionId });
          if (fresh.is_enabled && fresh.rights?.can_reply) {
            businessConnections.set(String(fresh.id), fresh);
            await persistBusinessConnections();
          }
        } catch (error) {
          console.warn("Could not refresh Business connection from business_message:", error.message);
        }
      }

      if (businessMessage.text) {
        await supabaseReady;
        if (supabase) await loadOrders();
        const list = orders.filter(item => String(item.telegramChatId) === String(chatId));
        const order = list[list.length - 1];
        if (order) {
          order.comments.push({ comment: businessMessage.text, at: new Date().toISOString(), from: chatId });
          await saveOrderRecord(order);
          if (ADMIN_CHAT_ID) await telegram("sendMessage", { chat_id: ADMIN_CHAT_ID,
            text: `💬 Comment on ${esc(order.orderId)} from customer ${esc(chatId)}:\n${esc(businessMessage.text)}` });
        }
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Telegram webhook error:", error);
    res.sendStatus(200);
  }
});

app.use((error, req, res, next) => res.status(400).json({ ok: false, error: error.message || "Upload failed." }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Ambar Furniture app running on port ${PORT}`);
  if (supabase) {
    supabaseReady = Promise.all([loadOrders(), restoreBusinessConnections()]).then(() => console.log("Supabase data restored."));
  }
  configureTelegramWebhook();
});
