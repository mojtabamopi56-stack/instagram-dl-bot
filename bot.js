// Pure Node.js Telegram bot — no library, no log flood
const https  = require("https");
const { execFile } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const http = require("http");

const TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const PORT         = process.env.PORT || 3000;
const BOT_USERNAME = "@lnterinstagram_Bot";
const ADMIN_USER   = "Mojeao";
const DATA_FILE    = "/tmp/bdata.json";

if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN missing"); process.exit(1); }

// ── Telegram API ──────────────────────────────────────────────────────────────
function tg(method, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const req  = https.request({
      hostname: "api.telegram.org",
      path:     `/bot${TOKEN}/${method}`,
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({}); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy());
    req.write(body);
    req.end();
  });
}

const sendMsg  = (chatId, text, extra = {}) => tg("sendMessage",  { chat_id: chatId, text, ...extra });
const editMsg  = (chatId, msgId, text)       => tg("editMessageText", { chat_id: chatId, message_id: msgId, text });
const delMsg   = (chatId, msgId)             => tg("deleteMessage", { chat_id: chatId, message_id: msgId });
const sendVid  = (chatId, src, cap)          => tg("sendVideo",  { chat_id: chatId, video:  src, caption: cap });
const sendAud  = (chatId, src, cap)          => tg("sendAudio",  { chat_id: chatId, audio:  src, caption: cap });
const answerCb = (id, text = "")             => tg("answerCallbackQuery", { callback_query_id: id, text });
const getChatMember = (ch, uid)              => tg("getChatMember", { chat_id: ch, user_id: uid });

// Send file (multipart) — used for video/audio
function sendFile(method, chatId, filePath, fieldName, caption) {
  return new Promise((resolve, reject) => {
    const boundary = "----Boundary" + Date.now();
    const fileData  = fs.readFileSync(filePath);
    const fileName  = path.basename(filePath);
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ];
    const header = Buffer.from(parts.join("\r\n") + "\r\n");
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body   = Buffer.concat([header, fileData, footer]);

    const req = https.request({
      hostname: "api.telegram.org",
      path:     `/bot${TOKEN}/${method}`,
      method:   "POST",
      headers:  { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length },
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve(JSON.parse(d || "{}")));
    });
    req.on("error", reject);
    req.setTimeout(120000, () => req.destroy());
    req.write(body);
    req.end();
  });
}

// ── data ──────────────────────────────────────────────────────────────────────
let db = { users: {}, forceCh: null };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch {}
const save    = () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch {} };
const addUser = (from) => {
  if (!from) return;
  db.users[String(from.id)] = { id: from.id, name: from.first_name || "", un: from.username || "" };
  save();
};

// ── helpers ───────────────────────────────────────────────────────────────────
const IG     = /https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/[^\s]+/i;
const getUrl = (t) => { const m = String(t).match(/https?:\/\/[^\s]+/); return m ? m[0] : null; };
const isIG   = (u) => IG.test(u);
const isAdm  = (from) => from?.username?.toLowerCase() === ADMIN_USER.toLowerCase();

function dlFile(url, tpl, extra = []) {
  return new Promise((ok, fail) => {
    execFile("yt-dlp",
      ["--no-playlist", "--no-warnings", "-o", tpl, ...extra, url],
      { timeout: 120000 },
      (err, _, stderr) => err ? fail(new Error(stderr || err.message)) : ok()
    );
  });
}

async function checkJoin(uid) {
  if (!db.forceCh) return true;
  try {
    const r = await getChatMember(db.forceCh, uid);
    return ["member","administrator","creator"].includes(r.result?.status);
  } catch { return true; }
}

// ── health server ─────────────────────────────────────────────────────────────
http.createServer((_, res) => { res.writeHead(200); res.end("ok"); }).listen(PORT);

