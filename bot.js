const { Telegraf, Markup } = require("telegraf");
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
let db = { users: {}, forceCh: null };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch {}
const save    = () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db)); } catch {} };
const addUser = (ctx) => {
  const f = ctx.from;
  if (!f) return;
  db.users[String(f.id)] = { id: f.id, name: f.first_name || "", un: f.username || "" };
  save();
};

// ── util ──────────────────────────────────────────────────────────────────────
const IG      = /https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv|stories)\/[^\s]+/i;
const getUrl  = (t) => { const m = String(t).match(/https?:\/\/[^\s]+/); return m ? m[0] : null; };
const isIG    = (u) => IG.test(u);
const isAdmin = (ctx) => ctx.from?.username?.toLowerCase() === ADMIN_USER.toLowerCase();

function download(url, tpl, extra = []) {
  return new Promise((ok, fail) => {
    execFile("yt-dlp",
      ["--no-playlist", "--no-warnings", "-o", tpl, ...extra, url],
      { timeout: 120000 },
      (err, _, stderr) => err ? fail(new Error(stderr || err.message)) : ok()
    );
  });
}

async function inCh(bot, uid) {
  if (!db.forceCh) return true;
  try {
    const r = await bot.telegram.getChatMember(db.forceCh, uid);
    return ["member","administrator","creator"].includes(r.status);
  } catch { return true; }
}

// ── health ────────────────────────────────────────────────────────────────────
http.createServer((_, res) => { res.writeHead(200); res.end("ok"); }).listen(PORT);

// ── bot ───────────────────────────────────────────────────────────────────────
const bot = new Telegraf(TOKEN);

// ── /start ────────────────────────────────────────────────────────────────────
bot.start((ctx) => {
  addUser(ctx);
  const n = ctx.from?.first_name || "دوست";
  ctx.reply(
    `سلام ${n}! 👋\n\nربات دانلود اینستاگرام 🤖\n\n🎬 ویدیو و ریلز\n🎵 موزیک و صدا\n\nلینک پست یا ریلز عمومی اینستاگرام رو بفرست!`
  );
});

// ── /admin ────────────────────────────────────────────────────────────────────
bot.command("admin", (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("❌ دسترسی ندارید.");
  const cnt = Object.keys(db.users).length;
  ctx.reply(
    `👑 پنل ادمین — @${ADMIN_USER}\n👤 کاربران: ${cnt}\n🔒 جوین اجباری: ${db.forceCh || "ندارد"}`,
    Markup.inlineKeyboard([
      [Markup.button.callback("📢 پیام همگانی", "A_bc")],
      [Markup.button.callback("🔒 تنظیم جوین", "A_sj"), Markup.button.callback("❌ حذف جوین", "A_rj")],
      [Markup.button.callback("📊 آمار", "A_st")],
    ])
  );
});

// ── /broadcast ────────────────────────────────────────────────────────────────
bot.command("broadcast", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const txt  = ctx.message.text.replace(/^\/broadcast\s*/i, "").trim();
  if (!txt)  return ctx.reply("متن پیام رو بعد از /broadcast بنویس.");
  const list = Object.values(db.users);
  const sm   = await ctx.reply(`⏳ ارسال به ${list.length} نفر...`);
  let ok2 = 0, bad = 0;
  for (const u of list) {
    try { await bot.telegram.sendMessage(u.id, `📢 پیام ادمین:\n\n${txt}`); ok2++; }
    catch { bad++; }
    await new Promise(r => setTimeout(r, 60));
  }
  bot.telegram.editMessageText(ctx.chat.id, sm.message_id, undefined,
    `✅ تموم!\n✔️ ${ok2} موفق\n❌ ${bad} ناموفق`).catch(() => {});
});

// ── /setjoin ──────────────────────────────────────────────────────────────────
bot.command("setjoin", (ctx) => {
  if (!isAdmin(ctx)) return;
  const ch = (ctx.message.text.split(" ")[1] || "").trim();
  if (!ch) return ctx.reply("مثال: /setjoin @channel_username");
  db.forceCh = ch.startsWith("@") ? ch : "@" + ch;
  save();
  ctx.reply(`✅ جوین اجباری: ${db.forceCh}`);
});

// ── /removejoin ───────────────────────────────────────────────────────────────
bot.command("removejoin", (ctx) => {
  if (!isAdmin(ctx)) return;
  db.forceCh = null; save();
  ctx.reply("✅ جوین اجباری حذف شد.");
});

// ── /stats ────────────────────────────────────────────────────────────────────
bot.command("stats", (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.reply(`📊 کاربران: ${Object.keys(db.users).length}\n🔒 جوین: ${db.forceCh || "ندارد"}`);
});

