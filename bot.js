'use strict';

const mineflayer = require('mineflayer');

// ===================== AYARLAR =====================
const MC_HOST = process.env.MC_HOST || 'maven.play.hosting';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const MC_VERSION = process.env.MC_VERSION || '1.21.1';

// LÜTFEN MODUNUZU SEÇİN:
// 'just-jump' : Durduğu yerde zıplar ve sürekli önünü kazar / vurur (Rastgele tıklamaz!)
// 'freeze'    : Tamamen hareketsiz durur, kick yememek için 10 dakikada sadece 1 kez zıplar
const AKTIF_MOD = 'just-jump'; 
const VURMA_SANIYESI = 1; // 'just-jump' modundayken kaç saniyede bir vuracağını seçin

let BOT_CONFIGS = [];
try {
  if (process.env.BOT_CONFIGS_JSON) {
    BOT_CONFIGS = JSON.parse(process.env.BOT_CONFIGS_JSON);
  } else {
    BOT_CONFIGS = [
      { username: 'thetuffman', password: 'sigma12321' },
      { username: 'sigmaoyuncu', password: 'sigma12321' },
      { username: 'pikachufn', password: 'sigma12321' },
      { username: 'tr_tier1', password: 'sigma12321' },
      { username: 'smpseverrr', password: 'sigma12321' }
    ];
  }
} catch (err) {
  console.error('Bot ayarları hatası:', err.message);
  process.exit(1);
}

const activeBots = new Map();

// ===================== HAREKET VE BOT DÖNGÜLERİ =====================
function startBotBehavior(bot) {
  const loops = [];

  // MOD 1: Sadece Zıpla ve Belirttiğin Saniyede Bir Otomatik Vur
  if (AKTIF_MOD === 'just-jump') {
    bot.clearControlStates();
    
    // 6 saniyede bir kaybolmayan anti-afk zıplaması
    const jumpLoop = setInterval(() => {
      if (!bot.entity) return;
      bot.setControlState('jump', true);
      setTimeout(() => { if (bot.entity) bot.setControlState('jump', false); }, 400);
    }, 6000);

    // Ayarladığın saniyede bir önündeki bloğu kazma veya boşa sol tık vurma
    const attackLoop = setInterval(() => {
      if (!bot.entity) return;
      const block = bot.blockAtCursor(4);
      if (block && block.type !== 0) {
        bot.dig(block, true).catch(() => {});
      } else {
        bot.swingArm();
      }
    }, VURMA_SANIYESI * 1000);

    loops.push(jumpLoop, attackLoop);
    console.log(`[${bot.username}] 'just-jump' modu aktif edildi. Vurma süresi: ${VURMA_SANIYESI}sn.`);
  }

  // MOD 2: Dondur (10 dakikada sadece 1 kere zıplar - Sıfır hasar ve lag riski)
  else if (AKTIF_MOD === 'freeze') {
    bot.clearControlStates();
    
    const freezeLoop = setInterval(() => {
      if (!bot.entity) return;
      bot.setControlState('jump', true);
      setTimeout(() => { if (bot.entity) bot.setControlState('jump', false); }, 400);
      console.log(`[${bot.username}] Dondurma modunda anti-kick zıplaması yapıldı.`);
    }, 10 * 60 * 1000);

    loops.push(freezeLoop);
    console.log(`[${bot.username}] 'freeze' dondurma modu aktif edildi. 10 dakikada bir zıplayacak.`);
  }

  // Bot düşerse zamanlayıcıları temizle
  bot.once('end', () => {
    loops.forEach(l => clearInterval(l));
  });
}

// ===================== BOT YÖNETİMİ VE BAĞLANTI =====================
function scheduleReconnect(cfg) {
  setTimeout(() => {
    startBot(cfg);
  }, 12000);
}

function startBot(cfg, delay = 0) {
  setTimeout(() => {
    console.log(`[${cfg.username}] Minecraft sunucusuna bağlanıyor...`);

    let bot;
    try {
      bot = mineflayer.createBot({
        host: MC_HOST,
        port: MC_PORT,
        username: cfg.username,
        version: MC_VERSION,
        auth: 'offline'
      });
    } catch (e) {
      console.error(`[${cfg.username}] Bağlantı hatası: ${e.message}`);
      scheduleReconnect(cfg);
      return;
    }

    activeBots.set(cfg.username, bot);

    bot.once('spawn', () => {
      console.log(`[${cfg.username}] Sunucuya başarıyla giriş yaptı!`);

      // Şifre Giriş Mesajı
      setTimeout(() => {
        bot.chat(`/login ${cfg.password}`);
        console.log(`[${cfg.username}] Giriş komutu gönderildi.`);
        
        // Hareket modlarını başlat
        startBotBehavior(bot);
      }, 2000);
    });

    bot.on('message', msg => {
      // Sunucu içi sohbet mesajlarını Render log ekranına yazdırır
      console.log(`[${cfg.username} SOHBET]: ${msg.toString()}`);
    });

    bot.on('end', () => {
      console.log(`[${cfg.username}] Sunucudan düştü. 12 saniye sonra tekrar denenecek...`);
      activeBots.delete(cfg.username);
      scheduleReconnect(cfg);
    });

    bot.on('error', err => console.error(`[${cfg.username}] Hata: ${err.message}`));
  }, delay);
}

// Tüm botları sırayla başlat
console.log('Maven Arka Plan AFK Sistemi başlatılıyor...');
BOT_CONFIGS.forEach((cfg, i) => startBot(cfg, i * 4000));
