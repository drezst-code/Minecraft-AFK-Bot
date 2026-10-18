
require('dotenv').config();

const path = require('path');
const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false }
});

const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.MC_HOST || 'maven.play.hosting';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const MC_VERSION = process.env.MC_VERSION || '1.21.1';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || '';

if (PANEL_PASSWORD.length < 6) {
  console.error('HATA: Render Environment bölümünde PANEL_PASSWORD ayarla (en az 6 karakter).');
  process.exit(1);
}

let botConfigs;

try {
  botConfigs = JSON.parse(process.env.BOT_CONFIGS_JSON || '[]');
} catch {
  console.error('HATA: BOT_CONFIGS_JSON geçerli JSON değil.');
  process.exit(1);
}

if (!Array.isArray(botConfigs) || botConfigs.length !== 5) {
  console.error('HATA: BOT_CONFIGS_JSON içinde tam olarak 5 bot olmalı.');
  process.exit(1);
}

for (const cfg of botConfigs) {
  if (
    typeof cfg.username !== 'string' ||
    !/^[A-Za-z0-9_]{3,16}$/.test(cfg.username) ||
    typeof cfg.password !== 'string' ||
    !cfg.password.length
  ) {
    console.error('HATA: Her bot için geçerli username ve password gerekli.');
    process.exit(1);
  }
}

if (new Set(botConfigs.map(c => c.username.toLowerCase())).size !== 5) {
  console.error('HATA: Bot kullanıcı adları birbirinden farklı olmalı.');
  process.exit(1);
}

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/healthz', (_req, res) => {
  res.status(200).send('ok');
});

const sessions = new Map();
const viewerProxies = [];

function safeName(name) {
  return typeof name === 'string' &&
    botConfigs.some(c => c.username === name);
}

function logBot(username, message, type = 'system') {
  const entry = {
    text: `[${new Date().toLocaleTimeString()}] ${message}`,
    type
  };

  console.log(`[${username}] ${message}`);
  io.to(`bot:${username}`).emit('log', entry);
}

function clearControls(bot) {
  if (!bot) return;

  for (const key of [
    'forward', 'back', 'left', 'right',
    'jump', 'sprint', 'sneak'
  ]) {
    try {
      bot.setControlState(key, false);
    } catch {}
  }
}

function startBot(cfg, delay = 0) {
  setTimeout(() => {
    const existing = sessions.get(cfg.username);

    if (existing && existing.bot) return;

    logBot(cfg.username, `Sunucuya bağlanılıyor: ${HOST}:${MC_PORT}`);

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
      scheduleReconnect(cfg);
      return;
    }

    const state = {
      bot,
      connected: false,
      viewerStarted: false,
      reconnectTimer: null
    };

    sessions.set(cfg.username, state);

    bot.once('spawn', () => {
      state.connected = true;
      logBot(cfg.username, 'Bot sunucuya bağlandı.');

      setTimeout(() => {
        if (
          sessions.get(cfg.username) === state &&
          bot.player
        ) {
          bot.chat(`/login ${cfg.password}`);
          logBot(cfg.username, 'Sunucu giriş komutu gönderildi.');
        }
      }, 2500);

      if (!state.viewerStarted) {
        const index = botConfigs.findIndex(
          c => c.username === cfg.username
        );

        try {
          mineflayerViewer(bot, {
            port: 3100 + index,
            firstPerson: false,
            viewDistance: 5
          });

          state.viewerStarted = true;
          logBot(cfg.username, 'Dünya görüntüsü başlatıldı.');
        } catch (err) {
          logBot(
            cfg.username,
            `Görüntü başlatılamadı: ${err.message}`,
            'error'
          );
        }
      }
    });

    bot.on('chat', (sender, message) => {
      if (sender !== cfg.username) {
        logBot(cfg.username, `<${sender}> ${message}`, 'chat');
      }
    });

    bot.on('message', jsonMsg => {
      const message = jsonMsg.toString();

      if (message) {
        logBot(cfg.username, message, 'chat');
      }
    });

    bot.on('kicked', reason => {
      logBot(cfg.username, `Sunucudan atıldı: ${String(reason)}`, 'error');
    });

    bot.on('error', err => {
      logBot(cfg.username, `Bağlantı hatası: ${err.message}`, 'error');
    });

    bot.on('end', reason => {
      state.connected = false;
      clearControls(bot);

      logBot(
        cfg.username,
        `Bağlantı kesildi: ${String(reason || 'bilinmeyen neden')}`,
        'error'
      );

      if (sessions.get(cfg.username) === state) {
        sessions.delete(cfg.username);
        scheduleReconnect(cfg);
      }
    });
  }, delay);
}

