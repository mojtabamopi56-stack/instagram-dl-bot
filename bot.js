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
const DATA_FILE = path.join("/tmp", "bot_data.json");

// ─── persistent data ────────────────────────────────────────────────────────
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return { users: {}, forceJoinChannel: null }; }
}
function saveData(d) { try { fs.writeFileSync(DATA_FILE, JSON.stringify(d)); } catch {} }
let data = loadData();

function addUser(msg) {
  const u = msg.from;
  if (!u) return;
  data.users[u.id] = { id: u.id, first_name: u.first_name || "", username: u.username || "", last: Date.now() };
  saveData(data);
}

// ─── helpers ─────────────────────────────────────────────────────────────────
const INSTAGRAM_REGEX = /https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/[^\s]+/i;
function extractUrl(text) { const m = text.match(/https?:\/\/[^\s]+/); return m ? m[0] : null; }
function isInstagram(url) { return INSTAGRAM_REGEX.test(url); }

function downloadFile(url, out, extra = []) {
  return new Promise((resolve, reject) => {
    execFile("yt-dlp", ["--no-playlist", "--no-warnings", "-o", out, ...extra, url],
      { timeout: 120000 }, (err, _o, stderr) => err ? reject(new Error(stderr || err.message)) : resolve());
  });
}

function isAdmin(msg) {
  return msg.from && msg.from.username && msg.from.username.toLowerCase() === ADMIN_USERNAME.toLowerCase();
}

// ─── force-join check ─────────────────────────────────────────────────────────
async function checkForceJoin(bot, chatId, userId) {
  if (!data.forceJoinChannel) return true;
  try {
    const member = await bot.getChatMember(data.forceJoinChannel, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch { return true; }
}

// ─── health server ────────────────────────────────────────────────────────────
http.createServer((req, res) => { res.writeHead(200); res.end("OK"); }).listen(PORT, () => console.log(`Health on ${PORT}`));

// ─── bot ──────────────────────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: { interval: 300, autoStart: true, params: { timeout: 10 } } });

// /start
bot.onText(/\/start/, async (msg) => {
  addUser(msg);
  const name = msg.from?.first_name || "دوست";
  await bot.sendMessage(msg.chat.id,
    `سلام ${name}! 👋\n\nمن ربات دانلود اینستاگرام هستم.\n\n` +
    `🎬 ویدیو و ریلز\n🎵 موزیک و صدا\n\nکافیه لینک پست یا ریلز اینستاگرام رو بفرستی!`
  );
});

// /admin
bot.onText(/\/admin/, async (msg) => {
  if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "❌ شما ادمین نیستید.");
  const userCount = Object.keys(data.users).length;
  const kb = {
    inline_keyboard: [
      [{ text: `📢 پیام همگانی`, callback_data: "admin_broadcast" }],
      [{ text: `🔒 تنظیم جوین اجباری`, callback_data: "admin_setjoin" }, { text: `❌ حذف جوین اجباری`, callback_data: "admin_removejoin" }],
      [{ text: `📊 آمار`, callback_data: "admin_stats" }],
    ]
  };
  await bot.sendMessage(msg.chat.id,
    `👑 پنل ادمین\n\n👤 تعداد کاربران: ${userCount}\n🔒 جوین اجباری: ${data.forceJoinChannel || "ندارد"}`,
    { reply_markup: kb }
  );
});

// /broadcast (admin only) - format: /broadcast پیامت اینجا
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  const text = match[1];
  const users = Object.values(data.users);
  let sent = 0, failed = 0;
  await bot.sendMessage(msg.chat.id, `⏳ ارسال به ${users.length} نفر...`);
  for (const u of users) {
    try { await bot.sendMessage(u.id, `📢 پیام ادمین:\n\n${text}`); sent++; } catch { failed++; }
    await new Promise(r => setTimeout(r, 50));
  }
  await bot.sendMessage(msg.chat.id, `✅ ارسال شد:\n✔️ موفق: ${sent}\n❌ ناموفق: ${failed}`);
});

// /setjoin channel (admin only)
bot.onText(/\/setjoin (.+)/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  const ch = match[1].trim();
  data.forceJoinChannel = ch.startsWith("@") ? ch : "@" + ch;
  saveData(data);
  await bot.sendMessage(msg.chat.id, `✅ جوین اجباری تنظیم شد: ${data.forceJoinChannel}`);
});

// /removejoin (admin only)
bot.onText(/\/removejoin/, async (msg) => {
  if (!isAdmin(msg)) return;
  data.forceJoinChannel = null;
  saveData(data);
  await bot.sendMessage(msg.chat.id, `✅ جوین اجباری حذف شد.`);
});

// /stats (admin only)
bot.onText(/\/stats/, async (msg) => {
  if (!isAdmin(msg)) return;
  await bot.sendMessage(msg.chat.id, `📊 آمار:\n👤 کاربران: ${Object.keys(data.users).length}\n🔒 جوین اجباری: ${data.forceJoinChannel || "ندارد"}`);
});