// ── message handler ───────────────────────────────────────────────────────────
async function handleMsg(msg) {
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const from   = msg.from || {};
  const text   = msg.text.trim();
  const name   = from.first_name || "دوست";
  addUser(from);

  // commands
  if (text === "/start") {
    return sendMsg(chatId, `سلام ${name}! 👋\n\nربات دانلود اینستاگرام 🤖\n\n🎬 ویدیو و ریلز\n🎵 موزیک و صدا\n\nلینک پست یا ریلز عمومی اینستاگرام رو بفرست!`);
  }

  if (text === "/admin") {
    if (!isAdm(from)) return sendMsg(chatId, "❌ دسترسی ندارید.");
    const cnt = Object.keys(db.users).length;
    return sendMsg(chatId,
      `👑 پنل ادمین — @${ADMIN_USER}\n👤 کاربران: ${cnt}\n🔒 جوین اجباری: ${db.forceCh || "ندارد"}`,
      { reply_markup: { inline_keyboard: [
        [{ text: "📢 پیام همگانی", callback_data: "A_bc" }],
        [{ text: "🔒 تنظیم جوین", callback_data: "A_sj" }, { text: "❌ حذف جوین", callback_data: "A_rj" }],
        [{ text: "📊 آمار", callback_data: "A_st" }],
      ]}}
    );
  }

  if (text.startsWith("/broadcast ")) {
    if (!isAdm(from)) return;
    const msg2 = text.slice(11).trim();
    if (!msg2) return sendMsg(chatId, "متن پیام رو بنویس: /broadcast متن...");
    const list = Object.values(db.users);
    const sm   = await sendMsg(chatId, `⏳ ارسال به ${list.length} نفر...`);
    let ok2 = 0, bad = 0;
    for (const u of list) {
      try { await sendMsg(u.id, `📢 پیام ادمین:\n\n${msg2}`); ok2++; }
      catch { bad++; }
      await new Promise(r => setTimeout(r, 60));
    }
    return editMsg(chatId, sm.result?.message_id, `✅ تموم!\n✔️ ${ok2} موفق\n❌ ${bad} ناموفق`);
  }

  if (text.startsWith("/setjoin ")) {
    if (!isAdm(from)) return;
    const ch = text.split(" ")[1] || "";
    db.forceCh = ch.startsWith("@") ? ch : "@" + ch;
    save();
    return sendMsg(chatId, `✅ جوین اجباری: ${db.forceCh}`);
  }

  if (text === "/removejoin") {
    if (!isAdm(from)) return;
    db.forceCh = null; save();
    return sendMsg(chatId, "✅ جوین اجباری حذف شد.");
  }

  if (text === "/stats") {
    if (!isAdm(from)) return;
    return sendMsg(chatId, `📊 کاربران: ${Object.keys(db.users).length}\n🔒 جوین: ${db.forceCh || "ندارد"}`);
  }

  if (text.startsWith("/")) return;

  // force join
  if (db.forceCh && from.id) {
    if (!(await checkJoin(from.id))) {
      const ch = db.forceCh.replace("@", "");
      return sendMsg(chatId,
        `سلام ${name}! ⚠️ برای استفاده باید عضو کانال بشی:`,
        { reply_markup: { inline_keyboard: [[
          { text: "🔔 عضویت", url: `https://t.me/${ch}` },
          { text: "✅ عضو شدم", callback_data: `cj_${from.id}` },
        ]]}}
      );
    }
  }

  // instagram link
  const url = getUrl(text);
  if (!url || !isIG(url)) {
    return sendMsg(chatId, `سلام ${name}! ❌ لینک اینستاگرام معتبر نیست.\nریلز یا پست عمومی بفرست.`);
  }

  sendMsg(chatId, `${name} عزیز، چی دانلود کنم؟ 👇`, {
    reply_markup: { inline_keyboard: [[
      { text: "🎬 ویدیو / ریلز", callback_data: `v|${url}` },
      { text: "🎵 صدا MP3",       callback_data: `a|${url}` },
    ]]}
  });
}

