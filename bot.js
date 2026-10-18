
const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const { createProxyMiddleware } = require('http-proxy-middleware');

// ==================================================
// AYARLAR
// ==================================================

const SERVER_HOST = 'maven.play.hosting';
const SERVER_PORT = 25565;
const MC_VERSION = '1.21.1';

// Web paneli giriş şifreni burada değiştir.
const PANEL_PASSWORD = 'BURAYA_GUCLU_PANEL_SIFRESI_YAZ';

// Bot isimleri ve sunucudaki /login şifreleri.
const BOT_CONFIGS = [
  { username: 'thetuffman', password: 'sigma12321' },
  { username: 'sigmaoyuncu', password: 'sigma12321' },
  { username: 'pikachufn', password: 'sigma12321' },
  { username: 'tr_tier1', password: 'sigma12321' },
  { username: 'smpseverrr', password: 'sigma12321' }
];

if (
  PANEL_PASSWORD.length < 6 ||
  PANEL_PASSWORD === 'BURAYA_GUCLU_PANEL_SIFRESI_YAZ'
) {
  console.error('Önce bot.js içindeki PANEL_PASSWORD değerini değiştir.');
  process.exit(1);
}

if (new Set(BOT_CONFIGS.map(b => b.username.toLowerCase())).size !== BOT_CONFIGS.length) {
  throw new Error('Bot isimleri birbirinden farklı olmalı.');
}

// ==================================================
// WEB SUNUCUSU
// ==================================================

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: false }
});

const PORT = Number(process.env.PORT || 3000);
const activeBots = new Map();
const viewerProxies = [];

app.get('/healthz', (_req, res) => {
  res.status(200).send('ok');
});

// Bu dosya public/index.html dosyasını sunar.
app.use(express.static(path.join(__dirname, 'public'), {
  index: false
}));

// Ana sayfa: bot listesini gösterir.
app.get('/', (_req, res) => {
  const links = BOT_CONFIGS.map(cfg =>
    `<li><a href="/bot/${encodeURIComponent(cfg.username)}">${cfg.username} kontrol panelini aç</a></li>`
  ).join('');

  res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Minecraft Bot Paneli</title>
<style>
body{background:#12151c;color:#f4f4f5;font-family:Arial,sans-serif;padding:30px}
a{color:#68e0a0;text-decoration:none}
li{margin:15px 0}
input,button{padding:10px;margin:5px;border-radius:6px}
</style>
</head>
<body>
<h1>Minecraft Bot Kontrol Paneli</h1>
<p>Devam etmek için panel şifreni gir.</p>
<input id="password" type="password" placeholder="Panel şifresi">
<button onclick="login()">Giriş yap</button>
<p id="status"></p>
<ul id="bots" hidden>${links}</ul>
<script>
function login(){
  sessionStorage.setItem('panelPassword',document.getElementById('password').value);
  fetch('/api/bots',{headers:{'x-panel-password':sessionStorage.getItem('panelPassword')}})
    .then(r=>{
      if(!r.ok) throw new Error('Şifre yanlış');
      return r.json();
    })
    .then(data=>{
      document.getElementById('status').textContent='Giriş başarılı';
      document.getElementById('bots').hidden=false;
    })
    .catch(()=>{
      sessionStorage.removeItem('panelPassword');
      document.getElementById('status').textContent='Şifre yanlış.';
    });
}
</script>
</body>
</html>`);
});

// Panel şifresi doğrulaması.
function checkPassword(req, res, next) {
  const supplied = req.headers['x-panel-password'];

  if (typeof supplied === 'string' && supplied === PANEL_PASSWORD) {
    return next();
  }

  return res.status(401).send('Panel şifresi yanlış.');
}

app.get('/api/bots', checkPassword, (_req, res) => {
  res.json(BOT_CONFIGS.map(cfg => {
    const state = activeBots.get(cfg.username);

    return {
      username: cfg.username,
      connected: !!(state && state.connected)
    };
  }));
});

// Bot başına özel kontrol sayfası.
// public/index.html dosyası kullanılır.
app.get('/bot/:username', (req, res) => {
  const username = req.params.username;

  if (!BOT_CONFIGS.some(cfg => cfg.username === username)) {
    return res.status(404).send('Bot bulunamadı.');
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Görüntü portlarını tek web portu üzerinden yönlendir.
BOT_CONFIGS.forEach((cfg, index) => {
  const viewerPort = 3100 + index;

  const proxy = createProxyMiddleware({
    target: `http://127.0.0.1:${viewerPort}`,
    changeOrigin: true,
    ws: true,
    pathRewrite: p => p.replace(
      new RegExp('^/view/' + cfg.username),
      ''
    ),
    on: {
      error: (_err, _req, res) => {
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.writeHead(503, {
            'Content-Type': 'text/plain; charset=utf-8'
          });
          res.end('Bot görüntüsü hazır değil.');
        }
      }
    }
  });

  app.use(`/view/${cfg.username}`, proxy);
  viewerProxies.push(proxy);
});

