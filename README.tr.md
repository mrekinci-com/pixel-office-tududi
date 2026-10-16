[English](README.md) | **Türkçe**

# Tududi — mrekinci sürümü

`pixel-office-tududi`, Tududi v0.87 temelinde hazırlanmış bağımsız bir çataldır. Paket ve Docker imajı sürümü `0.87-po.5` olarak yayımlanır; uygulamanın adı **Tududi** olarak kalır.

[Piksel Ofis](https://github.com/mrekinci-com/pixel-office), ajanların görevlerini, projelerini ve notlarını bu uygulamada tutar. [Bu depo](https://github.com/mrekinci-com/pixel-office-tududi) yalnız iş defterini içerir; ofis paneli ve ajan çalıştırıcıları ayrı projededir. Tek başına görev yönetimi için de kullanılabilir. Orijinal proje [Chris Veleris / Tududi](https://github.com/chrisvel/tududi) adresindedir.

## Ekran görüntüleri

Yalnız örnek veriler.

![Tüm görevler](docs/images/tasks.png)

![Yaklaşan görevler takvimi](docs/images/upcoming.png)

![Hakkında sayfası](docs/images/about.png)

![Terminal](docs/images/terminal.png)

Bu Terminal görüntüsünde örnek çıktı canlandırılmıştır; ekran görüntüsü için ana makinede CLI başlatılmadı.

## Orijinal sürümden farklar

- Yaklaşan görevlerde 90 günlük pencere, aylık takvim ve gündem görünümleri; proje süzme ve görev tarihini sürükleyerek değiştirme.
- Gün başlıkları ve görev tarihleri uygulama dili ile kullanıcının saat dilimini izler.
- Notlarda sıralama; proje notlarında varsayılan olarak en yeni notun başta olması.
- Tamamlama halkasıyla görevi tamamlamadan veya yeniden açmadan önce onay.
- Yönetici API’sinde yalnız şifre gönderilerek yapılan değişikliklerin veritabanına kaydedilmesi.
- Kısmi görev güncellemelerinde durumun korunması: yalnız adı, notu veya tarihi değiştirmek tamamlanmış görevi yeniden açmaz.
- Bildirim zilinde yalnız okunmamış kayıtlar; okundu bilgisinin doğru gösterilmesi. Tamamlanan, arşivlenen veya silinen görevlerin ve ileri taşınan hatırlatmaların bildirimleri için düzeltmeler.
- İsteğe bağlı, sağlayıcıdan bağımsız dış panel kimlik kapısı; Piksel Ofis'in özel erişim davranışıyla uyumluluk.
- Claude Code veya Codex için isteğe bağlı Terminal; oturumla korunan vekil, pano ve görsel aktarımı.
- Bu sürüme ait Hakkında sayfası, Türkçe ve İngilizce metinler.

Kişisel terminal yapılandırması ve markalama kaldırılmıştır. Kendi ana makine kurulumunuz için genel, isteğe bağlı Terminal aşağıda açıklanır. Mevcut veri modeli, yönetici API'si, API anahtarları ve görev/not/proje uçları korunur. Ayrıntılı bağlantı sözleşmesi [Uyumluluk sözleşmesi](docs/PIXEL-OFFICE-COMPATIBILITY.md) dosyasındadır.

## Docker ile kurulum

Node.js 22 tabanlı imajı bu depodan derleyin:

```sh
docker build -t pixel-office-tududi:0.87-po.5 .
cp .env.example .env
openssl rand -hex 64
```

`.env` içindeki yönetici e-postasını ve şifresini değiştirin. Son komutun ürettiği değeri `TUDUDI_SESSION_SECRET` alanına yazın; bu dosyayı paylaşmayın. Ardından:

```sh
docker compose up -d
```

Tarayıcıda `http://localhost:3002` adresini açın. Compose portu yalnız yerel arayüzde yayımlar. Veritabanı `./tududi_db`, yüklemeler `./uploads` dizininde saklanır. `PUID` ve `PGID` değerlerini gerekirse makinenizdeki dosya izinlerine göre değiştirin. Bu sürüm için hazır bir imaj kaydı varsayılmaz; Compose yerel imajı kullanır veya kaynaktan derler.

Piksel Ofis'e geçerken mevcut veritabanı ve yüklemeleri yedekleyin; yalnız imajı `pixel-office-tududi:0.87-po.5` olarak değiştirin. `PORT=9393`, ağ alanı paylaşımı, vekilin Host başlığı ve mevcut bağlama ayarları için uyum belgesini izleyin. Bu depodaki örnek Compose, tek başına yerel kullanım içindir.

## Optional terminal — İsteğe bağlı Terminal

**Terminal**, varsayılan olarak kapalı bir kenar çubuğu sayfası (`/terminal`) ve boyutlandırılabilir proje panelidir. Ana makinedeki **Claude Code** veya **Codex** sohbetine ttyd ve tmux üzerinden bağlanır. İzin verilen hesaplar aynı ana makine oturumunu paylaşır; proje seçimi çalışma dizinini değiştirmez. Ctrl/Cmd+V metin yapıştırır; Ctrl/Cmd+C seçili metni kopyalar, seçim yoksa CLI'ya kesme sinyali gönderir. tmux seçimleri özgün OSC 52 pano köprüsünü kullanır. Görseller yapıştırılabilir, sürüklenebilir veya seçilebilir; ana makine yolları Enter'a basılmadan terminale eklenir.

**Güvenlik:** bu özellik ana makinede kabuk erişimi olan bir yapay zekâ CLI'sı çalıştırır. Yalnız güvenilen, tek kullanıcılı kurulumlar içindir. İzin listesindeki herkes aynı ana makine hesabını ve sohbeti yönetebilir. ttyd'yi özel bir Unix soketinde tutun, uzaktan tarayıcı erişiminde HTTPS kullanın, TCP portunu dışarı açmayın. Tarayıcı yalnız Tududi'nin aynı kaynaklı vekiline ulaşır. HTTP, görsel yükleme ve WebSocket yükseltmeleri Tududi tarayıcı oturumu ve izin verilen e-posta gerektirir; API anahtarı Terminal erişimi sağlamaz. Origin kontrolü uygulanır; WebSocket ve yüklemede Origin zorunludur. Etkinse dış panel kimlik kapısı yükseltmeleri de korur. Soket dizinini diğer kullanıcılara kapatın. CLI kimlik bilgileri Tududi'ye bağlanmaz veya gönderilmez.

1. **Ana makineye** `ttyd` (1.7+), `tmux`, Bash ve Python 3 kurun. Codex'in ilk sohbet kimliğini yakalamak için util-linux `script` de gerekir. Seçtiğiniz CLI'yı resmî yönergeleriyle kurun: [Claude Code kurulumu](https://code.claude.com/docs/en/setup), [Codex CLI](https://developers.openai.com/codex/cli/). ttyd'yi çalıştıracak ana makine kullanıcısı kendi hesabıyla giriş yapmalıdır: Claude Code için `claude auth login`, Codex için `codex login`. CLI'ların normal izin istemlerini açık tutun.
2. `scripts/terminal/launch.sh`, `run-cli.sh` ve `tmux.conf` dosyalarını örneğin `~/terminal/` özel dizinine kopyalayın; iki betiği çalıştırılabilir yapın. `terminal.service.example` dosyasını `~/.config/systemd/user/terminal.service` konumuna kopyalayın. Yolları, `PATH`, `TERMINAL_WORKDIR`, `TERMINAL_SESSION` ve `TERMINAL_CLI=claude` veya `codex` değerini düzenleyin. Süreci ana makinedeki `TERMINAL_CLI` seçer; kapsayıcıdaki değişken yalnız arayüz ipucudur. Çalışma dizini önceden var olmalıdır. ttyd komutunda `--url-arg` yoktur; tarayıcı parametreleri ana makine komutunu veya dizinini seçemez.
3. Özel soket ve yükleme dizinlerini hazırlayın. Örnek birim ile Compose ekinde **aynı ana makine soket dizinini** kullanın. Birimin varsayılanı `~/.local/share/tududi-terminal/socket`, Compose ekindeki yer tutucu `/srv/tududi-terminal/socket` yoludur. Tududi UID/GID'sine sokete bağlanma ve görsel yazma, ana makine CLI'sına görsel okuma izni verin. Aynı UID veya özel ortak grup (`PGID`) kullanın. Yükleme dizininin grubunu ve `2770` kipini ayarlayın; yeni dosyalar ortak grubu devralsın. Görseller `0640` kipiyle yazılır; soket ve dizin izinleri birimdeki `UMask=0007` ayarını izler. Herkese yazma izni vermeyin.
4. Düzenlenen kullanıcı birimini etkinleştirin (`systemctl --user daemon-reload`, ardından `systemctl --user enable --now terminal.service`). [Compose ekindeki](scripts/terminal/docker-compose.terminal.example.yml) ortam değişkenlerini ve bağlamaları kendi kurulumunuza ekleyin. Tek başına kurulumda: `docker compose -f docker-compose.yml -f scripts/terminal/docker-compose.terminal.example.yml up -d`. Önce yer tutucu yolları ve e-postayı değiştirin; mevcut ağ/veritabanı ayarlarınızı koruyun. Soket dizini salt okunur, görseller ayrı bağlanır; ana makine çalışma dizini ve CLI kimlik bilgileri bağlanmaz. Tududi'ye izin listesindeki hesapla giriş yapınca Terminal menüsü görünür. Projelerde de isteğe bağlı Terminal düğmesi vardır.

| Kapsayıcı değişkeni | Anlamı |
| --- | --- |
| `TERMINAL_ENABLED=true` | Açık etkinleştirme. Tanımsız/false ise menü gizlenir ve Terminal uçları 404 döndürür. |
| `TERMINAL_SOCKET` | ttyd Unix soketinin Tududi **kapsayıcısındaki** mutlak yolu; önerilen seçenek. |
| `TERMINAL_URL` | Alternatif olarak `127.0.0.1`, `localhost` veya `[::1]` üzerinde HTTP tabanı (ör. `http://127.0.0.1:7681`). Yalnız ttyd Tududi'nin yerel ağ alanındaysa, örneğin mevcut paylaşılan ağ alanında çalışır. Normal Docker kapsayıcısının loopback adresi ana makine değildir. Uzak sunucu, kimlik bilgisi, sorgu veya parça kabul edilmez. Soket önceliklidir. |
| `TERMINAL_ALLOWED_EMAILS` | Zorunlu, virgülle ayrılmış tam hesap e-postaları; büyük/küçük harf ve çevre boşlukları önemsenmez. Boş/tanımsızsa özellik kapanır. |
| `TERMINAL_UPLOAD_DIR` | Kapsayıcıda özel, ayrı dizin; genel erişime sunulan yükleme dizininin altına koymayın. |
| `TERMINAL_UPLOAD_HOST_DIR` | Aynı dizinin ana makine CLI'sından görülen yolu. Boşluk, kontrol karakteri, kabuk özel karakteri veya nokta bileşeni içermeyen mutlak yol. Görseller için iki yükleme değişkeni de gerekir. |
| `TERMINAL_LABEL` | İsteğe bağlı alt etiket; varsayılan `Terminal`. |
| `TERMINAL_CLI` | İsteğe bağlı arayüz ipucu: `claude` veya `codex`. |

Vekil `/terminal-proxy/`, ayar/yükleme uçları `/api/terminal/config` ve `/api/terminal/upload` altındadır (`/api/v1` takma adı da vardır). HTTPS giriş vekiliniz WebSocket yükseltmelerini iletmeli, tarayıcının Host başlığını ve `X-Forwarded-Proto` bilgisini korumalıdır. `/terminal-proxy/` yolunu doğrudan ttyd'ye yönlendirmeyin. Uygulama önekini kaldıran giriş vekiliyle `TUDUDI_BASE_PATH` desteklenir. Dakikada, tek Tududi sürecinde: bağlanan IP başına 300 istek/yükseltme, izinli kullanıcı başına 120 istek ve 20 görsel yükleme sınırı vardır. PNG, JPEG, GIF ve WebP içerikten tanınır, dosya başına üst sınır 15 MB'dır; istemci dosya adı kullanılmaz. Özgün atomik, rastgele sunucu adları, özel dosya izinleri ve 30 günlük temizlik mekanizması korundu. Temizlik başarılı yüklemelerde yalnız kendi ad kalıbındaki normal dosyaları siler. Pano işlevleri tarayıcı izinlerine bağlıdır; tam köprü gömülü panel/sayfada çalışır.

Sohbet kimlikleri ana makinede `TERMINAL_STATE_DIR` altında (varsayılan `~/.local/state/tududi-terminal`), oturum anahtarı ve CLI için ayrı saklanır. tmux bağlan/oluştur davranışı tarayıcı kopunca CLI'yı açık tutar. Claude Code sabit UUID ile `--session-id`, kayıt varsa `--resume` kullanır. Codex bir yeni etkileşimli sohbet açar; çıkışta yazdığı `codex resume <UUID>` bilgisini yakalar, ardından daima o kimlikle devam eder; `--last` kullanmaz. Var olan sohbeti ana makine biriminde `TERMINAL_CODEX_SESSION_ID` ile seçebilirsiniz. İlk Codex çalışması kimliği yazmadan çökerse betik sessizce yeni sohbet açmak yerine o sohbetin UUID'sini ister (ana makinede `codex resume` ile bulun, `/status` ile kimliği görün). Özel ilk-çalışma dökümü kimlik kaydedilince silinir. Oturum durumunu ve CLI'nın kendi sohbet deposunu ana makinede yedekleyin; CLI'yı bitirmek için tmux oturumunu açıkça kapatın. Yükseltmelerde kurulu `claude --help`, `codex --help` ve [Codex devam ettirme belgesiyle](https://developers.openai.com/codex/cli/reference/#codex-resume) seçenekleri kontrol edin.

## Erişim ayarları

- `TUDUDI_ALLOWED_ORIGINS`: tarayıcıdan izin verilen kökenlerin virgülle ayrılmış listesi. CORS listesi, özel Host istisnasını genişletmez.
- `RATE_LIMIT_AUTH_MAX`: giriş sınırı; varsayılan 15 dakikada 5 deneme. Piksel Ofis, özel ağda çok sayıda ajan hesabı açıp kullandığı kopyada `300` verir.
- `PANEL_ACCESS_ENABLED` **tanımsızsa** standart Tududi oturumu/API anahtarı doğrulaması kullanılır.
- `PANEL_ACCESS_ENABLED=false`: Piksel Ofis ile geriye uyumlu **yalnız özel erişim** modu. `localhost`, `127.0.0.1` ve tam olarak `127.0.0.1:${PORT}` Host değerleri geçer. Diğer Host değerleri 503 alır. Bu bir ağ güvenlik duvarı değildir; uygulamayı yerel arayüze bağlayan Compose/vekil düzeniyle birlikte kullanılır.
- `PANEL_ACCESS_ENABLED=true`: dış panelde RS256 imzalı kimlik jetonu **ve** normal Tududi girişi gerekir. `PANEL_PUBLIC_ORIGIN` (HTTPS kökeni), `PANEL_ACCESS_ISSUER`, `PANEL_ACCESS_AUD`, `PANEL_ACCESS_JWKS_URL` (HTTPS anahtar adresi), `PANEL_OWNER_EMAIL` (küçük harfli tam e-posta) birlikte tanımlanır. Kimlik jetonu `x-panel-access-token` başlığından alınır; farklı başlık için `PANEL_ACCESS_TOKEN_HEADER` ayarlanabilir. Jetonda `exp`, `iat`, `sub`, `email`, doğru issuer/audience ve sahip e-postası aranır. Vekil `X-Forwarded-Proto: https` iletir. Hatalı/eksik ayar dış erişimi kapatır; yerel istisna çalışmaya devam eder. Dış erişimde kayıt/e-posta doğrulama uçları kapalıdır.

Dış panel özelliği hiçbir kişisel alan adına, IP'ye veya kimlik sağlayıcısının özel uçlarına bağlı değildir. Yeni bir dış panel kurulumunda kendi HTTPS kimlik vekilinizi ve imzalı jeton ayarlarınızı kullanın. Özel erişimde vekil, yönlendirme/kimlik başlıklarını taşımadan tam yerel Host değerini göndermelidir; Piksel Ofis vekili bunu zaten yapar.

## Hakkında yapılandırması

Bu, [mrekinci](https://github.com/mrekinci-com) tarafından kendi kullanımı için özelleştirilmiş Tududi sürümüdür; [Piksel Ofis](https://github.com/mrekinci-com/pixel-office) de bu sürümü kullanır. Kimlik ve bağlantılar `frontend/config/edition.ts` dosyasında tutulur. Hakkında sayfasındaki Geliştirmeyi Destekle kutusu GitHub Sponsors, Topluluk kutusu GitHub profili bağlantısını gösterir. İlgili bağlantı listesi boşsa kutu görünmez. Yapılandırma değişikliklerinden sonra ön yüz yeniden derlenir.

## Geliştirme ve doğrulama

```sh
npm ci
NODE_ENV=production npm run frontend:build
npm run backend:build
npm run lint
npm run backend:test -- --runInBand
npm run backend:test:panel
npm run frontend:test -- --runInBand
```

Arka uç doğrudan JavaScript çalıştırır; ayrı bir dönüştürme/çıktı üretme aşaması yoktur. `backend:build`, sunucuyu başlatmadan üretim JavaScript kaynaklarının Node sözdizimi denetimini yapar. Jest testleri geçici test veritabanları kullanır. Dış panel testleri gerçek RSA imzalarıyla, ağ sunucusu açmadan çalışır. Playwright uçtan uca test betikleri servis başlatır; yalnız buna izin verilen ortamda çalıştırılmalıdır.

Varsayılan kullanıcı dili ve ön yüz yedek dili İngilizcedir. Mevcut dil tercihleri ve tarayıcı dili algılama davranışı korunur.

## Lisans ve atıf

MIT lisansı. Tududi'nin orijinal geliştiricisi Chris Veleris'tir. `LICENSE` içindeki `Copyright 2024, 2025 Tududi Developers` bildirimi korunmuştur; uyarlama için `Copyright (c) 2026 mrekinci` eklenmiştir. Dağıtımda lisans metni ve telif bildirimleri korunur; Docker imajı da `/app/LICENSE` dosyasını içerir.
