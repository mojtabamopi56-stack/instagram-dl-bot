const TelegramBot = require("node-telegram-bot-api");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN required"); process.exit(1); }

const PORT = process.env.PORT || 3000;
const BOT_USERNAME = "@lnterinstagram_Bot";
const ADMIN_USERNAME = "Mojeao";
const WEBHOOK_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : null;
const DATA_FILE = path.join("/tmp", "bot_data.json");

// ─── data ────────────────────────────────────────────────────────────────────
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { users: {}, forceJoinChannel: null }; }
}
function saveData(d) { try { fs.writeFileSync(DATA_FILE, JSON.stringify(d)); } catch {} }
let data = loadData();

function addUser(from) {
  if (!from) return;
  data.users[from.id] = { id: from.id, first_name: from.first_name || "", username: from.username || "", last: Date.now() };
  saveData(data);
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const INSTAGRAM_REGEX = /https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/[^\s]+/i;
function extractUrl(text) { const m = text.match(/https?:\/\/[^\s]+/); return m ? m[0] : null; }
function isInstagram(url) { return INSTAGRAM_REGEX.test(url); }
function isAdmin(from) { return from && from.username && from.username.toLowerCase() === ADMIN_USERNAME.toLowerCase(); }

function downloadFile(url, out, extra = []) {
  return new Promise((resolve, reject) => {
    execFile("yt-dlp", ["--no-playlist", "--no-warnings", "-o", out, ...extra, url],
      { timeout: 120000 }, (err, _o, stderr) => err ? reject(new Error(stderr || err.message)) : resolve());
  });
}

async function checkForceJoin(bot, userId) {
  if (!data.forceJoinChannel) return true;
  try {
    const m = await bot.getChatMember(data.forceJoinChannel, userId);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch { return true; }
}

// ─── bot init (webhook or polling) ────────────────────────────────────────────
let bot;
if (WEBHOOK_DOMAIN) {
  const webhookPath = `/webhook/${TOKEN}`;
  bot = new TelegramBot(TOKEN, { webHook: { port: PORT } });
  bot.setWebHook(`${WEBHOOK_DOMAIN}${webhookPath}`);
  console.log(`Webhook set: ${WEBHOOK_DOMAIN}${webhookPath}`);
} else {
  bot = new TelegramBot(TOKEN, { polling: true });
  console.log("Polling mode");
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  addUser(msg.from);
  const name = msg.from?.first_name || "دوست";
  await bot.sendMessage(msg.chat.id,
    `سلام ${name}! 👋\n\nمن ربات دانلود اینستاگرام هستم.\n\n🎬 دانلود ویدیو و ریلز\n🎵 دانلود موزیک و صدا\n\nکافیه لینک پست یا ریلز عمومی اینستاگرام رو بفرستی!`
  );
});

// ─── /admin ───────────────────────────────────────────────────────────────────
bot.onText(/\/admin/, async (msg) => {
  if (!isAdmin(msg.from)) return bot.sendMessage(msg.chat.id, "❌ شما ادمین نیستید.");
  const count = Object.keys(data.users).length;
  await bot.sendMessage(msg.chat.id,
    `👑 پنل ادمین @${ADMIN_USERNAME}\n\n👤 کاربران: ${count} نفر\n🔒 جوین اجباری: ${data.forceJoinChannel || "ندارد"}`,
    { reply_markup: { inline_keyboard: [
      [{ text: "📢 پیام همگانی", callback_data: "a_broadcast" }],
      [{ text: "🔒 تنظیم جوین اجباری", callback_data: "a_setjoin" }, { text: "❌ حذف جوین", callback_data: "a_removejoin" }],
      [{ text: "📊 آمار کاربران", callback_data: "a_stats" }],
    ]}}
  );
});

// ─── /broadcast ───────────────────────────────────────────────────────────────
bot.onText(/\/broadcast (.+)/s, async (msg, match) => {
  if (!isAdmin(msg.from)) return;
  const text = match[1];
  const users = Object.values(data.users);
  let sent = 0, failed = 0;
  const statusMsg = await bot.sendMessage(msg.chat.id, `⏳ در حال ارسال به ${users.length} نفر...`);
  for (const u of users) {
    try { await bot.sendMessage(u.id, `📢 پیام ادمین:\n\n${text}`); sent++; }
    catch { failed++; }
    await new Promise(r => setTimeout(r, 50));
  }
  await bot.editMessageText(`✅ ارسال تموم شد!\n✔️ موفق: ${sent}\n❌ ناموفق: ${failed}`,
    { chat_id: msg.chat.id, message_id: statusMsg.message_id });
});

// ─── /setjoin ─────────────────────────────────────────────────────────────────
bot.onText(/\/setjoin (@?\S+)/, async (msg, match) => {
  if (!isAdmin(msg.from)) return;
  const ch = match[1].startsWith("@") ? match[1] : "@" + match[1];
  data.forceJoinChannel = ch; saveData(data);
  await bot.sendMessage(msg.chat.id, `✅ جوین اجباری فعال شد: ${ch}`);
});

// ─── /removejoin ─────────────────────────────────────────────────────────────
bot.onText(/\/removejoin/, async (msg) => {
  if (!isAdmin(msg.from)) return;
  data.forceJoinChannel = null; saveData(data);
  await bot.sendMessage(msg.chat.id, "✅ جوین اجباری حذف شد.");
});

// ─── /stats ──────────────────────────────────────────────────────────────────
bot.onText(/\/stats/, async (msg) => {
  if (!isAdmin(msg.from)) return;
  await bot.sendMessage(msg.chat.id,
    `📊 آمار:\n👤 کاربران ثبت‌شده: ${Object.keys(data.users).length}\n🔒 جوین اجباری: ${data.forceJoinChannel || "ندارد"}`);
});

// ─── messages ─────────────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const text = msg.text;
  if (!text || text.startsWith("/")) return;
  addUser(msg.from);

  const name = msg.from?.first_name || "دوست";
  const userId = msg.from?.id;

  // force join check
  if (data.forceJoinChannel && userId) {
    const joined = await checkForceJoin(bot, userId);
    if (!joined) {
      const ch = data.forceJoinChannel.replace("@", "");
      return bot.sendMessage(msg.chat.id,
        `سلام ${name}! ⚠️\n\nبرای استفاده از ربات باید عضو کانال بشی:`,
        { reply_markup: { inline_keyboard: [[
          { text: "🔔 عضویت در کانال", url: `https://t.me/${ch}` },
          { text: "✅ عضو شدم، بررسی کن", callback_data: `checkjoin_${userId}` }
        ]]}}
      );
    }
  }

  const url = extractUrl(text);
  if (!url || !isInstagram(url)) {
    return bot.sendMessage(msg.chat.id,
      `سلام ${name}! ❌\n\nلینک اینستاگرام معتبر نیست.\nیه لینک ریلز یا پست عمومی از اینستاگرام بفرست.`
    );
  }

  await bot.sendMessage(msg.chat.id, `${name} عزیز، چی می‌خوای دانلود کنی؟ 👇`, {
    reply_markup: { inline_keyboard: [[
      { text: "🎬 دانلود ویدیو / ریلز", callback_data: `video|${url}` },
      { text: "🎵 دانلود صدا (MP3)", callback_data: `audio|${url}` },
    ]]}
  });
});

