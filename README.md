# Instagram Admin Paneli

Siyah temalı, mobil uyumlu, çok kullanıcılı takipçi snapshot analiz paneli.

## Ne Yapar?

- Panel hesabı ile kayıt/giriş yapar.
- Instagram şifresi istemez.
- `DATABASE_URL` eklenirse ücretsiz Postgres üzerinde kalıcı veri tutar.
- iPhone veya bilgisayardan ZIP, JSON, HTML, CSV, TXT, TSV, XLSX snapshot dosyası yükler.
- Önceki snapshot ile yeni snapshotı karşılaştırır.
- Takipten çıkanları, yeni takipçileri, karşılıksız takipleri ve bekleyen istekleri listeler.
- Panel ekranı 2 saniyede bir yenilenir.
- Resmi Meta API bağlantısı varsa takipçi, takip edilen, gönderi sayısı, kullanıcı adı, bio ve web sitesi metriklerini geçmişe kaydeder.
- Panel profilinde ad/soyad ve panel şifresi değiştirilebilir.

## Net Sınırlar

- Açık hesap da olsa Instagram web sayfası arka planda kazınmaz.
- Instagram kullanıcı adı tek başına hesap sahipliği doğrulaması değildir.
- Gerçek hesap doğrulaması için resmi Meta bağlantısı veya hesaba ait export dosyası gerekir.
- Kişi kişi takipten çıkan analizi için iki farklı snapshot/export karşılaştırması gerekir.
- Dosya boyutu sınırsız değildir; varsayılan limit `100 MB`.

## Instagram Verisini Nereden Alırım?

- Export sayfası: https://accountscenter.instagram.com/info_and_permissions/dyi/
- Resmi yardım: https://www.facebook.com/help/instagram/181231772500920

Paneldeki **Yükle** ekranında bu iki bağlantı da bulunur.

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

Bu repo GitHub'a bağlıysa Render push sonrası otomatik deploy eder.

Render ayarları:

- Build command: `npm install`
- Start command: `npm start`
- Environment: Node

Ortam değişkenleri:

```text
SESSION_SECRET=uzun-guclu-bir-deger
UPLOAD_DIR=/var/data/uploads
UPLOAD_LIMIT_MB=100
DATABASE_URL=postgresql://...
META_ACCESS_TOKEN=...
META_IG_USER_ID=...
META_IG_BUSINESS_ACCOUNT_ID=...
META_GRAPH_VERSION=v23.0
```

`META_IG_USER_ID` varsa panel kendi bağlı hesabının profil metriklerini doğrudan okur. Yoksa `META_IG_BUSINESS_ACCOUNT_ID` ile Business Discovery yolu kullanılır.

Tamamen ücretsiz kalmak için Render Free Web Service + Neon/Supabase Free Postgres kullan.

## Desteklenen Dosyalar

- `.zip`
- `.json`
- `.html`, `.htm`
- `.csv`, `.txt`, `.tsv`
- `.xlsx`

Instagram export ZIP dosyası önerilir. ZIP içindeki takipçi/takip edilen dosyaları otomatik okunur.
