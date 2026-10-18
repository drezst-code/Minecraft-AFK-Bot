'use strict';

const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const { createProxyMiddleware } = require('http-proxy-middleware');

// ===================== AYARLAR =====================
const PORT = Number(process.env.PORT || 10000);
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'MavenSecurePanel2026!K9x';
const MC_HOST = process.env.MC_HOST || 'maven.play.hosting';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const MC_VERSION = process.env.MC_VERSION || '1.21.1';

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
    console.log('BOT_CONFIGS_JSON bulunamadı → varsayılan botlar kullanılıyor.');
  }
  if (!Array.isArray(BOT_CONFIGS) || BOT_CONFIGS.length === 0) throw new Error('Bot listesi boş');
} catch (err) {
  console.error('Bot ayarları hatası:', err.message);
  process.exit(1);
}

console.log(`Panel şifresi: ${PANEL_PASSWORD}`);

// ===================== WEB SERVER =====================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const activeBots = new Map();
const viewerProxies = new Map();

function validBot(username) {
  return BOT_CONFIGS.find(cfg => cfg.username === username);
}
function getState(username) {
  const s = activeBots.get(username);
  return s && s.bot && s.connected ? s : null;
}
function passwordFromRequest(req) {
  return req.headers['x-panel-password'] || req.query?.panelPassword || '';
}
function requirePassword(req, res, next) {
  if (passwordFromRequest(req) === PANEL_PASSWORD) return next();
  res.status(401).send('Panel şifresi yanlış.');
}

app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/bot/:username', (req, res) => {
  if (!validBot(req.params.username)) return res.status(404).send('Bot bulunamadı');
  res.sendFile(path.join(__dirname, 'public', 'bot.html'));
});

app.get('/api/bots', requirePassword, (_req, res) => {
  res.json(BOT_CONFIGS.map(cfg => {
    const s = activeBots.get(cfg.username);
    return { username: cfg.username, connected: !!(s && s.connected) };
  }));
});

// Viewer proxy ayarları
BOT_CONFIGS.forEach((cfg, index) => {
  const viewerPort = 3100 + index;
  const proxy = createProxyMiddleware({
    target: `http://127.0.0.1:${viewerPort}`,
    changeOrigin: true,
    ws: true,
    pathRewrite: p => p.replace(new RegExp(`^/view/${cfg.username}`), '') || '/',
    on: {
      error: (_err, _req, res) => {
        if (res && !res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end('3D görüntü henüz hazır değil');
        }
      }
    }
  });
  viewerProxies.set(cfg.username, proxy);
  app.use(`/view/${cfg.username}`, (req, res, next) => {
    if (passwordFromRequest(req) !== PANEL_PASSWORD) return res.status(401).send('Giriş yap');
    proxy(req, res, next);
  });
});

// Socket.IO
io.use((socket, next) => {
  if (socket.handshake.auth?.password === PANEL_PASSWORD) return next();
  next(new Error('Panel şifresi yanlış'));
});

io.on('connection', socket => {
  socket.emit('bot-list', BOT_CONFIGS.map(cfg => ({
    username: cfg.username,
    connected: !!(activeBots.get(cfg.username)?.connected)
  })));

  socket.on('select-bot', username => {
    if (!validBot(username)) return;
    BOT_CONFIGS.forEach(cfg => socket.leave(`bot:${cfg.username}`));
    socket.join(`bot:${username}`);
    const s = activeBots.get(username);
    socket.emit('bot-status', { username, connected: !!(s?.connected) });
  });

  socket.on('command', data => {
    if (!data || !validBot(data.botName) || typeof data.text !== 'string') return;
    const text = data.text.trim();
    if (!text || text.length > 256) return;
    const state = getState(data.botName);
    if (!state) return socket.emit('notice', 'Bot bağlı değil');
    state.bot.chat(text);
  });

  socket.on('move', data => {
    if (!data || !validBot(data.botName) || typeof data.controls !== 'object') return;
    const state = getState(data.botName);
    if (!state) return;
    ['forward','back','left','right','jump','sprint','sneak'].forEach(k => {
      state.bot.setControlState(k, data.controls[k] === true);
    });
  });

  socket.on('look', data => {
    if (!data || !validBot(data.botName)) return;
    const state = getState(data.botName);
    if (!state) return;
    const yaw = Number(data.yaw), pitch = Number(data.pitch);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    state.bot.look(yaw, Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch)), true).catch(() => {});
  });
});

