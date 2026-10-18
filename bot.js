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

// BOT_CONFIGS_JSON yoksa varsayılan (sen kendi hesaplarınla değiştir)
let BOT_CONFIGS = [];
try {
  if (process.env.BOT_CONFIGS_JSON) {
    BOT_CONFIGS = JSON.parse(process.env.BOT_CONFIGS_JSON);
  } else {
    // Varsayılan botlar (şifreleri kendin güncelle)
    BOT_CONFIGS = [
      { username: 'thetuffman', password: 'sigma12321' },
      { username: 'sigmaoyuncu', password: 'sigma12321' },
      { username: 'pikachufn', password: 'sigma12321' },
      { username: 'tr_tier1', password: 'sigma12321' },
      { username: 'smpseverrr', password: 'sigma12321' }
    ];
    console.log('BOT_CONFIGS_JSON bulunamadı, varsayılan botlar kullanılıyor. Environment Variables eklemen önerilir.');
  }

  if (!Array.isArray(BOT_CONFIGS) || BOT_CONFIGS.length === 0) {
    throw new Error('Bot listesi boş.');
  }
} catch (err) {
  console.error('Bot ayarları okunamadı:', err.message);
  process.exit(1);
}

if (PANEL_PASSWORD.length < 8) {
  console.error('PANEL_PASSWORD çok kısa.');
  process.exit(1);
}

// ===================== WEB SUNUCUSU =====================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const activeBots = new Map();
const viewerProxies = new Map();

function validBot(username) {
  return BOT_CONFIGS.find(cfg => cfg.username === username);
}

function getState(username) {
  const state = activeBots.get(username);
  return state && state.bot && state.connected ? state : null;
}

function passwordFromRequest(req) {
  const header = req.headers['x-panel-password'];
  const query = req.query?.panelPassword;
  return (typeof header === 'string' && header) || (typeof query === 'string' && query) || '';
}

function requirePassword(req, res, next) {
  if (passwordFromRequest(req) === PANEL_PASSWORD) return next();
  res.status(401).send('Panel şifresi yanlış.');
}

app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/bot/:username', (req, res) => {
  if (!validBot(req.params.username)) return res.status(404).send('Bot bulunamadı.');
  res.sendFile(path.join(__dirname, 'public', 'bot.html'));
});

app.get('/api/bots', requirePassword, (_req, res) => {
  res.json(BOT_CONFIGS.map(cfg => {
    const state = activeBots.get(cfg.username);
    return {
      username: cfg.username,
      connected: !!(state && state.connected)
    };
  }));
});

BOT_CONFIGS.forEach((cfg, index) => {
  const viewerPort = 3100 + index;
  const proxy = createProxyMiddleware({
    target: `http://127.0.0.1:${viewerPort}`,
    changeOrigin: true,
    ws: true,
    pathRewrite: (p) => p.replace(new RegExp(`^/view/${cfg.username}`), '') || '/',
    on: {
      error: (_err, _req, res) => {
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('3D görüntü henüz hazır değil.');
        }
      }
    }
  });
  viewerProxies.set(cfg.username, proxy);

  app.use(`/view/${cfg.username}`, (req, res, next) => {
    if (passwordFromRequest(req) !== PANEL_PASSWORD) {
      return res.status(401).send('Önce panel girişini yap.');
    }
    return proxy(req, res, next);
  });
});

// Socket.IO
io.use((socket, next) => {
  const supplied = socket.handshake.auth?.password;
  if (typeof supplied === 'string' && supplied === PANEL_PASSWORD) return next();
  next(new Error('Panel şifresi yanlış.'));
});

