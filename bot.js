// Instagram Downloader Bot — Pure Node.js
"use strict";
const https  = require("https");
const http   = require("http");
const { execFile } = require("child_process");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");

const TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const PORT         = process.env.PORT || 3000;
const BOT_USERNAME = "@lnterinstagram_Bot";
const ADMIN_USER   = "Mojeao";
const DATA_FILE    = "/tmp/bdata.json";

if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN missing"); process.exit(1); }

// ── Telegram API ───────────────────────────────────────────────────────────────
function tg(method, params = {}) {
  return new Promise((resolve) => {
    const body = JSON.stringify(params);
    const req  = https.request({
      hostname: "api.telegram.org",
      path:     `/bot${TOKEN}/${method}`,
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on("error", () => resolve({}));
    req.setTimeout(30000, () => { req.destroy(); resolve({}); });
    req.write(body); req.end();
  });
}

// Multipart file upload to Telegram
function sendFile(method, chatId, filePath, fieldName, caption) {
  return new Promise((resolve, reject) => {
    const boundary = "Bound" + Date.now();
    const fileData = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const CRLF = "\r\n";
    const head = Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}${chatId}${CRLF}` +
      `--${boundary}${CRLF}Content-Disposition: form-data; name="caption"${CRLF}${CRLF}${caption}${CRLF}` +
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"${CRLF}Content-Type: application/octet-stream${CRLF}${CRLF}`
    );
    const foot = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
    const body = Buffer.concat([head, fileData, foot]);
    const req  = https.request({
      hostname: "api.telegram.org",
      path:     `/bot${TOKEN}/${method}`,
      method:   "POST",
      headers:  { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length },
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on("error", reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error("آپلود timeout")); });
    req.write(body); req.end();
  });
}

const sendMsg   = (c, t, e={}) => tg("sendMessage",      { chat_id: c, text: t, ...e });
const editMsg   = (c, m, t)    => tg("editMessageText",  { chat_id: c, message_id: m, text: t });
const delMsg    = (c, m)       => tg("deleteMessage",    { chat_id: c, message_id: m });
const answerCb  = (id, t="")   => tg("answerCallbackQuery", { callback_query_id: id, text: t });
const getMemb   = (ch, uid)    => tg("getChatMember",    { chat_id: ch, user_id: uid });
const sendChat  = (c, a)       => tg("sendChatAction",   { chat_id: c, action: a });

// ── Persistent data ────────────────────────────────────────────────────────────
let db = { users: {}, channels: [] };
try {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  // Migrate old single-channel format
  if (raw.forceCh && !raw.channels) raw.channels = raw.forceCh ? [raw.forceCh] : [];
  db = { users: raw.users || {}, channels: raw.channels || [] };
} catch {}
const save    = () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch {} };
const addUser = (from) => {
  if (!from?.id) return;
  db.users[String(from.id)] = { id: from.id, name: from.first_name || "", un: from.username || "" };
  save();
};

// ── URL cache (fixes Telegram 64-byte callback_data limit) ─────────────────────
const urlCache = new Map();
let   urlSeq   = 0;
function cacheUrl(url) {
  const id = String(++urlSeq % 9999);
  urlCache.set(id, url);
  if (urlCache.size > 2000) {
    const old = urlCache.keys().next().value;
    urlCache.delete(old);
  }
  return id;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const IG     = /https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/[^\s)>]+/i;
const getUrl = (t) => { const m = String(t).match(/https?:\/\/[^\s)>]+/); return m?.[0] || null; };
const isIG   = (u) => IG.test(u);
const isAdm  = (from) => from?.username?.toLowerCase() === ADMIN_USER.toLowerCase();
const fmtSize = (bytes) => {
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + " KB";
  return (bytes/(1024*1024)).toFixed(1) + " MB";
};

function dlFile(url, tpl, extra = []) {
  return new Promise((ok, fail) => {
    execFile("yt-dlp",
      [
        "--no-playlist", "--no-warnings", "--no-check-certificates",
        "--user-agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
        "-o", tpl, ...extra, url
      ],
      { timeout: 180000 },
      (err, stdout, stderr) => {
        if (err) fail(new Error(stderr || stdout || err.message));
        else ok();
      }
    );
  });
}

