# Maven Minecraft Bot Panel

Render üzerinde çalışan, webden kontrol edilen Mineflayer bot paneli + 3D viewer.

## Panel Şifresi
**MavenSecurePanel2026!K9x**

## Render Deploy
1. Bu klasörü GitHub repo’suna pushla (public klasörü mutlaka olsun).
2. Yeni Web Service oluştur.
3. Build: `npm install`
4. Start: `npm start`
5. Environment (opsiyonel ama önerilir):
   - `PANEL_PASSWORD` = `MavenSecurePanel2026!K9x`
   - `BOT_CONFIGS_JSON` = `[{"username":"BOT1","password":"SIFRE1"},...]`
   - `MC_HOST` = `maven.play.hosting`
6. Deploy.

`/healthz` → `ok` gelirse çalışıyor demektir.

## Yerel test
```bash
npm install
npm start
```
http://localhost:10000

## Not
Bot şifrelerini kendi hesaplarınla değiştir. Eski şifreleri değiştir.