// ==================================================
// SOCKET.IO GÜVENLİĞİ
// ==================================================

io.use((socket, next) => {
  const supplied = socket.handshake.auth?.password;

  if (typeof supplied === 'string' && supplied === PANEL_PASSWORD) {
    return next();
  }

  next(new Error('Panel şifresi yanlış.'));
});

function isKnownBot(username) {
  return BOT_CONFIGS.some(cfg => cfg.username === username);
}

function getConnectedBot(username) {
  const state = activeBots.get(username);

  if (!state || !state.bot || !state.connected) {
    return null;
  }

  return state;
}

// ==================================================
// BOT BAĞLANTISI
// ==================================================

function startBot(cfg, delay = 0) {
  setTimeout(() => {
    const old = activeBots.get(cfg.username);

    if (old && old.bot) return;

    console.log(`[${cfg.username}] Sunucuya bağlanılıyor...`);

    let bot;

    try {
      bot = mineflayer.createBot({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: cfg.username,
        version: MC_VERSION,
        auth: 'offline',
        hideErrors: false
      });
    } catch (err) {
      console.error(`[${cfg.username}] ${err.message}`);
      scheduleReconnect(cfg);
      return;
    }

    const state = {
      bot,
      connected: false,
      reconnectTimer: null,
      viewerStarted: false
    };

    activeBots.set(cfg.username, state);

    bot.once('spawn', () => {
      state.connected = true;

      console.log(`[${cfg.username}] Sunucuya bağlandı.`);
      io.emit('bot-status', {
        username: cfg.username,
        connected: true
      });

      setTimeout(() => {
        if (
          activeBots.get(cfg.username) === state &&
          bot.player
        ) {
          bot.chat(`/login ${cfg.password}`);
          console.log(`[${cfg.username}] Giriş komutu gönderildi.`);
        }
      }, 2500);

      if (!state.viewerStarted) {
        const index = BOT_CONFIGS.findIndex(
          item => item.username === cfg.username
        );

        try {
          mineflayerViewer(bot, {
            port: 3100 + index,
            firstPerson: false,
            viewDistance: 5
          });

          state.viewerStarted = true;
          console.log(`[${cfg.username}] Görüntüleyici başlatıldı.`);
        } catch (err) {
          console.error(
            `[${cfg.username}] Görüntüleyici hatası: ${err.message}`
          );
        }
      }
    });

    bot.on('chat', (sender, message) => {
      if (sender === cfg.username) return;

      io.to(`bot:${cfg.username}`).emit('log', {
        type: 'chat',
        text: `<${sender}> ${message}`
      });
    });

    bot.on('message', message => {
      io.to(`bot:${cfg.username}`).emit('log', {
        type: 'chat',
        text: message.toString()
      });
    });

    bot.on('kicked', reason => {
      console.log(`[${cfg.username}] Sunucudan atıldı: ${String(reason)}`);
    });

    bot.on('error', err => {
      console.error(`[${cfg.username}] ${err.message}`);
    });

    bot.on('end', reason => {
      state.connected = false;

      for (const key of [
        'forward', 'back', 'left', 'right',
        'jump', 'sprint', 'sneak'
      ]) {
        try {
          bot.setControlState(key, false);
        } catch {}
      }

      if (activeBots.get(cfg.username) === state) {
        activeBots.delete(cfg.username);
      }

      io.emit('bot-status', {
        username: cfg.username,
        connected: false
      });

      console.log(
        `[${cfg.username}] Bağlantı kapandı: ${String(reason || '')}`
      );

      scheduleReconnect(cfg);
    });
  }, delay);
}

