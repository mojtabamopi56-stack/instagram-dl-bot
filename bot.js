const TelegramBot = require("node-telegram-bot-api");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200);
    res.end("OK - Bot is running");
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Health server running on port ${PORT}`);
});

const INSTAGRAM_REGEX =
  /https?:\/\/(www\.)?instagram\.com\/(p|reel|tv|stories)\/[^\s]+/i;

function isInstagramUrl(url) {
  return INSTAGRAM_REGEX.test(url);
}

function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

function downloadFile(url, outputPath, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [
      "--no-playlist",
      "--no-warnings",
      "-o",
      outputPath,
      ...extraArgs,
      url,
    ];
    execFile("yt-dlp", args, { timeout: 120000 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve();
      }
    });
  });
}

const bot = new TelegramBot(TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `سلام! 👋\n\nمن ربات دانلود اینستاگرام هستم.\n\nکافیه لینک پست، ریل یا ویدیوی اینستاگرام رو بفرستی.\n\nبرات گزینه‌های دانلود رو نشون میدم! 🎬🎵`
  );
});

bot.on("message", async (msg) => {
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  const url = extractUrl(text);
  if (!url || !isInstagramUrl(url)) {
    bot.sendMessage(
      msg.chat.id,
      "❌ لینک اینستاگرام معتبر نیست.\n\nیه لینک پست، ریل یا ویدیو از اینستاگرام بفرست."
    );
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: "🎬 دانلود ویدیو", callback_data: `video|${url}` },
        { text: "🎵 دانلود صدا (MP3)", callback_data: `audio|${url}` },
      ],
    ],
  };

  bot.sendMessage(msg.chat.id, "چی می‌خوای دانلود کنی؟ 👇", {
    reply_markup: keyboard,
  });
});

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  if (!chatId || !messageId) return;

  const data = query.data;
  if (!data || !data.includes("|")) return;

  const pipeIdx = data.indexOf("|");
  const type = data.slice(0, pipeIdx);
  const url = data.slice(pipeIdx + 1);

  await bot.answerCallbackQuery(query.id);
  await bot.editMessageText("⏳ داره دانلود میشه... صبر کن", {
    chat_id: chatId,
    message_id: messageId,
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "igdl-"));

  try {
    if (type === "video") {
      const outputTemplate = path.join(tmpDir, "video.%(ext)s");
      await downloadFile(url, outputTemplate, [
        "-f",
        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format",
        "mp4",
      ]);

      const files = fs.readdirSync(tmpDir);
      const videoFile = files.find((f) => f.startsWith("video."));
      if (!videoFile) throw new Error("فایل ویدیو پیدا نشد");

      const filePath = path.join(tmpDir, videoFile);
      const stat = fs.statSync(filePath);

      if (stat.size > 50 * 1024 * 1024) {
        await bot.editMessageText(
          "⚠️ حجم ویدیو بیشتر از ۵۰MB هست. با کیفیت پایین‌تر امتحان میکنم...",
          { chat_id: chatId, message_id: messageId }
        );
        const output2 = path.join(tmpDir, "video_low.%(ext)s");
        await downloadFile(url, output2, [
          "-f",
          "worst[ext=mp4]/worst",
          "--merge-output-format",
          "mp4",
        ]);
        const files2 = fs.readdirSync(tmpDir);
        const low = files2.find((f) => f.startsWith("video_low."));
        if (!low) throw new Error("فایل ویدیو پیدا نشد");
        await bot.sendVideo(chatId, path.join(tmpDir, low), {
          caption: "🎬 ویدیو (کیفیت پایین)",
        });
      } else {
        await bot.sendVideo(chatId, filePath, {
          caption: "🎬 ویدیو دانلود شد!",
        });
      }
      await bot.deleteMessage(chatId, messageId);
    } else if (type === "audio") {
      const outputTemplate = path.join(tmpDir, "audio.%(ext)s");
      await downloadFile(url, outputTemplate, [
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
      ]);

      const files = fs.readdirSync(tmpDir);
      const audioFile = files.find((f) => f.startsWith("audio."));
      if (!audioFile) throw new Error("فایل صدا پیدا نشد");

      await bot.sendAudio(chatId, path.join(tmpDir, audioFile), {
        caption: "🎵 صدا دانلود شد!",
      });
      await bot.deleteMessage(chatId, messageId);
    }
  } catch (err) {
    const errMsg =
      err.message.includes("Login required") || err.message.includes("login")
        ? "❌ اینستاگرام برای این ویدیو نیاز به لاگین داره. فقط ریل‌ها و پست‌های عمومی کار می‌کنن."
        : `❌ خطا در دانلود:\n${err.message.slice(0, 200)}`;

    await bot
      .editMessageText(errMsg, { chat_id: chatId, message_id: messageId })
      .catch(() => bot.sendMessage(chatId, errMsg));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

console.log("🤖 ربات روشن شد و داره کار می‌کنه...");
