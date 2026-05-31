# Admin Paneli

Siyah temalı, mobil uyumlu, çok kullanıcılı takipçi snapshot analiz paneli.

## Ne Yapar?

- Panel hesabı ile kayıt/giriş yapar.
- Instagram şifresi istemez.
- `DATABASE_URL` eklenirse ücretsiz Postgres üzerinde kalıcı veri tutar.
- iPhone veya bilgisayardan ZIP, JSON, HTML, CSV, TXT, XLSX snapshot dosyası yükler.
- Önceki snapshot ile yeni snapshotı karşılaştırır.
- Takipten çıkanları, yeni takipçileri, karşılıksız takipleri ve bekleyen istekleri listeler.
- Panel ekranı 5 saniyede bir yenilenir.
- Kullanıcı adı değişimi, dosyada güvenilir hesap ID bilgisi varsa otomatik işlenir.
- `META_ACCESS_TOKEN` ve `META_IG_BUSINESS_ACCOUNT_ID` eklenirse resmi Meta API ile dosya yüklemeden takipçi, takip edilen ve gönderi sayısı metrikleri yenilenir.

## Net Sınırlar

- Açık hesap da olsa Instagram takipçi listesi otomatik kazınmaz.
- Instagram kullanıcı adı tek başına hesap sahipliği doğrulaması değildir.
- Gerçek hesap doğrulaması için resmi Meta bağlantısı veya hesaba ait export dosyası gerekir.
- Dosya boyutu sınırsız değildir; varsayılan limit `100 MB`.

## Yerelde Çalıştırma

```bash
npm install
npm start
```

Sonra tarayıcıdan aç:

```text
http://localhost:3000
```

Telefon aynı Wi-Fi ağındaysa bilgisayarının yerel IP adresiyle açabilirsin:

```text
http://BILGISAYAR-IP:3000
```

## Render Deploy

Bu repoyu GitHub'a yükle, Render'da **New Web Service** ile bağla.

Render ayarları:

- Build command: `npm install`
- Start command: `npm start`
- Environment: Node
- Disk: `render.yaml` içinde `/var/data` olarak tanımlı

Ortam değişkenleri:

```text
SESSION_SECRET=uzun-guclu-bir-deger
DATA_FILE=/var/data/db.json
UPLOAD_DIR=/var/data/uploads
UPLOAD_LIMIT_MB=100
DATABASE_URL=postgresql://...
META_ACCESS_TOKEN=...
META_IG_BUSINESS_ACCOUNT_ID=...
META_GRAPH_VERSION=v23.0
```

Tamamen ücretsiz kalmak için Render Free Web Service + Neon/Supabase Free Postgres kullan. Render Free web servislerinde kalıcı disk yoktur; `DATABASE_URL` eklemezsen servis yeniden başladığında lokal JSON veri kaybolabilir.

## Desteklenen Dosyalar

- `.zip`
- `.json`
- `.html`, `.htm`
- `.csv`, `.txt`, `.tsv`
- `.xlsx`

Instagram export ZIP dosyası önerilir. ZIP içindeki takipçi/takip edilen dosyaları otomatik okunur.
