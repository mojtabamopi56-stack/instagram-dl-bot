process.env.NTBA_FIX_319 = "1";
const TelegramBot = require("node-telegram-bot-api");
const { execFile } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const http = require("http");

// ── config ────────────────────────────────────────────────────────────────────
const TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const PORT         = process.env.PORT || 3000;
const BOT_USERNAME = "@lnterinstagram_Bot";
const ADMIN_USER   = "Mojeao";
const DATA_FILE    = "/tmp/bdata.json";

if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN missing"); process.exit(1); }

// ── data ──────────────────────────────────────────────────────────────────────
let data = { users: {}, forceCh: null };
try { data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch {}
const save = () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(data)); } catch {} };
const addUser = (f) => {
  if (!f) return;
  data.users[String(f.id)] = { id: f.id, name: f.first_name || "", un: f.username || "" };
  save();
};

// ── util ──────────────────────────────────────────────────────────────────────
const IG = /https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/[^\s]+/i;
const getUrl   = (t) => { const m = t.match(/https?:\/\/[^\s]+/); return m ? m[0] : null; };
const isIG     = (u) => IG.test(u);
const isAdmin  = (f) => f && f.username && f.username.toLowerCase() === ADMIN_USER.toLowerCase();

function download(url, outTemplate, extraArgs = []) {
  return new Promise((ok, fail) => {
    execFile("yt-dlp",
      ["--no-playlist", "--no-warnings", "-o", outTemplate, ...extraArgs, url],
      { timeout: 120000 },
      (err, _, stderr) => err ? fail(new Error(stderr || err.message)) : ok()
    );
  });
}

async function inChannel(bot, uid) {
  if (!data.forceCh) return true;
  try {
    const r = await bot.getChatMember(data.forceCh, uid);
    return ["member","administrator","creator"].includes(r.status);
  } catch { return true; }
}

// ── health ────────────────────────────────────────────────────────────────────
http.createServer((_, res) => { res.writeHead(200); res.end("ok"); }).listen(PORT);

// ── bot ───────────────────────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 300,
    autoStart: false,
    params: { timeout: 10, allowed_updates: ["message","callback_query"] }
  }
});

// make sure no webhook is active, then start
(async () => {
  try { await bot.deleteWebHook(); } catch {}
  bot.startPolling();
  console.log(`🤖 ${BOT_USERNAME} polling`);
})();

// ── /start ────────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  addUser(msg.from);
  const n = msg.from?.first_name || "دوست";
  bot.sendMessage(msg.chat.id,
    `سلام ${n}! 👋\n\nربات دانلود اینستاگرام 🤖\n\n🎬 ویدیو و ریلز\n🎵 موزیک و صدا\n\nلینک پست یا ریلز عمومی اینستاگرام رو بفرست!`
  );
});

// ── /admin ────────────────────────────────────────────────────────────────────
bot.onText(/\/admin/, (msg) => {
  if (!isAdmin(msg.from)) return bot.sendMessage(msg.chat.id, "❌ دسترسی ندارید.");
  const cnt = Object.keys(data.users).length;
  bot.sendMessage(msg.chat.id,
    `👑 پنل ادمین — @${ADMIN_USER}\n👤 کاربران: ${cnt}\n🔒 جوین اجباری: ${data.forceCh || "ندارد"}`,
    { reply_markup: { inline_keyboard: [
      [{ text: "📢 پیام همگانی", callback_data: "A_bc" }],
      [{ text: "🔒 تنظیم جوین", callback_data: "A_sj" }, { text: "❌ حذف جوین", callback_data: "A_rj" }],
      [{ text: "📊 آمار", callback_data: "A_st" }],
    ]}}
  );
});

bot.onText(/\/broadcast (.+)/s, async (msg, m) => {
  if (!isAdmin(msg.from)) return;
  const txt  = m[1];
  const list = Object.values(data.users);
  const sm   = await bot.sendMessage(msg.chat.id, `⏳ ارسال به ${list.length} نفر...`);
  let ok2 = 0, bad = 0;
  for (const u of list) {
    try { await bot.sendMessage(u.id, `📢 پیام ادمین:\n\n${txt}`); ok2++; }
    catch { bad++; }
    await new Promise(r => setTimeout(r, 60));
  }
  bot.editMessageText(`✅ تموم!\n✔️ ${ok2} موفق\n❌ ${bad} ناموفق`,
    { chat_id: msg.chat.id, message_id: sm.message_id });
});

bot.onText(/\/setjoin (@?\S+)/, (msg, m) => {
  if (!isAdmin(msg.from)) return;
  const ch = m[1].startsWith("@") ? m[1] : "@" + m[1];
  data.forceCh = ch; save();
  bot.sendMessage(msg.chat.id, `✅ جوین اجباری: ${ch}`);
});

bot.onText(/\/removejoin/, (msg) => {
  if (!isAdmin(msg.from)) return;
  data.forceCh = null; save();
  bot.sendMessage(msg.chat.id, "✅ جوین اجباری حذف شد.");
});