server.on('upgrade', (req, socket, head) => {
  const m = req.url?.match(/^\/view\/([A-Za-z0-9_]{3,16})/);
  if (!m) return socket.destroy();
  const username = m[1]; // Eski koddaki kritik yönlendirme hatası düzeltildi
  if (!validBot(username)) return socket.destroy();
  const url = new URL(req.url, 'http://x');
  if (url.searchParams.get('panelPassword') !== PANEL_PASSWORD) return socket.destroy();
  const proxy = viewerProxies.get(username);
  if (!proxy) return socket.destroy();
  req.url = req.url.replace(`/view/${username}`, '') || '/';
  try { proxy.upgrade(req, socket, head); } catch { socket.destroy(); }
});

// ===================== NUEKKIS AFK & FARM ENTEGRASYONU =====================
function startNuekkisLoop(bot) {
  // 1. Döngü: Klasik Nuekkis Wiggle (Rastgele Hareketler)
  const afkInterval = setInterval(() => {
    if (!bot || !bot.entity) return;

    bot.setControlState('jump', Math.random() > 0.5);
    bot.setControlState('sneak', Math.random() > 0.6);
    
    const yaw = (Math.random() - 0.5) * Math.PI;
    const pitch = (Math.random() - 0.5) * (Math.PI / 2);
    bot.look(yaw, pitch, false).catch(() => {});

    setTimeout(() => {
      if (bot.entity) {
        bot.setControlState('jump', false);
        bot.setControlState('sneak', false);
      }
    }, 1000);
  }, 6000);

  // 2. Döngü: Otomatik Sol Tık / Kazma Döngüsü
  const farmInterval = setInterval(() => {
    if (!bot || !bot.entity) return;

    const block = bot.blockAtCursor(4); 
    if (block && block.type !== 0) {
      bot.dig(block, true).catch(() => {});
    } else {
      bot.swingArm();
    }
  }, 1200);

  bot.once('end', () => {
    clearInterval(afkInterval);
    clearInterval(farmInterval);
  });
}

// ===================== BOT YÖNETİMİ =====================
function scheduleReconnect(cfg) {
  const cur = activeBots.get(cfg.username);
  if (cur?.reconnectTimer) return;
  const t = setTimeout(() => {
    if (!activeBots.get(cfg.username)?.bot) startBot(cfg);
  }, 12000);
  if (cur) cur.reconnectTimer = t;
  else activeBots.set(cfg.username, { bot: null, connected: false, reconnectTimer: t, viewerStarted: false });
}

function startBot(cfg, delay = 0) {
  setTimeout(() => {
    if (activeBots.get(cfg.username)?.bot) return;
    console.log(`[${cfg.username}] bağlanıyor...`);

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
      console.error(`[${cfg.username}] ${e.message}`);
      scheduleReconnect(cfg);
      return;
    }

    const state = { bot, connected: false, reconnectTimer: null, viewerStarted: false };
    activeBots.set(cfg.username, state);

    bot.once('spawn', () => {
      state.connected = true;
      io.emit('bot-status', { username: cfg.username, connected: true });
      console.log(`[${cfg.username}] spawn oldu`);

      setTimeout(() => {
        if (activeBots.get(cfg.username) === state) {
          bot.chat(`/login ${cfg.password}`);
          console.log(`[${cfg.username}] /login gönderildi`);
          startNuekkisLoop(bot);
        }
      }, 1800);

      if (!state.viewerStarted) {
        const idx = BOT_CONFIGS.findIndex(c => c.username === cfg.username);
        try {
          mineflayerViewer(bot, { port: 3100 + idx, firstPerson: false, viewDistance: 4 });
          state.viewerStarted = true;
          console.log(`[${cfg.username}] viewer açıldı`);
        } catch (e) {
          console.error(`[${cfg.username}] viewer hata: ${e.message}`);
        }
      }
    });

    bot.on('message', msg => {
      io.to(`bot:${cfg.username}`).emit('log', { text: msg.toString() });
    });

    bot.on('end', () => {
      state.connected = false;
      if (activeBots.get(cfg.username) === state) activeBots.delete(cfg.username);
      io.emit('bot-status', { username: cfg.username, connected: false });
      scheduleReconnect(cfg);
    });

    bot.on('error', err => console.error(`[${cfg.username}] ${err.message}`));
  }, delay);
}

// ===================== BAŞLAT =====================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Panel hazır → port ${PORT}`);
  BOT_CONFIGS.forEach((cfg, i) => startBot(cfg, i * 3500));
});

process.on('SIGTERM', () => {
  for (const s of activeBots.values()) {
    if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
    try { s.bot?.quit(); } catch {}
  }
  process.exit(0);
});