function scheduleReconnect(cfg) {
  const existing = sessions.get(cfg.username);

  if (existing && existing.reconnectTimer) return;

  const timer = setTimeout(() => {
    const current = sessions.get(cfg.username);

    if (!current || !current.bot) {
      startBot(cfg);
    }
  }, 20000);

  if (existing) {
    existing.reconnectTimer = timer;
  } else {
    sessions.set(cfg.username, {
      bot: null,
      connected: false,
      viewerStarted: false,
      reconnectTimer: timer
    });
  }
}

// Her botun görüntüsünü kendi dahili portuna yönlendir.
botConfigs.forEach((cfg, index) => {
  const viewerPort = 3100 + index;

  const proxy = createProxyMiddleware({
    target: `http://127.0.0.1:${viewerPort}`,
    changeOrigin: true,
    ws: true,
    pathRewrite: path =>
      path.replace(new RegExp(`^/view/${cfg.username}`), ''),
    on: {
      error: (_err, _req, res) => {
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.writeHead(503, {
            'Content-Type': 'text/plain; charset=utf-8'
          });
          res.end('Bot görüntüsü henüz hazır değil.');
        }
      }
    }
  });

  app.use(`/view/${cfg.username}`, proxy);
  viewerProxies.push(proxy);
});

// Panel giriş kontrolü.
io.use((socket, next) => {
  const supplied = socket.handshake.auth?.password;

  if (
    typeof supplied === 'string' &&
    supplied === PANEL_PASSWORD
  ) {
    return next();
  }

  next(new Error('Panel şifresi yanlış.'));
});

io.on('connection', socket => {
  socket.emit('bot-list', botConfigs.map(cfg => {
    const state = sessions.get(cfg.username);

    return {
      username: cfg.username,
      connected: !!(state && state.connected)
    };
  }));

  socket.on('select-bot', username => {
    if (!safeName(username)) return;

    for (const cfg of botConfigs) {
      socket.leave(`bot:${cfg.username}`);
    }

    socket.join(`bot:${username}`);

    const state = sessions.get(username);

    socket.emit('bot-status', {
      username,
      connected: !!(state && state.connected)
    });
  });

  socket.on('command', payload => {
    if (
      !payload ||
      !safeName(payload.botName) ||
      typeof payload.text !== 'string'
    ) return;

    const command = payload.text.trim();

    if (
      !command ||
      command.length > 256 ||
      /[\r\n]/.test(command)
    ) return;

    const state = sessions.get(payload.botName);

    if (!state?.bot || !state.connected) {
      socket.emit('notice', 'Bot bağlı değil.');
      return;
    }

    state.bot.chat(command);
    logBot(payload.botName, 'Panelden komut gönderildi.');
  });

  socket.on('move', payload => {
    if (
      !payload ||
      !safeName(payload.botName) ||
      !payload.controls ||
      typeof payload.controls !== 'object'
    ) return;

    const state = sessions.get(payload.botName);

    if (!state?.bot || !state.connected) return;

    const allowed = [
      'forward', 'back', 'left', 'right',
      'jump', 'sprint', 'sneak'
    ];

    for (const key of allowed) {
      state.bot.setControlState(
        key,
        payload.controls[key] === true
      );
    }
  });

  socket.on('look', payload => {
    if (!payload || !safeName(payload.botName)) return;

    const state = sessions.get(payload.botName);

    if (!state?.bot || !state.connected) return;

    const yaw = Number(payload.yaw);
    const pitch = Number(payload.pitch);

    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;

    const safePitch = Math.max(
      -Math.PI / 2,
      Math.min(Math.PI / 2, pitch)
    );

    state.bot.look(yaw, safePitch, true).catch(() => {});
  });
});

server.on('upgrade', (req, socket, head) => {
  const match = req.url?.match(
    /^\/view\/([A-Za-z0-9_]{3,16})(?:\/|$)/
  );

  if (!match) return;

  const index = botConfigs.findIndex(
    cfg => cfg.username === match[1]
  );

  if (index < 0) return;

  try {
    viewerProxies[index]?.upgrade(req, socket, head);
  } catch {
    socket.destroy();
  }
});

function shutdown() {
  console.log('Sunucu kapanıyor...');

  for (const state of sessions.values()) {
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    clearControls(state.bot);

    try {
      state.bot?.quit('Sunucu kapanıyor');
    } catch {}
  }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Web paneli ${PORT} portunda hazır.`);

  botConfigs.forEach((cfg, index) => {
    startBot(cfg, index * 5000);
  });
});
