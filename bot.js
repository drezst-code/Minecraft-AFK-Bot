require('dotenv').config();

const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.MC_HOST || 'maven.play.hosting';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const MC_VERSION = process.env.MC_VERSION || '1.21.1';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;

if (!PANEL_PASSWORD || PANEL_PASSWORD.length < 6) {
  console.error('PANEL_PASSWORD ortam değişkenini en az 6 karakter olarak ayarla.');
  process.exit(1);
}

let botConfigs;
try {
  botConfigs = JSON.parse(process.env.BOT_CONFIGS_JSON || '[]');
} catch {
  console.error('BOT_CONFIGS_JSON geçerli JSON değil.');
  process.exit(1);
}
if (!Array.isArray(botConfigs) || botConfigs.length !== 5) {
  console.error('BOT_CONFIGS_JSON içinde tam olarak 5 bot tanımlamalısın.');
  process.exit(1);
}
for (const cfg of botConfigs) {
  if (!cfg.username || !cfg.password || !/^[A-Za-z0-9_]{3,16}$/.test(cfg.username)) {
    console.error('Her botta geçerli username ve password olmalı.');
    process.exit(1);
  }
}

app.use(express.static('public', { index: false }));

// Simple password gate for the control panel and all Socket.IO actions.
app.get('/', (req, res) => res.sendFile(require('path').join(__dirname, 'public', 'index.html')));
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

const sessions = new Map();
const viewerProxies = [];

function safeName(name) {
  return botConfigs.some(c => c.username === name);
}

function logBot(username, text, type = 'system') {
  const entry = { text: `[${new Date().toLocaleTimeString()}] ${text}`, type };
  console.log(`[${username}] ${text}`);
  io.to(`bot:${username}`).emit('log', entry);
}

function clearControls(bot) {
  if (!bot) return;
  for (const key of ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']) {
    try { bot.setControlState(key, false); } catch {}
  }
}

function startBot(cfg, delay = 0) {
  setTimeout(() => {
    if (sessions.has(cfg.username) && sessions.get(cfg.username).bot) return;
    logBot(cfg.username, `Minecraft sunucusuna bağlanılıyor (${MC_VERSION})...`);
    let bot;
    try {
      bot = mineflayer.createBot({
        host: HOST,
        port: MC_PORT,
        username: cfg.username,
        version: MC_VERSION,
        auth: 'offline',
        hideErrors: false
      });
    } catch (err) {
      logBot(cfg.username, `Bot başlatılamadı: ${err.message}`, 'error');
      return;
    }

    const state = { bot, connected: false, viewerStarted: false, reconnectTimer: null };
    sessions.set(cfg.username, state);

    bot.once('spawn', () => {
      state.connected = true;
      logBot(cfg.username, 'Sunucuya bağlandı ve dünyada doğdu.');
      setTimeout(() => {
        if (bot.player) {
          bot.chat(`/login ${cfg.password}`);
          logBot(cfg.username, 'Giriş komutu gönderildi.');
        }
      }, 2500);

      // Each viewer has an internal port; Express proxies it through the single Render public port.
      if (!state.viewerStarted) {
        state.viewerStarted = true;
        const viewerPort = 3100 + botConfigs.findIndex(c => c.username === cfg.username);
        try {
          mineflayerViewer(bot, {
            port: viewerPort,
            firstPerson: false,
            viewDistance: 5
          });
          logBot(cfg.username, `Dünya görüntüsü hazır (viewer port ${viewerPort}).`);
        } catch (err) {
          logBot(cfg.username, `Görüntüleyici başlatılamadı: ${err.message}`, 'error');
        }
      }
    });

    bot.on('chat', (sender, message) => {
      if (sender !== cfg.username) logBot(cfg.username, `<${sender}> ${message}`, 'chat');
    });

    bot.on('message', (jsonMsg) => {
      const text = jsonMsg.toString();
      if (text && !text.includes(cfg.username)) logBot(cfg.username, text, 'chat');
    });

    bot.on('kicked', reason => logBot(cfg.username, `Sunucudan atıldı: ${String(reason)}`, 'error'));
    bot.on('error', err => logBot(cfg.username, `Bağlantı hatası: ${err.message}`, 'error'));

    bot.on('end', reason => {
      state.connected = false;
      clearControls(bot);
      logBot(cfg.username, `Bağlantı kesildi: ${String(reason || 'bilinmeyen neden')}. 20 saniye sonra yeniden denenecek.`);
      if (sessions.get(cfg.username) === state) sessions.delete(cfg.username);
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      state.reconnectTimer = setTimeout(() => startBot(cfg, 0), 20000);
    });
  }, delay);
}

