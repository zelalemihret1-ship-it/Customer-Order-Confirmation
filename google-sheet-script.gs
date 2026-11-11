/**
 * AMBAR – Google Sheet connector (no Google Cloud / API needed)
 * Paste this whole file in: your Google Sheet → Extensions → Apps Script → replace Code.gs → Save.
 * Then: Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy.
 * Copy the Web app URL and put it in the server setting GOOGLE_SCRIPT_URL.
 */
var SECRET = ""; // optional: type any password here AND set the same value in GOOGLE_SCRIPT_KEY on the server

function doGet() { return out({ ok: true, message: "AMBAR sheet connector is running." }); }

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    if (SECRET && d.key !== SECRET) return out({ ok: false, error: "Wrong GOOGLE_SCRIPT_KEY." });
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      if (d.action === "setup") return out(setup(d));
      if (d.action === "state") return out(state(d));
      if (d.action === "upsert") return out(upsert(d));
      if (d.action === "syncAll") return out(syncAll(d));
      if (d.action === "log") { appendLog(d.logs); return out({ ok: true }); }
      return out({ ok: false, error: "Unknown action." });
    } finally { lock.releaseLock(); }
  } catch (err) { return out({ ok: false, error: String(err) }); }
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function sh(name) { var ss = SpreadsheetApp.getActive(); return ss.getSheetByName(name) || ss.insertSheet(name); }

function setup(d) {
  var o = sh("Orders"), l = sh("Activity Log"), b = sh("Dashboard");
  [[o, d.orderHead], [l, d.logHead]].forEach(function (p) {
    p[0].getRange(1, 1, 1, p[1].length).setValues([p[1]]).setFontWeight("bold").setBackground("#153a2e").setFontColor("#ffffff");
    p[0].setFrozenRows(1);
  });
  var col = function (n) { var i = d.orderHead.indexOf(n) + 1, s = ""; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  var st = col("Status"), dl = col("Delivered To Customer"), cm = col("Comments"), pr = col("Product");
  b.getRange("A1:B8").setValues([
    ["AMBAR FURNITURE — Control Dashboard", ""],
    ["(live: built from the Orders tab)", ""],
    ["Total orders", "=COUNTA(Orders!A2:A)"],
    ["Pending", '=COUNTIF(Orders!' + st + '2:' + st + ',"Pending")'],
    ["Confirmed", '=COUNTIF(Orders!' + st + '2:' + st + ',"Confirmed")'],
    ["Rejected", '=COUNTIF(Orders!' + st + '2:' + st + ',"Rejected")'],
    ["Cards NOT delivered", '=COUNTIF(Orders!' + dl + '2:' + dl + ',"No")'],
    ["Customer comments", "=SUM(Orders!" + cm + "2:" + cm + ")"]
  ]);
  b.getRange("A1").setFontWeight("bold").setFontSize(14);
  b.getRange("A10").setValue("Orders by product").setFontWeight("bold");
  b.getRange("A11").setFormula('=IFERROR(QUERY(Orders!A2:' + pr + ',"select ' + pr + ', count(A) where A is not null group by ' + pr + ' label ' + pr + " 'Product', count(A) 'Orders'\",0),\"no orders yet\")");
  b.setColumnWidth(1, 300);
  return { ok: true, orders: Math.max(0, o.getLastRow() - 1), url: SpreadsheetApp.getActive().getUrl() };
}

function findRow(id) {
  var o = sh("Orders"), n = o.getLastRow();
  if (n < 2) return 0;
  var ids = o.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function state(d) {
  var r = findRow(d.id), o = sh("Orders");
  return { ok: true, row: r, values: r ? o.getRange(r, 1, 1, o.getLastColumn()).getValues()[0] : null };
}

function upsert(d) {
  var o = sh("Orders"), r = findRow(d.id);
  if (r) o.getRange(r, 1, 1, d.row.length).setValues([d.row]); else o.appendRow(d.row);
  appendLog(d.logs);
  return { ok: true, row: r || o.getLastRow() };
}

function syncAll(d) {
  var o = sh("Orders"), added = 0, updated = 0;
  d.rows.forEach(function (row) {
    var r = findRow(row[0]);
    if (r) { o.getRange(r, 1, 1, row.length).setValues([row]); updated++; } else { o.appendRow(row); added++; }
  });
  appendLog(d.logs);
  return { ok: true, added: added, updated: updated };
}

function appendLog(logs) {
  if (!logs || !logs.length) return;
  var l = sh("Activity Log");
  l.getRange(l.getLastRow() + 1, 1, logs.length, logs[0].length).setValues(logs);
}