// Check user is member of ALL force channels
async function checkAllJoins(uid) {
  if (!db.channels.length) return { ok: true };
  for (const ch of db.channels) {
    try {
      const r = await getMemb(ch, uid);
      const st = r.result?.status;
      if (!["member","administrator","creator"].includes(st)) {
        return { ok: false, ch };
      }
    } catch {
      // if error checking, assume ok (bot might not be admin)
    }
  }
  return { ok: true };
}

// ── Health server ─────────────────────────────────────────────────────────────
http.createServer((_, res) => { res.writeHead(200); res.end("ok"); }).listen(PORT);

// ── Admin panel ───────────────────────────────────────────────────────────────
function adminPanel(chatId) {
  const cnt  = Object.keys(db.users).length;
  const chs  = db.channels.length ? db.channels.join("\n  ") : "ندارد";
  const text = `👑 پنل ادمین\n\n👤 کاربران: ${cnt}\n🔒 کانال‌های جوین:\n  ${chs}`;
  const rows = [
    [{ text: "➕ اضافه کانال", callback_data: "A_add" }, { text: "➖ حذف کانال", callback_data: "A_del" }],
    [{ text: "📢 پیام همگانی", callback_data: "A_bc" }],
    [{ text: "📊 آمار کاربران", callback_data: "A_st" }],
  ];
  return sendMsg(chatId, text, { reply_markup: { inline_keyboard: rows } });
}

// State machine for admin commands waiting for input
const adminState = new Map(); // chatId -> state

// ── Message handler ───────────────────────────────────────────────────────────
async function handleMsg(msg) {
  if (!msg) return;
  const chatId = msg.chat.id;
  const from   = msg.from || {};
  const text   = (msg.text || "").trim();
  const name   = from.first_name || "دوست";
  addUser(from);

  // Admin state machine (waiting for input)
  if (adminState.has(chatId) && !text.startsWith("/")) {
    const state = adminState.get(chatId);
    adminState.delete(chatId);

    if (state === "add_ch") {
      let ch = text.startsWith("@") ? text : "@" + text;
      if (db.channels.includes(ch)) return sendMsg(chatId, "⚠️ این کانال قبلاً اضافه شده.");
      db.channels.push(ch); save();
      return sendMsg(chatId, `✅ کانال ${ch} اضافه شد.\nمطمئن شو ربات ادمین اون کانال باشه!`);
    }
    if (state === "del_ch") {
      const ch = text.startsWith("@") ? text : "@" + text;
      const i  = db.channels.indexOf(ch);
      if (i === -1) return sendMsg(chatId, `❌ کانال ${ch} پیدا نشد.`);
      db.channels.splice(i, 1); save();
      return sendMsg(chatId, `✅ کانال ${ch} حذف شد.`);
    }
    if (state === "broadcast") {
      const list = Object.values(db.users);
      const sm   = await sendMsg(chatId, `⏳ ارسال به ${list.length} نفر...`);
      let ok2 = 0, bad = 0;
      for (const u of list) {
        try { await sendMsg(u.id, `📢 پیام ادمین:\n\n${text}`); ok2++; }
        catch { bad++; }
        await new Promise(r => setTimeout(r, 60));
      }
      return editMsg(chatId, sm.result?.message_id, `✅ ارسال تموم شد!\n✔️ ${ok2} موفق  ❌ ${bad} ناموفق`);
    }
    return;
  }

  // Commands
  if (text === "/start") {
    return sendMsg(chatId,
      `سلام ${name}! 👋\n\n` +
      `🤖 ربات دانلود اینستاگرام\n\n` +
      `📌 فقط لینک پست یا ریلز عمومی اینستاگرام بفرست.\n` +
      `🎬 ویدیو  |  🎵 صدا MP3`
    );
  }

  if (text === "/admin") {
    if (!isAdm(from)) return sendMsg(chatId, "❌ دسترسی ندارید.");
    return adminPanel(chatId);
  }

  if (text === "/stats" && isAdm(from)) {
    return sendMsg(chatId, `📊 کاربران: ${Object.keys(db.users).length}\n🔒 کانال‌ها: ${db.channels.join(", ") || "ندارد"}`);
  }

  if (text.startsWith("/")) return;

  // Force join check (EVERY message)
  if (db.channels.length && from.id) {
    const jc = await checkAllJoins(from.id);
    if (!jc.ok) {
      const ch = (jc.ch || "").replace("@", "");
      return sendMsg(chatId,
        `${name} عزیز، برای استفاده از ربات باید عضو کانال بشی 👇`,
        { reply_markup: { inline_keyboard: [[
          { text: "🔔 عضو کانال", url: `https://t.me/${ch}` },
          { text: "✅ عضو شدم", callback_data: `cj_${from.id}` },
        ]]}}
      );
    }
  }

  // Instagram link
  const url = getUrl(text);
  if (!url || !isIG(url)) {
    return sendMsg(chatId,
      `${name} عزیز! ❌\n\nلینک اینستاگرام معتبر نیست.\nفقط لینک پست یا ریلز عمومی بفرست.`
    );
  }

  const uid = cacheUrl(url);
  sendMsg(chatId, `${name} عزیز، چی دانلود کنم؟ 👇`, {
    reply_markup: { inline_keyboard: [[
      { text: "🎬 ویدیو / ریلز", callback_data: `v${uid}` },
      { text: "🎵 صدا MP3",      callback_data: `a${uid}` },
    ]]}
  });
}