io.on('connection', (socket) => {
  socket.emit('bot-list', BOT_CONFIGS.map(cfg => {
    const state = activeBots.get(cfg.username);
    return { username: cfg.username, connected: !!(state && state.connected) };
  }));

  socket.on('select-bot', (username) => {
    if (!validBot(username)) return;
    for (const cfg of BOT_CONFIGS) socket.leave(`bot:${cfg.username}`);
    socket.join(`bot:${username}`);
    const state = activeBots.get(username);
    socket.emit('bot-status', { username, connected: !!(state && state.connected) });
  });

  socket.on('command', (data) => {
    if (!data || !validBot(data.botName) || typeof data.text !== 'string') return;
    const command = data.text.trim();
    if (!command || command.length > 256 || /[\r\n]/.test(command)) return;
    const state = getState(data.botName);
    if (!state) return socket.emit('notice', 'Bot bağlı değil.');
    state.bot.chat(command);
  });

  socket.on('move', (data) => {
    if (!data || !validBot(data.botName) || typeof data.controls !== 'object') return;
    const state = getState(data.botName);
    if (!state) return;
    ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].forEach(key => {
      state.bot.setControlState(key, data.controls[key] === true);
    });
  });

  socket.on('look', (data) => {
    if (!data || !validBot(data.botName)) return;
    const state = getState(data.botName);
    if (!state) return;
    const yaw = Number(data.yaw);
    const pitch = Number(data.pitch);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    state.bot.look(yaw, Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)), true).catch(() => {});
  });
});

server.on('upgrade', (req, socket, head) => {
  const match = req.url?.match(/^\/view\/([A-Za-z0-9_]{3,16})(?:\/|$)/);
  if (!match) return;
  const username = match[1];
  if (!validBot(username)) return socket.destroy();

  const parsed = new URL(req.url, 'http://localhost');
  if (parsed.searchParams.get('panelPassword') !== PANEL_PASSWORD) return socket.destroy();

  const proxy = viewerProxies.get(username);
  if (!proxy) return socket.destroy();

  req.url = req.url.replace(new RegExp(`^/view/${username}`), '') || '/';
  try { proxy.upgrade(req, socket, head); } catch { socket.destroy(); }
});

// Bot yönetimi
function scheduleReconnect(cfg) {
  const current = activeBots.get(cfg.username);
  if (current?.reconnectTimer) return;
  const timer = setTimeout(() => {
    const latest = activeBots.get(cfg.username);
    if (!latest || !latest.bot) startBot(cfg);
  }, 15000);
  if (current) current.reconnectTimer = timer;
  else activeBots.set(cfg.username, { bot: null, connected: false, reconnectTimer: timer, viewerStarted: false });
}

function startBot(cfg, delay = 0) {
  setTimeout(() => {
    if (activeBots.get(cfg.username)?.bot) return;
    console.log(`[${cfg.username}] Bağlanılıyor...`);

    let bot;
    try {
      bot = mineflayer.createBot({
        host: MC_HOST,
        port: MC_PORT,
        username: cfg.username,
        version: MC_VERSION,
        auth: 'offline'
      });
    } catch (err) {
      console.error(`[${cfg.username}] Hata: ${err.message}`);
      scheduleReconnect(cfg);
      return;
    }

    const state = { bot, connected: false, reconnectTimer: null, viewerStarted: false };
    activeBots.set(cfg.username, state);

    bot.once('spawn', () => {
      state.connected = true;
      io.emit('bot-status', { username: cfg.username, connected: true });
      console.log(`[${cfg.username}] Spawn oldu.`);

      setTimeout(() => {
        if (activeBots.get(cfg.username) === state && bot.player) {
          bot.chat(`/login ${cfg.password}`);
          console.log(`[${cfg.username}] /login gönderildi.`);
        }
      }, 2000);

      if (!state.viewerStarted) {
        const index = BOT_CONFIGS.findIndex(item => item.username === cfg.username);
        try {
          mineflayerViewer(bot, { port: 3100 + index, firstPerson: false, viewDistance: 4 });
          state.viewerStarted = true;
          console.log(`[${cfg.username}] Viewer başlatıldı.`);
        } catch (err) {
          console.error(`[${cfg.username}] Viewer hatası: ${err.message}`);
        }
      }
    });

    bot.on('message', (message) => {
      io.to(`bot:${cfg.username}`).emit('log', { text: message.toString() });
    });

    bot.on('end', () => {
      state.connected = false;
      if (activeBots.get(cfg.username) === state) activeBots.delete(cfg.username);
      io.emit('bot-status', { username: cfg.username, connected: false });
      scheduleReconnect(cfg);
    });

    bot.on('error', (err) => console.error(`[${cfg.username}] ${err.message}`));
  }, delay);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Panel ${PORT} portunda çalışıyor. Panel şifresi: ${PANEL_PASSWORD}`);
  BOT_CONFIGS.forEach((cfg, i) => startBot(cfg, i * 4000));
});

function shutdown() {
  for (const state of activeBots.values()) {
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    try { state.bot?.quit('Kapanıyor'); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
