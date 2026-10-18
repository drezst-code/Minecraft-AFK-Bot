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
const VURMA_SANIYESI = 1; 

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
  }
  else if (AKTIF_MOD === 'freeze') {
    bot.clearControlStates();
    
    const freezeLoop = setInterval(() => {
      if (!bot.entity) return;
      bot.setControlState('jump', true);
      setTimeout(() => { if (bot.entity) bot.setControlState('jump', false); }, 400);
    }, 10 * 60 * 1000);

    loops.push(freezeLoop);
  }

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
    if (activeBots.has(cfg.username)) return;
    console.log(`[${cfg.username}] Minecraft sunucusuna bağlanıyor...`);

    let bot;
    try {
      bot = mineflayer.createBot({
        host: MC_HOST,
        port: MC_PORT,
        username: cfg.username,
        version: MC_VERSION,
        auth: 'offline',
        hideErrors: true // DÜZELTME: VarInt/SlotComponent tipi paket hatalarında botun çökmesini engeller
      });
    } catch (e) {
      console.error(`[${cfg.username}] Bağlantı hatası: ${e.message}`);
      scheduleReconnect(cfg);
      return;
    }

    activeBots.set(cfg.username, bot);

    bot.once('spawn', () => {
      console.log(`[${cfg.username}] Sunucuya başarıyla giriş yaptı!`);

      // DÜZELTME: Slaş işaretinin yutulmaması için komut doğrudan sunucu paket kanalına yazdırılıyor
      setTimeout(() => {
        if (bot._client && bot._client.write) {
          bot._client.write('chat', { message: `/login ${cfg.password}` });
          console.log(`[${cfg.username}] Güvenli Giriş komutu (/login) paket olarak gönderildi.`);
          startBotBehavior(bot);
        }
      }, 2500);
    });

    bot.on('message', msg => {
      console.log(`[${cfg.username} SOHBET]: ${msg.toString()}`);
    });

    // DÜZELTME: Beklenmedik paket veya protokol hatalarında tüm projenin çökmesini önler
    bot.on('error', err => {
      console.error(`[${cfg.username}] Protokol/Hata Yakalandı: ${err.message}`);
    });

    bot.on('end', () => {
      console.log(`[${cfg.username}] Sunucudan düştü. 12 saniye sonra tekrar denenecek...`);
      activeBots.delete(cfg.username);
      scheduleReconnect(cfg);
    });
  }, delay);
}

console.log('Maven Arka Plan AFK Sistemi başlatılıyor...');
BOT_CONFIGS.forEach((cfg, i) => startBot(cfg, i * 4000));
