# masa-panel

Emre'nin SANAL (paper) trading masaları için canlı, salt-okunur izleme paneli.
**Gerçek para yok.** Emir göndermez, anahtar istemez.

- Site: https://emkaya42.github.io/masa-panel/ (main dalı)
- Veri: `data` dalındaki `data.json` (kutudaki yayıncı ~60 sn'de bir, tek commit olarak günceller)
- Canlı fiyatlar tarayıcıdan: DexScreener (Solana), OKX spot (**Binance verisi değil**). Mumlar: GeckoTerminal ve OKX.

## Terminal

Genel bakışta bağımsız hesap bakiyeleri, karar öncesi veri/risk kontrolleri,
kaynak bağlantıları, piyasa bağlamı ve model test sonuçları bulunur.
İşlem günlüğünde masa, dönem ve metin filtresi; sonuç sıralaması ve CSV indirme vardır.
Günlük ve özetleri yalnızca son JSON kaydındaki kapanmış işlemleri kapsar;
tam geçmiş performansı değildir. USD/USDT sonuçları kaynak kayıt birimiyle sunulur,
döviz dönüşümü yapılmaz ve hesap bakiyeleri birleştirilmez.

Masa kayıtları 300 saniye, tarayıcı fiyatları 60 saniye sonra eski kabul edilir.
Eski DexScreener fiyatı yerine masanın kayıtlı fiyatı kullanılır.
Bağlantı hatası son geçerli kaydı silmez. Eksik bir masa diğer masaların
gösterilmesini engellemez. `kill: null` bilinmeyen durumdur.

## Geliştirme ve kontrol

Node.js 22 veya üzeri ile `node --test`; sözdizimi için
`node --check app.js`, `node --check core.js`, `node --check terminal.js`.
Bağımlılık kurulumu veya derleme gerekmez. Yerel sunucu:
`python -m http.server 8080` ve `http://localhost:8080`.
GitHub Actions aynı Node kontrollerini çalıştırır.

Motor ve yayıncı bu repoda değildir. Terminal gerçek emir veya strateji
değişikliği göndermez. Motor entegrasyonu için mevcut `data` dalı sözleşmesi korunur.

