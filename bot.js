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
const DATA_FILE = "/tmp/bot_data.json";

// ── data ──────────────────────────────────────────────────────────────────────
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { users: {}, forceJoinChannel: null }; }
}
function saveData(d) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(d)); } catch {}
}
let data = loadData();

function addUser(from) {
  if (!from) return;
  data.users[String(from.id)] = {
    id: from.id,
    first_name: from.first_name || "",
    username: from.username || "",
    last: Date.now(),
  };
  saveData(data);
}

// ── helpers ───────────────────────────────────────────────────────────────────
const IG_REGEX = /https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/[^\s]+/i;
function extractUrl(text) {
  const m = text.match(/https?:\/\/[^\s]+/);
  return m ? m[0] : null;
}
function isIG(url) { return IG_REGEX.test(url); }
function isAdmin(from) {
  return from && from.username &&
    from.username.toLowerCase() === ADMIN_USERNAME.toLowerCase();
}

function dl(url, out, extra = []) {
  return new Promise((resolve, reject) => {
    execFile(
      "yt-dlp",
      ["--no-playlist", "--no-warnings", "-o", out, ...extra, url],
      { timeout: 120000 },
      (err, _o, stderr) => err ? reject(new Error(stderr || err.message)) : resolve()
    );
  });
}

async function checkJoin(bot, userId) {
  if (!data.forceJoinChannel) return true;
  try {
    const m = await bot.getChatMember(data.forceJoinChannel, userId);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch { return true; }
}

// ── health server (separate from bot) ────────────────────────────────────────
http.createServer((_req, res) => {
  res.writeHead(200);
  res.end("bot is running");
}).listen(PORT, () => console.log("Health server on port", PORT));

// ── clear old webhook & start polling ────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: false });

bot.deleteWebHook().then(() => {
  bot.startPolling({ restart: false });
  console.log(`🤖 ${BOT_USERNAME} started polling`);
}).catch(err => {
  console.error("deleteWebhook error:", err.message);
  bot.startPolling({ restart: false });
});

// ── /start ────────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  addUser(msg.from);
  const name = msg.from?.first_name || "دوست";
  bot.sendMessage(msg.chat.id,
    `سلام ${name}! 👋\n\nربات دانلود اینستاگرام\n\n🎬 ویدیو و ریلز\n🎵 موزیک و صدا\n\nلینک پست یا ریلز عمومی اینستاگرام رو بفرست!`
  );
});

// ── /admin ────────────────────────────────────────────────────────────────────
bot.onText(/\/admin/, async (msg) => {
  if (!isAdmin(msg.from)) return bot.sendMessage(msg.chat.id, "❌ دسترسی ندارید.");
  const count = Object.keys(data.users).length;
  bot.sendMessage(msg.chat.id,
    `👑 پنل ادمین — @${ADMIN_USERNAME}\n\n👤 کاربران: ${count} نفر\n🔒 جوین اجباری: ${data.forceJoinChannel || "ندارد"}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📢 پیام همگانی", callback_data: "adm_broadcast" }],
          [
            { text: "🔒 تنظیم جوین اجباری", callback_data: "adm_setjoin" },
            { text: "❌ حذف جوین", callback_data: "adm_removejoin" },
          ],
          [{ text: "📊 آمار", callback_data: "adm_stats" }],
        ],
      },
    }
  );
});

// ── /broadcast ───────────────────────────────────────────────────────────────
bot.onText(/\/broadcast (.+)/s, async (msg, match) => {
  if (!isAdmin(msg.from)) return;
  const text = match[1];
  const users = Object.values(data.users);
  const sm = await bot.sendMessage(msg.chat.id, `⏳ در حال ارسال به ${users.length} نفر...`);
  let sent = 0, failed = 0;
  for (const u of users) {
    try { await bot.sendMessage(u.id, `📢 پیام ادمین:\n\n${text}`); sent++; }
    catch { failed++; }
    await new Promise(r => setTimeout(r, 60));
  }
  bot.editMessageText(
    `✅ تموم شد!\n✔️ موفق: ${sent}\n❌ ناموفق: ${failed}`,
    { chat_id: msg.chat.id, message_id: sm.message_id }
  );
});

// ── /setjoin ──────────────────────────────────────────────────────────────────
bot.onText(/\/setjoin (@?\S+)/, async (msg, match) => {
  if (!isAdmin(msg.from)) return;
  const ch = match[1].startsWith("@") ? match[1] : "@" + match[1];
  data.forceJoinChannel = ch;
  saveData(data);
  bot.sendMessage(msg.chat.id, `✅ جوین اجباری فعال: ${ch}`);
});

// ── /removejoin ───────────────────────────────────────────────────────────────
bot.onText(/\/removejoin/, async (msg) => {
  if (!isAdmin(msg.from)) return;
  data.forceJoinChannel = null;
  saveData(data);
  bot.sendMessage(msg.chat.id, "✅ جوین اجباری حذف شد.");
});

// ── /stats ────────────────────────────────────────────────────────────────────
bot.onText(/\/stats/, async (msg) => {
  if (!isAdmin(msg.from)) return;
  bot.sendMessage(msg.chat.id,
    `📊 آمار:\n👤 کاربران: ${Object.keys(data.users).length}\n🔒 جوین: ${data.forceJoinChannel || "ندارد"}`
  );
});

// ── messages ──────────────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const text = msg.text;
  if (!text || text.startsWith("/")) return;
  addUser(msg.from);

  const name = msg.from?.first_name || "دوست";
  const userId = msg.from?.id;

  if (data.forceJoinChannel && userId) {
    const joined = await checkJoin(bot, userId);
    if (!joined) {
      const ch = data.forceJoinChannel.replace("@", "");
      return bot.sendMessage(msg.chat.id,
        `سلام ${name}! ⚠️\n\nبرای استفاده از ربات باید عضو کانال بشی:`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: "🔔 عضویت در کانال", url: `https://t.me/${ch}` },
              { text: "✅ عضو شدم", callback_data: `cj_${userId}` },
            ]],
          },
        }
      );
    }
  }

  const url = extractUrl(text);
  if (!url || !isIG(url)) {
    return bot.sendMessage(msg.chat.id,
      `سلام ${name}! ❌\n\nلینک اینستاگرام معتبر نیست.\nلینک ریلز یا پست عمومی بفرست.`
    );
  }

  bot.sendMessage(msg.chat.id, `${name} عزیز، چی دانلود کنم؟ 👇`, {
    reply_markup: {
      inline_keyboard: [[
        { text: "🎬 ویدیو / ریلز", callback_data: `video|${url}` },
        { text: "🎵 صدا (MP3)", callback_data: `audio|${url}` },
      ]],
    },
  });
});