// ─── callbacks ────────────────────────────────────────────────────────────────
bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  const from = query.from;
  if (!chatId) return;

  await bot.answerCallbackQuery(query.id);
  const d = query.data || "";

  // admin callbacks
  if (d === "a_stats") {
    return bot.sendMessage(chatId, `📊 کاربران: ${Object.keys(data.users).length}\n🔒 جوین: ${data.forceJoinChannel || "ندارد"}`);
  }
  if (d === "a_removejoin") {
    if (!isAdmin(from)) return;
    data.forceJoinChannel = null; saveData(data);
    return bot.sendMessage(chatId, "✅ جوین اجباری حذف شد.");
  }
  if (d === "a_broadcast") {
    return bot.sendMessage(chatId, "برای پیام همگانی:\n\n/broadcast متن پیامت اینجا");
  }
  if (d === "a_setjoin") {
    return bot.sendMessage(chatId, "برای تنظیم جوین اجباری:\n\n/setjoin @channel_username");
  }

  // check join callback
  if (d.startsWith("checkjoin_")) {
    const uid = parseInt(d.split("_")[1]);
    const joined = await checkForceJoin(bot, uid);
    const name = from.first_name || "دوست";
    if (joined) return bot.sendMessage(chatId, `✅ ${name} عزیز، عضویتت تأیید شد! حالا لینک اینستاگرامت رو بفرست.`);
    else return bot.sendMessage(chatId, `❌ هنوز عضو نشدی. اول عضو بشو بعد دوباره بزن.`);
  }

  // download callbacks
  if (!d.includes("|")) return;
  const pipeIdx = d.indexOf("|");
  const type = d.slice(0, pipeIdx);
  const url = d.slice(pipeIdx + 1);
  const name = from?.first_name || "دوست";

  await bot.editMessageText("⏳ داره دانلود میشه... صبر کن", { chat_id: chatId, message_id: messageId });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "igdl-"));

  try {
    if (type === "video") {
      await downloadFile(url, path.join(tmpDir, "video.%(ext)s"), [
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
      ]);
      const vf = fs.readdirSync(tmpDir).find(f => f.startsWith("video."));
      if (!vf) throw new Error("فایل ویدیو پیدا نشد");
      const fp = path.join(tmpDir, vf);
      if (fs.statSync(fp).size > 50 * 1024 * 1024) {
        await bot.editMessageText("⚠️ حجم بیشتر از ۵۰MB. با کیفیت پایین امتحان میکنم...", { chat_id: chatId, message_id: messageId });
        await downloadFile(url, path.join(tmpDir, "low.%(ext)s"), ["-f", "worst[ext=mp4]/worst", "--merge-output-format", "mp4"]);
        const lf = fs.readdirSync(tmpDir).find(f => f.startsWith("low."));
        if (!lf) throw new Error("فایل پیدا نشد");
        await bot.sendVideo(chatId, path.join(tmpDir, lf), { caption: `🎬 ویدیو / ریلز دانلود شد\nby ${BOT_USERNAME}` });
      } else {
        await bot.sendVideo(chatId, fp, { caption: `🎬 ویدیو / ریلز دانلود شد\nby ${BOT_USERNAME}` });
      }
      await bot.deleteMessage(chatId, messageId);

    } else if (type === "audio") {
      await downloadFile(url, path.join(tmpDir, "audio.%(ext)s"), ["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
      const af = fs.readdirSync(tmpDir).find(f => f.startsWith("audio."));
      if (!af) throw new Error("فایل صدا پیدا نشد");
      await bot.sendAudio(chatId, path.join(tmpDir, af), { caption: `🎵 صدا دانلود شد\nby ${BOT_USERNAME}` });
      await bot.deleteMessage(chatId, messageId);
    }
  } catch (err) {
    const errMsg = err.message.includes("Login required") || err.message.includes("login")
      ? "❌ این ویدیو خصوصیه.\nفقط ریلز و پست‌های عمومی کار می‌کنن."
      : `❌ خطا در دانلود:\n${err.message.slice(0, 300)}`;
    await bot.editMessageText(errMsg, { chat_id: chatId, message_id: messageId })
      .catch(() => bot.sendMessage(chatId, errMsg));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

bot.on("polling_error", (err) => { if (!err.message.includes("409")) console.error("polling:", err.message); });

console.log(`🤖 ربات ${BOT_USERNAME} روشن شد!`);