// ── Callback handler ──────────────────────────────────────────────────────────
async function handleCb(cb) {
  const chatId = cb.message?.chat?.id;
  const msgId  = cb.message?.message_id;
  const from   = cb.from || {};
  const d      = cb.data || "";
  if (!chatId) return;
  answerCb(cb.id).catch(() => {});

  // Admin callbacks
  if (d === "A_st") {
    return sendMsg(chatId, `📊 کاربران: ${Object.keys(db.users).length}\n🔒 کانال‌ها: ${db.channels.join(", ") || "ندارد"}`);
  }
  if (d === "A_add") {
    if (!isAdm(from)) return;
    adminState.set(chatId, "add_ch");
    return sendMsg(chatId, "آیدی کانال رو بفرست (مثلاً @mychannel):\n⚠️ ربات باید ادمین اون کانال باشه!");
  }
  if (d === "A_del") {
    if (!isAdm(from)) return;
    if (!db.channels.length) return sendMsg(chatId, "هیچ کانالی ثبت نشده.");
    const btns = db.channels.map(ch => [{ text: `❌ ${ch}`, callback_data: `rm_${ch}` }]);
    btns.push([{ text: "🔙 بازگشت", callback_data: "A_back" }]);
    return sendMsg(chatId, "کانالی که می‌خوای حذف کنی رو انتخاب کن:", { reply_markup: { inline_keyboard: btns } });
  }
  if (d.startsWith("rm_")) {
    if (!isAdm(from)) return;
    const ch = d.slice(3);
    const i  = db.channels.indexOf(ch);
    if (i !== -1) { db.channels.splice(i, 1); save(); }
    return sendMsg(chatId, `✅ کانال ${ch} حذف شد.`);
  }
  if (d === "A_back") return adminPanel(chatId);
  if (d === "A_bc") {
    if (!isAdm(from)) return;
    adminState.set(chatId, "broadcast");
    return sendMsg(chatId, "متن پیام همگانی رو بفرست:");
  }

  // Force join check button
  if (d.startsWith("cj_")) {
    const uid  = parseInt(d.slice(3));
    const n    = from.first_name || "دوست";
    const jc   = await checkAllJoins(uid);
    if (jc.ok) {
      return sendMsg(chatId, `✅ ${n} عضو شدی! حالا لینک اینستاگرام رو بفرست.`);
    } else {
      const ch = (jc.ch || "").replace("@", "");
      return sendMsg(chatId,
        `❌ هنوز عضو کانال ${jc.ch} نشدی!`,
        { reply_markup: { inline_keyboard: [[
          { text: "🔔 عضو کانال", url: `https://t.me/${ch}` },
          { text: "✅ عضو شدم", callback_data: `cj_${uid}` },
        ]]}}
      );
    }
  }

  // Download callbacks (v1234 or a1234)
  const dlMatch = d.match(/^([va])(\d+)$/);
  if (!dlMatch) return;
  const type  = dlMatch[1];
  const urlId = dlMatch[2];
  const url   = urlCache.get(urlId);

  if (!url) {
    return editMsg(chatId, msgId, "❌ لینک منقضی شده، دوباره بفرست.");
  }

  // Force join check before download
  if (db.channels.length && from.id) {
    const jc = await checkAllJoins(from.id);
    if (!jc.ok) {
      const ch = (jc.ch || "").replace("@", "");
      return editMsg(chatId, msgId,
        `❌ برای دانلود باید عضو ${jc.ch} باشی!\nhttps://t.me/${ch}`
      );
    }
  }

  const statusMsg = await editMsg(chatId, msgId, "⏳ در حال دانلود...");
  const stMid = msgId; // reuse same message for status

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ig-"));

  try {
    if (type === "v") {
      // Try best quality first, fallback to any
      let success = false;
      for (const fmt of [
        ["-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/bestvideo+bestaudio/best", "--merge-output-format", "mp4"],
        ["-f", "best"],
      ]) {
        try {
          await dlFile(url, path.join(tmp, "v.%(ext)s"), fmt);
          success = true;
          break;
        } catch { /* try next format */ }
      }
      if (!success) throw new Error("دانلود ویدیو ناموفق بود. پست عمومیه؟");

      let vf = fs.readdirSync(tmp).find(f => f.startsWith("v."));
      if (!vf) throw new Error("فایل ویدیو پیدا نشد");
      let fp = path.join(tmp, vf);
      let sz = fs.statSync(fp).size;

      // If > 50MB try lower quality
      if (sz > 50 * 1024 * 1024) {
        await editMsg(chatId, stMid, "⚠️ حجم بالاست، کیفیت رو کم می‌کنم...");
        try {
          await dlFile(url, path.join(tmp, "lo.%(ext)s"), ["-f", "worst[ext=mp4]/worst"]);
          const lf = fs.readdirSync(tmp).find(f => f.startsWith("lo."));
          if (lf) { fp = path.join(tmp, lf); sz = fs.statSync(fp).size; }
        } catch { /* use original */ }
      }

      if (sz > 50 * 1024 * 1024) throw new Error("حجم ویدیو بیشتر از ۵۰MB هست و ارسال نمیشه.");

      await editMsg(chatId, stMid, "⬆️ در حال آپلود ویدیو...");
      sendChat(chatId, "upload_video").catch(() => {});
      const caption = `🎬 ویدیو دانلود شد\n📦 حجم: ${fmtSize(sz)}\n\nby ${BOT_USERNAME}`;
      const res = await sendFile("sendVideo", chatId, fp, "video", caption);
      if (!res.ok) throw new Error(res.description || "ارسال ویدیو ناموفق");

    } else {
      await editMsg(chatId, stMid, "⏳ در حال دانلود صدا...");
      await dlFile(url, path.join(tmp, "a.%(ext)s"), ["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
      const af = fs.readdirSync(tmp).find(f => f.startsWith("a."));
      if (!af) throw new Error("فایل صدا پیدا نشد");
      const fp = path.join(tmp, af);
      const sz = fs.statSync(fp).size;

      await editMsg(chatId, stMid, "⬆️ در حال آپلود صدا...");
      sendChat(chatId, "upload_audio").catch(() => {});
      const caption = `🎵 صدا (MP3) دانلود شد\n📦 حجم: ${fmtSize(sz)}\n\nby ${BOT_USERNAME}`;
      const res = await sendFile("sendAudio", chatId, fp, "audio", caption);
      if (!res.ok) throw new Error(res.description || "ارسال صدا ناموفق");
    }

    delMsg(chatId, stMid).catch(() => {});
  } catch (err) {
    const msg2 = err.message.includes("Login") || err.message.includes("login") || err.message.includes("Private")
      ? "❌ این پست خصوصیه!\nفقط پست‌های عمومی قابل دانلود هستن."
      : `❌ خطا در دانلود:\n${err.message.slice(0, 250)}`;
    editMsg(chatId, stMid, msg2).catch(() => sendMsg(chatId, msg2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Long polling ───────────────────────────────────────────────────────────────
let offset = 0;
async function poll() {
  try {
    const r = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
    if (r.ok && r.result?.length) {
      for (const u of r.result) {
        offset = u.update_id + 1;
        if (u.message)        handleMsg(u.message).catch(e => console.error("handleMsg:", e.message));
        if (u.callback_query) handleCb(u.callback_query).catch(e => console.error("handleCb:", e.message));
      }
    }
  } catch (e) {
    console.error("poll:", e.message);
    await new Promise(r => setTimeout(r, 3000));
  }
  setImmediate(poll);
}

tg("deleteWebhook", { drop_pending_updates: true })
  .then(() => { console.log(`✅ ${BOT_USERNAME} started — polling`); poll(); })
  .catch(() => { console.log(`✅ ${BOT_USERNAME} started`); poll(); });
