'use strict';

const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
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

app.use(express.static(__dirname));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/bot/:username', (req, res) => {
  if (!validBot(req.params.username)) return res.status(404).send('Bot bulunamadı');
  res.sendFile(path.join(__dirname, 'bot.html'));
});

app.get('/api/bots', requirePassword, (_req, res) => {
  res.json(BOT_CONFIGS.map(cfg => {
    const s = activeBots.get(cfg.username);
    return { username: cfg.username, connected: !!(s && s.connected) };
  }));
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

  // Panel butonlarından gelen mod komutları
  socket.on('set-bot-mode', data => {
    if (!data || !validBot(data.botName)) return;
    const state = activeBots.get(data.botName);
    if (!state || !state.bot) return;

    state.currentMode = data.mode;
    if (data.attackSeconds) {
      state.attackIntervalMs = Number(data.attackSeconds) * 1000;
    }
    updateBotBehavior(state.bot, state);
  });
});

// ===================== ÖZEL HAREKET MODLARI =====================
function updateBotBehavior(bot, state) {
  if (state.loops) {
    state.loops.forEach(l => clearInterval(l));
  }
  state.loops = [];

  // Mod 1: Sadece Durduğu Yerde Zıpla ve Saniyeli Otomatik Vur
  if (state.currentMode === 'just-jump') {
    bot.clearControlStates();
    
    const jumpLoop = setInterval(() => {
      if (!bot.entity) return;
      bot.setControlState('jump', true);
      setTimeout(() => { if (bot.entity) bot.setControlState('jump', false); }, 400);
    }, 6000);

    const attackMs = state.attackIntervalMs || 1000;
    const attackLoop = setInterval(() => {
      if (!bot.entity) return;
      const block = bot.blockAtCursor(4);
      if (block && block.type !== 0) {
        bot.dig(block, true).catch(() => {});
      } else {
        bot.swingArm();
      }
    }, attackMs);

    state.loops.push(jumpLoop, attackLoop);
  }
  // Mod 2: Dondur (Tam 10 Dakikada 1 Zıplar - Sunucudan düşürmez)
  else if (state.currentMode === 'freeze') {
    bot.clearControlStates();
    
    const freezeLoop = setInterval(() => {
      if (!bot.entity) return;
      bot.setControlState('jump', true);
      setTimeout(() => { if (bot.entity) bot.setControlState('jump', false); }, 400);
    }, 10 * 60 * 1000);

    state.loops.push(freezeLoop);
  }
}

// ===================== 2D YUKARDAN BAKMALI RADAR EKRANI =====================
function startMapRadar(bot, cfg) {
  const radarInterval = setInterval(() => {
    if (!bot || !bot.entity || !bot.entity.position) return;

    const botPos = bot.entity.position;
    const radius = 5; 
    const gridData = [];

    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const checkPos = botPos.offset(x, 0, z);
        const block = bot.blockAt(checkPos);
        
        let color = '#2c3e50'; 
        if (block && block.type !== 0) {
          if (block.name.includes('stone') || block.name.includes('cobble')) color = '#7f8c8d'; 
          else if (block.name.includes('cactus')) color = '#27ae60'; 
          else if (block.name.includes('water')) color = '#2980b9'; 
          else if (block.name.includes('lava')) color = '#e67e22'; 
          else color = '#95a5a6'; 
        }
        
        if (x === 0 && z === 0) {
          color = '#e74c3c'; 
        }

        gridData.push({ x, z, color });
      }
    }

    io.to(`bot:${cfg.username}`).emit('2d-map', { gridData, coords: { x: Math.floor(botPos.x), y: Math.floor(botPos.y), z: Math.floor(botPos.z) } });
  }, 2000);

  bot.once('end', () => clearInterval(radarInterval));
}

// ===================== BOTLARIL BAŞLATILMASI =====================
function scheduleReconnect(cfg) {
  const cur = activeBots.get(cfg.username);
  if (cur?.reconnectTimer) return;
  const t = setTimeout(() => {
    if (!activeBots.get(cfg.username)?.bot) startBot(cfg);
  }, 12000);
  if (cur) cur.reconnectTimer = t;
  else activeBots.set(cfg.username, { bot: null, connected: false, reconnectTimer: t, currentMode: 'just-jump', attackIntervalMs: 1000, loops: [] });
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

    const state = { bot, connected: false, reconnectTimer: null, currentMode: 'just-jump', attackIntervalMs: 1000, loops: [] };
    activeBots.set(cfg.username, state);

    bot.once('spawn', () => {
      state.connected = true;
      io.emit('bot-status', { username: cfg.username, connected: true });
      console.log(`[${cfg.username}] spawn oldu`);

      setTimeout(() => {
        if (activeBots.get(cfg.username) === state) {
          bot.chat(`/login ${cfg.password}`);
          console.log(`[${cfg.username}] /login gönderildi`);
          updateBotBehavior(bot, state);
          startMapRadar(bot, cfg);
        }
      }, 1800);
    });

    bot.on('message', msg => {
      io.to(`bot:${cfg.username}`).emit('log', { text: msg.toString() });
    });

    bot.on('end', () => {
      state.connected = false;
      if (state.loops) state.loops.forEach(l => clearInterval(l));
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