// ── callbacks ─────────────────────────────────────────────────────────────────
bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  const msgId = query.message?.message_id;
  const from = query.from;
  const d = query.data || "";
  if (!chatId) return;
  await bot.answerCallbackQuery(query.id).catch(() => {});

  // admin panel
  if (d === "adm_stats") {
    return bot.sendMessage(chatId,
      `📊 کاربران: ${Object.keys(data.users).length}\n🔒 جوین: ${data.forceJoinChannel || "ندارد"}`
    );
  }
  if (d === "adm_removejoin") {
    if (!isAdmin(from)) return;
    data.forceJoinChannel = null; saveData(data);
    return bot.sendMessage(chatId, "✅ جوین اجباری حذف شد.");
  }
  if (d === "adm_broadcast") {
    return bot.sendMessage(chatId, "📢 برای پیام همگانی:\n\n/broadcast متن پیامت");
  }
  if (d === "adm_setjoin") {
    return bot.sendMessage(chatId, "🔒 برای جوین اجباری:\n\n/setjoin @channel_username");
  }

  // check join
  if (d.startsWith("cj_")) {
    const uid = parseInt(d.split("_")[1]);
    const joined = await checkJoin(bot, uid);
    const name = from.first_name || "دوست";
    return joined
      ? bot.sendMessage(chatId, `✅ ${name} عزیز، تأیید شد! حالا لینک بفرست.`)
      : bot.sendMessage(chatId, "❌ هنوز عضو نشدی. عضو بشو بعد بزن.");
  }

  // download
  if (!d.includes("|")) return;
  const pipe = d.indexOf("|");
  const type = d.slice(0, pipe);
  const url = d.slice(pipe + 1);

  await bot.editMessageText("⏳ دانلود در حال انجام... صبر کن", { chat_id: chatId, message_id: msgId });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "igdl-"));

  try {
    if (type === "video") {
      await dl(url, path.join(tmp, "v.%(ext)s"), [
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
      ]);
      let vf = fs.readdirSync(tmp).find(f => f.startsWith("v."));
      if (!vf) throw new Error("فایل ویدیو پیدا نشد");
      let fp = path.join(tmp, vf);

      if (fs.statSync(fp).size > 50 * 1024 * 1024) {
        await bot.editMessageText("⚠️ حجم بیشتر از ۵۰MB، کیفیت پایین امتحان میکنم...", { chat_id: chatId, message_id: msgId });
        await dl(url, path.join(tmp, "low.%(ext)s"), ["-f", "worst[ext=mp4]/worst", "--merge-output-format", "mp4"]);
        const lf = fs.readdirSync(tmp).find(f => f.startsWith("low."));
        if (!lf) throw new Error("فایل پیدا نشد");
        fp = path.join(tmp, lf);
      }
      await bot.sendVideo(chatId, fp, { caption: `🎬 ویدیو / ریلز دانلود شد\nby ${BOT_USERNAME}` });
      await bot.deleteMessage(chatId, msgId).catch(() => {});

    } else if (type === "audio") {
      await dl(url, path.join(tmp, "a.%(ext)s"), ["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
      const af = fs.readdirSync(tmp).find(f => f.startsWith("a."));
      if (!af) throw new Error("فایل صدا پیدا نشد");
      await bot.sendAudio(chatId, path.join(tmp, af), { caption: `🎵 صدا دانلود شد\nby ${BOT_USERNAME}` });
      await bot.deleteMessage(chatId, msgId).catch(() => {});
    }
  } catch (err) {
    const errMsg = (err.message.includes("Login") || err.message.includes("login"))
      ? "❌ این ویدیو خصوصیه.\nفقط ریلز و پست‌های عمومی کار می‌کنن."
      : `❌ خطا:\n${err.message.slice(0, 300)}`;
    bot.editMessageText(errMsg, { chat_id: chatId, message_id: msgId })
      .catch(() => bot.sendMessage(chatId, errMsg));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

bot.on("polling_error", (err) => {
  if (err.code === "EFATAL") {
    console.error("Fatal polling error, restarting in 5s:", err.message);
    setTimeout(() => bot.startPolling({ restart: false }), 5000);
  }
});
