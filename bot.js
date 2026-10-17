const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- SUNUCU SABİT AYARLARI ---
const SERVER_HOST = 'maven.play.hosting';
const SERVER_PORT = 25565;

// Girdiğin 5 botun isimleri ve sunucudaki giriş şifreleri (Şifreleri kendine göre düzeltebilirsin brom)
const BOT_CONFIGS = [
  { username: 'thetuffman', password: 'sigma12321' },
  { username: 'sigmaoyuncu', password: 'sigma12321' },
  { username: 'pikachufn', password: 'sigma12321' },
  { username: 'tr_tier1', password: 'sigma12321' },
  { username: 'smpseverrr', password: 'sigma12321' }
];

// --- DİNAMİK KONSOL SAYFASI ALTYAPISI ---
// Her kullanıcı adı için özel bir web sayfası yolu (/sigmaoyuncu, /pikachufn vb.) oluşturuyoruz
BOT_CONFIGS.forEach(cfg => {
  app.get(`/${cfg.username}`, (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${cfg.username} Özel Konsolu</title>
        <meta charset="utf-8">
        <style>
          body { background: #121212; color: #00FF00; font-family: monospace; padding: 20px; margin: 0; }
          h2 { color: #fff; margin-top: 0; border-bottom: 2px solid #333; padding-bottom: 10px; }
          #console { background: #000; border: 1px solid #333; height: 450px; padding: 10px; overflow-y: scroll; margin-bottom: 10px; border-radius: 5px; }
          .log-entry { margin-bottom: 5px; white-space: pre-wrap; }
          #input-container { display: flex; }
          #cmd { flex: 1; padding: 12px; background: #222; border: 1px solid #444; color: #fff; font-family: monospace; font-size: 16px; border-radius: 3px 0 0 3px; }
          #btn { padding: 12px 25px; background: #00FF00; border: none; color: #000; font-weight: bold; cursor: pointer; border-radius: 0 3px 3px 0; }
          .system { color: #00bfff; }
          .chat { color: #ffffff; }
        </style>
      </head>
      <body>
        <h2>🖥️ ${cfg.username} Canlı Yönetim Masası</h2>
        <div id="console"></div>
        <div id="input-container">
          <input type="text" id="cmd" placeholder="${cfg.username} olarak chate veya komut gönder...">
          <button id="btn" onclick="sendCmd()">Gönder</button>
        </div>
        <script src="/socket.io/socket.io.js"></script>
        <script>
          const socket = io();
          const cons = document.getElementById('console');
          const myUser = "${cfg.username}";
          
          socket.on('log-' + myUser, (data) => {
            const div = document.createElement('div');
            div.className = 'log-entry ' + data.type;
            div.innerText = data.text;
            cons.appendChild(div);
            cons.scrollTop = cons.scrollHeight;
          });

          function sendCmd() {
            const val = document.getElementById('cmd').value;
            if(!val) return;
            socket.emit('command', { botName: myUser, text: val });
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
});

// Ana linke girildiğinde botların rehber listesini gösterir
app.get('/', (req, res) => {
  let links = BOT_CONFIGS.map(c => `<li><a href="/${c.username}" style="color: #00FF00; font-size: 18px;">${c.username} Konsolunu Aç</a></li>`).join('');
  res.send(`
    <body style="background: #121212; color: white; font-family: monospace; padding: 40px;">
      <h2>🤖 Çoklu Bot Ana Portalı</h2>
      <p>Yönetmek istediğin karakterin özel konsoluna tıklayarak bağlanabilirsin brom:</p>
      <ul>${links}</ul>
    </body>
  `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Çoklu Konsol Sistemi Aktif.`));

// --- BOTLARIN BAŞLATILMA ALTYAPISI ---
const activeBots = {};

function sendToBotConsole(botName, text, type = 'system') {
  console.log(`[${botName.toUpperCase()}] [${type.toUpperCase()}] ${text}`);
  io.emit('log-' + botName, { text: `[${new Date().toLocaleTimeString()}] ${text}`, type });
}

function initBot(cfg, delay) {
  // Sunucunun bot korumasına yakalanmamak için 5 saniye aralıklarla girerler
  setTimeout(() => {
    sendToBotConsole(cfg.username, 'Bot sunucuya 1.21.1 protokolü ile bağlanıyor...');
    
    const bot = mineflayer.createBot({
      host: SERVER_HOST,
      port: SERVER_PORT,
      username: cfg.username,
      version: '1.21.1',
      auth: 'offline',
      hideErrors: true // Sürüm paket hatalarını yutar, botları düşürmez
    });

    bot.on('spawn', () => {
      sendToBotConsole(cfg.username, 'Sunucuya başarıyla giriş yaptı ve dünyada doğdu!', 'system');
      
      // Giriş şifresini otomatik yazar
      setTimeout(() => {
        bot.chat(`/login ${cfg.password}`);
        sendToBotConsole(cfg.username, 'Otomatik giriş şifresi gönderildi.', 'system');
      }, 3000);

      // Her botun arkada anti-AFK için 15 saniyede bir hafifçe zıplama döngüsü
      const jumpInterval = setInterval(() => {
        if (!bot || !bot.entity) return;
        bot.setControlState('jump', true);
        setTimeout(() => { if(bot) bot.setControlState('jump', false); }, 500);
      }, 15000 + Math.random() * 3000);
      
      bot._jumpInterval = jumpInterval;
    });

    // Sadece bu botun gördüğü chati kendi özel konsoluna aktarır
    bot.on('chat', (sender, message) => {
      if (sender === cfg.username) return; // Kendi yazdığını loglama
      sendToBotConsole(cfg.username, `<${sender}> ${message}`, 'chat');
    });

    bot.on('end', (reason) => {
      sendToBotConsole(cfg.username, `Bağlantı koptu (${reason}). 20 saniye sonra tekrar bağlanacak...`, 'system');
      clearInterval(bot._jumpInterval);
      delete activeBots[cfg.username];
      setTimeout(() => initBot(cfg, 0), 20000);
    });

    bot.on('error', (err) => {
      if (!err.message.includes('VarInt') && !err.message.includes('buffer')) {
        sendToBotConsole(cfg.username, `Hata algılandı: ${err.message}`, 'system');
      }
    });

    activeBots[cfg.username] = bot;

  }, delay);
}

// 5 Botu sırayla ateşle
BOT_CONFIGS.forEach((cfg, index) => {
  initBot(cfg, index * 5000);
});

// Konsollardan gelen komutları sadece ilgili bota yönlendirme küpü
io.on('connection', (socket) => {
  socket.on('command', (data) => {
    const targetBot = activeBots[data.botName];
    if (targetBot) {
      targetBot.chat(data.text);
      sendToBotConsole(data.botName, `Konsoldan Gönderilen: ${data.text}`, 'system');
    } else {
      sendToBotConsole(data.botName, `Bot şu an bağlı olmadığından komut gönderilemedi!`, 'system');
    }
  });
});