// ── admin callbacks ───────────────────────────────────────────────────────────
bot.action("A_st", (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(`📊 کاربران: ${Object.keys(db.users).length}\n🔒 جوین: ${db.forceCh || "ندارد"}`);
});
bot.action("A_rj", (ctx) => {
  ctx.answerCbQuery();
  if (!isAdmin(ctx)) return;
  db.forceCh = null; save();
  ctx.reply("✅ جوین اجباری حذف شد.");
});
bot.action("A_bc", (ctx) => { ctx.answerCbQuery(); ctx.reply("📢 دستور:\n/broadcast متن پیامت"); });
bot.action("A_sj", (ctx) => { ctx.answerCbQuery(); ctx.reply("🔒 دستور:\n/setjoin @channel"); });

// ── check join callback ───────────────────────────────────────────────────────
bot.action(/^cj_(\d+)$/, async (ctx) => {
  ctx.answerCbQuery();
  const uid  = parseInt(ctx.match[1]);
  const ok2  = await inCh(bot, uid);
  const name = ctx.from?.first_name || "دوست";
  ctx.reply(ok2 ? `✅ ${name} تأیید شد! حالا لینک بفرست.` : "❌ هنوز عضو نشدی. عضو بشو بعد بزن.");
});

// ── messages ──────────────────────────────────────────────────────────────────
bot.on("message", async (ctx) => {
  const txt = ctx.message?.text;
  if (!txt || txt.startsWith("/")) return;
  addUser(ctx);

  const name = ctx.from?.first_name || "دوست";
  const uid  = ctx.from?.id;

  if (db.forceCh && uid) {
    const ok2 = await inCh(bot, uid);
    if (!ok2) {
      const ch = db.forceCh.replace("@", "");
      return ctx.reply(
        `سلام ${name}! ⚠️ برای استفاده باید عضو کانال بشی:`,
        Markup.inlineKeyboard([
          [Markup.button.url("🔔 عضویت", `https://t.me/${ch}`),
           Markup.button.callback("✅ عضو شدم", `cj_${uid}`)],
        ])
      );
    }
  }

  const url = getUrl(txt);
  if (!url || !isIG(url)) {
    return ctx.reply(`سلام ${name}! ❌ لینک اینستاگرام معتبر نیست.\nریلز یا پست عمومی بفرست.`);
  }

  ctx.reply(`${name} عزیز، چی دانلود کنم؟ 👇`,
    Markup.inlineKeyboard([
      [Markup.button.callback("🎬 ویدیو / ریلز", `v|${url}`),
       Markup.button.callback("🎵 صدا MP3",       `a|${url}`)],
    ])
  );
});

// ── download callbacks ────────────────────────────────────────────────────────
bot.action(/^(v|a)\|(.+)$/, async (ctx) => {
  const type = ctx.match[1];
  const url  = ctx.match[2];
  const cid  = ctx.chat?.id;
  const mid  = ctx.callbackQuery?.message?.message_id;
  if (!cid) return;

  await ctx.answerCbQuery();
  await ctx.telegram.editMessageText(cid, mid, undefined, "⏳ دانلود در حال انجام...");
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
        await ctx.telegram.editMessageText(cid, mid, undefined, "⚠️ بالای ۵۰MB، کیفیت پایین...");
        await download(url, path.join(tmp, "lo.%(ext)s"), ["-f", "worst[ext=mp4]/worst", "--merge-output-format", "mp4"]);
        const lf = fs.readdirSync(tmp).find(f => f.startsWith("lo."));
        if (!lf) throw new Error("فایل پیدا نشد");
        fp = path.join(tmp, lf);
      }
      await ctx.telegram.sendVideo(cid, { source: fp }, { caption: `🎬 ویدیو / ریلز دانلود شد\nby ${BOT_USERNAME}` });

    } else {
      await download(url, path.join(tmp, "a.%(ext)s"), ["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
      const af = fs.readdirSync(tmp).find(f => f.startsWith("a."));
      if (!af) throw new Error("فایل صدا پیدا نشد");
      await ctx.telegram.sendAudio(cid, { source: path.join(tmp, af) }, { caption: `🎵 صدا دانلود شد\nby ${BOT_USERNAME}` });
    }

    ctx.telegram.deleteMessage(cid, mid).catch(() => {});
  } catch (err) {
    const msg2 = (err.message.includes("Login") || err.message.includes("login"))
      ? "❌ ویدیو خصوصیه. فقط پست‌های عمومی کار می‌کنن."
      : `❌ خطا:\n${err.message.slice(0, 300)}`;
    ctx.telegram.editMessageText(cid, mid, undefined, msg2).catch(() => ctx.reply(msg2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── launch ────────────────────────────────────────────────────────────────────
bot.launch({ dropPendingUpdates: true });
console.log(`🤖 ${BOT_USERNAME} started with Telegraf`);

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
