const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || ""; // Used only for admin notifications/comments.

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const uploadDir = path.join(__dirname, "public", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Please upload an image file."));
    }
    cb(null, true);
  }
});

let orders = [];
let nextId = 1;

function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function cardCaption(o) {
  // Telegram photo captions are limited to 1024 characters. Keep this concise
  // so the product photo is delivered as a native Telegram photo card.
  const lines = [
    `AMBAR FURNITURE  |  ORDER ${o.orderId}`,
    `Product: ${o.product || "—"}`,
    `Size: L ${o.length || "—"} × W ${o.width || "—"} × H ${o.height || "—"} cm`,
    `Material: ${o.material || "—"}   Color: ${o.color || "—"}`,
    `Customer: ${o.customerName || "—"}`,
    `Phone: ${o.phone || "—"}`,
    `Location: ${o.location || "—"}`,
    `Payment: ${o.payment ? `${o.payment} Birr` : "—"}   Advance: ${o.advance ? `${o.advance} Birr` : "—"}`,
    `Delivery: ${o.deliveryDate || "—"}`,
    `Status: ${o.status}`,
    "Thank you for choosing Ambar Furniture!"
  ];
  return lines.join("\n").slice(0, 1024);
}
async function telegram(method, body) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not configured on the server.");
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || "Telegram API error");
  return data;
}
async function sendCustomerCard(o, file) {
  if (!o.telegramChatId || !String(o.telegramChatId).trim()) {
    throw new Error("Customer Telegram Chat ID is required. A username or phone number alone cannot be used by the Telegram Bot API to start a private chat.");
  }
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not configured on the server.");

  const chatId = String(o.telegramChatId).trim();
  const caption = cardCaption(o);
  let result;

  if (file) {
    // Upload the actual image bytes to Telegram. Do not give Telegram a localhost
    // URL or depend on PUBLIC_BASE_URL being publicly reachable.
    const bytes = await fs.promises.readFile(file.path);
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", new Blob([bytes], { type: file.mimetype }), file.originalname || "product-photo.jpg");
    form.append("caption", caption);
    form.append("reply_markup", JSON.stringify(keyboard(o.id)));
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form
    });
    result = await response.json();
    if (!result.ok) throw new Error(result.description || "Telegram photo upload failed.");
  } else {
    result = await telegram("sendMessage", {
      chat_id: chatId,
      text: caption,
      reply_markup: keyboard(o.id)
    });
  }
  return result;
}
function keyboard(id) {
  return { inline_keyboard: [
    [
      { text: "✅ Confirm Order", callback_data: `confirm:${id}` },
      { text: "❌ Reject Order", callback_data: `reject:${id}` }
    ],
    [{ text: "💬 Comment", callback_data: `comment:${id}` }]
  ] };
}

app.post("/api/orders", upload.single("productPhoto"), async (req, res) => {
  let file = req.file;
  try {
    const o = { ...req.body };
    if (!o.telegramChatId || !String(o.telegramChatId).trim()) {
      return res.status(400).json({
        ok: false,
        error: "Enter the customer's Telegram Chat ID. Telegram cannot send a private message to a customer using only their @username or phone number."
      });
    }
    o.id = nextId++;
    o.orderId = o.orderId || `Z-${String(o.id).padStart(3, "0")}`;
    o.status = "Pending";
    o.comments = [];
    if (file) {
      const ext = path.extname(file.originalname || "") || ".jpg";
      const safeName = `${randomUUID()}${ext}`;
      const finalPath = path.join(uploadDir, safeName);
      await fs.promises.rename(file.path, finalPath);
      file.path = finalPath;
      o.photo = `/uploads/${safeName}`;
    }

    // Save and send to the customer only; never silently redirect to ADMIN_CHAT_ID.
    const sent = await sendCustomerCard(o, file);
    o.sent = true;
    o.telegramMessageId = sent.result?.message_id;
    o.telegramChatId = String(o.telegramChatId).trim();
    orders.push(o);
    res.json({ ok: true, order: o, delivery: "customer" });
  } catch (e) {
    if (file?.path) {
      try { await fs.promises.unlink(file.path); } catch (_) {}
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/orders", (_req, res) => res.json(orders));

app.post("/api/orders/:id/comment", (req, res) => {
  const o = orders.find(x => x.id == req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  const comment = String(req.body.comment || "").trim();
  if (!comment) return res.status(400).json({ error: "Comment is required" });
  o.comments.push({ comment, at: new Date().toISOString() });
  res.json({ ok: true, order: o });
});

app.post("/api/telegram/webhook", async (req, res) => {
  try {
    const q = req.body.callback_query;
    if (q) {
      const [action, id] = String(q.data || "").split(":");
      const o = orders.find(x => x.id == id);
      if (o && (action === "confirm" || action === "reject")) {
        o.status = action === "confirm" ? "Confirmed" : "Rejected";
        await telegram("answerCallbackQuery", { callback_query_id: q.id, text: `Order ${o.status}.` });
        await telegram("editMessageReplyMarkup", {
          chat_id: q.message.chat.id,
          message_id: q.message.message_id,
          reply_markup: { inline_keyboard: [] }
        });
        await telegram("sendMessage", {
          chat_id: q.message.chat.id,
          text: `${o.orderId} is now ${o.status}.`
        });
      } else if (o && action === "comment") {
        await telegram("answerCallbackQuery", { callback_query_id: q.id, text: "Please send your comment in this chat." });
        await telegram("sendMessage", {
          chat_id: q.message.chat.id,
          text: `Please reply with your comment for ${o.orderId}.`
        });
      }
    }
    const m = req.body.message;
    if (m && m.text && !m.text.startsWith("/")) {
      const candidates = orders.filter(o => o.telegramChatId && String(o.telegramChatId) === String(m.chat.id));
      const o = candidates[candidates.length - 1];
      if (o) {
        o.comments.push({ comment: m.text, at: new Date().toISOString(), from: m.chat.id });
        if (ADMIN_CHAT_ID) {
          await telegram("sendMessage", {
            chat_id: ADMIN_CHAT_ID,
            text: `💬 Comment on ${
