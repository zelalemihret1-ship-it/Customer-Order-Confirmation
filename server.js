const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";

app.use(express.json({limit:"10mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,"public")));

const uploadDir = path.join(__dirname,"public","uploads");
fs.mkdirSync(uploadDir,{recursive:true});
const upload = multer({dest: uploadDir});

let orders = [];
let nextId = 1;

function esc(s=""){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function orderText(o){
  const f=(label,value)=>value && String(value).trim()?`• ${label}: ${esc(value)}\n`:"";
  const size=(o.length||o.width||o.height)?`• Size: L ${esc(o.length||"—")} × W ${esc(o.width||"—")} × H ${esc(o.height||"—")} cm\n`:"";
  return `<b>AMBAR FURNITURE</b>  •  <i>Customer Order Card</i>\n━━━━━━━━━━━━━━━━━━\n<b>ORDER ${esc(o.orderId)}</b>\n\n<b>PRODUCT</b>\n${f("Product",o.product)}${size}${f("Material",o.material)}${f("Color",o.color)}${f("Style",o.style)}${f("Design",o.design)}${f("Handle",o.handle)}${f("Door",o.door)}${f("Partition",o.partition)}${f("Drawer",o.drawer)}\n<b>CUSTOMER</b>\n${f("Name",o.customerName)}${f("Phone",o.phone)}${f("Location",o.location)}${f("Telegram",o.telegramUsername)}${f("Telegram phone",o.telegramPhone)}\n<b>SERVICE</b>\n${f("Payment",o.payment?o.payment+" Birr":"")}${f("Advance",o.advance?o.advance+" Birr":"")}${f("Delivery fee",o.deliveryFee?o.deliveryFee+" Birr":"")}${f("Order date",o.orderDate)}${f("Delivery date",o.deliveryDate)}\n<b>Status:</b> ${esc(o.status)}\n━━━━━━━━━━━━━━━━━━\n<i>Thank you for choosing Ambar Furniture!</i>`;
}
async function telegram(method, body){
  if(!BOT_TOKEN) throw new Error("BOT_TOKEN is not configured.");
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)
  });
  const data = await r.json();
  if(!data.ok) throw new Error(data.description || "Telegram API error");
  return data;
}
function keyboard(id){
  return {inline_keyboard:[
    [{text:"✅ Confirm Order",callback_data:`confirm:${id}`},{text:"❌ Reject Order",callback_data:`reject:${id}`}],
    [{text:"💬 Comment",callback_data:`comment:${id}`}]
  ]};
}

app.post("/api/orders", upload.single("productPhoto"), async (req,res)=>{
  try{
    const o = {...req.body};
    o.id = nextId++;
    o.orderId = o.orderId || `Z-${String(o.id).padStart(3,"0")}`;
    o.status = "Pending";
    o.comments = [];
    if(req.file) o.photo = `/uploads/${req.file.filename}`;
    orders.push(o);

    // Customer Telegram chat ID can be supplied by the admin form.
    // If omitted, the app sends to ADMIN_CHAT_ID as a testing/default destination.
    const chatId = o.telegramChatId || ADMIN_CHAT_ID;
    if(chatId){
      const caption = orderText(o).slice(0, 1024);
      if(o.photo){
        await telegram("sendPhoto",{chat_id:chatId,photo:`${process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`}${o.photo}`,caption,parse_mode:"HTML",reply_markup:keyboard(o.id)});
      } else {
        await telegram("sendMessage",{chat_id:chatId,text:caption,parse_mode:"HTML",reply_markup:keyboard(o.id)});
      }
      o.sent = true;
    }
    res.json({ok:true,order:o});
  }catch(e){ res.status(500).json({ok:false,error:e.message}); }
});

app.get("/api/orders",(req,res)=>res.json(orders));

app.post("/api/orders/:id/comment",(req,res)=>{
  const o = orders.find(x=>x.id==req.params.id);
  if(!o) return res.status(404).json({error:"Order not found"});
  const comment = String(req.body.comment||"").trim();
  if(!comment) return res.status(400).json({error:"Comment is required"});
  o.comments.push({comment,at:new Date().toISOString()});
  res.json({ok:true,order:o});
});

app.post("/api/telegram/webhook", async (req,res)=>{
  try{
    const q = req.body.callback_query;
    if(q){
      const [action,id] = String(q.data).split(":");
      const o = orders.find(x=>x.id==id);
      if(o && (action==="confirm" || action==="reject")){
        o.status = action==="confirm" ? "Confirmed" : "Rejected";
        await telegram("answerCallbackQuery",{callback_query_id:q.id,text:`Order ${o.status}.`});
        await telegram("editMessageReplyMarkup",{chat_id:q.message.chat.id,message_id:q.message.message_id,reply_markup:{inline_keyboard:[]}});
        await telegram("sendMessage",{chat_id:q.message.chat.id,text:`<b>${esc(o.orderId)}</b> is now <b>${esc(o.status)}</b>.`,parse_mode:"HTML"});
      } else if(o && action==="comment"){
        await telegram("answerCallbackQuery",{callback_query_id:q.id,text:"Please send your comment in this chat."});
        await telegram("sendMessage",{chat_id:q.message.chat.id,text:`Please reply with your comment for <b>${esc(o.orderId)}</b>.`,parse_mode:"HTML"});
      }
    }
    const m = req.body.message;
    if(m && m.text && !m.text.startsWith("/")){
      // Attach free-text customer comments to the most recent pending order for that chat.
      const candidates = orders.filter(o=>o.telegramChatId && String(o.telegramChatId)===String(m.chat.id));
      const o = candidates[candidates.length-1];
      if(o){
        o.comments.push({comment:m.text,at:new Date().toISOString(),from:m.chat.id});
        if(ADMIN_CHAT_ID) await telegram("sendMessage",{chat_id:ADMIN_CHAT_ID,text:`💬 <b>Comment on ${esc(o.orderId)}</b>\n${esc(m.text)}`,parse_mode:"HTML"});
      }
    }
    res.sendStatus(200);
  }catch(e){ res.sendStatus(200); }
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Ambar Furniture app running on http://localhost:${PORT}`));