function scheduleReconnect(cfg) {
  const existing = activeBots.get(cfg.username);

  if (existing?.reconnectTimer) return;

  const timer = setTimeout(() => {
    const current = activeBots.get(cfg.username);

    if (!current || !current.bot) {
      startBot(cfg);
    }
  }, 20000);

  if (existing) {
    existing.reconnectTimer = timer;
  } else {
    activeBots.set(cfg.username, {
      bot: null,
      connected: false,
      reconnectTimer: timer,
      viewerStarted: false
    });
  }
}

// ==================================================
// WEB KONTROLLERİ
// ==================================================

io.on('connection', socket => {
  socket.emit('bot-list', BOT_CONFIGS.map(cfg => {
    const state = activeBots.get(cfg.username);

    return {
      username: cfg.username,
      connected: !!(state && state.connected)
    };
  }));

  socket.on('select-bot', username => {
    if (!isKnownBot(username)) return;

    for (const cfg of BOT_CONFIGS) {
      socket.leave(`bot:${cfg.username}`);
    }

    socket.join(`bot:${username}`);

    const state = activeBots.get(username);

    socket.emit('bot-status', {
      username,
      connected: !!(state && state.connected)
    });
  });

  socket.on('command', data => {
    if (
      !data ||
      !isKnownBot(data.botName) ||
      typeof data.text !== 'string'
    ) return;

    const command = data.text.trim();

    if (!command || command.length > 256 || /[\r\n]/.test(command)) {
      return;
    }

    const state = getConnectedBot(data.botName);

    if (!state) {
      socket.emit('notice', 'Bot şu anda bağlı değil.');
      return;
    }

    state.bot.chat(command);
  });

  socket.on('move', data => {
    if (
      !data ||
      !isKnownBot(data.botName) ||
      !data.controls ||
      typeof data.controls !== 'object'
    ) return;

    const state = getConnectedBot(data.botName);

    if (!state) return;

    const allowed = [
      'forward', 'back', 'left', 'right',
      'jump', 'sprint', 'sneak'
    ];

    for (const key of allowed) {
      state.bot.setControlState(
        key,
        data.controls[key] === true
      );
    }
  });

  socket.on('look', data => {
    if (!data || !isKnownBot(data.botName)) return;

    const state = getConnectedBot(data.botName);

    if (!state) return;

    const yaw = Number(data.yaw);
    const pitch = Number(data.pitch);

    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;

    const safePitch = Math.max(
      -Math.PI / 2,
      Math.min(Math.PI / 2, pitch)
    );

    state.bot.look(yaw, safePitch, true).catch(() => {});
  });
});

// Viewer WebSocket bağlantılarını ilgili porta yönlendir.
server.on('upgrade', (req, socket, head) => {
  const match = req.url?.match(
    /^\/view\/([A-Za-z0-9_]{3,16})(?:\/|$)/
  );

  if (!match) return;

  const index = BOT_CONFIGS.findIndex(
    cfg => cfg.username === match[1]
  );

  if (index < 0) return;

  try {
    viewerProxies[index]?.upgrade(req, socket, head);
  } catch {
    socket.destroy();
  }
});

// ==================================================
// BAŞLAT
// ==================================================

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Web paneli ${PORT} portunda çalışıyor.`);

  BOT_CONFIGS.forEach((cfg, index) => {
    startBot(cfg, index * 5000);
  });
});

function shutdown() {
  console.log('Botlar kapatılıyor...');

  for (const state of activeBots.values()) {
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);

    try {
      state.bot?.quit('Sunucu kapanıyor');
    } catch {}
  }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