// callback queries for admin panel
bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  if (!chatId) return;
  await bot.answerCallbackQuery(query.id);

  const data_str = query.data;

  if (data_str === "admin_stats") {
    await bot.sendMessage(chatId, `📊 آمار:\n👤 کاربران: ${Object.keys(data.users).length}\n🔒 جوین اجباری: ${data.forceJoinChannel || "ندارد"}`);
    return;
  }
  if (data_str === "admin_removejoin") {
    if (!isAdmin(query.message)) return;
    data.forceJoinChannel = null;
    saveData(data);
    await bot.sendMessage(chatId, "✅ جوین اجباری حذف شد.");
    return;
  }
  if (data_str === "admin_broadcast") {
    await bot.sendMessage(chatId, "برای ارسال پیام همگانی از دستور زیر استفاده کن:\n\n/broadcast متن پیامت اینجا");
    return;
  }
  if (data_str === "admin_setjoin") {
    await bot.sendMessage(chatId, "برای تنظیم جوین اجباری از دستور زیر استفاده کن:\n\n/setjoin @channel_username");
    return;
  }

  // ─── download callbacks ──────────────────────────────────────────────────
  if (!data_str || !data_str.includes("|")) return;
  const pipeIdx = data_str.indexOf("|");
  const type = data_str.slice(0, pipeIdx);
  const url = data_str.slice(pipeIdx + 1);

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
      const size = fs.statSync(fp).size;
      if (size > 50 * 1024 * 1024) {
        await bot.editMessageText("⚠️ حجم بیشتر از ۵۰MB. با کیفیت پایین امتحان میکنم...", { chat_id: chatId, message_id: messageId });
        await downloadFile(url, path.join(tmpDir, "low.%(ext)s"), ["-f", "worst[ext=mp4]/worst", "--merge-output-format", "mp4"]);
        const lf = fs.readdirSync(tmpDir).find(f => f.startsWith("low."));
        if (!lf) throw new Error("فایل پیدا نشد");
        await bot.sendVideo(chatId, path.join(tmpDir, lf), { caption: `🎬 دانلود شد | by ${BOT_USERNAME}` });
      } else {
        await bot.sendVideo(chatId, fp, { caption: `🎬 دانلود شد | by ${BOT_USERNAME}` });
      }
      await bot.deleteMessage(chatId, messageId);

    } else if (type === "audio") {
      await downloadFile(url, path.join(tmpDir, "audio.%(ext)s"), ["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
      const af = fs.readdirSync(tmpDir).find(f => f.startsWith("audio."));
      if (!af) throw new Error("فایل صدا پیدا نشد");
      await bot.sendAudio(chatId, path.join(tmpDir, af), { caption: `🎵 دانلود شد | by ${BOT_USERNAME}` });
      await bot.deleteMessage(chatId, messageId);
    }
  } catch (err) {
    const msg_err = err.message.includes("Login required") || err.message.includes("login")
      ? "❌ این ویدیو خصوصیه یا نیاز به لاگین داره.\nفقط ریلز و پست‌های عمومی کار می‌کنن."
      : `❌ خطا در دانلود:\n${err.message.slice(0, 300)}`;
    await bot.editMessageText(msg_err, { chat_id: chatId, message_id: messageId }).catch(() => bot.sendMessage(chatId, msg_err));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─── main message handler ─────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const text = msg.text;
  if (!text || text.startsWith("/")) return;
  addUser(msg);

  const userId = msg.from?.id;
  const name = msg.from?.first_name || "دوست";

  // check force join
  if (data.forceJoinChannel && userId) {
    const joined = await checkForceJoin(bot, msg.chat.id, userId);
    if (!joined) {
      return bot.sendMessage(msg.chat.id,
        `سلام ${name}!\n\n⚠️ برای استفاده از ربات باید عضو کانال بشی:\n${data.forceJoinChannel}`,
        { reply_markup: { inline_keyboard: [[{ text: "🔔 عضویت در کانال", url: `https://t.me/${data.forceJoinChannel.replace("@","")}` }, { text: "✅ عضو شدم", callback_data: "check_join" }]] } }
      );
    }
  }

  const url = extractUrl(text);
  if (!url || !isInstagram(url)) {
    return bot.sendMessage(msg.chat.id,
      `سلام ${name}! ❌\n\nلینک اینستاگرام معتبر نیست.\nیه لینک ریلز یا پست عمومی از اینستاگرام بفرست.`
    );
  }

  await bot.sendMessage(msg.chat.id, "چی می‌خوای دانلود کنی؟ 👇", {
    reply_markup: {
      inline_keyboard: [[
        { text: "🎬 دانلود ویدیو / ریلز", callback_data: `video|${url}` },
        { text: "🎵 دانلود صدا (MP3)", callback_data: `audio|${url}` },
      ]]
    }
  });
});

// check join callback
bot.on("callback_query", async (query) => {
  if (query.data !== "check_join") return;
  const userId = query.from.id;
  const name = query.from.first_name || "دوست";
  const joined = await checkForceJoin(bot, query.message.chat.id, userId);
  await bot.answerCallbackQuery(query.id);
  if (joined) {
    await bot.sendMessage(query.message.chat.id, `✅ ${name} عزیز، عضویتت تأیید شد! حالا لینک اینستاگرامت رو بفرست.`);
  } else {
    await bot.sendMessage(query.message.chat.id, `❌ هنوز عضو نشدی. اول عضو کانال بشو بعد دوباره بزن.`);
  }
});

bot.on("polling_error", (err) => console.error("polling error:", err.message));

console.log(`🤖 ربات ${BOT_USERNAME} روشن شد!`);