// Reverse proxy: Render exposes only the PORT assigned to this web service.
botConfigs.forEach((cfg, index) => {
  const viewerPort = 3100 + index;
  const proxy = createProxyMiddleware({
    target: `http://127.0.0.1:${viewerPort}`,
    changeOrigin: true,
    ws: true,
    pathRewrite: path => path.replace(new RegExp(`^/view/${cfg.username}`), ''),
    on: {
      error: (_err, _req, res) => {
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Bu botun görüntüsü henüz hazır değil. Botun sunucuya bağlanmasını bekle.');
        }
      }
    }
  });
  app.use(`/view/${cfg.username}`, proxy);
  viewerProxies.push(proxy);
});

// Login is handled by Socket.IO so the panel itself never contains a secret.
io.use((socket, next) => {
  const supplied = socket.handshake.auth && socket.handshake.auth.password;
  if (supplied && supplied === PANEL_PASSWORD) return next();
  next(new Error('Panel şifresi yanlış.'));
});

io.on('connection', socket => {
  socket.emit('bot-list', botConfigs.map(c => {
    const state = sessions.get(c.username);
    return { username: c.username, connected: !!(state && state.connected) };
  }));

  socket.on('select-bot', username => {
    if (!safeName(username)) return;
    for (const cfg of botConfigs) socket.leave(`bot:${cfg.username}`);
    socket.join(`bot:${username}`);
    const state = sessions.get(username);
    socket.emit('bot-status', { username, connected: !!(state && state.connected) });
  });

  socket.on('command', payload => {
    if (!payload || !safeName(payload.botName) || typeof payload.text !== 'string') return;
    const text = payload.text.trim();
    if (!text || text.length > 256 || /[\r\n]/.test(text)) return;
    const state = sessions.get(payload.botName);
    if (!state || !state.bot || !state.connected) {
      socket.emit('notice', 'Bot bağlı değil; komut gönderilemedi.');
      return;
    }
    state.bot.chat(text);
    logBot(payload.botName, `Panelden gönderildi: ${text}`);
  });

  socket.on('move', payload => {
    if (!payload || !safeName(payload.botName) || !payload.controls || typeof payload.controls !== 'object') return;
    const state = sessions.get(payload.botName);
    if (!state || !state.bot || !state.connected) return;
    const allowed = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];
    for (const key of allowed) {
      state.bot.setControlState(key, payload.controls[key] === true);
    }
  });

  socket.on('look', payload => {
    if (!payload || !safeName(payload.botName)) return;
    const state = sessions.get(payload.botName);
    if (!state || !state.bot || !state.connected) return;
    const yaw = Number(payload.yaw);
    const pitch = Number(payload.pitch);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    const safePitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    state.bot.look(yaw, safePitch, true).catch(() => {});
  });

  socket.on('disconnect', () => {});
});

server.on('upgrade', (req, socket, head) => {
  // Route each viewer WebSocket upgrade only to its matching bot viewer.
  const match = req.url && req.url.match(/^\/view\/([A-Za-z0-9_]{3,16})(?:\/|$)/);
  if (!match) return;
  const index = botConfigs.findIndex(c => c.username === match[1]);
  if (index < 0) return;
  const proxy = viewerProxies[index];
  try { if (proxy && proxy.upgrade) proxy.upgrade(req, socket, head); }
  catch { try { socket.destroy(); } catch {} }
});

process.on('SIGTERM', () => {
  console.log('SIGTERM alındı; botlar kapatılıyor...');
  for (const state of sessions.values()) {
    clearControls(state.bot);
    try { state.bot.quit('Server kapanıyor'); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Web paneli PORT ${PORT} üzerinde hazır.`);
  botConfigs.forEach((cfg, index) => startBot(cfg, index * 5000));
});
