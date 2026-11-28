## v184 — any order can be sent · readymade = tap to send · ♻️ Restock · new admin access: Stock view + Open Google Sheet
- **New product → workshop:** you can send **any order** (not only customer-confirmed ones); rejected orders are still blocked. The sheet shows whether the customer confirmed.
- **Readymade product (Move ➜):** tap a product → it is sent to the **Sold Out group at once**, marked **Sold Out**, and the **customer's info changes** (status → Customer, Last conversation). No confirmation step, no button.
- **♻️ Restock:** Workshop → Standard / Custom now has a **🔴 Sold out** list; each Sold Out product has a **♻️ Restock** button that returns it to stock.
- **Manage Admins → access:** two new switches, **🖼 Stock view** and **📄 Open Google Sheet** (Home hides those buttons when off; `/api/stock` needs Stock view, Reports or Workshop). Admins saved before this version keep both until the main admin saves their access again.
- Files: `server.js`, `workshop.js`, `public/callers.html`, `public/workshop.html`, `public/home.html`, `public/index.html`.

