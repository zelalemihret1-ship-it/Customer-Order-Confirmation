const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";

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
// Telegram sends this object when the admin connects/disconnects the bot in Telegram Business.
let businessConnections = new Map();

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
  // This app is configured for one Ambar Furniture admin/business account.
  return [...businessConnections.values()].find(c => c.is_enabled && c.rights?.can_reply);
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

app.get("/api/business/status", (req, res) => {
  const connection = activeBusinessConnection();
  res.json({ connected: !!connection, sender: connection?.user ? [connection.user.first_name, connection.user.last_name].filter(Boolean).join(" ") : null,
    canReply: !!connection?.rights?.can_reply });
});

app.post("/api/orders", upload.fields([{ name: "productPhoto", maxCount: 1 }, { name: "cardImage", maxCount: 1 }]), async (req, res) => {
  try {
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
    order.photo = `/uploads/${productPhoto.filename}`;
    order.cardImage = `/uploads/${cardImage.filename}`;
    order.sender = "admin_business_account";
    orders.push(order);

    // IMPORTANT: business_connection_id makes Telegram deliver the generated image as the admin account.
    const sentMessage = await sendCardAsAdmin(order.telegramChatId, cardImage.path, order, connection);
    order.sent = true;
    order.businessConnectionId = connection.id;
    order.telegramMessageId = sentMessage.message_id;
    res.json({ ok: true, order, sentAs: "admin_business_account" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/orders", (req, res) => res.json(orders));
app.post("/api/orders/:id/comment", (req, res) => {
  const order = orders.find(item => item.id == req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  const comment = String(req.body.comment || "").trim();
  if (!comment) return res.status(400).json({ error: "Comment is required" });
  order.comments.push({ comment, at: new Date().toISOString() });
  res.json({ ok: true, order });
});

app.post("/api/telegram/webhook", async (req, res) => {
  try {
    if (WEBHOOK_SECRET && req.get("X-Telegram-Bot-Api-Secret-Token") !== WEBHOOK_SECRET) return res.sendStatus(401);
    const update = req.body;

    if (update.business_connection) {
      const connection = update.business_connection;
      if (connection.is_enabled) businessConnections.set(connection.id, connection);
      else businessConnections.delete(connection.id);
    }

    const callback = update.callback_query;
    if (callback) {
      const [action, id] = String(callback.data || "").split(":");
      const order = orders.find(item => item.id == id);
      if (order) {
        const connectionId = callback.message?.business_connection_id || order.businessConnectionId;
        if (action === "confirm" || action === "reject") {
          order.status = action === "confirm" ? "Confirmed" : "Rejected";
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
    if (businessMessage?.text) {
      const connectionId = businessMessage.business_connection_id;
      const chatId = businessMessage.chat?.id;
      const list = orders.filter(item => String(item.telegramChatId) === String(chatId));
      const order = list[list.length - 1];
      if (order) {
        order.comments.push({ comment: businessMessage.text, at: new Date().toISOString(), from: chatId });
        if (ADMIN_CHAT_ID) await telegram("sendMessage", { chat_id: ADMIN_CHAT_ID,
          text: `💬 Comment on ${esc(order.orderId)} from customer ${esc(chatId)}:\n${esc(businessMessage.text)}` });
      }
      // Keep latest enabled business connection state refreshed when business messages arrive.
      if (connectionId && !businessConnections.has(connectionId)) {
        try {
          const fresh = await telegram("getBusinessConnection", { business_connection_id: connectionId });
          if (fresh.is_enabled) businessConnections.set(fresh.id, fresh);
        } catch (_) {}
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
app.listen(PORT, "0.0.0.0", () => console.log(`Ambar Furniture app running on port ${PORT}`));
