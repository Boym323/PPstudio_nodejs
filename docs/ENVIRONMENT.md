# Environment Variables

Dokumentace proměnných prostředí pro lokální vývoj i produkci.

Stručný runtime přehled prostředí a vazeb na infrastrukturu je v kořenovém [`ENVIRONMENT.md`](../ENVIRONMENT.md). Tento soubor zůstává úplným katalogem proměnných.

## Pravidla
- Tajné hodnoty nikdy neukládej do repozitáře.
- Každá nová proměnná musí mít popis a příklad v `.env.example`.
- Runtime proměnné používané aplikací se validují při startu přes `src/config/env.ts`.
- CLI-only proměnné pro Prisma, například `SHADOW_DATABASE_URL`, načítá `prisma.config.ts` a nevalidují se při startu Next.js serveru.
- Pro konzistentní lokální vývoj, CI a produkci drž `Node 24 LTS`; repo má [`.nvmrc`](../.nvmrc#L1) a `package.json` `engines.node = ^24.0.0`.
- Prefill klientky pro admin ruční rezervaci používá jen query parametry `create=1` a `clientId` na existujících admin route; tahle změna nepřidává žádnou novou env proměnnou.
- Normalizace telefonu klientky je čistě aplikační validace ve sdílených TypeScript helperech a nepřidává žádnou env proměnnou ani databázovou migraci.
- Invariant `AvailabilitySlot.capacity = 1` nepřidává žádnou env proměnnou; vyžaduje pouze běžné `DATABASE_URL` pro Prisma migraci a předem čistá data.

## Přehled
- `NODE_ENV`: režim běhu (`development`, `production`).
- `NEXT_PUBLIC_APP_NAME`: veřejný název značky.
- `NEXT_PUBLIC_APP_URL`: runtime URL aplikace (redirecty, e-mailové odkazy, interní origin kontroly, CI/Playwright base URL).
- `NEXT_PUBLIC_SITE_URL`: volitelná kanonická veřejná URL webu pro SEO metadata/JSON-LD; pokud chybí, fallback je `NEXT_PUBLIC_APP_URL`.
- `NEXT_PUBLIC_SITE_DOMAIN`: volitelná veřejná doména webu bez schématu (např. `ppstudio.cz`), preferovaná pro textové zobrazení domény ve voucher PDF kontaktech.
- `VOUCHER_PUBLIC_DOMAIN`: volitelná explicitní doména pouze pro voucher PDF kontakty; má prioritu nad `NEXT_PUBLIC_SITE_DOMAIN`.
- `NEXT_PUBLIC_MATOMO_ENABLED`: zapnutí veřejného Matomo trackingu; tracking běží pouze při přesné hodnotě `true`.
- `NEXT_PUBLIC_CLARITY_ENABLED`: zapnutí veřejného Microsoft Clarity trackingu; tracking běží pouze při přesné hodnotě `true`.
- `NEXT_PUBLIC_META_PIXEL_ENABLED`: zapnutí veřejného Meta Pixel trackingu; tracking běží pouze při přesné hodnotě `true`.
- `NEXT_PUBLIC_GOOGLE_ADS_ENABLED`: zapnutí veřejného Google Ads tagu (`gtag.js`); tracking běží pouze při přesné hodnotě `true`.
- `NEXT_PUBLIC_WEB_VITALS_ENABLED`: zapnutí klientského sběru Web Vitals; měření běží pouze při přesné hodnotě `true`.
- `NEXT_PUBLIC_CLARITY_PROJECT_ID`: veřejné Clarity Project ID z Clarity dashboardu.
- `NEXT_PUBLIC_META_PIXEL_ID`: veřejné Meta Pixel ID (např. `977400093564812`).
- `NEXT_PUBLIC_GOOGLE_ADS_ID`: veřejné Google Ads tag ID, typicky ve tvaru `AW-18174837654`.
- `NEXT_PUBLIC_MATOMO_URL`: veřejná URL Matomo instance včetně schématu, například `https://matomo.example.cz/`.
- `NEXT_PUBLIC_MATOMO_SITE_ID`: ID webu v Matomo.
- `MATOMO_URL`: server-side URL Matomo instance pro Reporting API; typicky stejný origin jako veřejné Matomo, ale bez vystavení tokenu klientovi.
- `MATOMO_SITE_ID`: server-side ID webu pro Reporting API.
- `MATOMO_AUTH_TOKEN`: tajný Matomo Reporting API token pro dashboard agregace; nikdy nepoužívej prefix `NEXT_PUBLIC_`.
- `PUSHOVER_ENABLED`: server-only globalni vypinac owner Pushover notifikaci; odesila se pouze pri presne hodnote `true`.
- `PUSHOVER_APP_TOKEN`: server-only Pushover application token pro projekt; nikdy nepouzivej prefix `NEXT_PUBLIC_`.
- Cooldown DB failure alertu z `/api/health` je záměrně pevný na 10 minut v aplikaci a nepřidává žádnou env proměnnou; tím nemůže být omylem vystaven nebo rozvolněn pouze změnou prostředí.
- Selhání základní DB kontroly `/api/health` používá bezpečný `503` kontrakt. Detailní e-mailové metriky jsou oddělené v owner-only `/api/health/diagnostics`; pro konkrétní chyby slouží systemd journal webové služby.
- `turbopack.root` je odvozený od adresáře `next.config.ts` a nepoužívá env proměnnou ani pevnou cestu; tím funguje v kořeni repozitáře i v dočasném staging release.
- Diagnostika health/smoke kroku releasu používá volitelné `PPSTUDIO_LIVENESS_URL`, `PPSTUDIO_HEALTH_URL` a `PPSTUDIO_SMOKE_URL`, které se ve výpisu selhání zobrazí včetně HTTP statusu.
- `PPSTUDIO_WEB_READY_RETRIES` (výchozí `20`) a `PPSTUDIO_WEB_READY_RETRY_SECONDS` (výchozí `0.25`) jsou volitelné CLI-only proměnné release helperu pro tiché čekání na otevření webového endpointu po restartu; nejsou součástí runtime validace aplikace.
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`: stabilní base64 AES klíč pro Next.js Server Actions; na produkci musí zůstat stejný mezi release buildy.
- `NEXT_DEPLOYMENT_ID`: identifikátor konkrétního deploymentu pro ochranu proti version skew; při doporučeném rollout skriptu se nastavuje automaticky z aktuálního git commitu a nemá se držet staticky v `.env`.
- `DEPLOYMENT_VERSION`: volitelný alias pro deployment identifikátor; release skript ho automaticky exportuje na stejnou hodnotu jako `NEXT_DEPLOYMENT_ID`.
- `GIT_HASH`: volitelný fallback pro `deploymentId`; release skript ho automaticky exportuje na aktuální git commit.
- `.release-env`: runtime soubor generovaný `deploy/release.sh`, který obsahuje `NEXT_DEPLOYMENT_ID`, `DEPLOYMENT_VERSION` a `GIT_HASH` pro systemd `next start`. Needituje se ručně; je součástí každého verzovaného release adresáře a unit ho čte z `/var/www/ppstudio/current/.release-env`.
- Release proměnné se do veřejného health payloadu nepropisují; aktivní identitu ověř ve startup logu `ppstudio.next.register` nebo po přihlášení přes owner-only `/api/health/diagnostics`.
- `DATABASE_URL`: PostgreSQL connection string pro Prisma.
- `SHADOW_DATABASE_URL`: pomocná databáze pro `prisma migrate dev` (lokální vývoj).
- `ADMIN_SESSION_SECRET`: klíč pro podpis admin session cookie.
- `ADMIN_SESSION_IDLE_MAX_AGE_SECONDS`: volitelná idle expirace admin session cookie/JWT v sekundách (default `1209600` = 14 dní).
- `ADMIN_SESSION_REFRESH_WINDOW_SECONDS`: volitelné okno pro sliding refresh v sekundách (default `172800` = 48 hodin před expirací).
- `ADMIN_SESSION_ABSOLUTE_MAX_AGE_SECONDS`: volitelný absolutní strop session v sekundách (default `3888000` = 45 dní od prvního přihlášení).
- Admin session cookie `ppstudio-admin-session` má idle expiraci 14 dní; při admin requestech ji `proxy` obnoví, pokud do expiry zbývá méně než 48 hodin.
- Session má zároveň absolutní limit 45 dní od prvního přihlášení; po jeho překročení je vyžadované nové přihlášení.
- Při změně `ADMIN_SESSION_SECRET` se existující admin session okamžitě zneplatní.
- `ADMIN_OWNER_EMAIL`: kontaktní e-mail používaný jako bezpečný fallback pro systémové e-maily; neslouží k přihlášení.
- `EMAIL_DELIVERY_MODE`: režim e-mailové delivery (`log`, `background`).
- `EMAIL_TRANSPORT`: transport pro background odesílání (`smtp`, `resend`).
- `SMTP_HOST`: SMTP hostname pro produkční odesílání.
- `SMTP_PORT`: SMTP port.
- `SMTP_SECURE`: `auto` pro volbu podle portu, `true` pro implicitní TLS, `false` pro explicitní STARTTLS nebo plain transport podle provideru.
- `SMTP_USER`: SMTP login.
- `SMTP_PASSWORD`: SMTP heslo nebo app password.
- `SMTP_FROM_EMAIL`: adresa odesílatele.
- `SMTP_FROM_NAME`: jméno odesílatele zobrazované klientovi.
- `SMTP_REPLY_TO`: volitelná reply-to adresa.
- `RESEND_API_KEY`: API klíč pro odesílání přes Resend REST API.
- `RESEND_WEBHOOK_SECRET`: signing secret pro verifikaci webhooku `POST /api/webhooks/resend`.
- `MEDIA_STORAGE_ROOT`: volitelná absolutní cesta k lokálnímu root adresáři pro nahraná média; pokud chybí, aplikace použije `/var/www/ppstudio/uploads`.
- `SITE_SETTINGS_SNAPSHOT_PATH`: volitelná absolutní cesta pro atomický snapshot posledního správně načteného `SiteSettings`; výchozí je `/var/lib/ppstudio/site-settings-snapshot.json`. Cesta musí být mimo checkout/release a zapisovatelná pro runtime uživatele `ppstudio`. Při výpadku DB se použije snapshot, zaloguje se provozní alert a nové veřejné rezervace se do obnovení aktuálních pravidel odmítnou.

## Doporučený lokální `.env` základ

`cp .env.example .env` ti připraví bezpečný výchozí základ. Pro lokální onboarding obvykle měníš hlavně runtime URL, databázi, session secret a dočasně bootstrap/email režim.

```dotenv
NODE_ENV=development
NEXT_PUBLIC_APP_NAME=PP Studio
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SITE_DOMAIN=ppstudio.cz
VOUCHER_PUBLIC_DOMAIN=ppstudio.cz
NEXT_PUBLIC_MATOMO_ENABLED=false
NEXT_PUBLIC_CLARITY_ENABLED=false
NEXT_PUBLIC_META_PIXEL_ENABLED=false
NEXT_PUBLIC_GOOGLE_ADS_ENABLED=false
NEXT_PUBLIC_WEB_VITALS_ENABLED=true
NEXT_PUBLIC_CLARITY_PROJECT_ID=
NEXT_PUBLIC_META_PIXEL_ID=
NEXT_PUBLIC_GOOGLE_ADS_ID=AW-18174837654
NEXT_PUBLIC_MATOMO_URL=https://matomo.example.cz/
NEXT_PUBLIC_MATOMO_SITE_ID=1
MATOMO_URL=https://matomo.example.cz/
MATOMO_SITE_ID=1
MATOMO_AUTH_TOKEN=replace-with-server-side-reporting-token
PUSHOVER_ENABLED=false
PUSHOVER_APP_TOKEN=replace-with-pushover-application-token
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=replace-with-openssl-rand-base64-32

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public"
SHADOW_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ppstudio_shadow?schema=public"

ADMIN_SESSION_SECRET=replace-with-long-random-secret-at-least-32-chars
ADMIN_SESSION_IDLE_MAX_AGE_SECONDS=1209600
ADMIN_SESSION_REFRESH_WINDOW_SECONDS=172800
ADMIN_SESSION_ABSOLUTE_MAX_AGE_SECONDS=3888000
ADMIN_OWNER_EMAIL=owner@example.com

EMAIL_DELIVERY_MODE=log
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=auto
SMTP_USER=mailer@example.com
SMTP_PASSWORD=change-me-smtp
SMTP_FROM_EMAIL=no-reply@example.com
SMTP_FROM_NAME=PP Studio
SMTP_REPLY_TO=hello@example.com
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
MEDIA_STORAGE_ROOT=/var/www/ppstudio-uploads
SITE_SETTINGS_SNAPSHOT_PATH=/var/lib/ppstudio/site-settings-snapshot.json
```

Lokální doporučení:

- `EMAIL_DELIVERY_MODE=log` je nejbezpečnější výchozí režim pro vývoj a testovací rollout.
- `.env.example` drží `EMAIL_DELIVERY_MODE=background`; pro bezpečný vývoj jej obvykle přepni na `log`.
- `NEXT_PUBLIC_MATOMO_*`, `NEXT_PUBLIC_CLARITY_*`, `NEXT_PUBLIC_META_PIXEL_*`, `NEXT_PUBLIC_GOOGLE_ADS_*`, `MATOMO_*` a `PUSHOVER_*` nech klidně vypnuté, pokud zrovna netestuješ analytics nebo notifikace.
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` drž stabilně v produkčním `.env`; deployment identifikátor naopak do `.env` běžně nefixuj, protože `deploy/release.sh` ho automaticky odvozuje z aktuálního commitu a zapisuje do runtime `.release-env`.
- Produkční `instrumentation.ts` z těchto hodnot skládá provozní log metadata. Do logu se nezapisuje surový `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, jen jeho bezpečný fingerprint; ten lze mezi instancemi porovnat při debugování `Failed to find Server Action`.
- Session časování můžeš upravit přes `ADMIN_SESSION_*_SECONDS`; pokud je nenastavíš, běží default `14 dní idle / refresh při <48h / absolutní strop 45 dní`.
- `MEDIA_STORAGE_ROOT` drž mimo repozitář a ověř, že do něj má proces právo zapisovat.
- `SITE_SETTINGS_SNAPSHOT_PATH` drž mimo celý checkout i release; snapshot obsahuje provozní kontaktní údaje a soubor má být přístupný jen runtime uživateli.

## Poznámky
- Webový bootstrap admin přístup není podporovaný. Pro obnovu přístupu použij offline `npm run admin:recover-owner -- --email owner@example.com --name 'Jméno' --confirm < heslo.txt`; CLI heslo nevypisuje, nebere ho z env a audit zapisuje do `BookingSubmissionLog`.
- V produkci používej silná hesla a unikátní `ADMIN_SESSION_SECRET`.
- Identita konkrétního serveru se nesmí zapisovat jako pevné tvrzení do verzované dokumentace, protože repozitář se synchronizuje i na produkci. Pro ověření prostředí vždy čti lokální `.env` a deploy konfiguraci na cílovém serveru; zejména `NODE_ENV`, `DATABASE_URL`, `NEXT_PUBLIC_APP_URL` a e-mailové proměnné.
- Veřejný obsah salonu není řízený env proměnnými; texty a placeholdery jsou centralizované v `src/content/public-site.ts`.
- Provozní identita veřejného webu (jméno provozovatelky a IČ používané na `/kontakt` a `/obchodni-podminky`) aktuálně také není env konfigurace; je součástí sdíleného public profile helperu v `src/lib/site-settings.ts`.
- Admin login rate limit nepřidává novou env proměnnou; limity jsou zatím fixované v `src/lib/auth/admin-login-rate-limit.ts` (okno 10 minut, IP limit 20, e-mail fail limit 6).
- Hero fotografie pro `/o-mne` je aktuálně ručně verzovaný asset v `public/brand`; finální přepnutí na jiný soubor nevyžaduje novou env proměnnou, jen úpravu `aboutContent.profile.image`.
- Owner sekce `Přístupy` zobrazuje pouze databázové účty. Recovery zůstává mimo webovou aplikaci, takže nemůže vytvořit neplatnou session ani obcházet DB kontrolu role a aktivity.
- Pokud je `EMAIL_DELIVERY_MODE=background` a `EMAIL_TRANSPORT=smtp`, jsou `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` a `SMTP_FROM_EMAIL` povinné už při startu aplikace.
- Pokud je `EMAIL_DELIVERY_MODE=background` a `EMAIL_TRANSPORT=resend`, je při startu aplikace povinné `RESEND_API_KEY`.
- V aktuálním produkčním `.env` je `EMAIL_DELIVERY_MODE=log`, takže se e-mail neposílá žádným providerem; při zapnutí background delivery musí být `EMAIL_TRANSPORT` nastavený explicitně. `resend` používá providerovou idempotenci, zatímco `smtp` zůstává pouze at-least-once a při produkčním background režimu vypíše při startu jasné varování.
- Pokud je `EMAIL_DELIVERY_MODE=background`, admin pole `emailSenderEmail` v sekci `Nastavení` musí odpovídat `SMTP_FROM_EMAIL`; jinak aplikace změnu odmítne, aby se předešlo selhání doručování.
- `NEXT_PUBLIC_APP_URL` je kritická i pro provozní approve/reject odkazy v e-mailu; pokud míří na špatný host nebo schéma, owner email akce povedou na neplatnou URL.
- `NEXT_PUBLIC_SITE_URL` je doporučené nastavit v CI/Playwright režimu, kde `NEXT_PUBLIC_APP_URL` míří na lokální testovací origin (např. `http://127.0.0.1:3100`), aby veřejné SEO canonical/JSON-LD URL zůstaly produkční (např. `https://ppstudio.cz`).
- U Playwrightu nestačí nastavit `NEXT_PUBLIC_APP_URL` jen pro runtime `next start`. Protože je to `NEXT_PUBLIC_*` proměnná, admin redirecty, login/logout flow a další absolutní URL se zafixují už při buildu. Pokud `next build` proběhne s jiným hostem než následný `PLAYWRIGHT_BASE_URL`, browser po přihlášení odskočí na cizí origin a E2E skončí `ERR_CONNECTION_REFUSED`.
- `NEXT_PUBLIC_APP_URL` je zároveň kanonický fallback origin pro admin redirecty. `x-forwarded-host` se použije jen tehdy, když odpovídá `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_DOMAIN` nebo `VOUCHER_PUBLIC_DOMAIN`; validace bezpečně akceptuje i alias `apex <-> www`, aby admin RSC prefetch/redirecty nekončily cross-origin CORS chybou.
- Stejná validace se používá i pro CSRF ochranu klasických admin POST endpointů (`/api/auth/login`, `/api/auth/logout`, vybrané `/api/admin/*` mutace). Když `NEXT_PUBLIC_APP_URL` nebo proxy host neodpovídají reálnému veřejnému originu, login může skončit `error=origin_check_failed`.
- Matomo konfigurace je volitelná: pokud `NEXT_PUBLIC_MATOMO_ENABLED` není přesně `true`, nebo chybí URL či site ID, tracking zůstane vypnutý. Protože jde o `NEXT_PUBLIC_*` proměnné, hodnoty se promítají do klientského bundle při buildu.
- Clarity konfigurace je volitelná: pokud `NEXT_PUBLIC_CLARITY_ENABLED` není přesně `true`, nebo chybí `NEXT_PUBLIC_CLARITY_PROJECT_ID`, tracking zůstane vypnutý.
- Meta Pixel konfigurace je volitelná: pokud `NEXT_PUBLIC_META_PIXEL_ENABLED` není přesně `true`, nebo chybí `NEXT_PUBLIC_META_PIXEL_ID`, tracking zůstane vypnutý.
- Google Ads konfigurace je volitelná: pokud `NEXT_PUBLIC_GOOGLE_ADS_ENABLED` není přesně `true`, nebo chybí `NEXT_PUBLIC_GOOGLE_ADS_ID`, tracking zůstane vypnutý.
- Při zapnuté konfiguraci Meta Pixel aktuálně posílá nejen `PageView`, ale i neosobní funnel eventy `ViewContent`, `InitiateCheckout` (až po výběru termínu nebo při přechodu do kontaktního kroku), `AddToCart`, `BookingDateSelected`, `BookingTimeSelected`, `BookingContactStarted` a `Lead`.
- Vyloučení přihlášeného admina z veřejného Matomo trackingu je řešené aplikačně přes admin session cookie `ppstudio-admin-session`; nepřidává se kvůli tomu žádná nová env proměnná.
- Vyloučení přihlášeného admina z Clarity je řešené stejným guardem v `SiteShell` (`disabled` přes admin session cookie). Clarity se navíc neinicializuje na tokenových self-service routách.
- Vyloučení přihlášeného admina z Meta Pixelu je řešené stejným guardem v `SiteShell` (`disabled` přes admin session cookie). Meta Pixel se navíc neinicializuje na tokenových self-service routách.
- Web Vitals reporting má samostatný feature flag `NEXT_PUBLIC_WEB_VITALS_ENABLED` (default `true`). Pokud není přesně `true`, `WebVitalsReporter` se nespustí. Odeslání eventu je pořád závislé na veřejné Matomo konfiguraci `NEXT_PUBLIC_MATOMO_ENABLED`, `NEXT_PUBLIC_MATOMO_URL` a `NEXT_PUBLIC_MATOMO_SITE_ID`; bez ní je tracking helper no-op.
- Server-side Matomo reporting konfigurace je oddělená od klientského trackingu: `MATOMO_URL`, `MATOMO_SITE_ID` a `MATOMO_AUTH_TOKEN` čte pouze server-only modul `src/lib/analytics/matomo.ts`. Pokud některá hodnota chybí, dashboard analytics vrací nulové hodnoty místo chyby do UI.
- Úprava admin dashboardu na denní provozní cockpit nepřidává žádnou novou env proměnnou; používá stávající Prisma data, admin session a volitelnou server-side Matomo konfiguraci.
- Matomo se nepoužívá v adminu, neposílá tokenové self-service URL a neukládá analytics eventy do databáze PP Studio.
- Google Ads tag se nepoužívá v adminu a neinicializuje se na tokenových self-service URL; u App Router navigace používá sanitizovaný `page_path` bez citlivých query parametrů.
- Pushover konfigurace je oddelena na serverovy app token a per-owner User Key v DB. `PUSHOVER_ENABLED` a `PUSHOVER_APP_TOKEN` cte jen `src/lib/notifications/pushover.ts`; pri chybejici nebo vypnute konfiguraci se notifikace tise preskoci a hlavni booking/email flow pokracuje.
- Pushover User Key se nespravuje v `.env`, ale v owner-only admin bloku `/admin/nastaveni -> Pushover notifikace`; ulozeny je v `UserNotificationSettings.pushoverUserKey` pro konkretni `AdminUser`.
- Self-service změna termínu nepřidává nové env proměnné; pokud jsou `NEXT_PUBLIC_MATOMO_*` zapnuté, tokenová stránka může inicializovat Matomo kvůli bezpečným eventům, ale pageview s tokenem neodesílá.
- Přístupnost kontaktního kroku veřejné rezervace nepřidává žádnou novou env proměnnou; jde o čistou React/Tailwind úpravu nad stávajícím booking flow.
- Databázový základ voucherů (`Voucher`, `VoucherRedemption` a intent pole na `Booking`) nepřidává žádnou novou env proměnnou; používá stávající `DATABASE_URL`, Prisma migrace a admin session až v budoucí aplikační vrstvě.
- Serverová business vrstva voucherů také nepřidává žádnou novou env proměnnou; tvorba, validace i admin čerpání používají stávající Prisma připojení přes `DATABASE_URL`.
- Admin formulář pro vytvoření voucheru nepřidává žádnou novou env proměnnou; používá stávající admin session, Prisma připojení a voucher doménovou vrstvu.
- Admin uplatnění voucheru v detailu rezervace nepřidává žádnou novou env proměnnou; autorizace používá stávající admin session a role `OWNER` / `SALON`, persistence používá `DATABASE_URL`.
- Panel `Úhrada` v detailu rezervace nepřidává žádnou novou env proměnnou; summary se počítá request-time z `Booking.finalPriceCzk`, `Booking.servicePriceFromCzk`, `Service`, existujících `VoucherRedemption` záznamů a `BookingPayment` plateb přes stávající `DATABASE_URL`.
- `CRM souhrn` v detailu klientky nepřidává žádnou novou env proměnnou; počítá se request-time z rezervací klientky včetně případné `Booking.finalPriceCzk`, `VoucherRedemption` a `BookingPayment` přes stávající `DATABASE_URL`.
- Evidence plateb mimo voucher nepřidává žádnou platební bránu ani QR konfiguraci; metoda `Převodem / QR` je v této verzi pouze UI popisek enumu `BANK_TRANSFER`.
- QR kód ve voucher PDF dál používá `NEXT_PUBLIC_APP_URL` přes `siteConfig.url`, takže produkční hodnota musí mířit na veřejný HTTPS origin PP Studia.
- FAQPage JSON-LD pro `/faq` používá kanonický veřejný origin `NEXT_PUBLIC_SITE_URL` s fallbackem na `NEXT_PUBLIC_APP_URL`; změna FAQ nepřidává žádné nové env proměnné.
- Textová doména v kontaktním řádku voucher PDF je oddělená od runtime hostu: priorita je `VOUCHER_PUBLIC_DOMAIN` -> `NEXT_PUBLIC_SITE_DOMAIN` -> hostname z `NEXT_PUBLIC_APP_URL` jen pokud je bezpečně veřejný (ne localhost ani privátní IP). Když bezpečný host chybí, doména se do kontaktu nevypíše.
- Veřejná stránka ověření voucheru `/vouchery/overeni` nepřidává žádnou novou env proměnnou; používá stávající `DATABASE_URL` a QR odkazy z PDF dál vznikají z `NEXT_PUBLIC_APP_URL`.
- Rucni odeslani voucheru e-mailem z admin detailu nepridava zadnou novou env promennou; pouziva existujici `EMAIL_DELIVERY_MODE`, `SMTP_*` konfiguraci a email worker/outbox flow.
- Kompaktní refaktor admin seznamu voucherů nepřidává žádnou novou env proměnnou; metric strip, hustší filtry i tabulka se stavovými badge jsou čistě UI změna nad existujícím voucher read modelem.
- Kompaktní provozní refaktor detailu voucheru nepřidává žádnou novou env proměnnou; summary karta, sloučené panely i odstranění přetrvávajícího `Rendering...` textu jsou čistě UI změna nad existujícím read modelem.
- Tisková A4 varianta voucher PDF nepřidává žádnou novou env proměnnou; používá stejné `NEXT_PUBLIC_APP_URL`, `VOUCHER_PUBLIC_DOMAIN` / `NEXT_PUBLIC_SITE_DOMAIN`, `SiteSettings` kontakty a `voucherPdfLogoMediaId` jako původní PDF voucher.
- Rate limit pro `/vouchery/overeni` nepřidává novou env proměnnou; limity jsou zatím fixované v `src/features/vouchers/lib/voucher-public-verification-rate-limit.ts` (okno 10 minut, IP limit 10).
- Provozní editace a ruční zrušení voucheru nepřidává žádnou novou env proměnnou; používá stávající admin session, Prisma připojení přes `DATABASE_URL` a existující owner/salon admin routy.
- `NEXT_PUBLIC_APP_URL` je stejně kritická i pro klientský self-service manage link `/rezervace/sprava/[token]`; pokud míří na špatný host nebo schéma, confirmation screen, potvrzovací e-mail i reminder povedou na neplatnou URL.
- `NEXT_PUBLIC_APP_URL` je stejně kritická i pro owner ICS subscription feed; z této hodnoty se skládá kopírovatelný Apple Calendar odkaz v adminu.
- Nový approve/reject email flow nepřidává žádnou novou env proměnnou; využívá existující `NEXT_PUBLIC_APP_URL`, `ADMIN_SESSION_SECRET` a e-mailovou konfiguraci.
- Refaktor admin notifikace o nové rezervaci nepřidává žádnou env proměnnou; pouze mění HTML/text prezentaci a dál používá stejné `NEXT_PUBLIC_APP_URL` pro approve/reject odkazy i otevření administrace.
- Sjednocení booking e-mailových šablon nepřidává žádnou env proměnnou; klientská adresa a kontakt v e-mailech se berou ze `SiteSettings` přes veřejný salon profil a e-mail branding, zatímco `PP Studio`, `Sadová 2, 760 01 Zlín`, `info@ppstudio.cz` a `+420 732 856 036` zůstávají jen aplikační fallbacky. Tokenové odkazy dál používají existující `NEXT_PUBLIC_APP_URL`.
- Dev skript `npm run email:previews` nepřidává žádnou env proměnnou; pro ukázkové URL používá stávající `NEXT_PUBLIC_APP_URL` a při chybě DB se opře o stejné fallbacky jako produkční renderer.
- Kalendářový feed také nepřidává novou env proměnnou; bezpečnost stojí na existujících `NEXT_PUBLIC_APP_URL` a `ADMIN_SESSION_SECRET`.
- Pokud měníš `ADMIN_SESSION_SECRET`, zneplatníš tím existující admin session a zároveň i starší odvozené ICS subscription URL. Po takové změně je potřeba v `/admin/nastaveni` feed znovu zkontrolovat a případně rotovat.
- Pro SMTP produkci je doporučené `SMTP_SECURE=auto`; port `465`/`2465` se přepne na implicit TLS, `587`/`2587` na STARTTLS.
- Resend REST automaticky používá stabilní idempotency key z `EmailLog.id` (platnost deduplikace na straně Resendu je 24 hodin); SMTP používá stabilní `Message-ID`, což nezaručuje exactly-once po nejistém výsledku síťového odeslání.
- `EMAIL_DELIVERY_MODE=log` je vhodný pro lokální vývoj, testovací rollout a safe-mode při produkčním incidentu s SMTP. Produkce ho nemá používat dlouhodobě; log režim neposílá SMTP a provozní logy záměrně maskují příjemce a anonymizují subject.
- Po změně `prisma/schema.prisma` už `npm run dev` a `npm run build` automaticky obnoví generovaný Prisma klient, ale při ruční práci s CLI je stále bezpečné spustit i `npm run db:generate`.
- Slot admin CRUD nezavádí žádné nové env proměnné; spoléhá na stávající session, databázi a bootstrap admin účty.
- Ruční vytvoření rezervace v adminu také nepřidává nové env proměnné; používá stejné `NEXT_PUBLIC_APP_URL`, `ADMIN_SESSION_SECRET`, DB schéma a e-mailovou konfiguraci jako veřejný booking. Nově ale počítá s tím, že `Client.email` může být `null`, takže potvrzovací e-mail se bez adresy přeskočí.
- Stabilizační refaktor `booking-public`, `booking-flow` a `admin-slots` nepřidává žádné nové env proměnné; veřejné entrypointy i provozní konfigurace zůstávají beze změny.
- Modul `Média` nepřidává žádnou novou env proměnnou; dál používá existující `MEDIA_STORAGE_ROOT` pro lokální storage mimo repozitář.
- Sjednocený handler veřejných médií nepřidává žádnou env proměnnou; nadále používá `MEDIA_STORAGE_ROOT` a databázovou kontrolu publikace `MediaAsset.isPublished`.
- UX refaktor `Média` také nepřidává žádnou novou env proměnnou; kompaktní upload panel, quick publish/unpublish i tabs s počty používají stejnou storage a stejný aplikační model.
- Rozdělení portrétů na `PORTRAIT_HOME` a `PORTRAIT_ABOUT` také nepřidává env proměnnou; jde čistě o databázový typ média a veřejný read fallback.
- Veřejná stránka `/studio` nepřidává žádnou novou env proměnnou; fotky studia čte přes stávající `MediaAsset` metadata a veřejné `/media/public/*` URL, se zachovanou kompatibilitou pro starší `/media/*`.
- Dev fallback fotek `/studio` (`public/dev/studio/*`) je aktivní jen při `NODE_ENV=development` a nepoužívá žádnou novou env proměnnou; v produkci se fallback automaticky vypíná.
- Samostatná kontaktní hero fotka (`MediaType.CONTACT_PHOTO`) nepřidává žádnou env proměnnou; používá stejný `MEDIA_STORAGE_ROOT`, media route a Prisma model jako ostatní média.
- Přepnutí `BookingSource` na nové provozní enum hodnoty (`WEB`, `PHONE`, `INSTAGRAM`, `IN_PERSON`, `OTHER`) je čistě databázová a aplikační změna, ne nová env konfigurace.
- Refaktor veřejného výběru časů v `/rezervace` také nezavádí žádné nové env proměnné; jde čistě o klientskou UI vrstvu nad existujícím booking catalogem.
- Admin sekce `Služby` také nepřidává nové env proměnné; používá stávající databázi, session a Prisma klient. Volitelný čas na úklid po službě (`Service.cleanupMinutes`) je databázové pole, ne konfigurace prostředí.
- Ruční skript `npm run db:backfill-service-copy` pro propsání strukturovaných textů služeb do DB nepřidává žádnou novou env proměnnou; používá stávající `DATABASE_URL` stejně jako ostatní Prisma servisní skripty.
- Audit změn cen služeb také nepřidává nové env proměnné; používá stávající databázi, admin session a Prisma klient.
- UX refaktor pracovního přehledu v sekci `Rezervace` také nepřidává nové env proměnné; klikací statistiky, toolbar filtrů i seskupení podle data běží čistě nad existujícími query parametry, Prisma read modelem a App Router routou.
- Refaktor detailu rezervace do rychlého decision panelu také nepřidává nové env proměnné; sticky header, kompaktní summary, action chooser i sjednocené poznámky běží nad existujícím booking read modelem a server actions.
- Produkce musí pro Next.js Server Actions nastavovat stabilní `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` a na každý deploy jednotné `NEXT_DEPLOYMENT_ID` nebo ekvivalentní `DEPLOYMENT_VERSION` / `GIT_HASH`. Bez toho může po rolling deployi nebo při více instancích vznikat `Failed to find Server Action`.
- Pokud řešíš `Failed to find Server Action`, hledej v `journalctl` záznamy `ppstudio.next.register` a `ppstudio.next.request-error`; porovnej mezi instancemi `deploymentId` a `serverActionsKeyFingerprint`, na requestu sleduj příchozí `x-deployment-id` a nově i shrnutí `next-action` headeru. Hodnota `looksMalformed: true` nebo sample typu `"x"` většinou ukazuje na scan/probing, ne na legitimní stale tab.
- Přepracované admin workflow `Služby` a `Kategorie služeb` také nepřidává nové env proměnné; create, quick actions, mobilní detail i varování běží čistě nad existující databází, session a Prisma klientem.
- Sjednocení detailů `Služby` a `Kategorie služeb` do pravého overlay draweru i na desktopu také nepřidává nové env proměnné; jde čistě o klientské/UI chování nad existujícími route query a server actions.
- Operativní redesign admin overview dashboardu také nepřidává nové env proměnné; nové metriky a timeline berou data jen ze stávajících modelů `Booking`, `AvailabilitySlot`, `Client`, `ServiceCategory`, `Service` a `EmailLog`.
- Admin sekce `Nastavení` také nepřidává nové env proměnné; kontaktní údaje, booking pravidla a e-mailový branding ukládá do DB modelu `SiteSettings`.
- Logo pro PDF vouchery nepřidává nové env proměnné. Reference je v `SiteSettings.voucherPdfLogoMediaId`, soubor se čte z existujícího lokálního `MEDIA_STORAGE_ROOT` přes `MediaAsset`.
- Přestavba sekce `Přístupy` ani invite aktivace nepřidává nové env proměnné; používá existující `ADMIN_SESSION_SECRET` (hash tokenů) a `NEXT_PUBLIC_APP_URL` (link v pozvánce), plus DB pole `AdminUser.invitedAt` a tabulku `AdminUserInviteToken`.
- Bezpečné revokování administrátorských pozvánek při deaktivaci nevyžaduje novou konfiguraci ani migraci; vyžaduje pouze běžně podporované PostgreSQL transakce a row locky, které poskytuje stávající `DATABASE_URL`.
- Reminder systém 24 hodin před termínem nepřidává novou env proměnnou; používá existující `EMAIL_DELIVERY_MODE`, `NEXT_PUBLIC_APP_URL` a SMTP konfiguraci stejného `email:worker`.
- Admin reschedule flow také nepřidává novou env proměnnou; používá stejné `NEXT_PUBLIC_APP_URL`, `ADMIN_SESSION_SECRET`, DB schéma a email worker jako ostatní booking workflow.
- Klientský self-service přesun termínu také nepřidává novou env proměnnou; stojí na stejném `NEXT_PUBLIC_APP_URL`, hashovaných `BookingActionToken`, DB schématu a e-mailovém workeru.
- Do admin sekce `Nastavení` záměrně nepatří technické hodnoty jako `NEXT_PUBLIC_APP_URL`, `ADMIN_SESSION_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` nebo `SMTP_PASSWORD`.
- `MEDIA_STORAGE_ROOT` je infrastrukturní proměnná, ne business nastavení. Nepatří do adminu a má se spravovat na úrovni serveru nebo deploy konfigurace.
- Výchozí i doporučená produkční cesta v tomto projektu je `/var/www/ppstudio/uploads`.
- Aplikace uvnitř storage rootu používá pro nové uploady kanonickou větev `public/<type>/YYYY/MM/`; veřejné soubory pak servíruje přes stabilní URL vrstvu `/media/public/*`.
- Refaktor owner/salon admin route wrapperů na sdílené factory funkce nezavádí žádné nové env proměnné.
- Povolené LAN originy pro Next.js dev server nejsou env proměnné; udržují se přímo v `next.config.ts` přes `allowedDevOrigins` a po změně vyžadují restart `npm run dev`.
- Playwright E2E testy používají volitelné CLI-only proměnné `PLAYWRIGHT_PORT` a `PLAYWRIGHT_BASE_URL`; nejsou součástí runtime validace aplikace. Pokud nejsou nastavené, testy použijí `http://127.0.0.1:3100` a samy nastaví `NEXT_PUBLIC_APP_URL` pro lokální `next start` server.
- GitHub Actions CI definuje testovací hodnoty `NEXT_PUBLIC_APP_URL`, admin účtů, `DATABASE_URL`, `SHADOW_DATABASE_URL` a `EMAIL_DELIVERY_MODE=log` přímo ve workflow. Produkční secrets se pro CI testy nepoužívají.

## Poznámka k týdennímu planneru slotů
- Týdenní planner dostupností nepřidává žádné nové env proměnné.
- UX density pass planneru také nepřidává žádné nové env proměnné; kompaktnější header, toolbar, sloučený inspektor a čitelnější grid jsou čistě prezentační změna nad existujícím planner flow.
- Oprava fragmentace chained slotů pro admin planner také nepřidává žádné nové env proměnné; jde čistě o serverovou booking/reschedule logiku nad stávajícím `DATABASE_URL`.
- Helper `scripts/repair-legacy-chained-slots.mjs` také nepřidává žádné nové env proměnné; používá stávající `DATABASE_URL`.
- Oprava planner read modelu pro `CANCELLED` bookingy také nepřidává žádné nové env proměnné.
- Přímá editace v 30min gridu používá stejné existující základy:
  - `DATABASE_URL`
  - `ADMIN_SESSION_SECRET`
  - bootstrap admin účty pro `OWNER` a `SALON`
- Kontrola DST pro `Europe/Prague` nepřidává žádnou novou env proměnnou; timezone salonu zůstává konstantou v aplikačních helperech a nesmí být nahrazena serverovým lokálním timezone.
