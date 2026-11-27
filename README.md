## v177 — Material section on Home (Cut · Add · Edit with confirmation) · Workshop: newest orders, Sent products tab, Standard / Custom readymade
- **Home → Material** (new section, same style as Workshop) opens `/material.html`. The Material page shows every material (same data and same movement log as Reports → Material, which stays view-only) with three buttons per material: **✂️ Cut**, **➕ Add** and **✏️ Edit** (name, type, unit, low-stock alert and a stock correction). **🆕 New material** adds a material.
- **Confirmation.** The main admin's own Cut / Add / Edit apply at once. Every Cut / Add / New material / Edit made by any other admin goes to **⏳ Pending Admin Confirmation** at the top of the page; the stock does NOT change until the main admin presses **✅ Approve** (or **❌ Reject**). The sender sees his own waiting requests and the recently decided ones. Approved changes are logged in Reports → Material and the Google Sheet backup under the requester's name ("Approved by …" in the note). The Home row shows how many requests wait.
- **Access.** New admin section **🧱 Material** in Manage Admins. Admins who already have **Workshop** keep access to Material, so nobody has to be re-assigned.
- **Workshop → Order products** shows only the **newest orders that are not sent yet** (newest first, the latest one is marked). Orders already sent leave this list; rejected orders are hidden (they cannot be sent).
- **Workshop → 📤 Sent products** (new tab): all orders already sent (with Send again) and the sending log.
- **Workshop → Readymade** now has two types: **📦 Standard products** (regular models, as before) and **🎨 Custom products** (one-off custom designs: photo, name, type, measurement, **color**, quantity, handle, note). Both are saved into Stock and can be sent to the workshop group at once; custom products are marked CUSTOM in the Telegram post and in Home → Stock view. The **customer selection was removed** from the Readymade section (Customer ID → Send to workshop still sends a customer's info).
- Files changed: `material.js` (new), `public/material.html` (new), `workshop.js`, `public/workshop.html`, `reports.js` (custom + color on products), `server.js`, `public/home.html`, `public/index.html`, `package.json`, `README.md`. No change to the Google Apps Scripts. Check: `/api/workshop-version` → v177, `/api/material-version` → v177.

## v176 — Workshop rebuilt from scratch · Send to workshop from Customer ID · Stock view on Home
- **Old Workshop removed.** Production stages (workshop → finishing), materials, driver dispatch, Admin Confirmation, the monthly PDF report, Start from 0 and the Telegram stage buttons are gone (`pdfmini.js` deleted). Reports stays view-only (its Dispatch tab is removed; Material is read-only).
- **New Workshop (`workshop.js`, `public/workshop.html`).** Each admin chooses ONE workshop group (+ topic) once. The old workshop group of every admin is kept automatically on the first start. Posts go from the admin's own Telegram account, or from the AMBAR bot if the account is not connected (the bot must be in the group).
  - **📋 Order products** — every order with its customer. **Send** posts the product photo, order ID, measurement, details **and the customer info** (name, Customer ID, phone, location). An order already sent shows "Sent" (Send again is possible); rejected orders cannot be sent.
  - **🛋 Readymade products** — **➕ New readymade product** (photo, model, type, measurement, quantity, handle, note) is saved straight into **Stock** (Product IDs CH1…, CON1…, 1A… as before) and can be sent at once. Products already in stock can be sent one by one or many together, with an optional customer's info. Sold Out for everyone; delete for the main admin. Older Workflow products can be moved to Stock.
  - **🕘 Sent** — the log of everything sent (ok / failed with the reason).
- **Customer ID → 🛠 Send to workshop.** In the customer details (tap a customer), a button at the top beside the Customer ID opens that customer's orders (the newest unsent one is pre-selected) and the stock. Send → the workshop group, with this customer's info.
- **Home → Stock view.** Every in-stock product with its photo; tap a card for all info (ID, model, type, measurement, handle, category, capacity, location, kind, sales, dates, note). Search box, refreshes every 30 s. New route `GET /api/stock` (every assigned admin).
- Files changed: `workshop.js` (new), `public/workshop.html` (new), `public/callers.html`, `public/home.html`, `public/reports.html`, `public/index.html`, `reports.js` (`wsStockView`), `server.js`, `package.json`, `README.md`. Check: `/api/workshop-version` → v176.

## v175 — Material Add needs Main Admin confirmation; Confirmation Movements on top
- **Material Add → Pending Admin Confirmation.** When an admin (not the main admin) submits **New material** or **➕ Add** stock in Workshop → Material, nothing is added to the Material Stock. The request goes to a pending queue (`materialAddRequests` in the Reports data) and shows **⏳ Pending Admin Confirmation**; a pending "+qty" pill also appears on the material row. The submitter's Material topic (if chosen) gets a "waiting for confirmation" post.
- **Main admin** approves or rejects: **Approve** applies the add (new material or +qty, logged in Reports → Material and the Google Sheet backup under the requester's name, "Approved by …" in the note); **Reject** leaves the stock unchanged. A decision post goes to the Material topic. If a request can no longer be applied (e.g. the material was deleted), it is closed with a message. The main admin's own adds are applied at once (nobody above him to confirm). Cut behaviour is unchanged.
- **Confirmation Movements** is now the very first section on the Workshop page (above settings, tabs and everything else). Sender admin: own pending material requests and cuts, plus the last decided ones (✅ Approved / ❌ Rejected). Main admin: everything waiting, with Approve / Reject (shown only when something waits). It refreshes every 15 s.
- The Admin Confirmation sheet and the red number on Home / Workshop now count material adds and cuts together.
- New route `POST /api/workshop/material/add-decide` (main admin only). `/material/add` and `/material/move` return `pending: true` for non-main admins. Start from 0 keeps pending requests.
- Files changed: `reports.js`, `workshop.js`, `public/workshop.html`, `README.md`. Check: `/api/workshop-version` → v175.

## v174 — Modern dashboard, Admin Confirmation, view-only Reports, CH / CON product IDs, admin assignment
- **Admin Confirmation button** (Home, opposite the "Ambar Furniture" title; also in the Workshop header) — **main admin only**. Red number = pending inventory movements (material cut requests waiting for approval). The dot under it is the cutter status: amber and pulsing = "N cutter actions awaiting approval", green = "Cutter clear". Tapping it opens the confirmation sheet (Approve / Reject). New route `GET /api/workshop/confirmations` (main admin only, refreshed every 20 s on Home).
- **Reports is view-only** for Workflow, Stock, Stock view and Material. All write buttons are hidden, and every old write route (`/api/reports/product/*`, `/api/reports/material/*`) now answers 403. Create / edit / delete happen only in **Workshop**: Material tab (✏️ edit for Workshop admins; 🛠 fix stock, 🗑 delete for the main admin) and the new **Records** tab (✏️ edit for Workshop admins, 🗑 delete for the main admin). The same handlers are reused, so the Google Sheet backup is triggered exactly as before.
- **Workshop → Reports, live.** New Reports tab **🚚 Dispatch**: every driver dispatch (on the way / delivered) and every product in production, with the assigned admin. Workflow rows in Reports also show the assigned admin. Fed by `reportFeed()` of the Workshop module; Reports already refreshes every 5 s.
- **Sequential product IDs:** Shoe Shelf (footwear) → **CH1, CH2, CH3…**; Console products → **CON1, CON2…**. Numbers only go up; a deleted ID is never reused. Other product types keep 1A, 1B… Older Z-IDs stay as they are.
- **Assign admins to production activities** (Workshop → Progress): under each job in *In workshop* / *In finishing* a manager (main admin or any admin with the Workshop section) picks the admin responsible. The assigned admin can press Finished on that job even if another admin created it; the main admin can act on every job.
- **Main admin only:** Admin Confirmation, cut approval, product delete, material delete / stock fix / re-arrange, product undo / date correction, monthly report settings, Start from 0 (and the existing Reports connect / disconnect / reset).
- **Google Sheet:** same Apps Script, same one-way backup. The backup also re-runs by itself every 2 minutes if something changed since the last backup or the last backup failed (before: only on a new day).
- Files changed: `reports.js`, `workshop.js`, `server.js`, `public/home.html`, `public/workshop.html`, `public/reports.html`, `package.json`, `README.md`. No change to `reports-sheet-script.gs` — no new Apps Script deploy needed. Check: `/api/workshop-version` → v174.

## v173 — ⚙ Workshop settings: monthly PDF report + Start from 0
- **⚙ Settings button** (gear symbol, top right of the Workshop page). It opens a settings sheet with: the Telegram places (the old place settings), the **Monthly report** and **Start from 0**.
- **Monthly report (PDF, sent by the bot).** When an Ethiopian month is finished, the AMBAR **bot** sends one PDF to every main admin and the **new month starts** (the next report counts only the new month). The PDF holds everything: sold products, finished (moved to stock), in stock, in progress / workflow, workshop jobs, driver dispatches, all materials (in / out / stock now), material movements, standard products and the workshop activity — with product photos.
  - If the bot cannot send it (an admin never pressed Start in the AMBAR bot chat), it is retried every 10 minutes (about 2 days) and the settings sheet shows it as "Waiting to be sent".
  - Main admin can switch the automatic report off, and can switch on **"also start from 0 after it is sent"** (off by default). That automatic reset only clears the movements of the finished month.
  - **📄 Send this month's report to me now** sends the month so far to your own chat with the bot.
- **Start from 0** (main admin only, type ZERO). First the bot sends the full PDF (everything since the last start). If the PDF cannot be sent, **nothing is deleted** (a "Reset anyway (no PDF)" button appears). If the reports Google Sheet is connected, the old tabs are kept as "Archive …" like the Reports reset. Then only the old movements are cleared:
  - **Kept:** standard products · Progress (jobs in the workshop / finishing) and Workflow orders · products In Stock · every material and its stock · pending cut requests · deliveries still on the way.
  - **Cleared:** Sold products · the material movement list · decided cut requests · delivered driver dispatches · finished jobs that are already delivered (or sold) · the workshop activity log.
- The PDF is made inside the app (new file `pdfmini.js`, no new package). Text in other scripts (e.g. Amharic) cannot be drawn with the built-in PDF font and shows as "?".
- Files changed: `workshop.js`, `reports.js`, `server.js` (passes the main admin list), `public/workshop.html`, new `pdfmini.js`, `README.md`. Check: `/api/workshop-version` → v173.

## v172 — Each topic only once, Photo as photo, Delivered button in the driver topic, working material Cut
- **Each topic can be assigned only once.** The admin chooses his own places (Workshop, Finishing, Stock, Driver, Material). A topic already used by another admin, or by another place of the same admin, is hidden in the pickers, and Save refuses it too.
- **✂️ Cut** (Material tab) now cuts at once for the main admin: stock goes down, the movement is saved in **Reports → Material** (and the Google Sheet backup) and it is posted in the Material topic if one is chosen. Before, this button only sent a pending request.
- Material dispatch → Cut uses the same flow. A failed Telegram post (or no Material topic) no longer undoes the cut; it stays saved in Reports and the message tells you what happened.
- Other admins still send a cut request that the main admin approves.
- Dispatch photos are now sent as a real **photo** (before, the picture had no file name, so Telegram showed it as a file). Applies to every post sent from the admin's own account (workshop, finishing, stock, driver).
- **✅ Delivered** is now a button in the **driver topic**: right under the dispatch message the bot adds one small reply with the button (a user account cannot attach buttons; the dispatch itself is still sent from the admin's own account). The driver presses it when the product arrives: the button message changes to "✅ DELIVERED · name · time", and 
- No separate bot message about the delivery is sent to the admin any more (only the button message in the driver topic changes to ✅ DELIVERED).
- **Finished order** now lists only the **customers who have an available finished order** (real order record, not rejected, finished, not yet with the driver). Tap a customer → choose the product if there are several → the product and customer info open (photo, Product ID-Model, order ID, size, quantity, name, phone, location, balance) → 🚚 Send to driver.
- The mini app no longer has a Delivered button. Driver dispatch → **On the way** (waiting) and **✅ Delivered products** (full list with the time and who pressed it); the sheet refreshes by itself while open.
- The AMBAR bot must be in the driver group (as admin) so it can post the button.
- Files changed: `workshop.js`, `server.js` (forwards `wdel:`), `public/workshop.html`, `README.md`. Check: `/api/workshop-version` → v172.

## v171 — Dispatch rebuilt: two small buttons at the bottom
- The old **Send & Dispatch** tab (Driver dispatch + Material dispatch) was removed completely, with its route `/api/workshop/dispatch/send`.
- Production & Dispatch now ends with two small buttons fixed at the bottom of the page: **🚚 Driver dispatch** (badge = deliveries on the way) and **🧱 Material dispatch**. Each opens a sheet.
- **Driver dispatch** → posted in the Driver topic from the admin's own Telegram account (never the bot): product photo, Product ID-Model, customer name / phone / location (+ map link), **remaining balance** and an optional note.
  - 🛋 *Readymade sale*: choose a readymade product (Reports → Stock, or already Sold Out), pick the customer from the directory (or type), write the remaining balance.
  - 📦 *Finished order*: choose a finished order; customer and balance are filled from the order (Payment − Advance, or 0 when Paid in full) and can be edited. The order then leaves the old Progress "Send to driver" button.
  - **On the way** list with **✅ Delivered**: a Telegram user account cannot attach inline buttons, so the button is in the mini app. Pressing it posts "✅ DELIVERED" as a reply to the dispatch message in the Driver topic. **Remove** takes a wrong entry off the list (the Telegram message stays).
- **Material dispatch** → Material topic, from the admin's own account:
  - **✂️ Cut**: choose the material, write the amount → posted in the group AND taken off the stock (and written in the movement log / Sheet backup) at the same moment. If the Telegram post fails the stock is put back. Admins who are not the main admin still send a *cut request* that the main admin approves (v165 rule).
  - **📤 Send available materials**: every material with stock > 0 and its quantity.
- Fix: text-only posts from the user account were missing `parseMode: "html"`, so `<b>` tags appeared literally (also affected the v165 cut-request posts).
- Files changed: `workshop.js`, `reports.js` (wsCutNow, wsRevertCut, wsStockProducts), `public/workshop.html`, `README.md`. Check: `/api/workshop-version` → v171.

## v165 — Material cut approval + user-account topic sending
- Added a dedicated **Material topic** setting.
- Material **Cut** now creates a pending request; stock is reduced only after the **main admin approves** it.
- Main admin sees pending cuts in Workshop → Material and can Approve/Reject. Approved cuts are recorded in the shared material movement log and Google Sheet backup.
- Cut requests and approval/rejection notices are sent to the selected Material topic from the connected **user Telegram account**, not the bot.
- Workshop, Finishing, Stock and Driver production messages now send from the connected admin's **own Telegram account** to the selected topics.
- The mini app is the control center for approvals and production actions.
- Important: Telegram bot callback buttons are not used for these user-account production posts; the mini app controls the workflow.

## v164 Color, Send to driver, hide finished orders
- "Which order?" lists only UNFINISHED orders: an order whose products are all finished (or already sent to the driver) is not shown any more.
- Add sheet (when Order is chosen) and Custom product have a Color box: choose from the list or type any color. It is written in the workshop message under ADDITIONAL TEXTS.
- New optional DRIVER place in the Workshop settings (group + its Driver topic), like Workshop / Finishing / Stock.
- Finished ORDER → Stock post gets "🚚 Send to driver". READYMADE → after "🔴 Sold Out" the post gets "🚚 Send to driver" (not before). The same button is in Progress → Finished lately. The driver post has AMBAR FURNITURE, bold Product ID-Model, Order ID, measurement, quantity and (for orders) customer name, phone, location and delivery date. Sent once only.

## v163 "Which order?" shows all orders + typed order ID
- The "Which order?" box (Add sheet and Custom product) now lists ALL your orders (any status, even already sent), and has "✍ Type the order ID…" to type one by hand.
- The order ID (chosen or typed) is written in the workshop Telegram message as "Order ID: …" under the bold Product ID-Model lines.

## v162 Material search + add/cut only in Workshop
- Workshop → Material has a search box (name, type, unit, table).
- Reports → Material no longer has New material, ➕ Add or ✂️ Cut (buttons and server routes removed). Materials are added / cut only in Workshop; Reports keeps edit, fix stock, delete, drag order, history and the movements list.

## v161 Material section in Workshop
- New first tab "Material" at the top of the Workshop page: the same materials and movement log as Reports → Material (shared data, nothing duplicated).
- New material, ➕ Add and ✂️ Cut work from Workshop; changes show in Reports at once (and in its Google Sheet backup), and the other way round.

## v160 Workshop-only products, new Product IDs, short workshop message
- Reports no longer has "➕ New product" (and the /api/reports/product/add route is gone). Products are added only in the Workshop section. "➕ New material" stays.
- Reports → Stock view lists every product separately (own Product ID + model, e.g. Z1-E1); no more grouping with ×2, ×3.
- Product IDs: Shoe Shelf keeps Z1, Z2 … Every other product type / order uses 1A, 1B … 1Z, 2A … 2Z, 3A … The Workshop page previews the right IDs for each product type.
- Workshop Telegram message is now: AMBAR FURNITURE (top) · bold "ProductID-Model" (one line per unit, e.g. Z1-E1) · Measurement 120*35*120 · Quantity · Additional texts. (Finishing and Stock posts are unchanged.)

## v159 Workshop standard products + redesign
- Every admin with the Workshop section can now add, change and delete standard products (before, only the main admin saw the input).
- Standard tab: always-visible Add product button, an Add tile, search, and a clear empty state with an Add button.
- Every product sent to the workshop (readymade, order, custom) gets one Product ID per unit (orders too, from the same Z/Y/X sequence): Z1..Z40, Y1..Y40 … (E skipped), then OZ1..OZ40, OY1.. (quantity 4 = 4 IDs).
- Standard and custom products have a Product type (Shoe Shelf, Console Table, Chest Drawer, Center Table, TV Stand, Dining Table, Mirror, or Other). It is saved to Reports and shown in the Telegram message.
- Product IDs always start from the first free ID (Z1) and skip IDs already used.
- Choosing a standard product (or custom design) and a quantity shows the Product IDs it will get, live, in the Add sheet.
- Orders tab shows the Product ID each order will get (reserved so it matches the Telegram message). Telegram workshop message lists all Product IDs with a count.
- "List to send" shows the Product IDs each line will receive before it is sent to the workshop group.
- Progress tab now also lists every job linked to a product that is in Reports Workflow (e.g. N6 "In workshop"), even when another admin sent it.
- Workshop page redesigned: refreshed header, sticky icon tabs, softer cards, modern product grid.

## v158 Reports ↔ Workshop Workflow Products
- Workshop's Workflow Products tab is now a live view of every Reports product whose status is Workflow (READYMADE and ORDER), with Reports as the source of truth.
- Existing Reports products can be sent to Workshop and linked to a job; already-linked products show the current Workshop stage and cannot be sent twice.
- Workshop stage changes are written back to the Reports product (In workshop / In finishing). Finishing moves the same Reports product to Stock, so it leaves Workflow automatically.
- The Workshop tab is renamed Workflow Products and shows Reports product code, order type/reference, priority, and active stage.


## v157 Workshop reset and live synchronization
- Workshop queue now starts fresh at deployment cutover; older Workshop jobs remain stored but are hidden from the current board.
- Orders queue shows only eligible orders created after the cutover timestamp.
- Report Workflow products already linked to a Workshop job are removed from the Readymade send display and shown only in their current production stage.
- Reports refreshes every 5 seconds and Workshop every 10 seconds while visible, so Telegram Sold Out/Restock and stage changes appear promptly.
- Index page received responsive desktop/mobile layout polish.

# v153 — Workshop → Finishing → Stock chain, orderable confirmed orders, fixed Telegram group picker
- **Orders tab:** only orders the customer **CONFIRMED** and whose card was **DELIVERED** are listed and can be sent (button **Send** per order). Rejected, still-waiting and undelivered ("failed") orders are removed from the list, and the server refuses them too.
- **Telegram group selection fixed:** two places per admin — **Workshop** and **Finishing** — each a group or one topic of a group. Pick from "My groups" (groups with topics are marked), then pick the topic **by name** from a real topic list (no more typing a topic number). A pasted link is checked: a message number in a normal link is no longer mistaken for a topic. New **Check the bot** and a test message that goes to both places.
- **The chain:** a job (order / readymade / standard product / new design) is posted by the **AMBAR bot** in the **Workshop** topic with the button **🛠 Finished workshop** → it is posted in the **Finishing** topic with the button **✅ Finished** → the product moves to **Stock** in Reports. The same two buttons exist in the mini app (**Progress** tab).
- **Connected to Reports:** every job creates its product(s) in **Reports → Workflow** (ORDER or READYMADE, with the photo and a Prod ID); **✅ Finished** moves them to **Stock** (Ethiopian date + time, history line, Google Sheet backup). Readymade products already in Workflow can be sent from the **Readymade** tab.
- **Connected to the orders:** the order keeps `workshop` = stage (In workshop / In finishing / Finished · in stock) with who and when; the Orders tab shows it.
- The bot must be a member (best: admin) of the group — a Telegram user account cannot send buttons. Browsing groups/topics still uses the admin's own Telegram account.
- The old mode "without confirmation" was removed (only confirmed + delivered orders are orderable); an admin who had it is treated as "after the customer confirms".
- Files changed: `workshop.js`, `reports.js`, `server.js` (button callback + 2 context items), `public/workshop.html`. Check: `/api/workshop-version` → v153.

# v152 — Workshop: progress-only views, Custom product tab, Telegram sending fixed, modern look
- **Orders** tab now shows only orders IN PROGRESS (rejected by the customer and paid-in-full/completed orders are hidden). It is a view only — nothing is sent from it.
- **Readymade** tab now shows only UNFINISHED readymade products (still in Reports → Workflow). Finished (in stock) products are hidden. View only — no send.
- **Standard** tab has two sub-tabs: **Standard products** and **Custom product** (new design: photo + name + quantity + measurement + optional order + notes → added to the list → sent to the workshop).
- **Telegram fix:** a failed send was shown as "Sent" (the server overwrote `ok:false`). Now the real result and the Telegram error are shown, and the list is kept when sending fails.
- New modern design for `index.html` and `workshop.html`.
- Files changed: `workshop.js`, `reports.js`, `public/workshop.html`, `public/index.html`, `package.json`. Check: `/api/workshop-version` → v152.

# v151 — Workshop: STANDARD PRODUCTS → quantity + measurement → Order / Readymade → send
- Workshop page → new tab **🧰 Standard**. The **main admin** makes the standard products once (➕ New standard product: name + photo + standard measurements, one per line; ✏️ to change or delete). Every admin who has Workshop can choose from them.
- Tap a standard product → choose **Quantity** (− / + / type), **Measurement** (tap a standard one or type your own), and decide **📦 Order** or **🛋 Readymade**. For an **Order** you also pick *which order* (only your own orders) — its **Order ID** goes to the workshop. Add **additional notes** if needed.
- Each choice goes into a **list**; add as many products as you want, then **📨 Send list to workshop**. The workshop receives, per product: the standard photo + (ORDER: order ID) + product name + quantity + measurement + notes + who sent it. Sent from the admin's own Telegram account to the admin's own workshop group.
- Files changed: `workshop.js`, `public/workshop.html`, `package.json`. Check: `/api/workshop-version` → v151.

# v150 — WORKSHOP: send orders + readymade products to the private workshop Telegram group (per admin)
- New page **/workshop.html** (Home → **Workshop**) and new section **Workshop** in **Manage Admins** — the main admin ticks it for each individual admin. Main admins always have it.
- **Every admin has HIS OWN settings**: his own workshop group (+ topic) and his own sending mode. Picked from “My groups” (the groups his own Telegram account is in) or pasted as a link / @username / id (right-click-style: long-press a message in the group → Copy link; it also carries the topic).
- **Three ways for orders to reach the workshop** (per admin): 🖐 manual (button on each order) · ✅ automatically AFTER the customer confirms · ⚡ automatically WITHOUT confirmation, the moment the order is created. Sending manually an unconfirmed / rejected order asks “send without confirmation?” first.
- **Readymade products**: the in-stock readymade products of Reports (photo, size, handle, Prod Ids) are listed on the Workshop page — tick some (or all) and send them to the same group.
- Sent from the admin’s OWN connected Telegram account (not the bot). The workshop gets the product photo + production details only — **no phone, no payment, no customer contact**. A log of the last sends is shown on the page.
- Files: new `workshop.js`, `public/workshop.html`; changed `server.js`, `reports.js`, `public/index.html`, `public/home.html`, `package.json`. Check: `/api/workshop-version`.

# v149 — Fresh package of the Reports fix (no more “hasPerm is not a function”)
- Same fix as v147/v148, with the build tag raised to v149 so you can see the new files are really running: Reports → ⚙ must say `page v149 · server v149`. If the server part says v148 or OLD, the server was not updated: deploy the whole folder and restart.
- Files changed: `reports.js`, `public/reports.html`, `package.json`.

# v148 — Version check for the “hasPerm is not a function” error
- The Reports ⚙ sheet now shows `page v148 · server v148`. If it says **server OLD (not updated)** or the error is still there, the server is still running old files: deploy the **whole folder** of this zip (server.js, reports.js, public/…, package.json) and restart / redeploy.
- Files changed: `reports.js`, `public/reports.html`, `package.json`.

# v147 — Fix: “hasPerm is not a function” when opening Reports
- `reports.js` no longer depends on `server.js` passing `hasPerm` (older `server.js` files did not): it has its own safe check. If you still see an error after redeploying, make sure the **whole folder** (including `server.js`) from this zip is deployed, not only some files.
- Files changed: `reports.js`, `package.json`.

# v146 — Stock → Telegram: assign ALL sender admin accounts · each sends daily at its own time
- **Reports → ⚙ → Stock → Telegram → ⏰ Admin accounts that send the stock every day:** tick any admins (or **Select all admins**) and set a **time for each**. Every day, at its time, the stock is sent **from that admin's own Telegram account** (main admins, assigned main admins and assigned admins). The list shows who is connected and the last result of each sender.
- All senders use the same destinations (group / topic and the optional private admins). An admin whose Telegram account is not connected is skipped that day and shows ⚠️.
- **📨 Send now** still sends from the account of whoever presses it.
- Existing setting (single sender + time) is converted automatically.
- Files changed: `reports.js`, `public/reports.html`, `package.json`.

# v145 — Stock → Telegram: add / remove groups & channels · pick the topic (also several)
- **➕ Add from my Telegram groups & channels** lists the groups and channels of the sender's own Telegram account (public or private). A group with topics shows a **topic list with tick boxes** — tick one or several topics (or "General / whole group") and press **Add**. Channels and groups without topics are added directly.
- Every added group shows **🗂 Topic** (change / choose the topic later) and **✕ Remove**. Main admins: add / remove / topic changes are saved immediately; other admins use them for their own send.
- Still possible: paste `@username` or a topic link. Private sending to admins stays optional.
- Files changed: `reports.js`, `public/reports.html`, `package.json`.

# v144 — Stock → Telegram: private sending OPTIONAL · Telegram group (also private) + TOPIC
- **Reports → ⚙ → Stock → Telegram:** new **📣 Telegram group / channel** section. **🔎 Choose from my Telegram groups** lists the groups the sending person's own Telegram account is in (private ones too); if the group has topics, pick the **topic** and the stock goes into that topic. You can also paste a link/username (`@mygroup`, or a topic link like `https://t.me/c/1234567890/5`).
- **Sending privately to admins is now optional** — tick/untick **Also send privately to admins**; with it off only the group/topic gets the stock.
- Still sent from the account of whoever presses **Send now** (daily send: the chosen admin's account). READYMADE products only.
- The sending account must be a member of the group (admin for a channel) and allowed to post in the topic.
- Files changed: `reports.js`, `public/reports.html`, `package.json`.

# v143 — Stock → Telegram: sent from YOUR own account · group / channel username
- **📨 Send now** works for every admin who can open Reports (main admin, assigned main admin, assigned admin). It is sent **from the account of the person who presses it** — never from someone else's. If that person's own Telegram account is not connected the app says so.
- **Daily automatic send:** the sender can now be any admin whose own Telegram account is connected (main admin switches it on).
- **New: 📣 Telegram group or channel username** (e.g. `@mychannel, @mygroup`, several allowed). The stock is sent there too. The sending account must be a member of the group / an admin of the channel.
- The sender is skipped in the recipients list (nobody messages himself). Last send shows who sent it.
- READYMADE products only (unchanged).
- Files changed: `reports.js`, `public/reports.html`, `package.json`.

# v142 — Stock view shows ORDER products · Telegram sends READYMADE only
- **Reports → 🖼 Stock view** shows every product in stock, READYMADE and ORDER; ORDER products carry an **ORDER** tag (card, list and the opened product).
- **📨 Daily stock → Telegram** (and Send now) sends **READYMADE products only** — ORDER products are never sent.
- Files changed: `public/reports.html`, `reports.js`, `package.json`.

# v141 — Stock view: tap a product → big photo + description, handle, capacity
- Opening a product in **Reports → Stock view** now shows the large photo (whole picture, not cropped), the **Description**, handle, shoe capacity, type and group, then every Prod Id with its own photo, description and note.
- Files changed: `public/reports.html`, `package.json`.

# v140 — Stock view: same model + same handle + same measurement = one product
- **Reports → 🖼 Stock view** (and the daily Telegram stock message): products count as the SAME product only when the **model name, handle type and measurement (Description)** are all the same (×2, ×3 …). A different handle **or** a different measurement makes a separate product with its own photo.
- Files changed: `public/reports.html`, `reports.js`, `package.json`.

# v139 — Interested customers in the Google Sheet: golden shiny text
- **Google Sheet → Customers Data:** new column **⭐ Interested In** (products + note). Every interested customer row (something in that column, or Status = Interested) shows in **bold shiny gold text (#FFD700) on a deep dark background** so it glows. It follows the data automatically (conditional format).
- To apply: redeploy; paste the new `google-sheet-script.gs` (version `v94`), Deploy → Manage deployments → ✏ → New version → Deploy, then Customers Data → sync all.
- Files changed: `server.js`, `google-sheet-script.gs`, `README.md`.

# v138 — Reports: clean, modern, less crowded design
- **Look only — every function is the same.** Calmer colours, more space, one summary strip, simple tabs, softer cards.
- **One main button per product / material** (✅ Finished · 💰 Sold · ➕ Add · ✂️ Cut). Edit, Dates & times, History, Undo, Fix stock and Delete are inside a **⋯** menu with clear names.
- Smaller headings, no all-capital labels, and the red text for finished / sold products is kept.
- Files changed: `public/reports.html`, `package.json`.

# v137 — Sheet: one-line texts · Workflow columns removed · black line after every stock · red low material · Fix stock · confirmations
- **Google Sheet (all tabs):** texts run **horizontally on one line** (no more wrapping downwards); every column is widened to fit its longest text.
- **Workflow tab:** removed *Delivery Date · Sales Name · LOCATION · CHANGES · COR.* (the app still keeps these fields).
- **Stock tab:** a **black line** at the end of every stock table (SHOE SHELF · OTHERS · GADGETS).
- **Material tab:** **10 DAY 1 · 2 · 3** is bigger and bolder; a material with quantity **below 5** has its whole row in **red** (also in the app list/cards and the PDF).
- **Mini app → Material:** new **🛠 Fix stock** button — type the real quantity when a wrong one was inserted. It is saved in *Recent movements* as a correction (who, date, time, reason) and the sheet follows.
- **Confirmation for all movements:** ➕ Add · ✂️ Cut · 🛠 Fix stock · 💰 Sold · new product / material · edits · date changes now ask "are you sure?" (showing before → after) before saving. Finished · Undo · Delete already asked.
- To apply: redeploy the folder; paste the new `reports-sheet-script.gs` (version `reports-13`), Deploy → Manage deployments → ✏ → New version → Deploy, then Reports → ☁ → Back up now.
- Files changed: `reports.js`, `public/reports.html`, `reports-sheet-script.gs`, `package.json`.

# v135 — Sheet: black text · black line between 10-DAY blocks · wrapped text · Sold type + dates/times in the app
- **Google Sheet (all tabs):** every text is **black**. Only red: **sold products** (Stock tab) and **products moved to Stock** (Workflow tab). Cells that had white/red text on a dark fill now use a lighter fill so the black text is readable.
- **Material tab:** a solid **black line** now separates **10 DAY 1 · 2 · 3** (and stays at the end).
- **Long text:** every cell wraps and the row grows to fit, so nothing is hidden or runs outside its box.
- **Mini app → Reports:** **💰 Sold** has *Sold type* (Automatic / S.TODAY / SOLD), sold date and sold time. New **🕒 Dates & times** button (Workflow, Stock, Sold; list and card) edits the Started, Finished (moved to Stock) and Sold date + clock time and the Sold type. Saved in the history and in the Google Sheet.
- To apply: redeploy the folder; paste the new `reports-sheet-script.gs` (version `reports-12`), Deploy → Manage deployments → ✏ → New version → Deploy, then Reports → ☁ → Back up now.
- Files changed: `reports.js`, `public/reports.html`, `reports-sheet-script.gs`, `package.json`.

# v134 — Customer ID ⇄ Telegram name · Material sheet: second table without the header
- **Customers Data → add / edit:** new **✈️ Telegram name** field next to the Customer ID. Pick the Telegram account (name · @username) the bot has seen; the link is saved on the customer and the same Customer ID then shows beside that Telegram name in the customers list, the customer view and the **Orders → choose customer** list (choosing it also picks the Customer ID and creates the Order ID). A customer with the same @username is matched automatically; one Telegram account can belong to only one Customer ID. Orders of a linked Telegram account get that Customer ID and Telegram name.
- **Google Sheet · Material tab:** only the first table keeps the weekday row and the heading (No · Material · Type · Unit · Avilable · Opening Stock · dates · Total Used · NOTE). The second table (LAMINATE, PLYWOOD & OTHERS) continues directly under the first, with no heading.
- **Red text** for products moved to Stock and for sold products is in the script since v133 — paste the newest `reports-sheet-script.gs` (version `reports-11`), Deploy → Manage deployments → ✏ → New version → Deploy, then Reports → ☁ → Back up now.
- Files changed: `server.js`, `public/callers.html`, `public/index.html`, `reports-sheet-script.gs`, `package.json`.

# v133 — Reports: red text for finished / sold · new month starts clean · Material in two tables (reference order) · hold & drag to rearrange
- **Workflow:** when a product is pressed **Finished → In Stock** it stays in Workflow for the rest of that Ethiopian month under **✅ Finished → In Stock**, with **red text** (app, PDF and Google Sheet row). In the new month it is gone from Workflow.
- **Stock:** when a product is **Sold** its text turns **red** (app Sold list, PDF, Google Sheet row). The **Sold** list shows this Ethiopian month only; **📂 Show earlier months** brings the older sales back.
- **New month sheet = available products only:** the new month's Workflow tab has only products still in progress; the Stock tab has only products still in stock. Finished and sold products stay in the tab of the month they happened in. (Nothing is deleted from the app.)
- **Material:** two tables, in the reference order. Table 1 *OAK & NORMAL MDF*: OAK 6, OAK 18, NORMAL MDF 6 · 10 · 12 · 18. Table 2 *LAMINATE, PLYWOOD & OTHERS*: LAMINATE 18 GRAY, 18 RED/WOOD, plywood/suf 6 · 8 · 12, chipped 12, LAMINATE 6 white, LAMINATE WHITE/cream 18, LAMINATE WHITE 18, AUSTRALIA 4 BY 5 · 7 BY 5, MORALE 4 BY 5 · 7 BY 5, uv black 18. They are created once with quantity 0 (a material you already had with the same name + type keeps its quantity and just moves into place). New materials are added at the end of table 2 unless you choose another table. The Google Sheet Material tab and the PDF use the same two tables and order.
- **✋ Hold and drag:** hold a material for about half a second, then drag it to a new place — inside its table or into the other table. The order is saved by itself and is used by the PDF and the Google Sheet. (Turned off while the search box is used.)
- **Start from 0** now re-creates the two reference tables (all at 0).
- To apply: redeploy the folder; paste the new `reports-sheet-script.gs` (version `reports-10`), Deploy → Manage deployments → ✏ → New version → Deploy.
- Files changed: `reports.js`, `reports-sheet-script.gs`, `public/reports.html`, `package.json`.

# v124 — Interested customers · Reports ⚙ settings · modern Reports & Weekly Story design
- **Reports:** Make PDF, Google Sheet backup, Daily stock → Telegram and Start from 0 now live in the **⚙ gear** (top right). The bottom bar and the "☁ Backup ✓ date" chip are removed.
- **Reports and Weekly Story** have a new, more professional look (header, tabs, cards, buttons, forms).
- **Interested / special customers** with product selection (order page after sending, Customers Data form, list filter).
- Fix: First Greeting `getAppAdmins is not a function`.

# v122 — First Greeting switch = main admin only · Reports: list view default, Stock view after Material, daily stock to Telegram, ORDER type, real sales name
- **First Greeting → 🤖 Automatic first greeting:** only the **main admin** can switch it ON/OFF. The main admin sees one switch per admin (main admins + assigned admins) and sets each one; an assigned admin sees the state, the switch is locked (🔒) and the server refuses the change. Assigned admins can still write their own greeting text.
- **Reports:** the **☰ List view is now the default** (▦ Cards still one tap away). **🖼 Stock view** now comes **after Material**.
- **📨 Daily stock → Telegram (Reports → 📨 Telegram, main admin):** every day at the chosen Addis Ababa time the Stock view is sent to **every admin** (main + assigned): one message per model (same model + same handle = one message ×N) with the **photo**, **📏 size** (Description), **👟 shoe capacity**, **🔧 handle type** and the Prod Ids. It is sent **from the main admin's own Telegram account** (the one connected with the QR) — not from the bot and not from the mini app. **📨 Send now** tests it. The main admin's Telegram account needs an existing chat with each admin (open one once if Telegram says it cannot find them).
- New product field **Shoe capacity** (e.g. 24 pairs). The product's **Description** is used as the size.
- **Order Type is now READYMADE / ORDER** (CUSTOM is replaced everywhere: app, PDF, Google Sheet; old records are converted).
- **Sales info = the real mini-app salesperson.** When you press 💰 Sold the Sales Name (suggested from the mini-app admins, empty = you) is saved as the sales info — in the app, the PDF and the Google Sheet STOCK tab (SELSE INFO column) instead of S.R / S.O.
- **Google Sheet:** new products are at the **bottom** (oldest first, newest last — also for products saved in the same minute) on the Workflow and Stock tabs. Paste the new `reports-sheet-script.gs` (version `reports-9`) and deploy a New version.
- Files changed: `greetings.js`, `reports.js`, `reports-sheet-script.gs`, `server.js`, `public/greeting.html`, `public/reports.html`, `package.json`.

# v121 — Customer view (Make order · Edit) · Reports: Handle type, product photo, Stock view, List view, Recent movements
- **Customers Data → 📋 Customers:** tap a customer and a **view** opens (all the customer's information) with two buttons: **🧾 Make order** (opens the order page with this customer already chosen — Customer ID, name, phone, location, @username and the automatic Order ID are filled) and **✏️ Edit** (opens the customer in the Add / Update form).
- **Reports → New product / Edit:** new **Handle type** field (suggests the handle types you already used) and a **📷 Product photo** upload (shrunk to a small JPEG in the phone; change or remove it when editing). The handle is also in the PDF and in the Google Sheet backup (inside the Description cell, so your sheet layout stays the same).
- **Reports → 🖼 Stock view (new section):** shows the products that are IN STOCK by photo. **Same model + same handle = ONE photo with ×2, ×3 …** (tap it to see every Prod Id and press 💰 Sold / ✏️ on each). **Same model but a different handle = a separate photo.** The moment you press *Finished → In Stock* in Workflow the product appears here.
- **▦ Cards / ☰ List switch** on Workflow, Stock, Stock view and Material (remembered on the phone). Cards also show the product photo.
- **Material:** **🕘 Recent movements** is now its own section (all adds, cuts and new materials, grouped by Ethiopian day) next to **🧱 Materials**.
- To apply: redeploy the folder; paste the new `reports-sheet-script.gs` (version `reports-8`), Deploy → Manage deployments → ✏ → New version → Deploy (only needed so the handle shows in the sheet).
- Files changed: `reports.js`, `reports-sheet-script.gs`, `public/reports.html`, `public/callers.html`, `public/index.html`, `package.json`. Photos are saved in `data/report-photos` and also in Supabase (`app_settings`, key `rphoto_<id>`) so they survive a restart.

# v120 — Admin section access · Ratings end at "Delivered" + customer info · Reports from 0 · Stock sheet = your reference
- **Manage Admins** (Home → Administration): each assigned admin gets a 🔑 *Section access* panel: Orders · Customers · First Greeting · Ratings · Weekly Story · **Reports**. Turn Reports on and the Reports section appears on that admin's Home page and its API opens for them. Existing admins keep their old access (everything except Reports). Backup connect/disconnect and Start from 0 stay main-admin only.
- **Ratings**: stages are *Not delivered yet → Delivered → Rated* (no "sent" stage). Tap a rated order to see the customer's full info, the order details and all their orders.
- **Reports → 🗑 Start from 0** (main admin): the current data is saved in the Google Sheet first (old tabs renamed "Archive …"), then everything is cleared. If the backup fails nothing is deleted. Paste the new reports-sheet-script.gs (version reports-7) and deploy a New version.
- Sold type is S.TODAY on the sale day and SOLD from the next day; the server refreshes the sheet when the Ethiopian day changes.

# v119 — Reports work INSIDE the app · Google Sheet = BACKUP in YOUR sheet layouts · Ethiopian date + clock · Rating sections
**The mini app is the main source.** Home → Reports (main admins only). Nothing is read from the Google Sheet.
- **🛠 Workflow** (WORKFLOW FOLLOW-UP columns): Prod Id · S.No · Model · Description · Order Type (READYMADE/CUSTOM) · Priority (LOW/MEDIUM/HIGH) · Start Date (automatic) · Status · Finished Date · Delivery Date · Sales Name · Location · Changes · Correction. A Prod Id can't be used twice (empty = P-0001, P-0002 …).
- **✅ Finished → In Stock** → **📦 Stock**, grouped SHOE SHELF / OTHERS / GADGETS (the "Stock group" chosen on the product). **💰 Sold** records the sale; Sold type is **S.TODAY** on the day of the sale and **SOLD** afterwards; Sales info is S.R (readymade) or S.O (order) unless you type another. ↩ fixes a mistake; 📜 shows the history of each product.
- **🧱 Material** (Material Report columns): Material · Type · Unit · Available · Opening stock · daily use · Total used · Note. ➕ New material · ➕ Add · ✂️ Cut (never below 0). Tables (groups) like your sheet: put materials in a group name, e.g. BOARD / LAMINATES.
- **Ethiopian date AND Ethiopian clock everywhere** (app, PDF, sheet notes): 13:15 → 7:15 ቀን, 21:00 → 3:00 ሌሊት, 06:00 → 12:00 ቀን.
- **☁ Google Sheet backup:** after every change (and automatically when a new Ethiopian month starts) the app sends a copy. For EVERY Ethiopian month the sheet gets 3 tabs copied from your own sheets: `Workflow · Hidar 2019` (WORKFLOW FOLLOW-UP), `Stock · Hidar 2019` (30 DAY REPORT with SHOE SHELF / OTHERS / GADGETS tables, totals, AVAILABLE/BALANCE boxes, legend), `Material · Hidar 2019` (Material Report with 10 DAY 1·2·3 blocks, weekdays, opening/available/total used, newest additions box). Hover a date cell to see its Ethiopian clock time. Tabs are overwritten on every backup — work in the app. Other tabs are never touched. Old months stay.
- **⭐ Rating page:** the Orders list is now split into separate sections: **📤 Delivered · not sent**, **🚚 Not delivered yet**, **✉️ Link sent · waiting**, **⭐ Rated orders** (each with its count).
- **To apply:** redeploy the folder; paste the new `reports-sheet-script.gs` (version `reports-6`) in the reports Google Sheet (Extensions → Apps Script), Deploy → Manage deployments → ✏ → New version → Deploy; then Reports → ☁ → Back up now.
- Files changed: `reports.js`, `reports-sheet-script.gs`, `public/reports.html`, `public/rating.html`, `public/home.html`, `package.json`.

# v118 — Reports (Workflow · Stock · Material) from a NEW Google Sheet · View-only admins
**Reports (main admins only)**
- New **Reports** tile on Home (inside the main-admin area). Tabs **Workflow / Stock / Material** show the sheet exactly as it looks (colours, merged cells). **📄 Make PDF** builds an A4-landscape PDF (header, page numbers, date) in the phone; then **⬇ Download**, **Open**, or **✈ Send to my Telegram** (the bot sends the PDF to your own chat — the reliable way inside Telegram).
- **The report you see in the app IS the PDF page** (same header, colours, page numbers) with Fit / − / + zoom. **✏️ Edit** mode: tap a cell to change it, **➕ Insert row below** or **🗑 Delete row** — saved straight into the sheet (formula cells are locked; every edit is written to the Activity Log). Main admins only.
- If a report is empty the page says why and offers **🔍 Check connection** (link → script → tabs → rows read per tab) and an inline tab picker.
- After updating, paste the new `reports-sheet-script.gs` (script version `reports-3`) in the NEW sheet and deploy a New version (needed for editing).
- Data comes LIVE from a **second Google Sheet**. The old order sheet and `google-sheet-script.gs` are unchanged and keep working. The new sheet uses its own script: **`reports-sheet-script.gs`** (reads, and saves your in-app edits).
- First time: Home → Reports → follow the steps on screen (copy script → paste in the NEW sheet's Apps Script → deploy as Web app → paste the `/exec` link → Connect). The link is saved permanently (file + Supabase) like the order sheet.
- **Render:** set ONLY `REPORTS_SCRIPT_URL` = the `/exec` link and redeploy. No key needed (`REPORTS_SCRIPT_KEY` / `REPORT_KEY` are optional). The tab list and Workflow/Stock/Material tabs are detected automatically.
- ⚙ Settings (on the Reports page): choose which sheet tab(s) belong to Workflow / Stock / Material (guessed from the tab names), reload the tab list, open the sheet, disconnect. A report can use several tabs (e.g. Stock = Shoe Shelf + Others + Gadgets); each tab starts a new PDF page.
- Only main admins can open it. Assigned and view-only admins get "main admins only". Env var: `REPORTS_SCRIPT_URL`.
- New files: `reports.js`, `reports-sheet-script.gs`, `public/reports.html`. Endpoints: `/api/reports/status|connect|map|disconnect|data|send-pdf|script`.

**View-only admins**
- ⚙ Manage Admins: tick **👁 View-only** when assigning or editing, or tap **👁 Make view-only / ✏️ Allow editing** on an admin's row. A main admin can't be view-only.
- A view-only admin can **watch** everything (all orders, customers, stories, greeting and rating pages) but **cannot create, edit, send, delete or connect anything**. The server refuses every write for them (403 `VIEW_ONLY`), and the app shows a **👁 View only** badge and a clear message. The Administration area and Reports are hidden for them.
- Files changed: `server.js`, `public/app.js`, `public/app.css`, `public/home.html`, `public/index.html`. No new packages. Redeploy the whole folder.

# v117 — Telegram connection is QR-only (main admin generates, assigned admin scans)
- The phone-number / SMS / login-code method is **removed** (endpoints `/api/my-account/send-code|verify|resend`, `/api/setup/send-code|verify` are gone).
- **Main admin:** ⚙ Settings → 👥 Manage Assigned Admins → tap **📱 Generate connection QR** on an admin's row (or **Generate my connection QR** for your own account).
- **Assigned admin:** Telegram → Settings → Devices → Link Desktop Device → scan the QR → confirm. The row turns **✓ Telegram account connected**.
- The QR works only for the Telegram ID it was generated for; if another account scans it, the login is refused and logged out. The QR refreshes automatically and expires after 5 minutes.
- If the scanning account has 2-step verification, the admin types their own password in the box shown under the QR.
- New endpoints (main admin / setup key only): `/api/setup/app-admins/qr-start|qr-poll|qr-password|qr-cancel`. Still needs `TG_API_ID` and `TG_API_HASH`.

## v116 — Weekly Story: smaller, clearer Admin overview
- The **👑 Admin overview** (All admins tab) is now compact: a 4-box summary (Admins · Connected · Running · Posted today / Failed), a red alert line only when something failed, and **one slim row per admin** (initial, name, MAIN badge, green/amber Telegram dot, running / today / failed). Tap **+** to create a plan for that admin.
- Admins with failures or no Telegram connection are listed **first**; a **Needs attention** filter appears only when there is something to fix. First 5 shown, **Show all** for the rest.
- **Tap an admin to see their plans:** the plan list below shows only the selected admin (tap again, or **✕ Show all admins**, to see everyone). The **+** button still creates a new plan for that admin.
- **No more bot messages about stories.** The bot no longer sends "plan assigned to you", "posted from your account" or "could not be posted" messages. Status is still visible on the Weekly Story page (Posted / Failed, and the red alert in the overview). To bring the messages back, set `STORY_BOT_MESSAGES=1` in Render.
- Files changed: `stories.js`, `public/stories.html`. Redeploy the whole folder.

## v115 — Story videos: memory fix (Render "exceeded its memory limit") · videos open faster
- **Cause:** videos were read into server memory whole (up to 200 MB) when saving, backing up, re-downloading after a restart, and — since v114 — once per assigned admin. On a small instance this restarted the server, which also made videos show "still loading".
- **Fixed:** nothing big is held in memory any more — files are streamed (hash, download from the backup, play). A big original is backed up only after it is converted (much smaller). Admins who get the same plan share ONE file on disk and the video is converted ONCE, then handed to every copy.
- Converting uses 1 thread and 720p (Telegram's own story size), so it needs far less memory.
- Opening a video no longer waits behind a long conversion queue: after a few seconds it plays the saved file as it is.
- Files changed: `stories.js`, `storyvideo.js`. Redeploy the whole folder.

## v114 — Weekly Story: assign ONE plan to several admins · "One story" removed
- The **🎯 One story** mode is removed. The Weekly Story page now has only the weekly plan (7 photos/videos, one per day).
- **Assign this plan to** (main admin): instead of choosing one admin, tick as many admins as you want (or **Select all admins**). The plan is created once and every ticked admin gets their **own copy** — the same photos, videos, captions, dates and time — posted from **that admin's own Telegram account**. Each admin is notified. Admins not yet connected to Telegram are fine: the plan is saved and posts when they connect.
- **One tap for everyone:** the top card **👥 All admins** selects every admin (and you) in one click; tap it again to go back to just you. Each admin card can still be ticked on its own.
- "Create plan for…" on the *All admins* tab now selects just that admin in the list. Normal admins still only create plans for themselves. Plans saved earlier (including old one-story plans) keep working.
- Files changed: `stories.js`, `public/stories.html`. No new packages, Google Sheet script unchanged. Redeploy the whole folder.

## v110 — Story videos: every format, every phone
- Weekly Story accepts **any video format** (MP4, MOV, MKV, AVI, WebM, 3GP, WMV, FLV, MPEG, HEVC/H.265 …). The server converts each one to H.264 + AAC MP4 (`storyvideo.js`), so it plays **inside the mini app** on every phone and posts to Telegram. Videos already in that format are only re-wrapped (fast).
- Needs ffmpeg: the `@ffmpeg-installer/ffmpeg` package is an *optional* dependency in `package.json` (ships the binary, no download step, so it can never break the deploy). Or set `FFMPEG_PATH`. Videos saved earlier are converted once, the first time they are opened.
- Without ffmpeg, only videos the phone itself can read (normally MP4/MOV) are accepted.
- Limits unchanged: 60 seconds and 200 MB per video. Converting can take up to about a minute per video.

## v107 — Speed-up · Open Google Sheet fixed at the bottom
- **Open Google Sheet** is now a button fixed at the **bottom** of Home (just above the tab bar) and opens the sheet straight away (no extra page).
- Faster server: gzip on pages/JSON, pages revalidate (304) instead of re-downloading, order list cached 5 s (refreshed after every save), Google "script version" check cached 5 min and skipped for the sheet button, customer-status sheet sync runs in the background.
- Faster pages: shorter page fade + splash, duplicate Telegram script removed, repeated `/api/me` calls on the order page merged into one.
- Home now scrolls all the way to the end (extra room under the last tiles).
- Story video that this phone cannot play inside the app: it first retries from a downloaded copy, then shows the preview picture and an **Open video in browser** button (the story is still saved and posted as is).
- Files changed: `server.js`, `public/stories.html`, `public/home.html`, `public/index.html`, `public/app.js`, `public/app.css`. Redeploy the whole folder.

## v106 — More main admins · Story full-screen preview · main admin manages other admins' stories · real-app feel
- **Connect Telegram disappears once connected.** On Home the *Connect Telegram* button is shown only until your own Telegram account is connected; after that it is gone (only *Open Google Sheet* stays). It comes back by itself if you ever disconnect.
- **Feels like a real app** (new shared files `public/app.css` + `public/app.js`, loaded by every page): bottom **tab bar** (Home · Orders · Customers · Stories), short **splash** when the app opens, smooth page transitions, a light **haptic tick** on every tap, no text-selection / rubber-band scrolling, swipe-down-to-close switched off, Telegram's header/background colours matched to the app, Telegram's back arrow closes the open panel first and otherwise goes Home, "No connection" notice when offline.
- **More MAIN ADMINS.** *Manage Admins* → every admin row has **👑 Make main admin** (or tick it when assigning). A main admin has the same full control as the original one: Manage Admins, Google Sheet, Start from ZERO, all stories, every area. Each main admin keeps their OWN Telegram account (never the original admin's). The original main admin (set in Render `MAIN_ADMIN_TELEGRAM_ID`) can never be removed or demoted inside the app; nobody can remove their own main-admin rights.
- **Weekly Story — see it full screen.** Tap any photo/video — while choosing (before saving), in *My plans*, in *All admins* and in the edit window — to open it **full screen**. A **video starts playing at once** (with controls). Swipe left/right (or ‹ ›) to go through the 7 days, swipe down or ✕ to close, caption is shown on top of the picture.
- **Main admin manages other admins' stories.** In *All admins* the main admin can **create a plan for an admin** (New week → *Create this plan for*), **✏️ edit** their plan (caption, time, duration, replace a photo/video), pause/resume/delete it and press **Post now / Post for <name>**. The story is posted **from THAT admin's own Telegram account** (the admin gets a bot message, the day shows "by <main admin>"). If that admin has not connected Telegram yet, the app says so clearly instead of posting from the wrong account. Normal admins still see and edit only their own plans.
- Files changed: `server.js`, `stories.js`, `public/*.html`, new `public/app.js`, `public/app.css`. No new packages, Google Sheet script unchanged. Redeploy the whole folder.

## v105 — Home page redesign (modern look, real 3D icons)
- All symbols are now **real 3D icons** (drawn in the page itself — no extra files, no internet needed, same look on every phone).
- **Customer Order Confirmation** and **Customer ID** are side by side at the top.
- **Connect Telegram** and **Open Google Sheet** are two buttons side by side in a bar that stays fixed at the **bottom** of the screen.
- **Administration** (main admin only): dark panel with Connect Google Sheet, Manage Admins, Setup & Checks, Start from ZERO (red, still asks twice).
- Only `public/home.html` changed. Redeploy the whole folder.

## v104 — Home: Connect Telegram, Google Sheet, Administration · old gear removed · back buttons
- The old ⚙ settings gear on the order form is **removed**. Everything it did is now on the **Home page**:
  - **My account → 🔗 Connect my Telegram account** (every admin).
  - **Google Sheet → 📊 Open Google Sheet** (every admin).
  - **Administration** (main admin only): **⚡ Connect Google Sheet**, **👥 Manage Assigned Admins**, **🗑 Start from ZERO** (still asks twice), **⚙️ Setup & Checks**.
- A Home tile opens that one action straight away (the order form stays hidden, a **← Home** bar is shown on top); closing the panel returns to Home. After *Start from ZERO* finishes you land on Home.
- **Back buttons:** every area page has **← Home** at the top, and Telegram's own back arrow (top bar) also returns to Home on all of them, including Setup.
- Redeploy the whole folder (`server.js` is unchanged; all changes are in `public/`).

## v103 — Mini App opens on the 🏠 Home page
- Opening the Mini App (`/`) now shows the **Home page** (choose an area). The **order form** moved to **/orders.html** (the old `/index.html` still works).
- The ✏️ **Edit order** button in the admin bot still opens the order form directly (`/?edit=<id>`).
- Every area page has a **← Home** button; the order form has one too.
- If `public/home.html` is missing, `/` falls back to the order form, so the app never breaks. Unknown addresses open Home.
- Redeploy the whole folder (`server.js` + all files in `public/`). In @BotFather keep the menu-button address as your plain site address.

## v101 — 🏠 Home page (new: /home.html)
- New start page with one big tile per area: **Customer Order Confirmation**, **Customer ID** (Customers Data), **First Greeting**, **Customer Rating**, **Weekly Story**, and **Setup & Admins** (main admin only). Tap a tile to open that area.
- Open it at `/home.html` (set it as the bot's menu-button address in @BotFather if you want it to be the first screen). The normal `/` page still opens the order form as before.
- Redeploy `server.js` and `public/home.html`.

## v100 — ⭐ Customer Rating (new page: /rating.html)
- New page **⭐ Customer Rating**, opened from ⚙ Settings → *Customers messages*. After an order is **delivered**, the customer gets ONE message with a private rating link.
- On the link (`/rate/<token>`, no login) the customer taps **1–5 stars** and may write a comment. One rating per order. Every admin gets a bot notification: `⭐ New rating 4/5`.
- **Orders tab:** every order you created (main admin: all). Press **✅ Delivered · send link** → the order is marked delivered and the link is sent the same way the order card was sent (the admin's own Telegram account → Telegram Business → AMBAR bot). **↻ Send again** is available until the customer rates.
- **🤖 Automatic switch (OFF by default, per admin):** when an order's **Delivery Date** arrives, the link is sent by itself, once. Orders more than 14 days past their Delivery Date, rejected orders and orders whose card was never delivered are skipped, so switching it on never floods old customers.
- **✉️ Message tab:** your own message text with `{name} {order} {product} {admin} {link}`; the link is always added even if you remove `{link}`.
- **⭐ Ratings tab:** average, number of ratings, every comment; main admin also sees the average per admin.
- **Needs `PUBLIC_BASE_URL`** (your https site address) set in Render — the page warns you if it is missing.
- New files: `ratings.js`, `public/rating.html`. Changed: `server.js` (route + module registration), `public/index.html` (Settings button). No new packages, Google Sheet script unchanged.
- Redeploy the whole folder (`server.js`, `ratings.js`, `public/index.html`, `public/rating.html`).

## v99 — Weekly Story: ✏️ Edit plan
- Every plan you made now has a **✏️ Edit** (pencil) button next to Pause / Delete, in **My plans**.
- In the edit window you can change: plan name, first story day (only before the first story is posted — it moves the whole week), post time, how long the story stays visible, who can see it, the posting account (main admin), the caption for all stories, "keep on profile", and the **own caption of each day**.
- Each day that is **not posted yet** also has **🔄 Replace photo / video** (photo ↔ video both work; the same file can't be used on two days).
- Stories already posted are never changed or posted again. Only the admin who made the plan can edit it (the main admin can still pause / resume / delete any plan).
- **File size limit raised to 200 MB** per photo or video (was 20 MB). Videos are still up to 60 seconds.
- Redeploy `stories.js` and `public/stories.html` (`server.js` unchanged).

## v98 — First Greeting: no customer list · Weekly Story: photos AND videos
- **First Greeting page:** the "Choose customers" section (search, checkboxes, Send greeting button) is removed. The greeting is now automatic only: write your text, switch the 🤖 Automatic first greeting ON/OFF. The Sent log stays.
- **Weekly Story:** each of the 7 days can now be a **photo or a video** — the admin picks whatever they want for every day (all photos, all videos, or a mix). Use **🖼 Add photos** / **🎬 Add videos**; ◀ ▶ reorders, captions work for both. Videos: MP4/MOV, up to 60 seconds and 20 MB each (Telegram story limits). A small preview picture is made on the phone for each video. Each item is still posted once, on its own day, from the admin's own account (or the Business connection for the main admin). Existing photo plans keep working unchanged.
- Video backups use Supabase Storage (same bucket as order images) when Supabase is connected.
- Redeploy `server.js` (unchanged), `stories.js`, `greetings.js` (unchanged), `public/`.

## v97 — Automatic greeting confirmed for ALL private chats
- The automatic first greeting goes to every person who messages privately for the first time — saved in Customers Data or not, saved in the phone contacts or not. The log marks people who are not in Customers Data. Same rules: once only, nothing for people you already chatted with.

## v96 — 🤖 Automatic first greeting (ON / OFF switch on the First Greeting page)
- New switch at the top of **⚙ Settings → 👋 First Greeting**. **ON:** the first time a NEW person writes to you in a private chat, your saved greeting text is sent back automatically (plain text, 2-4 s delay, once). **OFF:** nothing is sent automatically (manual sending still works).
- Works per admin: an assigned admin's switch covers messages to their own connected Telegram account. The main admin's switch also covers the shared Business connection and the AMBAR bot's private chat.
- "First text only": people you already had a conversation with get nothing, and nobody is ever greeted twice (also not if you or another admin already greeted them manually; matched to Customers Data by @username). Automatic greetings appear in the Sent log marked "automatic".
- The automatic text is your saved text (switching ON also saves what is in the text box). Redeploy `server.js`, `greetings.js`, `public/`.

## v95 — 👋 First Greeting (separate page, opened from the ⚙ Settings icon)
- **⚙ Settings → 👋 First Greeting (text only)** opens `public/greeting.html` (logic in `greetings.js`). It sends a customer their **first message: one plain text, nothing else** (no photo, no card, no buttons).
- Pick customers from Customers Data (search, "Not greeted yet" filter, up to 30 at a time). The text can use `{name}` (first name), `{fullname}` and `{admin}` (the sender's name), with a live preview.
- **A customer is greeted only once** — by any admin. Already-greeted customers are greyed out with who/when, and the server refuses a second greeting.
- **Separate per admin:** each admin has their own saved greeting text, sends only from their own connected Telegram account, and sees their own log. **Main admin:** also sees every admin's log and a sent/failed count per admin; with no personal account connected the main admin can greet through the shared Business connection (customers who opened the AMBAR bot only).
- Messages go out one by one (1.5 s apart) so Telegram does not rate-limit the account. Redeploy `server.js`, `greetings.js`, `public/`.

## v94 — 📸 Weekly Story (separate page, opened from the ⚙ Settings icon)
- **⚙ Settings → 📸 Weekly Story** opens its own page (`public/stories.html`, logic in `stories.js`). Add **7 photos once**: Day 1 = photo 1 … Day 7 = photo 7. Each photo is posted as a Telegram story **once, on its own day** and is never posted again (same picture twice is refused, a posted day cannot be re-posted, a day that passed is marked Missed instead of being posted late).
- Choose first day, daily post time, duration (24h recommended), who can see it, optional caption (for all days or per day). Photos are fitted to 1080x1920 on the phone.
- **Everyone works separately:** an assigned admin sees and posts only their own plans, only from their own connected Telegram account. **Main admin extras:** an "All admins" tab (who is connected, running plans, posted today, failures), pause / resume / delete any admin's plan, and the option to post from the shared Telegram Business connection (needs the "Manage stories" permission). Only a plan's own admin can press Post now.
- Failed posts retry 3 times (10 min apart), then the admin and main admin get a bot message.
- Needs the admin's Telegram account connected (TG_API_ID / TG_API_HASH as before). Redeploy `server.js`, `stories.js` and `public/`. No Google script change.

## v93 — Admin rename everywhere · Archived Orders without repeats · customer status follows orders
- **Renaming an admin (✏️) now updates everything:** their orders (Created By), the label of their connected Telegram account / sending account, Customers Data (Sales Name, created by) and the Google Sheet (re-synced automatically).
- **Archived Orders: one row per order, never repeated.** Cause: the script read the order ID from column 1 (Customer Name) instead of the real `ID` column, so an archived order was never recognised; every deploy's auto-sync brought it back and archived it again. Now the `ID` column is found by name, old repeated rows are removed once (first copy kept), columns are re-mapped safely after the new Telegram Name / Customer ID columns, and the highlight rules no longer pile up.
- **Customer status:** when a customer makes an order they become **Customer**, and the order status (Pending / Confirmed / Rejected) always follows that customer's **latest** order (an older order can no longer overwrite it). Customers with older orders (even without a saved Customer ID, matched by phone / @username) are fixed automatically at start and on every Sync.
- **To apply:** re-paste `google-sheet-script.gs` (Deploy → Manage deployments → Edit → New version → Deploy), redeploy `server.js`, then press Sync ALL once.

## v92 — ✏️ Edit button for assigned admins
- In **👥 Manage Assigned Admins** every admin row now has a yellow **✏️ pencil** next to Delete. Tap it to edit the **name, Telegram ID, phone and a note**, then Save (or Cancel). The setup page has the same under "Edit an assigned admin".
- Name changes apply to everything the admin does from then on (Sales Name, Created By). Old records keep the old name.
- Changing the **Telegram ID** disconnects the old personal Telegram connection; the new person opens the app and taps Connect my Telegram account. A duplicate ID or the main admin's ID is refused.
- Redeploy `server.js` + `public/` (no Google script change needed).

## v91 — New modern Dashboard + Telegram name & Customer ID in the last columns
- **Dashboard completely redesigned** (Google Sheet → `Dashboard` tab): dark header, one blue **Reporting period** box (Today · This week · This month · This year · All time), 4 order cards (Total / Pending / Confirmed / Rejected with %), 4 money cards (Total payment / Advance received / Balance still due / Average order), 4 colour-bar boxes (Payment status, Top products, Delivery type, Delivery service) and the **Latest 10 orders** table (now also shows Telegram name + Customer ID). Plain words, big numbers, no clutter.
- "This week" on the Dashboard now starts on **Monday**, the same as the other tabs.
- **Every order row now ends with two new columns: `Telegram Name` and `Customer ID`** (last two columns of every month tab, Orders View and the Latest-orders table). It is filled for **every admin's orders**: the Customer ID comes from Customers Data, the Telegram name from the customer's Telegram profile (falls back to the Customers Data name / @username). Customer ID is stored as text, so `0007` stays `0007`.
- **To apply:** re-paste `google-sheet-script.gs` into Apps Script and save (Deploy → Manage deployments → Edit → New version → Deploy), redeploy `server.js`, then press **Sync ALL** once so older orders get their Telegram name and Customer ID too.

## v90 — Find Customer searches ALL customers
- Before: Find Customer only looked inside the monthly order tabs, so a customer with no order could never be found.
- Now it searches the whole **Customers Data** tab (name, phone, additional phone, @username, Customer ID, Order id) AND every order tab (name, username, Chat ID, order code, phone). Partial phone numbers (5+ digits) and short Customer IDs (e.g. `2` = 0002) work.
- A customer with no orders shows their profile with "No orders yet for this customer."
- If several customers match (e.g. "abel"), the best match is shown in full and the others are listed under "OTHER MATCHING CUSTOMERS".
- Older orders whose customer is not in Customers Data are still found.
- The search box now works even before any order tab exists. **Re-paste `google-sheet-script.gs` into Apps Script and save** (new Web-app version if deployed as one), then press Sync ALL once.

## v89 — Google Sheet Dashboard fix
- **Root cause:** in `google-sheet-script.gs` (`buildDashboard`) each KPI tile first merged its whole 3×2 block into one cell and then tried to merge rows inside it. Google Sheets rejects that ("You must select all cells in a merged range…"), so the build stopped right after the title and period rows and the Dashboard stayed empty.
- **Fix:** the tile block now only gets its colour/border; the three rows inside are merged separately.
- The period drop-down (B3, merged B3:C3) is now detected by row/column, so changing it always refreshes the Dashboard.
- **You must re-paste `google-sheet-script.gs` into the sheet's Apps Script and save** (then, if it is deployed as a Web app: Deploy → Manage deployments → Edit → New version → Deploy). Then run `refreshDashboardNow` once, or press Sync ALL in the app.

## v88 — Admin "Connect my Telegram account": login-code fix
- The code request now reads Telegram's REAL delivery route (app / SMS / call) and tells the admin exactly where to look.
- New **Resend code (SMS / call)** button (uses Telegram's own ResendCode, so a code that never showed up in the app can be re-sent by SMS or call).
- New **Login without a code (QR / link)**: no code is delivered at all. The admin opens the link (or scans the QR from another device) in a Telegram app that is already logged in and confirms. 2-step passwords are supported.
- Endpoints added: `/api/my-account/resend`, `/api/my-account/qr-start`, `/api/my-account/qr-poll`, `/api/my-account/qr-password`.

# v87 — Main admin and assigned-admin access / account isolation

- Kept the app restricted to the main admin and Telegram IDs explicitly assigned by the main admin. Unassigned Telegram accounts remain blocked.
- Clarified the roles: the main admin controls the shared Telegram Business bot connection and assigns/removes users; assigned admins can use AMBAR and connect only their own Telegram account.
- Fixed main-admin account lookup: a main admin who connects their own Telegram account is now correctly recognized as their own sender account. Previously, the lookup could miss that account because it was stored with the main admin Telegram ID.
- Prevented personal-account fallback across users: an assigned admin cannot accidentally send from another admin’s connected Telegram session.
- Telegram personal-account login codes are still delivered only through Telegram’s own login flow (Telegram app / supported delivery option). AMBAR cannot force a code into the bot chat or forward it. The shared bot is connected separately through the main admin’s Telegram Business → Chatbots settings.

## v87 activation
1. Replace the existing application files with this ZIP’s files, preserving Render environment variables and persistent data.
2. Confirm `MAIN_ADMIN_TELEGRAM_ID` (or `OWNER_TELEGRAM_IDS`) is set to the main admin’s numeric Telegram ID in Render.
3. Keep `BOT_TOKEN` configured. For personal Telegram account connections, also keep `TG_API_ID` and `TG_API_HASH`.
4. Redeploy on Render.
5. The main admin opens AMBAR from the bot, assigns users in Admin Control, and connects the shared bot through Telegram Settings → Telegram Business → Chatbots. Assigned users then open the same Mini App from their own Telegram accounts.

## v86 – Telegram login delivery error and pending-session repair

- Added a specific explanation for Telegram's `SEND_CODE_UNAVAILABLE` response: it means Telegram has no further SMS/phone delivery option for that login attempt; it is not a code that AMBAR can send.
- Clarified that an in-app route is only Telegram's reported delivery route; AMBAR cannot verify that a service notification appeared or force Telegram to send it.
- Fixed both owner and assigned-admin code-request flows so a failed SMS attempt does not disconnect and discard a previously pending login session. A new pending session replaces the old one only after Telegram successfully returns a new code hash.
- Kept the normal Telegram code flow and the optional SMS request. Telegram still controls availability; do not repeatedly request codes while rate-limited.

## v85 – ADMIN TELEGRAM LOGIN DELIVERY FIX
- Corrected the delivery-route detection to use GramJS's actual `isCodeViaApp` result (the previous code looked for a raw `type` object that GramJS does not return).
- Added an optional “Request SMS instead” choice in the admin's Connect my Telegram account panel. Telegram may still decline SMS or choose another route; the app now reports that accurately.
- Added a busy state while requesting a code and clarified that AMBAR cannot confirm delivery or forward Telegram's private login code.
- Both the assigned-admin connection and setup/admin connection endpoints accept the SMS preference.
- This does not bypass Telegram delivery restrictions. The host must still have valid `TG_API_ID` and `TG_API_HASH`; Telegram controls whether app, SMS, or another route is available.

# v84 update (2026-11-19)

- Fixed admin sender selection: the main admin can choose which connected admin Telegram account sends a new order. Assigned admins can only send from their own connected account; the server ignores any attempt to select another admin.
- The Admin Control list now shows whether each assigned admin has connected their Telegram account.
- Improved Telegram account connection: login requests now report Telegram's actual delivery channel where available, return clearer errors for invalid API credentials, invalid phone numbers, expired codes and Telegram rate limits, and clean up failed login sessions.
- Clarified that Telegram login codes are delivered by Telegram to an already logged-in Telegram app session or by SMS if Telegram offers it. They are never sent by the AMBAR bot.
- Required server variables for personal-account connection: `TG_API_ID` and `TG_API_HASH` from https://my.telegram.org → API development tools. `BOT_TOKEN` alone cannot authorize a personal Telegram account.
- Deploy the updated app files (especially `server.js` and `public/index.html`) and restart the hosting service. No Google Apps Script update is needed for this release.

# v83 update (2026-11-19)

- Rebuilt the Dashboard with a self-contained renderer so a refresh cannot stop after the title and reporting-period rows. It writes all six KPI cards, archived count, product/delivery breakdowns, latest orders, and a visible source-count diagnostic in Dashboard cell A40.
- Dashboard order discovery now scans every plausible order-data tab by its own row-1 headers, rather than relying only on Ethiopian-month tab names. It excludes Customers Data, Dashboard, helper tabs, Orders View, and Archived Orders to avoid mixing customers or double-counting archived orders.
- Apps Script version: v83. Replace `google-sheet-script.gs`, save, deploy a **new web-app version**, then run `refreshDashboardNow` once from the Apps Script editor. Confirm the execution log says how many active order records were read; the Dashboard A40 line shows the same source count.
- This update changes only the Dashboard builder/reader in the Google Sheet script; the v82 customer-only order selection changes remain in the app files.

# v82 update (2026-11-19)

- Fixed the Dashboard data reader: it now reads each Ethiopian-month tab using that tab's own header row, so different/older column orders cannot make the Dashboard appear empty. The dashboard also has a manual `refreshDashboardNow` function that rebuilds ONLY the Dashboard tab from the existing month tabs.
- Main order index now permits order creation only after selecting an existing customer from the Customers Data list. Removed the “No Customer ID / type order code” option; Order ID stays automatic and the server rejects orders without a valid Customers Data customer.
- Apps Script version: v82. Replace `google-sheet-script.gs`, deploy a new web-app version, then run `refreshDashboardNow` once from Apps Script to rebuild the Dashboard only. Redeploy the app files so the customer-only selection rule is active.

# v81 update (2026-11-19)

- Fixed the Customers Data merge/freeze conflict by splitting the top directory banner and section labels at the frozen-column boundary; summary cards no longer merge frozen and scrollable columns.
- Customer Name is now column C and stays frozen with Customer ID and primary Phone Number. Additional Phone Number is moved to column D and scrolls normally. Existing v80 customer rows are migrated by swapping the old C/D values once, preserving their data.
- The customer overview remains at the top of Customers Data.
- Dashboard KPI cards are larger and more prominent; product, delivery type and delivery service breakdowns are displayed as bordered mini-cards with emphasized counts.
- Apps Script version: v81. Deploy the updated `google-sheet-script.gs` as a new web-app version and run `fixNow` once.

## v80 - Dashboard and verified failed-delivery archive

- Dashboard redesigned with clearer KPI cards, explanatory labels, readable product/delivery breakdowns, and a latest active-orders table. All metrics are calculated from actual active order rows for the selected reporting period.
- Archived Orders now receives only records whose Delivery Note contains BOTH the exact Mule failure marker (`Sent from: mule — ❌ NOT delivered`) and the entity error (`Could not find the input entity for`). It requires a real order ID, prevents duplicate IDs, copies the full original row plus archive timestamp/source, and removes the active row only after the archive append succeeds.
- Archived count uses unique non-empty order IDs, not the raw sheet row count. Archived orders stay excluded from active Dashboard totals.
- Customers Data directory remains at the top with live counts and revenue based on actual customer/order records.
- Apps Script version: v80. Paste `google-sheet-script.gs` into the bound Apps Script project, save, deploy a new version, then run `fixNow` / Refresh all sections.

## Latest update (v80b - sync result now confirms orders + customers share ONE Google Sheet)

## v80 - GUIDED FIX FOR "Customers: old Google script"

- When the Customers sync finds an old Google script, the app now says exactly which script version your link runs and shows a box with: **Copy new script**, **Open script.google.com**, and **Download customers (CSV backup)**. Paste the new script in a NEW project -> Deploy -> New deployment -> Web app (Me / Anyone) -> paste the new /exec link -> Connect & sync. The script creates the Google Sheet + Customers Data tab itself.
- New routes: GET /api/sheets/script, GET /api/sheets/customers.csv.

## Latest update (v79) - THREE SYNC BUTTONS, NO VERSION CHECK

- ⚙ Sheet connection now has three syncs: 1 = main order index (orders), 2 = Customers Data tab, 3 = ALL. Each one reports its own result.
- Removed: "Check script version", "Copy latest script" and the script-version block in the one-click connect. Orders keep syncing even with an older Google script; the Customers Data tab needs google-sheet-script.gs (included) pasted in a NEW project -> Deploy -> New deployment -> Web app (Me / Anyone); paste the new /exec link in ⚙ Sheet connection -> Connect. The script creates the Google Sheet and the Customers Data tab by itself.

## Previous update (v78) - ONE-CLICK CONNECT (⚙ Settings)

- ⚙ Settings -> "⚡ Connect Google Sheet (one click · all data)" uses the same original Apps Script link method on the main page. One button saves the link, checks the script version, creates every tab (incl. "Customers Data" in the SAME spreadsheet as the orders) and sends ALL data: orders + customers. Result lines are shown per part.
- Needs google-sheet-script.gs v78 (included). If the saved link runs an older script, the button says so and shows the fix steps.

## Previous update (v76) - SYNC ALL NOW INCLUDES CUSTOMERS + AUTO-CREATE GOOGLE SHEET (script v74)

- google-sheet-script.gs is now v74. If it is not linked to any sheet (or the sheet was deleted / cannot be opened) it CREATES a new Google Sheet in your Drive by itself and remembers it. Orders and the Customers Data tab always live in that ONE file. Run function `createNewSheet` in the editor to deliberately start with a fresh file.
- You MUST paste the new script, run `authorize` once, and deploy a NEW VERSION (or a New deployment and paste the new /exec link in ⚙ Sheet connection). "no version (very old script)" means the saved link still runs old code.

- The original Google Sheet panel is unchanged (📊 Google Sheet button / ⚙ Settings -> Sheet connection).
- "Sync ALL (orders + customers) to the sheet now" sends every order AND all customer information (Customers Data tab) to the same sheet, and reports each part separately (one failing never hides the other).

## Latest update

- Restored the original compact customer selector: type an ID, name, or phone in the search box, then choose a match from the single-line dropdown.
- The `Customers Data` tab is the permanent customer-record sheet in the same Google spreadsheet. New customers, edits, deletions, and full syncs write to that tab; it is kept as the first tab.

v73 - ONE SHARED GOOGLE SHEET + CUSTOMER SEARCH + LIVE ORDERS VIEW + GRAPHS
 - The order form index and Customers Data index use ONE Google spreadsheet and ONE Apps Script deployment. Customers Data is the first tab.
 - Orders View is restored as a combined view of every month, with Ethiopian calendar dates and newest order/time at the top. It refreshes after each save and full sync.
 - Graphs is restored and rebuilt from the live hidden _Data table; chart refresh runs after order changes.
 - /exec reports the short version field "v73" for reliable version checking.
 - Customer ID / name / phone search now displays matching choices immediately while typing, including normalized phone digits.
 - Run AMBAR -> Fix now (newest order on top) after updating the Apps Script to rebuild the tabs and charts.

v72 - SHEET CONNECTION PANEL: new buttons "Check script version" (shows which version your saved /exec link really runs vs the latest) and "Copy latest script" (copies google-sheet-script.gs so you can paste it in Apps Script). The expected version in the error message now follows the script file automatically.

v71 - NEWEST CUSTOMER ON TOP in the Customers Data tab (new customers are inserted right under the header; "Send all to Google Sheet" writes newest first). The script version is now "v71": open your Web app /exec link in a browser, it must show v71. If it shows an older version, the Google link saved in the app still runs the old script (paste the new google-sheet-script.gs -> Save -> Deploy -> Manage deployments -> Edit -> New version -> Deploy). The "Unknown action" message in the app now tells you which version the link answers with.

v70 - CUSTOMERS DATA + CUSTOMER-ID ORDER ID
 - "Callers Data" is renamed "Customers Data" (customers sometimes fill it themselves). Page: /customers.html (the old /callers.html still works). The Google Sheet tab is now "Customers Data" (an old "Callers" tab is renamed automatically, rows kept).
 - ORDER FORM: step 1 is the Customer ID. Choose the customer (search by ID / name / phone) -> Name, Phone, Location and @username are filled and the Order ID is made automatically (it is used as the Order Code, card and sheet).
   Order ID = Customer ID + Ethiopian month of the Order Date (today's month by default):  0007-03  (first order), 0007-03A (same customer orders again that month), 0007-03B, 0007-03C ...  A new month starts again at 0007-04.
   Each new Order ID is also added to that customer's "Order id" column in Customers Data. "No Customer ID" in the list lets you still type an order code by hand. To drop the "-" use ORDER_ID_SEP in server.js.
 - "Google Sheet NOT updated: Unknown action" = the Apps Script in Google is the OLD version. Paste the new google-sheet-script.gs -> Save -> Deploy -> Manage deployments -> Edit (pencil) -> Version: New version -> Deploy. The message in the app now says this.

v69 - CALLERS TAB IN THE MAIN GOOGLE SHEET: the "Callers" tab is a new section of the SAME spreadsheet as Dashboard / Find Customer / Analysis / month tabs (placed right after Analysis). It is now created automatically when the sheet connects (server start, Test, Sync ALL) and filled with every customer; later saves update their row. Paste the new google-sheet-script.gs -> Save -> Deploy -> New version, then restart.

v68 - CALLERS GOOGLE SHEET: every save on the Callers Data page is also written to a "Callers" tab (columns exactly as your list, Customer ID 0001... in column A, one row per customer; saving the same customer updates the same row). Needs the Apps Script Web app link (GOOGLE_SCRIPT_URL / main admin's Sheet connection).
 - You MUST paste the new google-sheet-script.gs -> Save -> Deploy -> Manage deployments -> New version, then restart the server.
 - Main admin: Customers tab -> "Send all to Google Sheet" back-fills / repairs the tab. Everyone: "Open Google Sheet (Callers tab)".
 - Fixed: the Callers page now shows the real reason when it cannot open (old server without the update, or your Telegram ID is not assigned) instead of one generic message.

CALLERS DATA (v67): new separate page /callers.html (open it from ⚙ Settings -> "📞 Callers Data"). Fields: Customer ID, Phone Number, Name, username, Location, Status, Last Conversation, Date, Time, Order Status, Rejection Reason, Sales Name, Total Spend, Order id, Source.
 - Customer ID is automatic: 0001, 0002, 0003 ... and is never reused (even after a delete).
 - One customer = one ID: the phone number is the key (0911..., +251911..., 251911... are the same customer). Typing a known phone opens that customer; saving updates the same ID and keeps the earlier conversation in "Earlier conversations".
 - Sales Name is filled automatically with the logged-in admin's name. Only the main admin can change it; only the main admin can delete a customer.
 - Stored in data/callers.json and in Supabase app_settings.callers_data (same as the admin list). Date is Ethiopian (yyyy/mm/dd). "Copy as table" pastes straight into Google Sheets.
 - The order confirmation page (index.html) is unchanged apart from the new Settings button.

FIND CUSTOMER (v66): phone search now accepts a leading 0 or + (0911..., +251911..., 251911... all find the same customer). Paste the new google-sheet-script.gs into Apps Script and deploy a new version.

ETHIOPIAN CALENDAR PICKER (v65): Order / Completion / Delivery date now open a calendar grid (Ethiopian months, Pagume 5/6 days, Today / Clear). Orders View now shows the exact Order, Completion and Delivery dates (yyyy/mm/dd) - paste the new google-sheet-script.gs into Apps Script and deploy a new version.

ETHIOPIAN CALENDAR UPDATE: every date is now Ethiopian.
 - Order Date / Completion Date / Delivery Date: the order form has Day · Month (Meskerem … Pagume) · Year pickers; the card shows the date as yyyy/mm/dd (e.g. 2019/03/05).
 - Google Sheet: those dates, plus Created At / Last Updated, are Ethiopian TEXT (yyyy/mm/dd). Google no longer turns them into Gregorian dates.
   Old rows (Gregorian) are converted automatically the next time the server starts / "Test" runs. Dashboard, Graphs (Daily/Weekly labels like "Hidar 5") and Orders View work from the Ethiopian dates.
 - To apply: paste the new google-sheet-script.gs into Apps Script, Save, Deploy -> New deployment (or "Manage deployments" -> New version), then restart the server.

Ambar Furniture v54
Customer answer page update:
The Telegram card still has exactly ONE button: መልስ ለመስጠት ክፈት.
On the answer page, customer can Confirm, Reject, or choose Comment.
After choosing Comment, they type the comment and choose exactly one of:
✅ Confirm & Send Comment
❌ Reject & Send Comment
The selected decision and comment are saved and sent to the admin together.

FILES IN THIS PROJECT
  package.json         – dependencies + start command (npm start)
  server.js            – the whole server, including the Google Sheet code
  public/index.html    – the order form page (product dropdown, Shoe Shelf sizes, main-admin 📊 Google Sheet button)
  public/setup.html    – the admin setup page
Deploy: keep this folder structure, run `npm install` then `npm start`.
(server.js also holds a built-in backup copy of both pages, used only if the public files are missing.)

Google Sheet control (main admin only)
--------------------------------------
Every order and every movement is written to a Google Sheet automatically:
  • Orders        – one row per order, always current (status, product, customer, delivery, comments, links)
  • Activity Log  – one new row per movement (created, delivered / not delivered, Confirmed, Rejected, comment, answer closed, admin assigned / removed, full sync)
  • Dashboard     – live totals and orders-by-product built from the two tabs above
The "📊 Google Sheet" button (and ⚙ settings: test / sync all) is shown ONLY to the main admin, and the server refuses everyone else.

One-time setup:
 1. Google Cloud Console → create a project → enable "Google Sheets API".
 2. IAM & Admin → Service Accounts → create one → Keys → Add key → JSON (download).
 3. Create a Google Sheet, click Share, add the service account e-mail (client_email in the JSON) as Editor.
 4. In Render → Environment add:
      GOOGLE_SHEET_ID               = the long id from the sheet URL (…/spreadsheets/d/<ID>/edit)
      GOOGLE_SERVICE_ACCOUNT_JSON   = the whole JSON file content
      SHEET_TIMEZONE                = optional, default Africa/Addis_Ababa
      PUBLIC_BASE_URL               = your app URL (so card / answer links in the sheet are full links)
 5. Redeploy, open the app as main admin, tap ⚙ → "Test connection", then "Sync ALL orders" to back-fill old orders.
The sheet is a one-way record (app → sheet). Editing cells in the sheet does not change orders in the app.


EASY Google Sheet connection (no Google Cloud, no API)
 1. Create a Google Sheet. Open Extensions -> Apps Script.
 2. Delete the existing code, paste everything from google-sheet-script.gs, click Save.
 3. Deploy -> New deployment -> gear icon -> "Web app". Execute as: Me. Who has access: Anyone. Click Deploy and allow permissions.
 4. Copy the Web app URL and set it on the server:  GOOGLE_SCRIPT_URL = <that URL>
    (optional password: set SECRET in the script and the same value in GOOGLE_SCRIPT_KEY)
 5. Restart the server, then use the Google Sheet button -> Test.

If you see "Google Script did not answer correctly":
 - Deploy -> Manage deployments -> pencil (Edit) -> Who has access = Anyone -> Version = New version -> Deploy.
 - Use the Web app URL ending in /exec (not /dev, not the sheet link).
 - Re-paste the latest google-sheet-script.gs, Save, then deploy a New version.
 - Open the /exec URL in a browser: it should show {"ok":true,"message":"AMBAR sheet connector is running."}

HTTP 401 / "asking to sign in" fix:
 - Apps Script -> Deploy -> New deployment -> gear -> Web app -> Execute as: Me, Who has access: Anyone -> Deploy.
 - Use the NEW /exec URL in GOOGLE_SCRIPT_URL (do not reuse the old deployment's URL) and restart the server.
 - Open the /exec URL in an Incognito window. It must show {"ok":true,...} with NO sign-in page.
 - If "Anyone" is not in the list, the Google account is a school/work account that blocks it. Use a personal @gmail.com account for the sheet and script.

GOOGLE FORM MODE (use this if the Web app link keeps giving HTTP 401)
 1. Create a Google Sheet. Open Extensions -> Apps Script, paste google-sheet-script.gs, Save.
 2. forms.google.com -> new form with ONE question, type "Paragraph" (not required). Settings -> Responses: turn OFF "Collect email addresses",
    "Limit to 1 response" and any "Restrict to users in ..." option.
 3. Form -> Responses tab -> "Link to Sheets" -> choose the sheet from step 1.
 4. Form -> three-dots menu -> "Get pre-filled link" -> type x in the box -> "Get link" -> copy the link.
 5. On the server set:  GOOGLE_FORM_URL = <that link>   and   GOOGLE_SHEET_URL = <your sheet's normal address, so the button can open it>
    Do NOT set GOOGLE_SCRIPT_URL (remove it).
 6. In Apps Script pick function "setupFormMode" -> Run -> allow permissions (one time).
 7. Restart the server, press Test. Orders appear in the Orders tab within about a minute.

"Cannot read properties of null (reading 'getSheetByName')":
 The script is not attached to your sheet. Either open the SHEET -> Extensions -> Apps Script and paste google-sheet-script.gs there,
 or put your sheet ID in SHEET_ID at the top of the script. Then Save, run function "authorize" once (allow), and
 Deploy -> New deployment -> Web app (Execute as Me, Anyone) and use the NEW /exec URL.

UPDATE: orders are saved to the Google Sheet in ONE step per order (new row, or the same row updated), with the Activity Log written by the script.
 - If saving fails, the order screen now shows "Google Sheet NOT updated: <reason>".
 - On every server start, all existing orders are synced into the sheet automatically; the main admin can also press Sync ALL.
 - After you change google-sheet-script.gs: Save -> Deploy -> New deployment, and use the new /exec URL.

GOOGLE SHEET LOOKS EMPTY? Your data is in the tab called "Orders" (bottom of the sheet). The new script puts Orders FIRST, removes the empty
default tab and formats it as a table (dark header, banded rows, filter buttons, colored Status, Delivery Type / Service columns).
After pasting the new google-sheet-script.gs: Save -> Deploy -> New deployment -> use the new /exec URL -> restart the server (or press Test)
so the formatting is applied. Tabs: Orders (table), Activity Log (table), Dashboard (totals, by product, by delivery type, by service, latest movements).

ETHIOPIAN MONTH TABS + START NEW MONTH
 - Each Ethiopian month gets its own tab in the Google Sheet (e.g. "Hidar 2019"). An order goes to the month of its Order Date
   (or its creation date if no Order Date). Later updates (confirm / reject / comments) stay in the same row.
 - Columns START WITH THE CUSTOMER INFORMATION: Customer Name, Phone, Telegram Username, Telegram Chat ID, Location, then the order details.
 - "▶ Start New Month" button (main admin only; the server refuses everyone else) creates / opens the tab of the current Ethiopian month.
 - Your old single "Orders" tab is renamed "Old Orders (backup)". When the server restarts, all existing orders are filed into the month tabs automatically
   (or press Sync ALL in the gear panel). You can delete the backup tab afterwards.
 - Dashboard totals add up ALL month tabs.
 - After pasting the new google-sheet-script.gs: Save -> Deploy -> New deployment -> new /exec URL -> restart the server.

v45 – SETTINGS MENU, ARCHIVE & START NEW, SUMMARY + GRAPHS
 - All control buttons now live inside ONE ⚙ settings icon (bottom right): Open Google Sheet, Summary, Graphs, Sheet test/sync (main admin),
   ♻ Archive old list & Start New (main admin), 👥 Manage Assigned Admins (main admin), 🔗 Connect my Telegram account.
 - ♻ Archive old list & Start New (main admin only, server-enforced): every month tab + the Activity Log are KEPT as "Archive <date> · …" tabs,
   a clean new month tab is created, and orders created before that moment are never written to the sheet again.
 - Google Sheet tabs now start with "Dashboard" (summary in numbers) and "Graphs" (charts), then the month tabs.
 - "Status" column now sits right after "Order Code" (existing tabs are re-mapped by column name automatically; no data is lost).
 - After pasting the new google-sheet-script.gs: Save -> Deploy -> New deployment -> new /exec URL -> restart the server.

v47 – PROFESSIONAL SHEET DESIGN
 - Order tabs: Roboto font, taller header with colour groups (gold = customer info, teal = Order Code + Status), frozen header + customer name,
   no gridlines, soft row banding, centered status/date columns, money columns formatted (#,##0), colour "pill" Status / Delivered / Paid In Full.
 - Dashboard: banner, 12 KPI tiles, breakdown tables (product / delivery type / service) and the latest 15 movements.
 - Graphs: banner + 6 charts (status, per-month stacked, product, delivery, delivery type, service) with the data tables underneath.
 - After pasting google-sheet-script.gs: Save -> Deploy -> New deployment -> new /exec URL -> restart the server (formatting is re-applied on start).

## Google Sheet tabs (modern layout)
- Dashboard, Graphs – totals and charts.
- **Find Customer** – type an @username, Telegram Chat ID, Order Code or phone in the yellow box (B4); the customer card plus that customer's Orders, Payments, Delivery and Product tables appear.
- Customers, Orders View, Payments (with Balance), Deliveries, Products – one filterable table per topic (live formulas over all month tabs).
- Month tabs (e.g. "Hidar 2019") hold the raw data, header colours grouped by topic. Do not type in the formula tabs.
After pasting the new google-sheet-script.gs: Save, Deploy -> Manage deployments -> New version, then restart the server (or press Test) so the tabs are built.

## v48 – SIMPLER SHEET + NO ZOOM
- Google Sheet tabs are now exactly: Dashboard · Find Customer · Orders View · Graphs · Activity Log · month (date) tabs (newest month first).
  Customers, Payments, Deliveries and Products tabs are no longer built and are deleted automatically (they were only formula views; no order data is lost).
  "Old Orders (backup)" is not touched – delete it by hand once you no longer need it.
- NEW ORDERS ARE ON TOP: every new order is inserted at row 2 of its month tab (right under the header). Existing month tabs are sorted newest-first
  on the next server start / Test, and "Sync ALL" files old orders oldest-first so the newest ends up on top. Orders View was already newest-first.
- Mini app is not zoomable: viewport has user-scalable=no / maximum-scale=1, plus pinch, double-tap and Ctrl+wheel zoom are blocked
  (index.html, setup.html and the customer answer page; server.js also injects it into the built-in fallback pages).
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> New deployment -> new /exec URL -> restart the server (or press Test).

## v49 – ONE "Start from ZERO" BUTTON (main admin only)
- ⚙ Settings → "🗑 Start from ZERO (backup + clear all)" replaces the old "Archive old list & Start New" button. Two confirmations are asked.
- What it does, in order: (1) writes every order to the Google Sheet, (2) the sheet keeps ALL current month tabs + the Activity Log as "Backup <date> · …" tabs
  and creates clean Dashboard / Orders / Log, (3) deletes all orders from the app database, (4) order numbering restarts at 1.
- If the sheet backup fails, nothing is deleted from the app. If the Google Sheet is not connected, the app is cleared without a sheet backup (the message says so).
- Server-enforced: only the main admin (owner) can call /api/sheets/reset-all. Uploaded photos already stored in Supabase Storage are not deleted.
- Note: the built-in fallback copy of index.html inside server.js is old; keep public/index.html in the deploy so the new button is shown.
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> New deployment -> new /exec URL -> restart the server.

## v50 – NO ACTIVITY LOG · NAME SEARCH · INTERACTIVE GRAPHS · AMBAR ASSISTANT
- **Activity Log removed.** The sheet no longer has an "Activity Log" tab (an old one is deleted automatically on the next server start / Test). The Dashboard's
  "Latest 15 movements" was replaced by "Latest 10 orders". Old "Backup … · Activity Log" tabs made by earlier "Start from ZERO" runs are NOT touched – delete them by hand if you wish.
- **Find Customer – search by NAME too.** In the yellow box type a name (or just part of it), @username, Chat ID, Order Code or phone. Row 5 tells you which customers matched
  (if a name matches several people the card shows the first one – type more of the name to narrow it down).
- **Dashboard + Graphs views.** Every graph has a yellow drop-down directly above it (Google Sheets cannot switch a graph by clicking the graph itself):
  * time graphs (Orders over time, Money over time, Dashboard "Trend"): **Daily · Weekly · Monthly · Yearly** (last 12 days / weeks / months / years;
    months and years are ETHIOPIAN, matching the month tabs; weeks start on Monday);
  * total graphs (status, product, delivery type, cards delivered, delivery service): **Today · This week · This month · This year · All time**;
  * the Dashboard numbers, breakdown tables and trend graph each have their own yellow box. Your last choice is kept when the sheet is rebuilt.
  * New look: one card header per graph, donut charts, stacked columns, softer grid, consistent colours (amber / green / red for Pending / Confirmed / Rejected).
- **Hidden tab "_Data"** is the live helper table behind the Dashboard and Graphs. Do not delete it (it is rebuilt automatically on every server start / Test).
- **🤖 Ambar Assistant** (index page, right after "Service Information"): an admin chooses *New feature* or *Correction*, writes it and presses Send.
  It is saved (data/assistant-notes.json, and Supabase `app_settings.assistant_notes` when Supabase is used) and sent by the bot to the main admin in Telegram.
  Assigned admins see their own notes; the main admin sees all of them and can press "Mark done".
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> Manage deployments -> New version (or New deployment, new /exec URL) -> restart the server (or press Test).

## v51 – ONE FEATURES BOX · ONE GRAPH BUTTON · ✏️ EDIT ORDER
- **Ambar Assistant removed** (card, server routes and notes storage). In Product Information there is now ONE box, "Additional features" (free text).
  It is printed on the order card, saved with the order and written to a new Google Sheet column "Additional Features" (after Drawer).
- **Graphs: ONE button.** The Graphs tab has a single yellow drop-down (cell B3): Daily · Weekly · Monthly · Yearly. It changes every graph together
  (time graphs = last 12 days/weeks/months/years; total graphs = Today / This week / This month / This year). The per-graph drop-downs are gone.
  The Dashboard tab is unchanged.
- **✏️ Edit order** button in the admin bot, on the cross-check copy, next to "💰 Customer paid in full" (it is there from the start; the paid button
  still appears after the customer confirms). It opens the order form pre-filled; "💾 Save changes" updates the SAME order:
  the same Google Sheet row is changed (no new row), the card image/caption is refreshed in the admin bot (and in the customer's chat when the bot sent it).
  Needs PUBLIC_BASE_URL set to your https address. The customer's Telegram chat ID is not editable.
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> New deployment -> new /exec URL -> restart the server (the new column and graph button are built on start).

## v52 – SEPARATE ANSWER BUTTON · PAY-FULL ALWAYS · EDIT RE-SENDS TO CUSTOMER · NO TREND · GRAPHS FIX
- Customer card sent by the bot: the answer link is ONLY the button "🔗 መልስ ለመስጠት ክፈት" (the extra text link inside the caption is gone).
- Admin bot: "💰 Customer paid in full" is always on the cross-check copy (no need to wait for the customer to confirm), next to "✏️ Edit order".
- Saving an edit re-sends the order to the customer as a new card titled "✏️ EDITED ORDER" with the answer button. The answer is reopened (status back to Pending)
  so the customer can confirm / reject / comment again. The same Google Sheet row is updated. Needs the customer's numeric Telegram chat ID (customer pressed Start).
- Google Sheet Dashboard: the TREND section is removed; Breakdown and Latest 10 orders moved up.
- Graphs tab: the total graphs now cover the same window as the time graphs (last 12 days / weeks / months / years), so they are no longer empty when "today" has no orders.
  The sheet is now built part by part: if one tab fails, the others are still built and the reason is shown in red in cell A3 of the Graphs tab.
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> New deployment -> new /exec URL -> restart the server.

## v53 – GRAPHS ALWAYS VISIBLE · EDITED ORDER RE-SENT · SEPARATE ANSWER BUTTON
- Graphs tab: the numbers behind the graphs are now calculated by the script and written as plain values (no formulas), so the charts cannot stay blank.
  They refresh when you change the yellow drop-down (B3), whenever an order is saved, and when the sheet is rebuilt. Totals cover the same last 12 days / weeks / months / years as the time graphs.
  The script also tries to install an "edit" trigger on setup (a permission prompt may appear when you deploy).
- Edited order: saving an edit re-sends it to the customer the same way the order first went: bot card -> Telegram Business -> your connected Telegram account.
  The message header says "✏️ EDITED ORDER". If it cannot be sent, the reason is shown on the edit screen.
- Cards sent from your own Telegram account: when the customer has pressed Start in the AMBAR bot, the answer link now comes as a SEPARATE message with a real button
  (a personal account cannot attach bot buttons). If the customer never pressed Start, the text link stays inside the card.
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> New deployment (allow permissions) -> new /exec URL -> restart the server.

## v54 – GRAPHS FILLED · EDIT CLOSED AFTER PAID IN FULL
- Graphs tab: the first column of every graph table (Nov 12, 2019 …) is now stored as plain TEXT. Before, Google Sheets turned it into dates / numbers, so the chart
  treated it as data and the real bars looked empty. Old rows are cleared on every refresh, the charts are told to use the first column as labels, and a pie with
  no orders shows a grey "(no orders)" slice instead of a blank circle.
- Every graph is drawn on its own; if one fails, the others still show and the reason is written in cell E3 (red). If the charts are ever deleted, they are drawn again
  automatically on the next order / drop-down change.
- Paid in full = order closed: after "💰 Customer paid in full" the ✏️ Edit order button disappears from the admin bot, the edit page shows "closed", and the server
  refuses any edit of that order. Everything else is unchanged.
- After updating: paste google-sheet-script.gs -> Save -> Deploy -> New deployment (allow permissions) -> new /exec URL -> restart the server (the Graphs tab is rebuilt on start).
- v54b: charts now send only basic options (colours, stacking, legend, donut, bar width, size); fonts / axis styling / chart-area options were removed because an unsupported option can leave an empty frame.

## v55 – GOOGLE SHEET: CONNECT ONCE, CONNECTED FOR ALL TIME
 - Main admin: ⚙ → 📊 Google Sheet → paste the Web app URL (…/exec) → "Connect & save permanently". The link is checked, then saved on disk AND in Supabase (`app_settings.google_sheet_connection`).
 - On every server start the saved link is restored automatically (before anything else), so a restart / redeploy never disconnects the sheet.
 - A wrong link never replaces a working saved one. Errors never erase the saved link.
 - If Google fails for a moment, the server quietly reconnects every 2 minutes, and each new order retries on its own.
 - Existing GOOGLE_SCRIPT_URL / GOOGLE_FORM_URL settings still work and are saved permanently on first start. Nothing else was changed.
 - For best permanence keep Supabase configured (Render's disk can be wiped on redeploy; Supabase keeps the link).

## v56 – CARD TO CUSTOMER + THANK-YOU AFTER FULL PAYMENT
 - Thank-you bug fixed: the check for the customer's chat ID was written with a broken pattern, so the message was never sent (and line breaks showed as "\n"). Now the customer gets the thank-you right after the admin presses "Paid in full"; the admin sees whether it was delivered.
 - Cards to customers: the bot sends the card to the customer when they have pressed Start. If not, the order is saved as "waiting" and the card is sent AUTOMATICALLY the moment the customer opens/starts the bot (matched by Telegram ID or @username). Admins get a note when it is delivered.
 - Telegram rule: a bot cannot message someone who never opened it, so the customer must open the bot once (the order warning shows the bot link to send them).

## v57 – CARD TO CUSTOMER: PERSONAL START LINK + FALLBACKS
 - If the card cannot be delivered when the order is saved, the admin warning now shows a personal link: https://t.me/<bot>?start=o_<order token>. When the customer opens it and presses Start, the card is delivered immediately (matched by the link itself, so it works even if the server forgot the customer's @username or ID, e.g. after a Render restart without Supabase).
 - Cards are also still auto-delivered when a known customer (by Telegram ID or @username) opens the bot.
 - If the card photo itself cannot be sent, the bot now falls back to a text message with the answer button instead of failing.
 - Telegram rule: a bot cannot message a person who never opened it, so a customer who never started the bot needs that one tap.
 - Keep Supabase configured so customers are remembered between restarts.

## v58 – CREATE & SEND ORDER CARD → SELECTED CUSTOMER
 - The "Select customer" list now shows everyone who pressed Start in the AMBAR bot, for the main admin AND for every assigned admin (before, assigned admins saw an empty list). Names are shown properly, and choosing one fills the customer's chat ID, @username and name.
 - "📨 Create & Send Order Card" sends the card with its button straight to the selected customer through the AMBAR bot. Assigned admins no longer need their own connected Telegram account for this.
 - If the customer has not pressed Start, the order is still saved and the personal start link (see v57) is shown.

## v59 – CARD REACHES THE SELECTED CUSTOMER (AND THE ADMIN BOT)
 - The order result now names exactly who received the card (customer name / @username) and warns if the chosen chat belongs to an admin account.
 - Admin accounts no longer appear in the "Select customer" list (they pressed Start too, but they are not customers).
 - When the admin has Telegram Business connected, the customer ALSO receives the card in their normal chat with the admin, in addition to the AMBAR bot copy. Admin cross-check copies in the AMBAR bot are unchanged.

## v60 – FOUR BUTTONS ON THE CUSTOMER'S ORDER CARD
 The card the customer receives now has four clickable buttons right under it:
 1. 🔗 መልስ ለመስጠት ክፈት – opens the answer page (unchanged)
 2. ✅ Confirm Order – confirms the order from the message itself
 3. ❌ Reject Order – rejects it
 4. 💬 Comment – the bot asks the customer to type the comment, saves it and tells the admins
 After an answer the buttons stay visible but locked, the card shows the final status, and the admin bot copies update as before. The order form and everything else are unchanged.

## v61 – CARD ALWAYS GETS SENT (button fallback)
 - The card is first sent with the 4 buttons. If Telegram refuses that keyboard for any reason, it is automatically re-sent with the 🔗 answer button only, and then with no buttons, so the customer always receives the card. Applies to the AMBAR bot send and the Telegram Business send.
 - If the card photo itself cannot be sent, a text message with the buttons is sent instead.
 - Real Telegram errors (blocked bot, customer never pressed Start, etc.) are shown in the order result.

## v62 – removed the 🔢 Summary (numbers) and 📈 Graphs page buttons from the settings panel (nothing else changed).

## v63 – fixed 'api is not defined' on 🗑 Start from ZERO (settings panel). Nothing else changed.


## v75 – DELIVERY FAILURES IN RED + COMPLETE LIVE SYNC
- Failed order-card deliveries now appear in the Delivery Note column as `Sent from: <admin> — ❌ NOT delivered (<reason>)` and the full order row is highlighted pale red in the month tab and Orders View.
- When an order is placed for a selected customer, Customers Data updates the customer status to `Customer`, the order status to `Pending`, and adds the order code. When the customer confirms or rejects, the order status in Customers Data follows that decision.
- Every order save and full sync rebuilds all derived tabs: Dashboard, Find Customer, Analysis, Orders View, Graphs and the hidden data source.
- Apps Script reports version `v78`. After updating, paste the included `google-sheet-script.gs` into Apps Script, Save, Deploy → Manage deployments → Edit → Version: New version → Deploy, then press Connect & sync EVERYTHING / Sync ALL in the app.


## v77 – MODERN SHEET + SAFE ORDER ARCHIVING

- Adds a dedicated **Archived Orders** tab. Archiving removes an order from active month tabs but preserves its complete row and archive timestamp/source.
- Adds the **AMBAR Orders** Google Sheets menu: Archive selected order, Restore selected archived order, and Refresh all sections.
- Select an order row in a month tab or Orders View, then choose **AMBAR Orders → Archive selected order…**. To bring it back, select its row in Archived Orders and choose **Restore selected archived order**.
- Full app syncs update an archived record in place rather than silently restoring it to active orders.
- Dashboard displays an Archived Orders count; active order totals remain separate from archived records.
- Connector version is `v77`.


## v78 – MODERN VIEWS, FAILED-DELIVERY ARCHIVE, SECOND PHONE & ETHIOPIAN DATES

- Updated the spreadsheet palette across generated views to a cleaner charcoal, orange and cream visual system, with clearer table headers and spacing.
- During every full rebuild/sync, orders whose row contains `Sent from: mule — ❌ NOT delivered` or the `Could not find the input entity for` delivery failure are moved out of active month tabs into `Archived Orders`, with archive timestamp and source tab retained. The archive table highlights delivery failures in pale red.
- Added `Additional Phone Number` to Customers Data and the customer form. Existing v77 customer-sheet data is migrated by inserting the new column after the primary phone, preserving the original values.
- Customer dates display as Ethiopian `DD/MM/YYYY`; the customer form accepts that format and keeps the internal Ethiopian date canonical.
- Added an `AMBAR Orders → Ethiopian date picker…` sidebar. Select a cell, choose Ethiopian day/month/year, and insert the date as `DD/MM/YYYY`. Dashboard date calculations accept both the existing `YYYY/MM/DD` values and the day-first format.
- Connector version is `v78`. After deploying the updated app files, paste the included `google-sheet-script.gs` into Apps Script, save, deploy a **New version**, then use **AMBAR Orders → Refresh all sections** or press the app's full sync.

NOTE: Archiving is performed on the next full rebuild/sync after this script is activated. The source order record is retained in `Archived Orders`; it is not permanently deleted.


## v79 – PROFESSIONAL DASHBOARD + CUSTOMER DIRECTORY SUMMARY
- Dashboard KPI cards are clearer and more readable, with a reporting-period selector, active order totals, status totals, payment, advance, and a separate archived-order count. Archived orders remain excluded from active totals.
- Customers Data now has a professional title band and five live KPI cards: Total Leads, Orders Placed, Rejections, Sold Readymade, and Total Revenue (Birr).
- Customer table headers and records move below the summary, with filters, frozen headings, readable widths, status colors and Ethiopian day/month/year dates retained. Existing v78 customer records are migrated safely by inserting summary rows above the old table.
- The customer summary refreshes when customer records are added, edited, deleted, fully synchronized, or when order data changes. Orders/rejections/readymade counts include archived order records so moving a failed delivery to the archive does not erase the business history.
- `Sold Readymade` counts order rows whose Product value contains the word “readymade”; `Total Revenue` sums the Customers Data `Total Spend` values.
- Apps Script connector version is `v79`. Paste the updated `google-sheet-script.gs`, save, deploy a New version, and refresh all sections.


## v154 — AMBAR Furniture workflow updates
- Workshop messages now use the AMBAR READYMADE PRODUCT / ORDERED PRODUCT format with Product ID and optional Order ID.
- Workshop Orders hide jobs already finished and in stock; My Last Sends can be filtered by result.
- Reports stock actions use Sold Out and Restock; restocking returns the item to In Stock with an audit-history entry.
- Reports product deletion is Main Admin-only and synchronizes removal from Workshop job lists.


## v166 — Material topic persistence + Workshop quick actions
- Fixed the Workshop state response so the saved Material topic is returned to the interface after reload; this was the reason the saved slot displayed “Not chosen yet” again.
- Added compact top-of-Workshop shortcuts to Material, Reports sold-out controls, and product records.
- Expanded the test-message success text to describe all configured destinations.