bot.onText(/\/stats/, (msg) => {
  if (!isAdmin(msg.from)) return;
  bot.sendMessage(msg.chat.id,
    `📊 کاربران: ${Object.keys(data.users).length}\n🔒 جوین: ${data.forceCh || "ندارد"}`);
});

// ── messages ──────────────────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  const txt = msg.text;
  if (!txt || txt.startsWith("/")) return;
  addUser(msg.from);

  const n  = msg.from?.first_name || "دوست";
  const id = msg.from?.id;

  if (data.forceCh && id) {
    if (!(await inChannel(bot, id))) {
      const ch = data.forceCh.replace("@", "");
      return bot.sendMessage(msg.chat.id,
        `سلام ${n}! ⚠️ برای استفاده باید عضو کانال بشی:`,
        { reply_markup: { inline_keyboard: [[
          { text: "🔔 عضویت", url: `https://t.me/${ch}` },
          { text: "✅ عضو شدم", callback_data: `cj_${id}` }
        ]]}}
      );
    }
  }

  const url = getUrl(txt);
  if (!url || !isIG(url)) {
    return bot.sendMessage(msg.chat.id,
      `سلام ${n}! ❌ لینک اینستاگرام معتبر نیست.\nریلز یا پست عمومی بفرست.`
    );
  }

  bot.sendMessage(msg.chat.id, `${n} عزیز، چی دانلود کنم؟ 👇`, {
    reply_markup: { inline_keyboard: [[
      { text: "🎬 ویدیو / ریلز", callback_data: `v|${url}` },
      { text: "🎵 صدا MP3",       callback_data: `a|${url}` },
    ]]}
  });
});

// ── callbacks ─────────────────────────────────────────────────────────────────
bot.on("callback_query", async (q) => {
  const cid  = q.message?.chat.id;
  const mid  = q.message?.message_id;
  const from = q.from;
  const d    = q.data || "";
  if (!cid) return;
  bot.answerCallbackQuery(q.id).catch(() => {});

  if (d === "A_st") {
    return bot.sendMessage(cid, `📊 کاربران: ${Object.keys(data.users).length}\n🔒 جوین: ${data.forceCh || "ندارد"}`);
  }
  if (d === "A_rj") {
    if (!isAdmin(from)) return;
    data.forceCh = null; save();
    return bot.sendMessage(cid, "✅ جوین اجباری حذف شد.");
  }
  if (d === "A_bc") return bot.sendMessage(cid, "📢 دستور:\n/broadcast متن پیامت");
  if (d === "A_sj") return bot.sendMessage(cid, "🔒 دستور:\n/setjoin @channel");

  if (d.startsWith("cj_")) {
    const uid = parseInt(d.slice(3));
    const ok2 = await inChannel(bot, uid);
    const n   = from.first_name || "دوست";
    return bot.sendMessage(cid, ok2 ? `✅ ${n} تأیید شد! لینک بفرست.` : "❌ هنوز عضو نشدی.");
  }

  if (!d.includes("|")) return;
  const pipe = d.indexOf("|");
  const type = d.slice(0, pipe);
  const url  = d.slice(pipe + 1);

  await bot.editMessageText("⏳ دانلود در حال انجام...", { chat_id: cid, message_id: mid });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ig-"));

  try {
    if (type === "v") {
      await download(url, path.join(tmp, "v.%(ext)s"), [
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
      ]);
      let vf = fs.readdirSync(tmp).find(f => f.startsWith("v."));
      if (!vf) throw new Error("فایل ویدیو پیدا نشد");
      let fp = path.join(tmp, vf);
      if (fs.statSync(fp).size > 50 * 1024 * 1024) {
        await bot.editMessageText("⚠️ بالای ۵۰MB، کیفیت پایین...", { chat_id: cid, message_id: mid });
        await download(url, path.join(tmp, "lo.%(ext)s"), ["-f", "worst[ext=mp4]/worst", "--merge-output-format", "mp4"]);
        const lf = fs.readdirSync(tmp).find(f => f.startsWith("lo."));
        if (!lf) throw new Error("فایل پیدا نشد");
        fp = path.join(tmp, lf);
      }
      await bot.sendVideo(cid, fp, { caption: `🎬 ویدیو / ریلز دانلود شد\nby ${BOT_USERNAME}` });

    } else if (type === "a") {
      await download(url, path.join(tmp, "a.%(ext)s"), ["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
      const af = fs.readdirSync(tmp).find(f => f.startsWith("a."));
      if (!af) throw new Error("فایل صدا پیدا نشد");
      await bot.sendAudio(cid, path.join(tmp, af), { caption: `🎵 صدا دانلود شد\nby ${BOT_USERNAME}` });
    }

    bot.deleteMessage(cid, mid).catch(() => {});
  } catch (err) {
    const msg2 = (err.message.includes("Login") || err.message.includes("login"))
      ? "❌ ویدیو خصوصیه. فقط پست‌های عمومی کار می‌کنن."
      : `❌ خطا:\n${err.message.slice(0, 300)}`;
    bot.editMessageText(msg2, { chat_id: cid, message_id: mid }).catch(() => bot.sendMessage(cid, msg2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

bot.on("polling_error", (err) => console.error("poll:", err.code, err.message?.slice(0, 80)));
