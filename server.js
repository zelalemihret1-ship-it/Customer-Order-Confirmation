const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || ""; // Receives comment notifications.
const BUSINESS_CONNECTION_ID = process.env.BUSINESS_CONNECTION_ID || ""; // Optional Telegram Business connection: sends as the connected business account.

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
  return String(s ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function cardSvg(o, photoDataUri) {
  const rows = [
    ["PRODUCT", o.product], ["SIZE", `L ${o.length || "—"} × W ${o.width || "—"} × H ${o.height || "—"} cm`],
    ["MATERIAL", o.material], ["COLOR", o.color], ["STYLE / DESIGN", [o.style, o.design].filter(Boolean).join(" / ")],
    ["HANDLE / DOOR", [o.handle, o.door].filter(Boolean).join(" / ")], ["PARTITION / DRAWER", [o.partition, o.drawer].filter(Boolean).join(" / ")],
    ["CUSTOMER", o.customerName], ["PHONE", o.phone], ["LOCATION", o.location],
    ["PAYMENT", o.payment ? `${o.payment} Birr` : "—"], ["ADVANCE", o.advance ? `${o.advance} Birr` : "—"],
    ["DELIVERY FEE", o.deliveryFee ? `${o.deliveryFee} Birr` : "—"], ["DELIVERY DATE", o.deliveryDate]
  ];
  const rowSvg = rows.map(([label, value], i) => {
    const col = i % 2, row = Math.floor(i / 2), x = col ? 635 : 75, y = 1035 + row * 76;
    return `<text x="${x}" y="${y}" class="label">${esc(label)}</text><text x="${x}" y="${y+32}" class="value">${esc(value || "—").slice(0, 48)}</text>`;
  }).join("");
  return `<svg width="1200" height="1660" viewBox="0 0 1200 1660" xmlns="http://www.w3.org/2000/svg">
  <defs><clipPath id="photo"><rect x="70" y="250" width="1060" height="700" rx="28"/></clipPath></defs>
  <rect width="1200" height="1660" fill="#f5f1e8"/><rect x="28" y="28" width="1144" height="1604" rx="38" fill="#fff" stroke="#e5ddcf" stroke-width="3"/>
  <path d="M28 66 Q28 28 66 28 H1134 Q1172 28 1172 66 V220 H28Z" fill="#153a2e"/>
  <text x="75" y="105" fill="#fff" font-family="Arial" font-size="48" font-weight="700">AMBAR FURNITURE</text>
  <text x="77" y="157" fill="#e8dfce" font-family="Arial" font-size="24" letter-spacing="4">CUSTOMER ORDER CARD</text>
  <rect x="900" y="76" width="220" height="70" rx="35" fill="#b89552"/><text x="1010" y="121" fill="#fff" text-anchor="middle" font-family="Arial" font-size="27" font-weight="700">${esc(o.orderId)}</text>
  <image href="${photoDataUri}" x="70" y="250" width="1060" height="700" preserveAspectRatio="xMidYMid meet" clip-path="url(#photo)"/>
  <rect x="70" y="250" width="1060" height="700" rx="28" fill="none" stroke="#e7e0d5" stroke-width="3"/>
  <text x="75" y="1000" fill="#b89552" font-family="Arial" font-size="25" font-weight="700" letter-spacing="3">ORDER DETAILS</text>
  ${rowSvg}
  <rect x="70" y="1535" width="1060" height="65" rx="18" fill="#f7f2e8"/><text x="600" y="1577" text-anchor="middle" fill="#153a2e" font-family="Arial" font-size="24" font-weight="700">Thank you for choosing Ambar Furniture!</text>
  </svg>`;
}
async function buildCardImage(o, file) {
  if (!file) throw new Error("Please select a product photo. A photo is required to create the order card.");
  const input = await fs.promises.readFile(file.path);
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error("The selected photo could not be read. Please choose a JPG, PNG, or WebP image.");
  const photo = await sharp(input).rotate().resize(1060, 700, { fit: "contain", background: "#f1ede5" }).png().toBuffer();
  const dataUri = `data:image/png;base64,${photo.toString("base64")}`;
  return sharp(Buffer.from(cardSvg(o, dataUri))).png().toBuffer();
}
async function telegram(method, body) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not configured on the server.");
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || "Telegram API error");
  return data;
}
async function sendCustomerCard(o, file) {
  if (!o.telegramChatId || !String(o.telegramChatId).trim()) {
    throw new Error("Customer Telegram Chat ID is required. The customer must start the bot first; a username alone cannot be used by the Bot API.");
  }
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not configured on the server.");
  const card = await buildCardImage(o, file);
  const form = new FormData();
  form.append("chat_id", String(o.telegramChatId).trim());
  form.append("photo", new Blob([card], { type: "image/png" }), `${o.orderId}-ambar-order-card.png`);
  form.append("caption", `Ambar Furniture · ${o.orderId}\nPlease review your order card.`);
  form.append("reply_markup", JSON.stringify(keyboard(o.id)));
  if (BUSINESS_CONNECTION_ID) form.append("business_connection_id", BUSINESS_CONNECTION_ID);
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: "POST", body: form });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram could not deliver the order card.");
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
    if (!file) return res.status(400).json({ ok: false, error: "Please select a product photo. The order is sent as a designed photo card, not as a text message." });
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
            text: `💬 Comment on ${o.orderId}\n${m.text}`
          });
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error("Telegram webhook error:", e);
    res.sendStatus(200);
  }
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ ok: false, error: err.message || "Upload failed." });
});
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Ambar Furniture app running on port ${PORT}`));
