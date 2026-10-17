const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Minecraft AFK Bot Konsolu</title>
      <meta charset="utf-8">
      <style>
        body { background: #121212; color: #00FF00; font-family: monospace; padding: 20px; margin: 0; }
        h2 { color: #fff; margin-top: 0; }
        #console { background: #000; border: 1px solid #333; height: 400px; padding: 10px; overflow-y: scroll; margin-bottom: 10px; border-radius: 5px; }
        .log-entry { margin-bottom: 5px; white-space: pre-wrap; }
        #input-container { display: flex; }
        #cmd { flex: 1; padding: 10px; background: #222; border: 1px solid #444; color: #fff; font-family: monospace; font-size: 16px; border-radius: 3px 0 0 3px; }
        #btn { padding: 10px 20px; background: #00FF00; border: none; color: #000; font-weight: bold; cursor: pointer; border-radius: 0 3px 3px 0; }
        .system { color: #00bfff; }
        .chat { color: #ffffff; }
      </style>
    </head>
    <body>
      <h2>🖥️ Minecraft Canlı Bot Konsolu</h2>
      <div id="console"></div>
      <div id="input-container">
        <input type="text" id="cmd" placeholder="Sunucuya komut veya mesaj gönder... (Örn: /spawn)">
        <button id="btn" onclick="sendCmd()">Gönder</button>
      </div>
      <script src="/socket.io/socket.io.js"></script>
      <script>
        const socket = io();
        const cons = document.getElementById('console');
        socket.on('log', (data) => {
          const div = document.createElement('div');
          div.className = 'log-entry ' + data.type;
          div.innerText = data.text;
          cons.appendChild(div);
          cons.scrollTop = cons.scrollHeight;
        });
        function sendCmd() {
          const val = document.getElementById('cmd').value;
          if(!val) return;
          socket.emit('command', val);
          document.getElementById('cmd').value = '';
        }
        document.getElementById('cmd').addEventListener('keypress', (e) => {
          if(e.key === 'Enter') sendCmd();
        });
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Konsol aktif.`));

// --- SUNUCU AYARLARINI BURAYA YAZINIZ ---
const botOptions = {
  host: 'maven.play.hosting',    // Örn: myserver.aternos.me
  port: 25565,
  username: 'sigmaoyuncu',          // Oyunda görünecek bot adı
  version: '1.21.1',                       // 1.21.11 sunucuları için bu şekilde kalmalı
  auth: 'offline',
  hideErrors: true                         // Sunucudan gelen geçersiz paket hatalarını gizler ve botun çökmesini engeller
};

let bot;

function sendToWebConsole(text, type = 'system') {
  console.log(`[${type.toUpperCase()}] ${text}`);
  io.emit('log', { text: `[${new Date().toLocaleTimeString()}] ${text}`, type });
}

function startBot() {
  sendToWebConsole('Bot sunucuya bağlanıyor...');
  bot = mineflayer.createBot(botOptions);

  bot.on('spawn', () => {
    sendToWebConsole('Bot sunucuya başarıyla giriş yaptı!', 'system');
    
    // Sunucuda crack şifren varsa buraya yaz, yoksa bu kısmı silebilirsin
    setTimeout(() => {
      bot.chat('/login sigma12321'); 
    }, 3000);

    // Anti-AFK hareketi (Sürekli zıplama)
    setInterval(() => {
      if (!bot || !bot.entity) return;
      bot.setControlState('jump', true);
      setTimeout(() => { if(bot) bot.setControlState('jump', false); }, 1000);
    }, 10000);
  });

  bot.on('chat', (username, message) => {
    sendToWebConsole(`<${username}> ${message}`, 'chat');
  });

  bot.on('end', (reason) => {
    sendToWebConsole(`Bağlantı koptu: ${reason}. 15 saniye sonra tekrar deneniyor...`, 'system');
    setTimeout(startBot, 15000);
  });

  bot.on('error', (err) => {
    // Kırmızı VarInt paket hataları geldiğinde sistemi çökertmek yerine hafifçe log geçip bağlantıyı taze tutar
    if (err.message.includes('VarInt') || err.message.includes('buffer')) {
      sendToWebConsole('Sunucudan geçersiz veri paketi algılandı, hata bastırıldı ve bot korunuyor.', 'system');
    } else {
      sendToWebConsole(`Hata: ${err.message}`, 'system');
    }
  });
}

io.on('connection', (socket) => {
  socket.on('command', (cmd) => {
    if (bot) bot.chat(cmd);
  });
});

startBot();
