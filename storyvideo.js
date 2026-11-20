// ── Story video converter ─────────────────────────────────────────────────────────────────────────
// Any video format the admin picks (MP4, MOV, MKV, AVI, WebM, 3GP, WMV, FLV, MPEG, HEVC/H.265 from new
// iPhones, …) is turned into the one format EVERY phone and Telegram can play: H.264 video + AAC audio
// in an MP4 with the index at the front ("faststart"). A video that is already in that format is only
// re-wrapped (fast, no quality loss). A small preview picture is made at the same time.
// Needs ffmpeg: the "@ffmpeg-installer/ffmpeg" npm package (optional dependency, no download step), or
// FFMPEG_PATH, or an ffmpeg installed on the server.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

let BIN = null;
function ffmpegBin() {
  if (BIN) return BIN;
  if (process.env.FFMPEG_PATH) return (BIN = process.env.FFMPEG_PATH);
  for (const mod of ["@ffmpeg-installer/ffmpeg", "ffmpeg-static"]) {
    try {
      const m = require(mod), p = typeof m === "string" ? m : m && m.path;
      if (p && fs.existsSync(p)) { try { fs.chmodSync(p, 0o755); } catch {} return (BIN = p); }
    } catch {}
  }
  return (BIN = "ffmpeg"); // an ffmpeg installed on the server itself
}
function run(args, timeoutMs = 10 * 60 * 1000) {
  return new Promise(resolve => {
    let err = "", done = false, child;
    const fin = r => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    try { child = spawn(ffmpegBin(), args, { stdio: ["ignore", "ignore", "pipe"] }); } catch (e) { return resolve({ code: -1, missing: true, stderr: String(e.message) }); }
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} fin({ code: -2, timeout: true, stderr: err }); }, timeoutMs);
    child.stderr.on("data", d => { err += d.toString(); if (err.length > 200000) err = err.slice(-100000); });
    child.on("error", e => fin({ code: -1, missing: e.code === "ENOENT", stderr: String(e.message) }));
    child.on("close", code => fin({ code, stderr: err }));
  });
}
async function probe(file) {
  const r = await run(["-hide_banner", "-i", file], 60000); // ffmpeg prints the file info, then exits with an "no output" code
  if (r.missing) return { missing: true };
  const s = r.stderr || "";
  const d = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0;
  const vl = (s.split("\n").find(l => /Stream #.*Video:/.test(l) && !/attached pic/.test(l))) || "";
  const al = (s.split("\n").find(l => /Stream #.*Audio:/.test(l))) || "";
  const sz = vl.match(/[ ,](\d{2,5})x(\d{2,5})[ ,\[]/);
  const rot = s.match(/rotation of (-?\d+(?:\.\d+)?) degrees/);
  return {
    hasVideo: !!vl, duration, w: sz ? +sz[1] : 0, h: sz ? +sz[2] : 0,
    vcodec: (vl.match(/Video:\s*([a-z0-9_]+)/i) || [])[1] || "", acodec: (al.match(/Audio:\s*([a-z0-9_]+)/i) || [])[1] || "",
    yuv420: /yuv420p(?!10)/.test(vl) && !/yuv420p10|yuvj/.test(vl), rotation: rot ? Math.abs(+rot[1]) % 360 : 0
  };
}
const tmp = ext => path.join(os.tmpdir(), "sv-" + crypto.randomBytes(8).toString("hex") + ext);
const rm = p => { try { fs.unlinkSync(p); } catch {} };

// → { ok:true, path, duration, w, h, poster:Buffer, converted }  |  { ok:false, missing? , error? }
async function normalize(inPath, { maxSeconds = 60 } = {}) {
  const info = await probe(inPath);
  if (info.missing) return { ok: false, missing: true };
  if (!info.hasVideo || !(info.duration > 0)) return { ok: false, error: "this file is not a readable video." };
  if (info.duration > maxSeconds + 0.5) return { ok: false, error: `is longer than ${maxSeconds} seconds (it is ${Math.round(info.duration)} s). Telegram stories allow up to ${maxSeconds} seconds.` };
  const out = tmp(".mp4");
  let converted = false;
  const compatible = info.vcodec === "h264" && info.yuv420 && !info.rotation && (!info.acodec || info.acodec === "aac") && info.w <= 1920 && info.h <= 1920;
  let ok = false;
  if (compatible) {
    const r = await run(["-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", "-t", String(maxSeconds), out]);
    ok = r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0;
    if (!ok) rm(out);
  }
  if (!ok) {
    converted = true;
    const r = await run(["-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-map", "0:v:0", "-map", "0:a:0?",
      "-vf", "scale='min(1080,iw)':-2,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-profile:v", "high", "-level", "4.1",
      "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", "-max_muxing_queue_size", "1024", "-t", String(maxSeconds), out]);
    ok = r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0;
    if (!ok) { rm(out); return { ok: false, error: r.timeout ? "took too long to convert. Please use a shorter or smaller video." : "could not be converted. Please try another video." }; }
  }
  const fin = await probe(out);
  const dur = fin.duration || Math.min(maxSeconds, info.duration);
  const pp = tmp(".jpg");
  await run(["-y", "-hide_banner", "-loglevel", "error", "-ss", String(Math.min(1, dur / 2)), "-i", out, "-frames:v", "1",
    "-vf", "scale=270:480:force_original_aspect_ratio=decrease,pad=270:480:(ow-iw)/2:(oh-ih)/2:color=0x153a2e", "-q:v", "4", pp], 60000);
  let poster = null; try { poster = fs.readFileSync(pp); } catch {} rm(pp);
  if (!poster || !poster.length) { rm(out); return { ok: false, error: "could not be read (no picture). Please try another video." }; }
  return { ok: true, path: out, duration: dur, w: fin.w || info.w || 720, h: fin.h || info.h || 1280, poster, converted };
}
module.exports = { normalize, probe };
