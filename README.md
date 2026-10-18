# Maven Minecraft Bot Panel

Web üzerinden kontrol edilebilen, çoklu Mineflayer botları için modern kontrol paneli.  
Render.com üzerinde tek port ile çalışacak şekilde tasarlandı. Prismarine Viewer ile tarayıcıda 3D dünya görüntüsü.

## Özellikler

- Birden fazla botu aynı panelden seçip kontrol etme
- Canlı sohbet / komut konsolu
- WASD + zıpla + eğil + koş hareket kontrolleri (klavye + dokunmatik butonlar)
- Fare ile bakış yönü değiştirme
- Prismarine Viewer üzerinden canlı 3D dünya görünümü (proxy ile tek porttan)
- Panel şifresi ile korunan Socket.IO ve API
- Otomatik yeniden bağlanma
- Render uyumlu (PORT ortam değişkeni, 0.0.0.0 dinleme, health check)

## Kurulum (Yerel)

```bash
npm install
```

`.env` dosyası oluştur (veya ortam değişkenlerini ayarla):

```env
PORT=10000
PANEL_PASSWORD=en_az_12_karakterlik_guclu_sifre
MC_HOST=maven.play.hosting
MC_PORT=25565
MC_VERSION=1.21.1
BOT_CONFIGS_JSON=[{"username":"BOT1","password":"SUNUCU_SIFRESI_1"},{"username":"BOT2","password":"SUNUCU_SIFRESI_2"}]
```

```bash
npm start
```

Tarayıcıda `http://localhost:10000` aç.

## Render Deploy

1. GitHub deposunu **Private** yap (bot şifreleri ortam değişkeninde tutulur ama yine de dikkatli ol).
2. Yeni **Web Service** oluştur.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Environment Variables ekle:
   - `PANEL_PASSWORD` → uzun, tahmin edilmesi zor şifre
   - `BOT_CONFIGS_JSON` → tek satır JSON (yukarıdaki gibi)
   - `MC_HOST`, `MC_PORT`, `MC_VERSION` (isteğe bağlı, varsayılanlar mevcut)
6. Deploy et.

Ücretsiz Render planında servis hareketsiz kalınca uykuya geçer. 7/24 bağlantı için ücretli plan gerekir.

## Önemli Uyarılar

- Bot hesaplarının şifrelerini asla kaynak koduna veya GitHub'a yazma. Sadece Environment Variables kullan.
- Daha önce paylaştığın gerçek Minecraft şifrelerini hemen değiştir.
- Sunucunun botlara izin vermesi gerekir. Offline mode + `/login` komutu kullanılıyor.
- Prismarine Viewer'ın WebSocket proxy'si Render üzerinde test edilmelidir. Sorun çıkarsa viewDistance değerini düşür.
- Bu bir başlangıç / kontrol paneli uygulamasıdır. Üretim kullanımı için ek güvenlik önlemleri düşün.

## Dosya Yapısı

```
bot.js
package.json
public/
  index.html
  bot.html
README.md
.env.example
.gitignore
```

## Lisans

MIT