// ── callback handler ──────────────────────────────────────────────────────────
async function handleCb(cb) {
  const chatId = cb.message?.chat?.id;
  const msgId  = cb.message?.message_id;
  const from   = cb.from || {};
  const d      = cb.data || "";
  if (!chatId) return;
  answerCb(cb.id).catch(() => {});

  if (d === "A_st") return sendMsg(chatId, `📊 کاربران: ${Object.keys(db.users).length}\n🔒 جوین: ${db.forceCh || "ندارد"}`);
  if (d === "A_rj") { if (!isAdm(from)) return; db.forceCh = null; save(); return sendMsg(chatId, "✅ جوین حذف شد."); }
  if (d === "A_bc") return sendMsg(chatId, "📢 دستور:\n/broadcast متن پیامت");
  if (d === "A_sj") return sendMsg(chatId, "🔒 دستور:\n/setjoin @channel");

  if (d.startsWith("cj_")) {
    const uid  = parseInt(d.slice(3));
    const ok2  = await checkJoin(uid);
    const n    = from.first_name || "دوست";
    return sendMsg(chatId, ok2 ? `✅ ${n} تأیید شد! حالا لینک بفرست.` : "❌ هنوز عضو نشدی.");
  }

  if (!d.includes("|")) return;
  const pipe = d.indexOf("|");
  const type = d.slice(0, pipe);
  const url  = d.slice(pipe + 1);

  await editMsg(chatId, msgId, "⏳ دانلود در حال انجام...");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ig-"));

  try {
    if (type === "v") {
      await dlFile(url, path.join(tmp, "v.%(ext)s"), [
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
      ]);
      let vf = fs.readdirSync(tmp).find(f => f.startsWith("v."));
      if (!vf) throw new Error("فایل ویدیو پیدا نشد");
      let fp = path.join(tmp, vf);

      if (fs.statSync(fp).size > 50 * 1024 * 1024) {
        await editMsg(chatId, msgId, "⚠️ بالای ۵۰MB، کیفیت پایین...");
        await dlFile(url, path.join(tmp, "lo.%(ext)s"), ["-f", "worst[ext=mp4]/worst", "--merge-output-format", "mp4"]);
        const lf = fs.readdirSync(tmp).find(f => f.startsWith("lo."));
        if (!lf) throw new Error("فایل پیدا نشد");
        fp = path.join(tmp, lf);
      }
      await sendFile("sendVideo", chatId, fp, "video", `🎬 ویدیو / ریلز دانلود شد\nby ${BOT_USERNAME}`);

    } else {
      await dlFile(url, path.join(tmp, "a.%(ext)s"), ["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
      const af = fs.readdirSync(tmp).find(f => f.startsWith("a."));
      if (!af) throw new Error("فایل صدا پیدا نشد");
      await sendFile("sendAudio", chatId, path.join(tmp, af), "audio", `🎵 صدا دانلود شد\nby ${BOT_USERNAME}`);
    }

    delMsg(chatId, msgId).catch(() => {});
  } catch (err) {
    const txt = (err.message.includes("Login") || err.message.includes("login"))
      ? "❌ ویدیو خصوصیه. فقط پست‌های عمومی کار می‌کنن."
      : `❌ خطا:\n${err.message.slice(0, 300)}`;
    editMsg(chatId, msgId, txt).catch(() => sendMsg(chatId, txt));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── long polling loop ─────────────────────────────────────────────────────────
let offset = 0;
async function poll() {
  try {
    const r = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message","callback_query"] });
    if (r.ok && r.result?.length) {
      for (const update of r.result) {
        offset = update.update_id + 1;
        if (update.message)        handleMsg(update.message).catch(e => console.error("msg err:", e.message));
        if (update.callback_query) handleCb(update.callback_query).catch(e => console.error("cb err:", e.message));
      }
    }
  } catch (e) {
    console.error("poll error:", e.message);
    await new Promise(r => setTimeout(r, 3000));
  }
  setImmediate(poll);
}

// Start: delete webhook then begin polling
tg("deleteWebhook", { drop_pending_updates: true })
  .then(() => { console.log(`🤖 ${BOT_USERNAME} polling started`); poll(); })
  .catch(() => { console.log(`🤖 ${BOT_USERNAME} polling started (webhook delete skipped)`); poll(); });
