# Minecraft-AFK-Bot — Render web kontrol paneli

## Neler var?
- Beş Mineflayer botu için ayrı seçim ve ayrı canlı konsol odası
- Tarayıcıdan chat/komut gönderme
- WASD, zıplama, koşma ve eğilme kontrolleri
- Fare hareketiyle botun bakış yönünü değiştirme (görüntü alanında sağ fare tuşunu basılı tutarak sürükle)
- Prismarine Viewer üzerinden tarayıcıda dünya görüntüsü
- Panel için şifreli Socket.IO bağlantısı

## Önemli görüntüleme notu
`prismarine-viewer` içinde `firstPerson: false`, klasik omuz üstü üçüncü şahıs kamerasından ziyade kuşbakışı/dışarıdan dünya görünümüdür. Bu paket, Minecraft istemcisinin tam üçüncü şahıs kamerasını birebir taklit etmez. Fareyle bakış kontrolü botun `look()` yönünü değiştirir.

## GitHub'a yüklemeden önce
1. Daha önce kaynak kodda paylaştığın Minecraft giriş şifrelerini değiştir.
2. `config` veya `.env` içinde gerçek şifre tutma.
3. `PANEL_PASSWORD` ve `BOT_CONFIGS_JSON` değerlerini Render > Environment bölümünde tanımla.
4. Repo içindeki eski `bot.js` ve `package.json` dosyalarını bu pakettekilerle değiştir; `public/index.html` dosyasını da ekle.

## Render ayarları
- Service type: Web Service
- Build Command: `npm install`
- Start Command: `npm start`
- Node: 20 veya üstü
- Render `PORT` değişkenini otomatik sağlar; uygulama `0.0.0.0` üzerinde dinler.
- Ücretsiz Render web servisleri hareketsiz kalınca uykuya geçebilir; bu yüzden ücretsiz planda 7/24 bot bağlantısı garanti değildir.

## Environment Variables
`PANEL_PASSWORD` = uzun, tahmin edilmesi zor panel parolası.

`BOT_CONFIGS_JSON` = tek satırlık JSON dizisi, tam beş bot:
```json
[{"username":"BotAdi1","password":"SunucuSifresi1"},{"username":"BotAdi2","password":"SunucuSifresi2"},{"username":"BotAdi3","password":"SunucuSifresi3"},{"username":"BotAdi4","password":"SunucuSifresi4"},{"username":"BotAdi5","password":"SunucuSifresi5"}]
```

Ayrıca `MC_HOST`, `MC_PORT`, `MC_VERSION` değişkenlerini istersen değiştir.

## Test
Yerelde:
```bash
npm install
```
`PANEL_PASSWORD` ve `BOT_CONFIGS_JSON` ortam değişkenlerini ayarla, sonra:
```bash
npm start
```
Tarayıcıda `http://localhost:10000` aç.

## Dikkat
Bu bir başlangıç uygulamasıdır; Render'a deploy etmeden önce test et. Viewer proxy/WebSocket yönlendirmesi, Render üzerinde ve kullandığın `prismarine-viewer` sürümünde doğrulanmalıdır. Botların bağlandığı Minecraft sunucusunun botlara izin vermesi gerekir.
