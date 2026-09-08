# Projektový Manuál

Tento soubor je průběžný uživatelský a provozní manuál projektu.

## Účel
- Popsat, jak projekt spustit, používat, nasadit a spravovat.
- Udržovat informace aktuální při každé významné změně.

## Obsah manuálu
1. Přehled projektu
2. Lokální spuštění
3. Konfigurace prostředí
4. Build a nasazení
5. Provoz a monitoring
6. Řešení problémů (Troubleshooting)

## Architektonická mapa
- Přehled architektury je v [`ARCHITECTURE.md`](ARCHITECTURE.md).
- Detail veřejného i self-service rezervačního toku je v [`BOOKING_FLOW.md`](BOOKING_FLOW.md).
- Stručný produkční deploy přehled pro Proxmox/LXC je v [`DEPLOYMENT.md`](DEPLOYMENT.md).
- Stručný runtime přehled proměnných a prostředí je v [`ENVIRONMENT.md`](ENVIRONMENT.md).
- Nejčastější provozní potíže a jejich první diagnostika jsou v [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Pravidla údržby
- Při každé funkční změně aktualizuj relevantní sekce.
- Při změně nasazení vždy aktualizuj sekci Build a nasazení.
- Pokud přibude nová chyba a její fix, doplň ji do Troubleshooting.

## Build a nasazení
- Doporučený produkční rollout script je [`deploy/release.sh`](deploy/release.sh).
- Spouštěj z rootu repozitáře:
  - `cd /var/www/ppstudio`
  - `./deploy/release.sh`
- Skript před releasem ověří, že na serveru existují units `ppstudio-web.service` a `ppstudio-email-worker.service`; pokud chybí, skončí s návodem na `sudo /var/www/ppstudio/deploy/deploy.sh`.
- Skript také hlídá, že stejné procesy neběží ještě přes legacy PM2; při konfliktu vypíše převod na čistý systemd provoz (`pm2 delete ...`, `pm2 save --force`, `systemctl disable --now pm2-root.service`).
- Při každém releasu skript navíc synchronizuje aktuální unit soubory z `deploy/systemd/` do `/etc/systemd/system/` a provede `systemctl daemon-reload`, takže změny v service definicích nečekají na ruční `deploy/deploy.sh`.
- Skript před buildem načte `.env` jako dotenv soubor, takže fungují i neuzavřené hodnoty s mezerami typu `NEXT_PUBLIC_APP_NAME=PP Studio`; zároveň vynutí přítomnost validního `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, pro aktuální release automaticky exportuje `NEXT_DEPLOYMENT_ID`, `DEPLOYMENT_VERSION` i `GIT_HASH` z aktuálního git commitu a stejnou trojici zapíše do runtime souboru `.release-env`, který čte systemd služba webu.
- Protože produkční `.env` běžně nastavuje `NODE_ENV=production`, skript používá `npm ci --include=dev`, aby se nainstalovaly i build-time nástroje z `devDependencies` jako `eslint`, `typescript` a `prisma`.
- Release build neběží nad živým runtime. Po úspěšném buildu vznikne úplný adresář `/var/www/ppstudio/releases/<commit>-<čas>` a systemd vždy spouští `/var/www/ppstudio/current`. Krátké atomické přepnutí symlinku proto přepne zdrojové soubory, `.next`, `node_modules` i worker `tsx` runtime společně; předchozí release zůstává zachovaný přes symlink `previous` až do úspěšného health a smoke testu.
- Po úspěšném release se adresář `releases/` automaticky uklidí: chráněné jsou pouze cíle `current` a `previous`; další release se ve výchozím nastavení neuchovávají. Limit upravíš přes `./deploy/release.sh --keep-releases 14`; úklid nikdy neběží při selhání releasu.
- `package.json` zároveň drží npm 11 `allowScripts` whitelist pro balíčky s install hooky (`prisma`, `@prisma/engines`, `sharp`, `esbuild`, `unrs-resolver`), takže release nevypisuje opakované `npm warn allow-scripts` a při upgradu těchto balíčků je potřeba whitelist znovu vědomě potvrdit.
- Skript před vytvořením čistého git-archive workspace odmítne lokální migrační adresáře bez `migration.sql` (ochrana před Prisma P3015). Bez zápisu do DB provede `npm ci`, generate, kontrolu historie, `prisma validate`, lint, samostatný `typecheck` a build; potom zastaví web i worker, ověří jejich neaktivní stav a teprve pak spustí `prisma migrate deploy`. Při selhání migrace nebo startu zůstávají služby fail-closed zastavené, dokud není ručně potvrzen bezpečný recovery postup.
- Kontrola historie může uvést rollbacknuté záznamy `20260419103000_service_public_bookability`, `20260419140000_site_settings_singleton` a `20260428133959_voucher_pdf_logo_settings`. Jsou následované úspěšným záznamem stejné migrace, takže při `Migration history check: OK` nepředstavují blocker releasu ani se nesmějí ručně mazat z `_prisma_migrations`.
- `next.config.ts` explicitně nastavuje `turbopack.root` na adresář právě běžícího checkoutu/release. Staging release tak může mít vlastní `package-lock.json` bez falešného workspace warningu při `next build`.
- Pokud release neprojde health/smoke krokem, skript vypíše, zda selhala liveness/readiness kontrola nebo homepage `/`, vždy s HTTP statusem. Teprve podle této informace čti `journalctl -u ppstudio-web.service -n 200 --no-pager`.
- Po restartu služeb helper nejdřív tiše čeká na otevření webového endpointu (výchozích 20 pokusů po 0,25 s). Tím se očekávaný krátký start Next.js nezamění za incident; až vyčerpání readiness pokusů spouští rollback. Volitelně jej upravíš přes `PPSTUDIO_WEB_READY_RETRIES` a `PPSTUDIO_WEB_READY_RETRY_SECONDS`.
- Detailní release checklist a QA body zůstávají v [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Testování a coverage
- `npm test` spouští celý Node test runner nad quoted globem `src/**/*.test.{ts,tsx}`; nejde už jen o shell-expanded podmnožinu jednoho souboru.
- `npm run typecheck` je samostatná rychlá kontrola TypeScript kontraktů bez buildu; pouštěj ji před většími refaktory a vždy při změnách sdílených typů, route kontraktů nebo Prisma read modelů.
- `npm run test:coverage` generuje report do `coverage/` a zaměřuje se na business logiku v `booking`, `admin`, `vouchers` a `lib/email`.
- Při refaktoringu velkých admin obrazovek drž odděleně route/data loading (`src/features/admin/lib/**`), čisté helpery (`src/features/admin/components/*-helpers.ts`) a samotnou React kompozici. Tím jde měnit strukturu bez regresí v route kontraktu nebo hydrataci.
- Admin planner `Volná okna` stále edituje půlhodinová okna, ale vizuálně umí rozlišit i cleanup/volno uvnitř jedné buňky po 15 minutách: žlutá značí úklid, zelená volno a červená navazující službu.
- Seznam `Volná okna` se skládá až nad merged volnými segmenty, takže sousední publikované sloty bez mezery se v inspektoru dne zobrazí jako jedno souvislé půlhodinově editovatelné okno.
- Výstupy jsou připravené pro lokální čtení i CI:
  - HTML report v `coverage/index.html`
  - LCOV data v `coverage/lcov.info`
  - strojově čitelný souhrn v `coverage/coverage-summary.json`
- Coverage běh je záměrně bez `RUN_DB_INTEGRATION_TESTS=1`, takže reprezentuje hlavně unit/business vrstvu; databázové integrační testy dál ověřuje samostatný `npm test`.
- GitHub Actions teď jako baseline pouští osm samostatných CI jobů:
  - `lint`
  - `typecheck`
  - `test`
  - `build`
  - `e2e`
  - `e2e chromium shard 2`
  - `e2e mobile`
  - `e2e mobile shard 2`
- Coverage je součástí jobu `test` přes `npm run test:ci` a ukládá se jako artefakt; nevzniká pro něj samostatný GitHub check.
- Joby `test` a `e2e` zůstávají povinnou CI branou před merge/releasem. Release skript je záměrně znovu nespouští nad produkčním `.env`: oba používají databázi a E2E provádějí zapisující scénáře.
- Z hlavního CI běhu se ukládají artifacty `coverage-report` a `playwright-report`, takže při pádu PR není potřeba vše znovu reprodukovat jen kvůli detailní diagnostice.
- Samostatné GitHub workflow navíc řeší `CodeQL`, `Dependency Review`, scheduled `npm audit --audit-level=high` a týdenní Dependabot update PR pro `npm` i GitHub Actions.
- GitHub Actions baseline je průběžně držena na novější major řadě bez Node 20 warningů v runneru: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7` a `actions/dependency-review-action@v5`.
- Samotné workflow soubory v repu nestačí k úplnému enforcementu. Po změně CI vždy ručně zkontroluj nastavení repozitáře na GitHubu:
  - branch protection / rulesets
  - required status checks pro jednotlivé GitHub job names `lint`, `typecheck`, `test`, `build`, `e2e`, `e2e chromium shard 2`, `e2e mobile`, `e2e mobile shard 2`; `coverage` není samostatný check
  - zapnutý Dependabot alerts a security overview
- Aktuální testovací batch (2026-05-19) doplnil unit testy pro `src/features/admin/actions/*action-state.ts` a early-fail validace v `src/features/booking/lib/booking-public/engine.ts` (`invalid startsAt`, `invalid phone`), aby se zlepšilo pokrytí nejnižších oblastí.
- Navazující batch (2026-05-19) přidal validační unit testy pro server actions v `src/features/admin/actions/actions-validation.test.ts` (invalid form payloady pro `client-actions`, `service-actions`, `booking-actions`, `settings-actions`) a zvýšil coverage především v `admin/actions`.
- Další rozšíření stejného validačního test souboru přidalo i pokrytí pro `service-category-actions` (`createServiceCategoryAction`, `updateServiceCategoryAction`) nad chybnými payloady, aby se dál zvedlo coverage v admin action vrstvě bez DB flaky závislostí.
- Nová helper vrstva pro admin detail rezervace a weekly planner má vlastní úzké unit testy. Při dalších změnách nejdřív přidej nebo uprav helper test, teprve potom přepisuj JSX nebo server route factory.
- Booking regresní sada nově obsahuje i `src/features/booking/lib/booking-local-time.test.ts` (Prague wall-clock převod) a `src/features/booking/lib/booking-manual.integration.test.ts` (ruční rezervace přes slot vs. explicitní manual override), takže při změnách admin booking flow pouštěj vedle běžných booking testů i tyto soubory.
- Pro širší booking regresi nově počítej i s `src/features/booking/lib/booking-public-voucher.integration.test.ts` (vytvoření veřejné rezervace, obsazený slot, snapshot služby/ceny/délky) a `src/features/booking/lib/booking-email-worker.integration.test.ts` (24h reminder scheduler + e-mail worker delivery).

## Setup projektu krok za krokem
1. Připrav Node.js 24 LTS, npm 10+ a PostgreSQL 15+.
2. Naklonuj repozitář a v rootu vytvoř `.env` z `.env.example`.
3. Nastav aspoň `DATABASE_URL`, `SHADOW_DATABASE_URL`, `ADMIN_SESSION_SECRET`, `NEXT_PUBLIC_APP_URL` a lokální `MEDIA_STORAGE_ROOT`.
4. Pro lokální vývoj preferuj `EMAIL_DELIVERY_MODE=log`, aby se neposílaly reálné e-maily.
5. Spusť `npm install`.
6. Spusť `npm run db:generate`.
7. Spusť `npm run db:migrate`.
8. Spusť `npm run dev` a otevři `http://localhost:3000`.
9. Pro první admin přihlášení vytvoř DB OWNERa offline příkazem `npm run admin:recover-owner -- --email owner@example.com --name 'Jméno' --confirm < heslo.txt`.

Poznámka k runtime:

- Repo nově cílí na `Node 24 LTS`.
- Lokálně použij `nvm use` podle [`.nvmrc`](.nvmrc#L1) nebo jiný ekvivalentní version manager.
- V CI i produkci drž stejnou major verzi Node, aby `npm ci`, build a nativní balíčky (`sharp`, Prisma) běžely nad stejným ABI.

## Troubleshooting
- Deaktivace administrátorského účtu je bezpečnostní zásah: v jednom databázovém commitu zneplatní i všechny dosud nepoužité pozvánky. Starý odkaz `/admin/pozvanka/[token]` proto musí skončit chybou a nikdy nesmí účet znovu aktivovat; pro návrat přístupu účet znovu aktivuje výhradně owner a podle potřeby odešle novou pozvánku.
- Pokud se v dev browser konzoli po restartu `next dev` objeví `ChunkLoadError: Failed to load chunk /_next/static/chunks/...`, aplikace se teď sama tvrdě obnoví už z inline `beforeInteractive` guardu v root layoutu, tedy ještě před hydrací Reactu. Guard nově používá krátké časové okno se dvěma pokusy a dočasný cache-busting query parametr, takže se nezasekne na trvalém `sessionStorage` locku po prvním nepovedeném reloadu. Když chyba zůstane i potom, spusť `npm run dev:clean`; jde obvykle o rozjetý Turbopack/HMR cache stav, ne o chybu business logiky stránky.
- Pokud v admin formuláři `Vytvořit voucher` na Windows/Chrome po přepnutí na `Poukaz na službu` nevidíš názvy služeb, nehledej starou browser cache. Šlo o browser-specific rendering nativního dropdownu; aktuální picker používá vlastní seznam služeb a problém už nemá být reprodukovatelný.
- Pokud DB test nebo storno rezervace spadne na `AvailabilitySlot_active_time_window_excl`, zkontroluj pořadí merge operací v `booking-slot-compaction.ts`. Sousední slot musí být při compaction nejdřív archivovaný a teprve potom se může rozšířit cílový interval; jinak PostgreSQL zachytí dočasný překryv dvou aktivních slotů.
- Kapacita slotu je pevně `1`, protože studio obsluhuje jedna osoba. Pokud migrace hlásí slot s jinou kapacitou, před opakováním rolloutů jej ručně prověř a oprav; nesnižuj hodnotu naslepo, dokud neověříš případné souběžné rezervace.
- Pokud admin hlásí, že ruční rezervace „ukazuje jiný čas než se pak uloží“, ověř, že client preview stále používá Prague helper `resolvePragueLocalDateTime(...)` a ne lokální `new Date(...)` z browser timezone. Platí to pro drawer `Přidat rezervaci` i pro `Přesunout termín`.
- Pokud se při výběru konkrétního slotu v adminu vrací chyba dostupnosti po změně služby nebo po delší prodlevě, je to očekávané: slot-mode už nesmí tiše vytvořit interní výjimku. Pro záměrnou interní výjimku použij režim ručního data/času.
- Pokud ruční booking pro vybranou existující klientku odchází bez e-mailu, backend má zachovat původní `Client.email`; prázdné pole ve formuláři není signál pro smazání kontaktu. Opačné chování ber jako regresi.
- Pokud admin login po odeslání formuláře vrací `error=origin_check_failed`, zkontroluj `NEXT_PUBLIC_APP_URL`, reverzní proxy hlavičky `Host` / `X-Forwarded-Host` a že formulář opravdu běží na stejném originu jako `/admin/prihlaseni`.

## Příklad `.env` a význam hlavních proměnných

```dotenv
NODE_ENV=development
NEXT_PUBLIC_APP_NAME=PP Studio
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SITE_DOMAIN=ppstudio.cz
VOUCHER_PUBLIC_DOMAIN=ppstudio.cz
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=replace-with-openssl-rand-base64-32
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ppstudio?schema=public"
SHADOW_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ppstudio_shadow?schema=public"
ADMIN_SESSION_SECRET=replace-with-long-random-secret-at-least-32-chars
EMAIL_DELIVERY_MODE=log
EMAIL_TRANSPORT=smtp
MEDIA_STORAGE_ROOT=/var/www/ppstudio-uploads
```

- `NEXT_PUBLIC_APP_URL` je runtime URL aplikace pro redirecty a e-mailové odkazy.
- `NEXT_PUBLIC_SITE_DOMAIN` a `VOUCHER_PUBLIC_DOMAIN` pomáhají držet veřejnou textovou doménu konzistentní ve voucher PDF a kontaktních výstupech.
- `NEXT_PUBLIC_SITE_URL` je doporučená kanonická veřejná URL pro SEO metadata a JSON-LD (při chybějící hodnotě fallback na `NEXT_PUBLIC_APP_URL`).
- `NEXT_PUBLIC_GOOGLE_ADS_ENABLED` a `NEXT_PUBLIC_GOOGLE_ADS_ID` volitelně zapínají veřejný Google Ads tag (`gtag.js`, typicky `AW-*`).
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` je povinný stabilní klíč pro Next.js Server Actions; v produkci musí zůstat stejný mezi instancemi stejného buildu.
- `DATABASE_URL` je hlavní aplikační databáze.
- `SHADOW_DATABASE_URL` používá Prisma při `migrate dev`.
- `ADMIN_SESSION_SECRET` podepisuje admin session cookie a musí být unikátní pro prostředí.
- Admin login/logout route navíc kontrolují stejný `Origin` a důvěryhodný host proti `NEXT_PUBLIC_APP_URL`; při nesouladu login skončí `error=origin_check_failed` a logout vrátí `403`.
- Recovery admin přístupu nepoužívá env přihlášení; použij auditovatelný offline příkaz `admin:recover-owner`.
- `EMAIL_DELIVERY_MODE=log` je bezpečný lokální režim bez SMTP odesílání.
- `EMAIL_TRANSPORT` určuje background transport (`smtp` nebo `resend`).
- `MEDIA_STORAGE_ROOT` je zapisovatelná absolutní cesta mimo repo pro nahraná média.
- Admin upload médií běží přes Next.js Server Actions. Aplikační limit obrázku je `8 MB`, ale `next.config.ts` drží request limit `10mb`, aby multipart overhead nesrazil legitimní upload ještě před serverovou validací.
- Produkční nasazení s veřejnými formuláři nad Next.js Server Actions musí používat jednotný `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` pro všechny instance stejného buildu a zároveň posílat konzistentní `NEXT_DEPLOYMENT_ID` nebo `DEPLOYMENT_VERSION` / `GIT_HASH`, ze kterých `next.config.ts` skládá `deploymentId`. Jinak po deployi hrozí `Failed to find Server Action` u uživatelky se starším otevřeným tabem.
- Při doporučeném rolloutu přes `deploy/release.sh` se `NEXT_DEPLOYMENT_ID` do `.env` běžně nepíše ručně; skript ho pro každý build automaticky nastaví na aktuální git commit a vedle build env ho zapíše i do `.release-env` pro runtime logy a incident diagnostiku. V `.env` tedy drž hlavně stabilní `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.
- Next.js runtime teď zapisuje při startu i při zachycené request chybě strukturované logy s prefixy `ppstudio.next.register` a `ppstudio.next.request-error`. U `Failed to find Server Action` log obsahuje bezpečný fingerprint `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, aktivní `deploymentId`, příchozí `x-deployment-id`, route context, sanitizovanou path bez raw tokenů a nově i shrnutí `next-action` headeru (`length`, fingerprint, krátký sample, `looksMalformed`) pro odlišení stale klienta od scan/probingu.

Detailní seznam všech env proměnných je v [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).
Praktický přehled hlavních HTTP endpointů je v [`docs/API.md`](docs/API.md).

## Monitoring a provozní SLA minimum
- Externí monitoring má pravidelně volat `GET /api/health`; při `503` nebo timeoutu ber stav jako incident.
- `GET /api/health/live` ověřuje pouze běh webového procesu; `GET /api/health` přidává jediný DB readiness dotaz a nevrací interní metadata.
- Detail fronty, workeru a release identity načti po owner přihlášení z `GET /api/health/diagnostics`; konkrétní příčinu chyb hledej v `journalctl -u ppstudio-web.service`.
- Při nedostupné DB endpoint vrací pouze stabilní `error.code=DATABASE_UNAVAILABLE`, nikdy raw detail ovladače nebo připojení. Owner alert je best-effort, neblokuje odpověď a v jednom procesu se pro tento stav odešle nejvýše jednou za 10 minut.
- Vedle webu sleduj i běh `ppstudio-web.service` a `ppstudio-email-worker.service`.
- Pravidelně kontroluj, že e-mailová fronta nemá rostoucí `failed`, `retrying` nebo `stale` záznamy.
- Po každém releasu proveď minimální smoke test: homepage, admin login a vytvoření testovací rezervace.
- Pokud používáš Matomo reporting pro dashboard, po změně konfigurace nebo incidentu spusť `npm run analytics:check`.

## Verzování (SemVer)
- Projekt používá Semantic Versioning `MAJOR.MINOR.PATCH` v `package.json`.
- Aktuální release je `3.28.0`; stabilní řada projektu začala verzí `1.0.0`.
- `PATCH` (`0.1.0 -> 0.1.1`) zvyšuj při opravách chyb, interním refaktoru bez změny chování a technických úpravách bez dopadu na veřejné rozhraní.
- `MINOR` (`0.1.0 -> 0.2.0`) zvyšuj při přidání nové funkce nebo rozšíření existující funkcionality zpětně kompatibilním způsobem.
- `MAJOR` (`0.1.0 -> 1.0.0` nebo `1.x.y -> 2.0.0`) zvyšuj při nekompatibilní změně API, datového kontraktu, routingu nebo provozního chování, které vyžaduje zásah uživatele/operátora.
- Každé zvýšení verze musí mít odpovídající záznam v `CHANGELOG.md` pod sekcí `Unreleased`.
- Před release se verze v `package.json` a `package-lock.json` mění atomicky jedním commitem společně s finální podobou release poznámek.

## Aktuální Stav Projektu
- Projekt běží na Next.js 16 App Routeru se strukturou oddělenou na public web, booking a admin.
- Veřejný shell (`SiteShell`) inicializuje volitelný Matomo tracking přes `NEXT_PUBLIC_MATOMO_ENABLED`, `NEXT_PUBLIC_MATOMO_URL` a `NEXT_PUBLIC_MATOMO_SITE_ID`; admin route group tracking komponentu nepoužívá a při přítomné admin session cookie `ppstudio-admin-session` Matomo nenačítá ani na veřejných stránkách.
- Veřejný shell (`SiteShell`) umí volitelně inicializovat i Microsoft Clarity přes `NEXT_PUBLIC_CLARITY_ENABLED` a `NEXT_PUBLIC_CLARITY_PROJECT_ID`; Clarity běží jen na veřejných/booking stránkách, nepouští se pro přihlášený admin session kontext a neinicializuje se na tokenových self-service routách.
- Veřejný shell (`SiteShell`) umí volitelně inicializovat i Google Ads tag přes `NEXT_PUBLIC_GOOGLE_ADS_ENABLED` a `NEXT_PUBLIC_GOOGLE_ADS_ID`; tag běží jen na veřejných/booking stránkách, nepouští se pro přihlášený admin session kontext, neinicializuje se na tokenových self-service routách a při klientské navigaci v App Routeru dopošle další pageview přes `gtag('config', ...)`.
- Veřejný shell (`SiteShell`) umí volitelně inicializovat i Meta Pixel přes `NEXT_PUBLIC_META_PIXEL_ENABLED` a `NEXT_PUBLIC_META_PIXEL_ID`; Pixel běží jen na veřejných/booking stránkách, nepouští se pro přihlášený admin session kontext a neinicializuje se na tokenových self-service routách.
- Meta Pixel nad rámec `PageView` sleduje i klíčové neosobní funnel kroky: `ViewContent` na detailu služby, custom `BookingServiceSelected` při výběru služby, `BookingDateSelected` / `BookingTimeSelected`, `InitiateCheckout` až po výběru termínu, `BookingContactStarted` při první interakci s kontaktem a po úspěchu `Schedule`. `Schedule` není platba a bez jednoznačné finální ceny neobsahuje hodnotu.
- Web Vitals tracking má vlastní klientský feature flag `NEXT_PUBLIC_WEB_VITALS_ENABLED` (default `true`), takže měření lze vypnout nezávisle na pageview/event trackingu v Matomo.
- Matomo bootstrap na veřejném webu běží přes inline `next/script` s `afterInteractive`, aby tokenové self-service stránky měly bezpečnou `_paq` queue připravenou spolehlivě hned po interaktivitě. `MatomoTracker` i helper `ensureMatomoTrackingPath` sdílí stejný bootstrap stav, takže ani při pomalejší hydrataci nebo CI se neztratí první bezpečné `setCustomUrl` pro tokenové route a raw tokenové URL se dál nikdy neposílají.
- Booking-only layout styly pro landscape header a sticky CTA jsou načítané jen v route group `(booking)` přes `src/app/(booking)/booking-layout.css`; homepage je nedostává z root globálního CSS.
- Homepage hero preferuje jako LCP kandidát logo: je preloadované přes `next/image`, zatímco portrait běží bez priority, aby první vykreslení nebylo bržděné konkurenčním načítáním.
- Veřejné kontaktní e-maily se uživatelkám zobrazují v běžném čitelném tvaru s `@`, ale veřejný web dál nesází surové `mailto:` přímo do SSR HTML; kontaktní odkazy se skládají až v klientu přes `ObfuscatedEmailLink`.
- Matomo měří pageview veřejných stránek a booking flow včetně klientských App Router navigací, ale neposílá pageview pro `/admin`, `/api`, Next internals ani tokenové self-service route `/rezervace/sprava/*`, `/rezervace/storno/*`, `/rezervace/akce/*`.
- Veřejný web obsahuje statický ověřovací soubor Seznam Webmasteru v `public/seznam-wmt-cjKzOuv71FG0TOfkMT7WBqHwAXFWhvum.txt`; po nasazení musí být dostupný na `https://ppstudio.cz/seznam-wmt-cjKzOuv71FG0TOfkMT7WBqHwAXFWhvum.txt`.
- Rezervační flow posílá pouze neosobní eventy `Rezervace / Služba vybrána`, `Datum vybráno`, `Čas vybrán`, `Kontakt zahájen`, `Odeslána rezervace`, `Formulář chyba`, `Termín konflikt při odeslání` a po úspěchu `Vytvořena`; při prázdném stavu katalogu navíc umí zaznamenat `Rezervace / Bez služeb` nebo `Rezervace / Bez termínů`. První krok dashboard funnelu (`viewed`) se už nebere z custom eventu, ale ze samotných pageview `/rezervace` v Matomu. Self-service změna termínu posílá bezpečné `Rezervace / Datum vybráno` a `Rezervace / Čas vybrán`. Předvyplnění služby přes URL (`/rezervace?service=...`) se zapisuje samostatně jako `Rezervace / Služba předvyplněna`, ale už neduplikuje funnel event `Služba vybrána`; ten zůstává jen pro skutečné ruční zvolení služby v UI. `Datum vybráno` je v booking flow i self-service deduplikované na první výběr konkrétního dne, takže klik na následný čas v tom samém dni už neposílá druhý stejný date event. `Kontakt zahájen` se odešle až při první interakci s kontaktním polem, `Formulář chyba` agreguje klientskou chybu kontaktního kroku nebo serverový submit error a `Termín konflikt při odeslání` se spouští jen pro konflikt/invalidaci vybraného slotu. Jméno, e-mail, telefon, poznámka ani tokeny se do analytics neposílají.
- Self-service správa rezervace navíc bezpečně měří `Rezervace / Změna termínu otevřena`, `Rezervace / Změna termínu odeslána`, `Rezervace / Storno odesláno` a `Rezervace / Storno dokončeno`; privacy guard v helperu blokuje jen PII a raw tokenové cesty, ne samotné slovo `storno`.
- Playwright smoke pokrývá i veřejné storno přes token: tokenová stránka nesmí poslat pageview s raw URL, ale po kliknutí na potvrzení musí projít bezpečné Matomo eventy `Storno odesláno` a `Storno dokončeno` bez úniku tokenu do `_paq`.
- Předvyplněný vstup na `/rezervace?service=...` z veřejného ceníku nebo detailu služby nově posílá i samostatný event `Rezervace / Služba předvyplněna`, takže v Matomu lze odlišit intent-rich vstup z jiné stránky od ručního výběru služby až uvnitř booking flow.
- Volitelný telefon v rezervaci se zadává přirozeně (`777 123 456`, `+420 777 123 456`, `00420 777 123 456`), ale do `Client.phone` a booking snapshotu se ukládá normalizovaně bez mezer v mezinárodním tvaru (`+420777123456`). Text, HTML a nejasná krátká čísla server odmítá hláškou s příklady formátu.
- Poznámka od klientky se ukládá k rezervaci a v provozním e-mailu o nové čekající rezervaci se ukáže majiteli/salonu jako kontext pro schválení. Klientské booking e-maily ji dál neobsahují.
- Když klientka přes self-service web přesune termín rezervace, na `notificationAdminEmail` nově odchází i provozní notifikace `Rezervace přesunuta klientkou` s původním/novým termínem a přímým odkazem na detail rezervace v adminu.
- V Matomo lze ručně nastavit Goal pro vlastní Matomo přehledy: název `Rezervace vytvořena`, trigger `custom event`, category `Rezervace`, action `Vytvořena`. Admin widget ale hlavní počet rezervací bere přímo z eventu `Rezervace / Vytvořena`, aby KPI a funnel držely stejnou definici.
- Server-side dashboard analytics používají `MATOMO_URL`, `MATOMO_SITE_ID` a tajný `MATOMO_AUTH_TOKEN` v `src/lib/analytics/matomo.ts`; token není `NEXT_PUBLIC_*`, nepatří do klientského bundle a při chybě nebo chybějící konfiguraci vrací dashboard nulové fallbacky.
- Admin dashboard může tato data číst přes `/api/admin/analytics`; endpoint je přístupný jen pro přihlášené role `OWNER` a `SALON`, vrací pouze agregované počty bez PII a při interní chybě spadne na bezpečný JSON fallback.
- Pro dashboard je připravená klientská komponenta `src/components/admin/AnalyticsWidget.tsx`; sama řeší `fetch('/api/admin/analytics')`, loading, error a kompaktní souhrn `Výkon webu` s návštěvami, rezervacemi a mírou rezervace.
- Rozbalení `Zobrazit analytiku` obsahuje hlavní funnel `Zobrazení -> Služba -> Termín -> Kontakt -> Odesláno -> Rezervace` a mini sekci `Kvalita kontaktního kroku`: `zahájeno`, `fokus pole`, `začátek vyplnění`, `chyba pole` + procenta vůči `Kontakt zahájen`.
- Admin přehled je kompaktní denní provozní cockpit: hlavní osa je `Provozní přehled -> Vyžaduje pozornost -> provozní KPI -> Dnešní plán / Nejbližší volné termíny`, zatímco rychlé akce, týdenní souhrn a výkon webu jsou v pravém sloupci jako podpůrné bloky. Na desktopu je horní část záměrně nízká, aby byl bez dlouhého scrollu vidět hlavní provoz dne.
- Hlavní dashboard CTA `Vytvořit rezervaci` už nevede jen do seznamu rezervací, ale rovnou otevírá drawer ruční rezervace (`?create=1`), takže kosmetička nezačíná další klik navíc.
- `Dnešní plán` a karta `Další rezervace` na dashboardu nově ukazují i provozní mikroakce `Volat`, `E-mail` a `Nová rezervace`, aby šlo obvolat klientku nebo rovnou navázat dalším termínem bez otevírání detailu bookingu.
- Sekce `Nejbližší volné termíny` už neslouží jen jako přehled. Každé volné okno má akci `Přidat rezervaci`, která otevře admin drawer s předvyplněným dnem a časem.
- Týdenní planner `Volné termíny` přidal do `Inspektoru dne` zkratky `Přidat rezervaci do dne` a `Rezervovat vybraný blok`. Otevírají stejný ruční booking drawer s předvyplněným dnem nebo konkrétním blokem, ale server pořád drží běžnou validaci kolizí a délky služby.
- Detail rezervace v adminu nově umí vedle změny stavu, ceny, voucheru a termínu také akci `Změnit službu`. Akce je určená pro situaci, kdy se na místě domluví jiný typ péče, ale rezervace má zůstat stejným bookingem.
- `Změnit službu` je povolené jen u čekajících a potvrzených rezervací. Server při uložení přepočítá délku služby, cleanup blokaci, ceníkový základ a ověří, že se nová služba stále vejde do rezervovaného času a nepere se se službovým voucherem.
- Blok `Vyžaduje pozornost` se vykreslí jen když existuje alespoň jeden actionable alert (`emphasis !== ok`); pokud nic nehoří, blok se úplně skryje. Pokud alerty existují, UI zvýrazní jeden primární alert (`emphasis=primary`, případně první dostupný) a ostatní drží jako kompaktní sekundární položky.
- Pokud je blok `Vyžaduje pozornost` zobrazený, alert text na mobilu se musí lámat do více řádků (bez `truncate`) a CTA může padat pod text; karta nesmí horizontálně přetékat mimo viewport.
- Actionable alerty v `Vyžaduje pozornost` aktuálně pokrývají jen skutečně akční provozní problémy: čekající rezervace na potvrzení, selhané e-maily a rezervace po konci termínu čekající na uzavření.
- Absence slotů dnes/zítra není sama o sobě problém: sekce `Nejbližší volné termíny` používá neutrální text (`Momentálně nejsou publikované žádné nadcházející volné termíny.`) a pokud existují draft sloty, zobrazí stav s počtem návrhů čekajících na publikování a odkazem do dostupnosti.
- Rychlé akce v pravém sloupci nejsou primární místo pro vytvoření rezervace; hlavní CTA zůstává nahoře v `Provozní přehled`. Pravý blok drží podpůrné vstupy `Rezervace`, `Dostupnost`, `Klienti` a `Vouchery`.
- Detailní zdroje návštěv a funnel jsou v dashboardu až v rozbalení `Zobrazit analytiku`, aby hlavní obrazovka nezobrazovala matoucí analytické hodnoty před provozními úkoly.
- Sekce `Zdroje návštěv` v tomto widgetu kombinuje Matomo kampaně a referrer typy do business názvů `Instagram`, `Firmy`, `Google`, `Přímý vstup` nebo `Ostatní`; rezervace u zdrojů jsou výslovně jen orientační odhad podle podílu návštěv na dokončených `Rezervace / Vytvořena`, ne přesná atribuce.
- Když je Matomo reporting rozbitý nebo zamčený, dashboard už neukazuje jen obecné nuly: `/api/admin/analytics` vrací i stav reportingu a widget vypíše provozní hlášku. Rychlá serverová kontrola funguje přes `npm run analytics:check`.
- V detailu owner `Email logu` akce `Znovu odeslat e-mail` založí nový `PENDING` log s aktuálním e-mailem kontaktu jako nový pokus; historický `recipientEmail` původního záznamu se kvůli auditu nikdy nepřepisuje.
- Admin detail rezervace musí i při dlouhém jménu, e-mailu nebo hlášce po přesunu termínu zalamovat text uvnitř karet; success bannery, historie i key/value souhrny nesmí horizontálně přetékat mimo panel.
- Aktuální runtime stack podle `package.json`:
  - `next` `16.3.1`
  - `react` `19.2.8`
  - `react-dom` `19.2.8`
  - `prisma` + `@prisma/client` `7.9.1`
- Veřejná část aktuálně pokrývá:
  - homepage
  - landing page `Dárkové vouchery` na `/vouchery` s CTA na domluvu voucheru a veřejné ověření kódu
  - služby a detail služby
  - ceník rozdělený podle kategorií přes celou šířku obsahu
  - o mně
  - kontakt
  - FAQ
  - storno podmínky
  - obchodní podmínky
  - GDPR
  - veřejné noindex ověření voucheru na `/vouchery/overeni`
- Veřejný obsah je centralizovaný v `src/content/public-site.ts`, aby šly texty a hlavní brand copy měnit bez zásahu do layout komponent.
- Klientská copy veřejného webu má reflektovat, že salon provozuje jedna osoba. Jednotné číslo používej tam, kde mluví přímo provozovatelka (`doporučuji`, `pošlu`, `můžete mě kontaktovat`); přirozené společné formulace s klientkou (`společně doladíme`) a studio jako místo (`k nám`) zůstávají v pořádku.
- Mobilní veřejný header má ukázat všechny položky `mainNavigation` jako čitelnou mřížku `2 × 3` a samostatné CTA `Rezervace`; cílem je zachovat úplnou orientaci bez mačkání textu do jedné řádky.
- Veřejný header používá desktop navigaci až od `lg`; `md` včetně iPad portrait zůstává v kompaktním tablet režimu (brand + CTA + mřížková navigace), aby se pravé CTA ani položky menu neusekávaly mimo viewport.
- Hero sekce `/kontakt` používá samostatnou publikovanou fotku z media knihovny (`CONTACT_PHOTO`) jako pravý above-the-fold vizuál; pokud zatím není nahraná, zobrazí decentní placeholder a nesahá do fotek studia.
- Globální SEO popis a fallback kontakty používají skutečné údaje PP Studia: `info@ppstudio.cz`, `+420 732 856 036` a `Sadová 2, 760 01 Zlín`; placeholder kontakty se nemají vracet ani při chybě DB settings.
- Veřejné e-mailové odkazy používají `ObfuscatedEmailLink`, ale výsledné HTML musí vždy obsahovat skutečný `mailto:` odkaz; nepoužívej dočasné `href="#"`, protože kontakt musí fungovat i před hydratací klientského JS.
- Stručná komunikace storno pravidla na homepage a ve FAQ má být benefit-first a klientsky srozumitelná: nepoužívej interní názvy typu `storno okno` ani procesní věty o tom, jak jsou pravidla komunikovaná; preferuj krátké formulace typu `Změna nebo zrušení termínu je možné nejpozději 24 hodin předem.` nebo kontextovou variantu se stejným významem.
- `/storno-podminky` už nepoužívá jen generický právní text; stránka má vlastní akční skladbu `hero -> kontaktní box -> rychlý přehled pravidel -> krátké sekce`, aby klientka během pár sekund viděla co dělat a jaké dopady má pozdní storno nebo no-show.
- Copy na `/storno-podminky` je nyní záměrně měkčí: zdůrazňuje včasné oznámení a provozní dopad pozdního zrušení, ale automaticky nekomunikuje storno poplatek; zároveň výslovně odkazuje i na storno link v potvrzení rezervace a 24h reminderu.
- FAQ na `/faq` už není plochý seznam několika otázek; stránka používá skladbu `hero s jemným CTA -> pravý informační box první návštěvy -> rychlá sekční navigace -> tematické accordion bloky`.
- Homepage i FAQ nově jemně promují samostatnou voucher landing page `/vouchery`, ale hlavní priorita veřejného webu zůstává rezervace a orientace v péči.
- Landing page `/vouchery` už není jen stručný teaser; obsahuje i rozhodovací scénáře pro výběr mezi konkrétní službou a hodnotovým voucherem a krátký průběh domluvy, aby pomáhala při reálném nákupním rozhodování.
- FAQ copy je záměrně orientované na rozhodnutí před první návštěvou: řeší výběr služby, průběh první návštěvy, praktické detaily, komfort, organizaci i stručné storno shrnutí s odkazem na samostatnou stránku podmínek.
- FAQ odpovědi zůstávají serverově vypsané v HTML přes nativní `details/summary`; JSON-LD `FAQPage` se skládá ze stejného `FaqSection -> FaqItem` modelu a nesmí obsahovat otázky, které nejsou na stránce reálně vidět.
- FAQ pokrývá i praktické rozhodovací otázky před rezervací: objednání bez přesného výběru služby, potvrzení rezervace, úpravu péče podle stavu pleti, doporučenou frekvenci kosmetiky, příchod s make-upem, citlivou pleť, běžnou citlivost úpravy obočí, výdrž barvení obočí, dárkové vouchery, adresu studia a odkaz na parkování na `/kontakt#parkovani`.
- FAQ nově zahrnuje i konkrétní rozhodování mezi kosmetickým ošetřením, lash liftingem a laminací obočí, výdrž lash liftingu a laminace obočí, vhodnost návštěvy při podráždění očí a rozdíl mezi voucherem na službu a voucherem na hodnotu.
- Rezervační stránka `/rezervace` musí mít v HTML právě jeden hlavní `h1` nadpis pro veřejné booking flow; aktuálně je to text `Vyberte si termín, který vám nejlépe vyhovuje.` nad samotným formulářem.
- Reálné služby z DB dostávají veřejnou copy vrstvu v `src/features/public/lib/public-services.ts`, ale zdrojem pravdy je model `Service`.
- Katalogová i veřejná textová data (`name`, `slug`, cena, délka, dostupnost, kategorie, pořadí, `publicIntro`, `description`, `pricingShortDescription`, `seoTitle`, `seoDescription`, `idealFor`, `includes`, `benefits`, `goodToKnow`) čte veřejný web z DB.
- Služba má interní pole `cleanupMinutes` pro čas na úklid po službě. Hodnota má výchozí `0`, nastavuje se v admin detailu služby, klientce se nezobrazuje jako délka služby a používá se jen pro interní blokaci dostupnosti po skončení služby.
- Veřejná i self-service rezervace nově vyžadují, aby se do publikovaného okna vešla samotná služba; cleanup blokace může přetéct za konec slotu. Navazující termíny se ale dál blokují až do `blockedUntil`, takže další start se nabídne teprve po interním cleanup intervalu.
- Stejné pravidlo platí i pro admin planner: seznam `Volná okna` nesmí spoléhat jen na `Booking.slotId`, ale musí odečíst i cleanup blokaci přetékající do sousedního publikovaného slotu.
- Stejné pravidlo teď drží i dashboard sekce `Nejbližší volné termíny`: zobrazené řádky jsou souvislá volná okna po odečtení booking blokací `scheduledStartsAt -> blockedUntil`, ne jen začátky jednotlivých publikovaných slotů se zdánlivě volnou kapacitou.
- Když se rezervace zruší a okolo jejího slotu zůstanou sousední běžné publikované fragmenty bez aktivních rezervací, systém je nově při stornu automaticky sloučí zpět do jednoho souvislého slotu. Tím se dostupnost po starších bookinzích sama čistí a nevznikají trvalé zbytky typu `:15` / `:45`, pokud už pro ně není reálný důvod.
- V planner mřížce se cleanup zobrazuje žlutě uvnitř stále 30min buňky: při 15min overflowu obarví horní nebo dolní polovinu, při plné 30min cleanup blokaci je žlutá celá buňka. Druhá polovina buňky dál drží svůj stav (`zelená` dostupnost, `červená` rezervace, případně jiné omezení) a legenda má pro cleanup samostatnou položku `Úklid`.
- Rezervační výběr služby používá DB `publicIntro`; strukturovaný copy override podle slugu není trvalý zdroj obsahu a smí sloužit jen jako dočasný backfill zdroj.
- Ceník na `/cenik` má vlastní modul v `src/features/public/components/pricing-page.tsx` a je rozdělený do jasné kompozice `hero -> category chips -> hlavní sekce -> menší grid sekce -> finální CTA`.
- Katalog služeb a kategorií teď nese i veřejná pricing metadata:
  - služba: `publicIntro`, `seoDescription`, `pricingShortDescription`, `pricingBadge` (název je sjednocený v poli `name` pro web i rezervace)
  - kategorie: `pricingDescription`, `pricingLayout`, `pricingIconKey`, `pricingSortOrder`; veřejný web i booking používají aktuální `ServiceCategory.name`
- `/sluzby`, `/cenik` i `/rezervace` musí používat stejné mapování kategorií nad aktuálním `ServiceCategory.name` a stejné pořadí podle `sortOrder`.
- Public pricing read model má runtime guard: jedna služba (`slug`) smí být v ceníku právě jednou; duplicita přes více kategorií je validační chyba.
- Homepage sekce `Doporučené služby` používá ruční výběr z katalogu: `Service.isFeaturedOnHomepage = true` a `homepageSortOrder`. Zobrazuje maximálně první tři aktivní veřejně rezervovatelné služby v aktivních kategoriích; pokud není vybraná žádná, zůstává fallback na první tři veřejné služby podle katalogového pořadí.
- Admin sekce `Služby` a `Kategorie služeb` tato metadata umí upravovat bez zásahu do databáze nebo kódu.
- V klientských admin workspaces nad React `useOptimistic` (např. rychlé akce kategorií) musí optimistic dispatch běžet uvnitř `startTransition(...)`; volání mimo transition vyhazuje runtime warning a degraduje UX při rychlých mutacích.
- Admin sekce `Služby` už nepoužívá vysoké katalogové karty; seznam je nově seskupený podle kategorií a funguje jako hustší provozní workspace.
- Každá skupina kategorií v adminu ukazuje počet služeb a jde rozbalit/sbalit; samotná služba má kompaktní řádek a sekundární kontext je až v rozbalení nebo v pravém detail draweru.
- KPI pás sekce `Služby` je nyní čistě katalogový souhrn aktuálního běžného pohledu: `Veřejné služby`, `Kategorie`, `Interní / skryté` a `Vyžaduje kontrolu`.
- Souhrnný řádek seznamu služeb drží jen provozní minimum `V seznamu / Skupin / Viditelné / Upozornění` a explicitně připomíná, že systémové/testovací položky zůstávají v běžném katalogu skryté.
- Rychlé změny služby se v seznamu soustředí do malého menu `⋯`; základní desktop řádek zůstává jednovrstvý a ukazuje jen název, délku, cenu, počet rezervací a badge stavu.
- Toolbar sekce `Služby` už nepoužívá duplicitní mezihlavičku; nad seznamem zůstává jen `Přehled služeb`, jediné CTA `Nová služba` je v horní stránkové hlavičce a legenda stavů je schovaná do malého rozbalovacího prvku.
- Ceník už nepoužívá vedlejší blok s poznámkami; detail služby zůstává místem pro doplňující vysvětlení.
- Veřejné stránky drží jednotný šířkový rytmus přes sdílený `Container` (`max-w-7xl`); při úpravách layoutu nepřidávej další globální zúžení sekcí přes `mx-auto max-w-*`.
- Vertikální spacing veřejných sekcí je sjednocený do rytmu `py-10 / sm:py-14 / lg:py-16`; větší rozestupy používej jen pro obsahově výrazné bloky.
- Rezervační vrstva stojí na ručně vypisovaných termínech přes `AvailabilitySlot`, ne na pevné otevírací době.
- Ruční rezervace v adminu nově dovoluje vytvořit klientku i bez e-mailu, což pokrývá rezervace z Instagramu, telefonu nebo osobní domluvy; pokud adresa chybí, klientské potvrzení se záměrně neposílá.
- Pending rezervace lze nově potvrdit nebo zrušit přímo z provozního e-mailu přes bezpečné jednorázové odkazy s mezikrokem potvrzení na veřejné route `/rezervace/akce/[intent]/[token]`.
- Admin sekce `Rezervace` používá nízkou stránkovou hlavičku s CTA `Přidat rezervaci`, jeden společný horní panel pro rychlé i detailní filtry a tenký KPI strip `Čeká na potvrzení / Dnes / Tento týden / Bez kontaktu`.
- Mobilní toolbar rezervací musí zůstat uvnitř pracovní karty: formulářové položky používají `min-w-0`, nativní date inputy nesmí roztlačit grid a kompaktní admin panel má na telefonu menší boční padding.
- Pracovní seznam rezervací je serverově seskupený do bloků `K uzavření`, `Čeká na potvrzení`, `Nadcházející` a `Minulé`. `K uzavření` je úplně nahoře a obsahuje aktivní proběhlé rezervace (`Čeká` nebo `Potvrzená`), kterým už skončil termín, ale ještě nejsou uzavřené jako `Hotovo`, `Zrušená` nebo `Nedorazila`.
- Dlouhé seznamy rezervací používají progresivní odkrývání: `Minulé` jsou výchozně sbalené, každá sekce ukazuje jen první várku položek a další rezervace se načítají přes `Zobrazit další` se zachováním filtrů i URL stavu.
- Pole `Hledat` v rezervacích nabízí živé našeptávání nad databází; při běžném textu nabízí hlavně klientky a služby, zatímco kontakty se ukážou jen u dotazu, který vypadá jako e-mail nebo telefon. Výběr dál používá stejné URL-driven hledání jako ruční text.
- Pole `Hledat` v rezervacích se po krátké pauze při psaní filtruje automaticky; tlačítko `Filtrovat` zůstává jako explicitní fallback a výběr návrhu z našeptávače filtr použije hned.
- Quick akce `Potvrdit` v seznamu rezervací nečeká na dokončení Pushover HTTP callu; stav rezervace se uloží a UI se odblokuje i při pomalé externí notifikační vrstvě.
- Rezervace v adminu rozlišují `Kanál rezervace` a marketingové `Odkud přišla`: `Web` znamená, že rezervace vznikla přes veřejný booking flow, zatímco akviziční štítek `Instagram`, `Google`, `Firmy.cz / Seznam` nebo `Direct / bez kampaně` vychází z UTM/referreru. `Instagram zpráva` v kanálu rezervace je ručně zadaná rezervace z konverzace, ne webová UTM návštěva.
- Akviziční cookie normalizuje primárně `utm_*`, ale jako fallback přijímá i `mtm_source`, `mtm_medium` a `mtm_campaign`, aby se booking attribution neztratil ani u Matomo-tagovaných odkazů.
- Pracovní seznam drží sticky prvky jen tam, kde to dává smysl: na mobilu filtr bar scrolluje spolu s obsahem (nepřekrývá řádky), od `md` breakpointu výš zůstává nahoře pro rychlou práci v delším seznamu; hlavička tabulky drží kontext a akce v řádku vrací okamžitý inline feedback přes loading stav a toast.
- Mobilní pracovní seznam rezervací drží rychlé akce jako dva plnohodnotné dotykové ovladače vedle sebe (`Potvrdit`, `Otevřít`); rychlé filtry lze horizontálně posunout bez zalomení štítků a formulářové akce `Filtrovat` / `Zrušit filtry` mají stejnou snadno dosažitelnou výšku.
- V pracovním seznamu je teď nejvýraznější čas rezervace; uzavřené stavy `Hotovo` a `Zrušená` mají menší vizuální váhu, inline akce se liší podle stavu rezervace a chybějící kontakt se zobrazuje neutrálně jako `bez kontaktu`.
- Kontakt v řádku rezervace je praktický i na mobilu: telefon používá `tel:`, e-mail `mailto:` a mobilní zobrazení skládá compact card s pořadím `čas -> klientka -> služba -> stav`.
- Admin detail klientky na `/admin/klienti/[clientId]` a `/admin/provoz/klienti/[clientId]` je provozní CRM karta: nahoře odpovídá kdo je klientka, jak ji kontaktovat, kdy byla naposledy a jestli má další termín; pod hlavičkou je kompaktní `CRM souhrn` s poslední/příští návštěvou, hodnotou dokončených služeb, uhrazeno/neuhrazeno a rozpad rezervací. `Neuhrazeno` neukazuje budoucí aktivní rezervace jako dluh, ale jen doplatky u dokončených nebo už proběhlých aktivních rezervací. Historie návštěv a interní poznámka jsou vlevo, kontakt, zkrácený přehled klientky a tlumená metadata vpravo.
- V seznamu klientek (`/admin/klienti`, `/admin/provoz/klienti`) znamená sloupec i řazení `Poslední návštěva` poslední minulou dokončenou rezervaci (`COMPLETED`). Budoucí nebo ještě neuzavřený termín se do této hodnoty nepropisuje, i když profilové `Client.lastBookedAt` už může být aktualizované novou rezervací.
- Stejné pravidlo platí i pro jednodušší legacy přehled klientek renderovaný přes `admin-section-page`, aby se význam `Poslední návštěva` mezi různými admin pohledy nerozcházel.
- Starší URL `/admin/email-logy` zůstává pro bookmarky funkční, ale přesměruje na pohled E-maily v `/admin/logy?view=emails`.
- Generický admin fallback `AdminSectionPage` byl odstraněný. Každá reálná admin sekce teď má buď vlastní explicitní route soubor, nebo svou jasně pojmenovanou větev v `createAdminSectionRoute(...)`.
- Hlavní admin sekce používají sjednocený intro copy pattern: krátký kontext v eyebrow, jednoduchý pracovní název sekce a stručný provozní popis.
- E-maily jsou součástí společného přehledu Události a logy, takže s Událostmi, Pozorností a Systémem sdílejí filtry, řazení i stránkování.
- Kontakt klientky lze v detailu klientky upravit přímo v kartě `Kontakt`; server action validuje e-mail/telefon, hlídá duplicitní e-mail a změnu propíše do profilu, aktivních rezervací (`PENDING`/`CONFIRMED`) a dosud neodeslaných e-mail logů navázaných na tyto rezervace. Proběhlé rezervace (`COMPLETED`, `CANCELLED`, `NO_SHOW`) se nepřepisují a každý propis do aktivní rezervace ukládá auditní stopu do `BookingStatusHistory` s metadaty původního/nového kontaktu.
- Historie návštěv v detailu klientky u každé rezervace rozlišuje poznámky podle původu: `Klientka` ukazuje poznámku z rezervace, `Interně` ukazuje provozní poznámku týmu. Pokud existují obě, zobrazí se obě.
- V seznamu klientek (`/admin/klienti`, `/admin/provoz/klienti`) se detail klientky otevírá kliknutím na celý řádek/kartu; štítek `Detail` je součást stejné akce.
- Primární akce `Vytvořit rezervaci` v detailu klientky teď používá existující booking workspace `/admin/rezervace` nebo `/admin/provoz/rezervace` s query parametry `create=1&clientId=...`; ruční booking drawer se po otevření pokusí klientku předvyplnit, při neplatném ID zobrazí jemnou hlášku a při neaktivní klientce varování, ale formulář zůstává použitelný.
- Po potvrzení rezervace zákaznice dostává v potvrzovacím e-mailu `.ics` přílohu s jednou konkrétní kalendářovou událostí pro potvrzený termín, ne subscription feed.
- Booking e-maily čtou kontaktní údaje salonu z admin nastavení (`SiteSettings`): název, adresa, telefon a kontaktní e-mail se propisují do HTML i textové varianty. Pokud nastavení nebo DB nejsou dostupné, zůstávají bezpečné fallbacky PP Studia.
- HTML náhledy hlavních booking a admin e-mailů lze vygenerovat příkazem `npm run email:previews`; soubory se zapisují do `tmp/email-previews` a jsou určené jen pro lokální vizuální kontrolu copy/layoutu.
- Owner může v `/admin/nastaveni` nově zapnout chráněný Apple Calendar subscription feed na `/api/calendar/owner.ics?token=...`; feed je read-only, bere jen potvrzené rezervace a aplikace zůstává jediným source of truth.
- OWNER muze v `/admin/nastaveni` v bloku `Pushover notifikace` nastavit vlastni Pushover User Key, zapnout/vypnout notifikace a zvolit event typy `Nova rezervace`, `Rezervace ceka na potvrzeni`, `Rezervace potvrzena`, `Rezervace zrusena`, `Termin presunut`, `Selhani emailu`, `Selhani reminderu` a `Systemove chyby`. Blok je owner-only; `SALON` nema route ani navigaci do nastaveni a Pushover sluzba pred odeslanim znovu vybira jen aktivni DB uzivatele s roli `OWNER`.
- U upozornění `Nova rezervace` je navíc uvedeno `Klientka: Nova klientka` nebo `Klientka: Vracejici se klientka`; rozhoduje, zda má klientka v databázi starší rezervaci.
- Pushover aplikacni token je server-only env `PUSHOVER_APP_TOKEN`; globalni vypinac je `PUSHOVER_ENABLED=true`. Chyba Pushover API se pouze loguje a nikdy nesmi rozbit booking, email worker ani reminder flow.
- Pushover kod je rozdeleny na Next.js wrapper `src/lib/notifications/pushover.ts` se `server-only` markerem a worker-safe implementaci `src/lib/notifications/pushover-core.ts`, kterou smi nacitat standalone `email:worker` pres `tsx`.
- Event `Systemove chyby` uz realne pokryva vic nez jen verejne vytvoreni rezervace: owner alert se posila i pri neocekavane chybe self-service i admin presunu terminu, pri rucnim vytvareni rezervace, pri schema driftu verejneho booking flow, pri selhani planner mutaci volnych terminu, pri kritickych voucher akcich/emailu, pri padu DB health checku, pri failu enqueue navazneho reschedule emailu a kdyz `/api/admin/analytics` nebo owner resend invite API spadne do fallback/error stavu.
- Admin detail rezervace nově podporuje samostatnou akci `Přesunout termín`; booking zůstává stejným záznamem, ale změna projde backend validací, auditním logem, resetem reminder návaznosti a volitelným klientským e-mailem `Termín byl změněn`.
- Drawer `Přesunout termín` v admin detailu při skládání volných slotů nepočítá právě upravovanou rezervaci jako obsazenost. Pokud je před původním začátkem 30min publikované okno a délka služby se vejde přes toto okno plus vlastní původní slot, nabídne se posun na dřívější začátek.
- Hlavička detailu rezervace je statická (není plovoucí) na všech breakpointech, aby nepřekrývala rozhodovací panel a CTA při potvrzení služby.
- Horní hlavička detailu rezervace je záměrně nízká a dvouřádková: první řádek drží návrat, stav/kanál a rychlé akce, druhý řádek jméno klientky + službu, délku a termín jako kompaktní text (bez velkého termínového boxu).
- Pokud je vyplněná klientská nebo interní poznámka, detail rezervace ji zvýrazní badge štítkem už v hlavičce i v samotném panelu `Poznámky`, aby byla okamžitě viditelná.
- Admin detail rezervace už nefunguje jako dlouhá informační stránka; nově je to rychlý rozhodovací panel se statickou kompaktní hlavičkou, horním akčním blokem, kompaktním souhrnem v bočním sloupci a sjednoceným blokem poznámek. Na mobilu jde souhrn hned pod hlavičku, potom teprve `Další krok`, `Úhrada`, poznámky a historie.
- Panel `Další krok` je pracovní cockpit. U potvrzené rezervace má copy jasně říct, že termín je potvrzený a po návštěvě se má uzavřít jako hotový, případně označit jako `Nedorazila`. Primární provozní CTA je `Dokončit návštěvu`; `Přesunout termín` a `Nedorazila` jsou sekundární kroky. `Zrušit rezervaci` patří do samostatné sekce `Nebezpečná akce / Zrušení rezervace` s červeným varováním, důvodem a potvrzovacím tlačítkem, nikdy vedle hlavního provozního CTA.
- Pro provozní realitu salonu je hlavní CTA u potvrzené rezervace přejmenované na `Dokončit návštěvu`. Cockpit ukazuje platební kontext (`Doplatek` nebo `Platba vyřešena`) a při doplatku nabízí kompaktní completion flow: `Hotově`, `QR platba`, `Voucher`, `Kombinovaně` nebo `Bez platby`.
- Completion flow při doplatku zapisuje úhradu/voucher přímo v rámci dokončení návštěvy a pak přepne stav na `Hotovo`. Zvolená platba nebo voucher musí pokrýt celý doplatek; částečný voucher nechá návštěvu otevřenou, pokud admin vědomě nezvolí `Bez platby`.
- `Bez platby` je vědomá výjimka, vyžaduje povinný důvod a rezervace může zůstat `Hotovo` i s doplatkem.
- Kompaktní varianta detailu rezervace zkracuje vertikální výšku: horní cockpit používá krátký stavový řádek (`Potvrzený termín · Po návštěvě uzavři rezervaci.`), potvrzení akce je v jednom kompaktním řádku (vysvětlení + volitelný důvod + potvrzení) a sekce `Nebezpečné akce` je výchozně sbalená.
- Success potvrzení po akci `Přesunout termín` musí v panelu `Další krok` zůstat uvnitř své sekundární karty: grid item potřebuje dovolit shrink (`min-w-0`) a banner musí text zalamovat, jinak dlouhé datum/důvod přeteče přes completion flow.
- Admin detail rezervace má panel `Úhrada` s jasnou prioritou `Stav úhrady -> Cena k úhradě -> doplatek -> + Zapsat platbu -> Přehled úhrad`. Horní souhrn zůstává nejvýraznější a vždy ukazuje stav (`Bez úhrady` / `Částečně uhrazeno` / `Zaplaceno` / `Přeplaceno`), cenu k úhradě, uhrazeno celkem, voucher, mimo voucher a doplatek nebo přeplatek; právě doplatek je opticky nejdůležitější hodnota. Úprava individuální ceny se otevírá kompaktně přes `Upravit` přímo u položky `Cena k úhradě`; samostatný blok `Cena rezervace` se ve výchozím zobrazení nepoužívá. CTA `+ Zapsat platbu` je dobře viditelné, ale nesmí přebít hlavní akci `Dokončit návštěvu`; seznam existujících plateb se zobrazuje jen jednou v `Přehled úhrad`, kde je dostupné i smazání platby. Voucher se samostatně neuplatňuje a prázdný stav `Přehled úhrad` používá jemnou informaci `Žádné úhrady zatím nejsou evidované.`
- V kompaktním režimu `Úhrada` začíná stručným trio souhrnem `Doplatek / Uhrazeno / Voucher`; podrobnější platební historii je možné rozbalit přes `Detail úhrady`.
- Samostatná sekce `Úhrada` zůstává beze změny role: slouží pro dodatečné zápisy plateb, opravy, úpravy ceny a nestandardní situace mimo completion flow; skutečné voucherové čerpání se zde samostatně neprovádí.
- `OWNER` i `SALON` mohou v panelu `Úhrada` nastavit individuální cenu rezervace přes `Upravit cenu`. Prázdná hodnota nebo stejná částka jako ceníkový snapshot úpravu zruší; rozdílná cena vyžaduje důvod. Sleva ani navýšení nejsou platba, ale mění cenu k úhradě, ze které se počítají hodnotové vouchery, běžné platby, doplatek i CRM souhrn. Službový voucher je nárok na konkrétní službu; při uplatnění se řídí shodou služby, ne individuální cenou rezervace.
- Platební část `CRM souhrnu` v detailu klientky používá stejný helper `getBookingPaymentSummary(...)` jako detail rezervace. `Uhrazeno` sčítá skutečně zapsané platby a voucherová čerpání, včetně případných úhrad zapsaných předem. `Neuhrazeno` se ale počítá jen z rezervací ve stavu `COMPLETED` nebo z aktivních `PENDING`/`CONFIRMED` rezervací se začátkem v minulosti; budoucí aktivní, `CANCELLED` a `NO_SHOW` rezervace se do doplatku nezapočítávají.
- Platby mimo voucher se zapisují přímo v panelu `Úhrada` metodami `Hotově`, `Kartou`, `Převodem / QR` a `Jiné`. `OWNER` i `SALON` mohou platbu zapsat, mazání platby je dostupné jen pro `OWNER`. QR kód se v této verzi negeneruje, text `Převodem / QR` je pouze popisek platební metody.
- Pokud rezervace už nese intended voucher z veřejného flow, detail rezervace zobrazí tento záměr přímo v panelu `Úhrada`; samostatný formulář pro uplatnění se nezobrazuje. Skutečné čerpání použije kód v completion flow v sekci `Další krok`.
- Pokud je hodnota voucheru nižší než cena služby, voucher pokryje jen svůj zbývající zůstatek a zbytek ceny se řeší jako doplatek mimo voucher. Completion flow zobrazí maximální použitelnou částku, při ručním zadání ji omezí na dostupný zůstatek a po úspěchu informuje o zbývajícím doplatku.
- Veřejné booking flow v kontaktním kroku nabízí volitelné pole `Kód voucheru`. Pokud je prázdné, rezervace pokračuje beze změny; pokud je vyplněné, server kód při vytvoření rezervace ověří a uloží ho jen jako intended voucher na `Booking`.
- Skutečné čerpání voucheru v provozu vzniká pouze v serverové akci `completeBookingVisitAction()`, která v jedné transakci dokončí návštěvu a zapíše `VoucherRedemption`; samostatná kompatibilní admin akce je pouze odmítající pojistka. Samotné veřejné zadání nebo intent na `Booking` zůstatek nikdy neodečítá.
- Veřejná stránka `/vouchery/overeni` slouží jen ke kontrole platnosti kódu z poukazu nebo QR odkazu `/vouchery/overeni?code=...`. Formulář vždy dovolí kód změnit a znovu ověřit; výsledek se počítá server-side po normalizaci kódu. Po platném výsledku stránka nabízí pouze další krok na rezervaci termínu nebo napsání do studia, žádné uplatnění voucheru.
- Po otevření detailu je během pár sekund vidět klientka, služba, termín, stav a nejpravděpodobnější další akce; reschedule zůstává oddělený jako samostatný drawer a chování pro `OWNER` i `SALON` je stejné.
- Veřejný manage flow `/rezervace/sprava/[token]` má nově DB integrační coverage nad reálným Prisma wiringem; testy ověřují token access, self-service storno, self-service přesun i hlavní auditní a notifikační side effects bez browser E2E vrstvy.
- Self-service přesun přes `/rezervace/sprava/[token]` po úspěchu záměrně nerevaliduje právě otevřenou veřejnou route; v Next.js 16 by route refresh po server action mohl přemountovat klientský panel a smazat lokální success stav dřív, než se ukáže uživatelce.
- Veřejná stránka změny termínu je UX refaktorovaná do toku `kontext -> aktuální rezervace -> hybridní výběr termínu -> potvrzení -> sekundární storno`: nejbližší termíny jsou nahoře jako rychlé chips, kalendář slouží jako sekundární výběr dne a potvrzení je jediná dominantní CTA.
- Při self-service přesunu se aktuální rezervace vynechává z výpočtu obsazenosti katalogu, aby šel termín posunout i na dřívější začátek v publikovaném volném bloku před původním začátkem, pokud celý nový interval pořád pokrývá souvislý publikovaný řetězec a nekoliduje s jinou aktivní rezervací.
- Veřejná booking dostupnost už není omezená jen na jeden fyzický `AvailabilitySlot`; pokud na sebe publikované sloty bez mezery navazují a mají stejná veřejná pravidla, katalog je složí do jednoho delšího okna a delší služby se tak mohou rezervovat i přes více sousedních segmentů.
- Uvnitř takto složeného okna systém stále drží správný podkladový `slotId` pro vybraný start času a backend při vytvoření nebo přesunu termínu ověřuje celý souvislý řetězec segmentů bez mezer, blokací a kapacitních kolizí.
- Ve veřejném rezervačním formuláři klik na den v kalendáři přesouvá fokus na blok `Dostupné časy`; teprve výběr konkrétního času potom přesune uživatelku do kontaktního kroku.
- Kontaktní krok veřejného booking flow musí držet explicitní vazby polí na popisky, nápovědy a chybové texty (`id`, `htmlFor`, `aria-describedby`) a chybové hlášky oznamovat přes live regiony nebo alerty; viditelný `focus-visible` stav polí a odkazů má zůstat v akcentu PP Studia.
- Když rezervace využije jen část takového navazujícího řetězce, engine nově rozseká i krajní segmenty coverage, aby admin planner ukazoval skutečně volné okraje jako normální dostupnost a ne jako technicky chráněný zbytek slotu.
- Pro starší dev/legacy data existuje jednorázový repair helper `scripts/repair-legacy-chained-slots.mjs`. Nejdřív ho spusť bez parametrů jako dry-run; teprve pokud vypíše bezpečné `repairable` případy, můžeš použít `--apply`. Případy s více bookingy na jednom anchor slotu zůstávají záměrně ve `skipped` režimu.
- Implementačně je veřejný booking flow po stabilizačním refaktoru rozdělený do menších interních komponent (`progress panel`, `service step`, `term step`, `contact step`, `summary sidebar`), ale chování pro klientku zůstává stejné.
- Admin má dva směry použití:
  - full admin na `/admin/*` pro roli `OWNER`
  - lite admin na `/admin/provoz/*` pro roli `SALON`
- Obě rozhraní sdílejí stejné doménové entity, ale liší se navigací i hustotou UI:
  - `OWNER` vidí strategické a technické sekce navíc
  - `SALON` vidí jen provozní sekce a jednodušší copy bez technických pojmů
- Přesun termínu má pro `OWNER` i `SALON` stejné chování; role mění jen administrativní cestu, ne business logiku reschedule flow.
- Filtrační lišta sekce `Služby` je na desktopu sticky a zůstává během scrollu po ruce; horní statistiky jsou záměrně menší, aby nepřebíraly roli hlavního obsahu. Scope běžného katalogu se v toolbaru komunikuje jen přes malé pill stavy typu `Běžný katalog` a `Systémové skryté`.
- Sekce `Volné termíny / Týdenní plán dostupností` drží grid-first provozní workflow: horní hlavička je nízká, datum týdne se ukazuje jen v planner toolbaru a pravý panel je zhuštěný do bloků `Inspektor dne` a `Detail výběru`.
- V planneru má legenda stavů zůstat sekundární a sbalená u detailu výběru; čitelnost času se zvyšuje spíš kontrastem levé osy, jemným zvýrazněním celých hodin a jasnějším selected stavem než dalšími vysvětlovacími kartami.
- `CANCELLED` rezervace už v týdenním planneru nemá působit jako barevná nebo editační překážka. Historie zrušené rezervace se zachová v archivovaném slotu na pozadí, ale samotná mřížka má pro obsluhu ukazovat jen reálně důležitou dostupnost, aktivní rezervace a omezení.
- Týdenní planner dostupností a veřejná booking service vrstva jsou po stabilizačním refaktoru modulární i v kódu, ale bez změny URL, exportů nebo databázového modelu.
- Prisma schema v1 už pokrývá:
  - admin uživatele a role
  - kategorie služeb a služby včetně samostatné veřejné rezervovatelnosti
  - sloty s omezením na vybrané služby
  - klienty, rezervace a historii stavů
  - dárkové vouchery (`Voucher`, `VoucherRedemption`) včetně admin evidence, admin uplatnění a veřejného intended zadání při rezervaci
  - e-mailové logy, action tokeny, legacy `Setting`, singleton `SiteSettings` a metadata model `MediaAsset`
- Voucher systém má připravenou serverovou business vrstvu, admin evidenci a provozní detail:
  - hodnotový voucher (`VALUE`) drží původní a zbývající hodnotu v Kč a může být čerpaný postupně,
  - voucher na službu (`SERVICE`) drží snapshot služby v okamžiku vydání a po admin uplatnění se celý označí jako uplatněný,
  - veřejná validace voucheru při rezervaci pouze ověřuje použitelnost pro vybranou službu a nic neodečítá,
  - skutečné čerpání vzniká pouze admin/server akcí, která zapisuje `VoucherRedemption`; jedna rezervace smí mít nejvýše jeden uplatněný voucher.
- Admin evidence voucherů je dostupná pro `OWNER` na `/admin/vouchery` a pro `SALON` na `/admin/provoz/vouchery`.
- Seznam voucherů je na desktopu kompaktní tabulka se sloupci `Kód`, `Typ`, `Voucher`, `Čerpání / zůstatek`, `Stav`, `Platnost` a `Akce`; na menších šířkách přechází do nízkých karet.
- Horní část seznamu používá nízkou stránkovou hlavičku s CTA `Nový voucher` vpravo a ještě nižší metric strip `Voucherů celkem / Aktivní / Částečně čerpané / Uzavřené`; filtr `q / type / status` je dál URL-driven.
- KPI pás seznamu voucherů je provozní souhrn, ne jen evidence stavů: ukazuje `Zbývá k uplatnění`, `Otevřené vouchery`, `Brzy expirují` a `Uzavřené`. Součet `Zbývá k uplatnění` zahrnuje jen otevřené vouchery.
- Stavové badge voucherů patří přímo do sloupce `Stav`; `Aktivní` je zelený, `Částečně čerpaný` zlatý, `Uplatněný` tlumený a `Propadlý` varovný.
- Všechny voucher routy včetně detailu a vytvoření běží uvnitř standardního tmavého admin shellu; pokud voucher obrazovka vypadá světle nebo bez navigace, chybí příslušný route layout.
- Seznam voucherů podporuje hledání podle query parametru `q`, filtr typu `type=all|value|service` a filtr stavu `status=all|active|partially_redeemed|redeemed|expired|cancelled|draft`.
- Nový voucher lze vytvořit přes `/admin/vouchery/novy` nebo `/admin/provoz/vouchery/novy`. Formulář podporuje hodnotový poukaz s částkou v Kč a poukaz na aktivní službu se snapshotem názvu, ceny a délky. Admin UI se soustředí na evidenci kupujícího a jeho e-mailu; obdarovaný a věnování se v této verzi ve formuláři nezobrazují. Pravý souhrn slouží jen jako živý provozní náhled před uložením.
- Detail voucheru je dostupný na `/admin/vouchery/[voucherId]` a `/admin/provoz/vouchery/[voucherId]`. Nahoře má jednu kompaktní summary kartu s kódem, typem, stavem, platností, čerpáním a akcemi `Stáhnout PDF`, `Tisk A4` a `Poslat e-mailem`. Pod ní je dvousloupcový provozní layout: vlevo `Parametry voucheru`, `Historie uplatnění` a provozní úpravy, vpravo `Kupující a odeslání` a nízká sekce `Poslední e-mailové pokusy`. Tlačítko `Stáhnout PDF` vede na `/admin/vouchery/[voucherId]/pdf` nebo `/admin/provoz/vouchery/[voucherId]/pdf` a stáhne původní aktuálně vygenerovaný dárkový poukaz používaný i pro e-mail. Vedle něj je samostatný odkaz `Tisk A4`, který stáhne A4 arch na výšku s voucherem v horní třetině; zbytek stránky mimo voucher zůstává bílý pro úsporný a čistý tisk.
- V detailu voucheru lze upravit jen provozní údaje kupujícího (`purchaserName`, `purchaserEmail`), platnost do a interní poznámku. Kód, typ, hodnota, měna, služba, čerpání a PDF identita se běžnou editací nemění. Voucher lze zrušit akcí `Zrušit voucher`, která vyžaduje důvod, nastaví stav `CANCELLED` a zachová auditní stopu; zrušení je povolené jen u voucheru bez čerpání.
- V detailu voucheru je nova manualni akce `Poslat e-mailem`. Odeslani se spousti vyhradne explicitnim submittem formulare v adminu; nevznika automaticky pri vytvoreni voucheru ani na verejnem webu.
- Formular `Poslat e-mailem` predvyplni prijemce z `purchaserEmail` (pokud existuje) a predmet `Darkovy poukaz PP Studio`. Telo e-mailu je zamerne pevne podle schvalene sablony; obsluha ho neupravuje.
- Poslat e-mailem lze pouze pro efektivni stavy voucheru `ACTIVE` a `PARTIALLY_REDEEMED`. Stavy `DRAFT`, `REDEEMED`, `EXPIRED` a `CANCELLED` jsou server-side odmítnute s hlaskou `Voucher v tomto stavu nelze odeslat e-mailem.`
- Voucher email se loguje do `EmailLog` (typ `VOUCHER_SENT`) a pouziva stavajici email worker:
  - `EMAIL_DELIVERY_MODE=background`: záznam jde do fronty a worker ho odesle s retry politikou.
  - `EMAIL_DELIVERY_MODE=log`: záznam se oznaci jako odeslany v log rezimu bez SMTP odeslani.
- Email worker pro PDF prilohu importuje worker-safe `src/features/vouchers/lib/voucher-pdf-core.ts`; Next.js wrapper `src/features/vouchers/lib/voucher-pdf.ts` zustava jen pro admin routy s `import "server-only"`.
- Email vzdy obsahuje jen bezpecna data (typ, hodnota nebo sluzba, kod, platnost, overovaci URL, instrukce) a PDF prilohu `voucher-KOD.pdf`; nikdy neobsahuje `internalNote`, historii cerpani ani technicka ID.
- PDF voucheru obsahuje pouze veřejně bezpečné údaje: samostatné logo z `Média` vybrané v `/admin/nastaveni`, případně textové logo `PP Studio`, typ a hodnotu/službu, kód, platnost, QR ověření, kontakty salonu a krátké podmínky podle typu voucheru. Neobsahuje jméno ani e-mail kupujícího, interní poznámku, historii uplatnění ani technická ID.
- Veřejné ověření voucheru na `/vouchery/overeni` je `noindex` a není v sitemap. Platný voucher ukazuje jen bezpečná pole: kód, typ, zbývající hodnotu u `VALUE`, název služby ze snapshotu u `SERVICE` a platnost do. Platný stav doplňuje CTA `Rezervovat termín` na `/rezervace` a e-mailové `Napsat do studia`. Neplatný voucher ukazuje pouze obecné bezpečné důvody: nenalezený, zatím neaktivní, uplatněný, propadlý, zrušený nebo bez dostupného zůstatku.
- Veřejné ověření voucheru má server-side rate limit podle IP hashe (okno 10 minut, max 10 pokusů). Při překročení vrací jen obecnou hlášku o dočasném omezení; neprozrazuje interní detail ani existenci konkrétního kódu.
- Veřejné ověření voucher nikdy neuplatňuje: nevytváří `VoucherRedemption`, nemění `remainingValueCzk` ani `Voucher.status`.
- Stav `Propadlý` v admin seznamu vychází z aplikačního efektivního pravidla: aktivní nebo částečně čerpaný voucher po `validUntil` se zobrazuje a filtruje jako propadlý, i když DB status ještě není `EXPIRED`.

## Lokální Spuštění
```bash
npm install
cp .env.example .env
npm run db:generate
npm run dev
```

Pokud `next dev` spadne na Turbopack cache chybu typu `Failed to restore task data` nebo chybějící `.sst` soubor v `.next/dev/cache/turbopack`, spusť:

```bash
npm run dev:clean
```

Fallback režim bez Turbopacku:

```bash
npm run dev:webpack
```

`npm test` nyní spouští i DB-backed integrační testy (nejsou skipnuté), takže běžná verifikace zahrnuje i booking integrační scénáře.

Browser E2E vrstva používá Playwright a spouští se samostatně:

```bash
npm run test:e2e
```

E2E testy nejdřív vytvoří produkční build, startují lokální `next start` server na samostatném portu, přepínají e-mail delivery do `log` režimu a seedují izolovaná data pro veřejnou rezervaci, storno, přesun termínu a admin potvrzení rezervace. Booking fixture rozkládá termíny podle `runId` do širšího rozpětí budoucích dní a časů, aby stale aktivní E2E rezervace ze staršího nedočištěného běhu náhodně neobsadily stejný veřejný čas. Self-service přesun termínu má v Playwrightu cíleně o něco širší timeout, protože čeká na plný server action roundtrip nad produkčním buildem; pokud je i „úspěšný“ náhradní slot mezitím obsazený paralelním během, test fallbackově zkusí další dostupné sloty a čeká na skutečný success heading. Při prvním spuštění na novém stroji může být potřeba doinstalovat Playwright browser přes `npx playwright install chromium`. Na Node 24 držíme Playwright alespoň na řadě `1.60+`; starší `1.59.1` se v GitHub Actions uměla zaseknout při rozbalování browser downloadu po dosažení `100 %`.
Build pro Playwright musí běžet se stejným `NEXT_PUBLIC_APP_URL` jako následný `PLAYWRIGHT_BASE_URL`/`next start` (`http://127.0.0.1:3100`, pokud nenastavíte jinak). `NEXT_PUBLIC_*` hodnoty se inlinují už při buildu; když se build udělá třeba na interním hostu serveru a test běží na `127.0.0.1:3100`, admin login redirect pošle browser na špatný origin a E2E skončí `ERR_CONNECTION_REFUSED`. Stejně tak musí build dostat testovací `NEXT_PUBLIC_MATOMO_*` hodnoty, protože Playwright smoke kontroluje Matomo `_paq` ve výsledném klientském bundle. Veřejné canonical URL přitom dál držíme přes `NEXT_PUBLIC_SITE_URL=https://ppstudio.cz`.
Admin smoke scénáře pro OWNER/SALON role mají záměrně vyšší timeout `90_000 ms`, protože kontrolují více admin sekcí za sebou a v CI mohou čistě kvůli délce průchodu přesáhnout výchozích `45_000 ms`.
Reschedule E2E scénář po ověření runtime kolize přepíná na předem určený nekolizní slot z fixture, ne na "další" tlačítko podle pořadí. Při rozšiřování fixture proto drž explicitní cílové labely nebo ISO start časy a zachovej run-specific rozptyl termínů, aby test zůstal order-independent a stabilní v CI i lokálně.
Pokud selže scénář `client can reschedule a booking through a public token`, test vypíše i poslední rozpoznaný stav formuláře (konflikt slotu, validační hláška nebo obecná chyba), takže je rychlejší odlišit timing flake od skutečné doménové regrese.

GitHub Actions CI používá stejnou verifikační sadu automaticky na pull requestech a pushech do hlavních větví:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

Workflow si pro testy startuje PostgreSQL service container a používá bezpečné lokální/testovací env hodnoty bez reálného SMTP odesílání.

Pro cílené spuštění pouze booking DB integračních testů je připravený i samostatný příkaz:

```bash
npm run test:db:booking
```

Aktuálně pokrývá i novější booking DB scénáře nad stejným globem `src/features/booking/lib/*.integration.test.ts`, mimo jiné:
- `src/features/booking/lib/booking-rescheduling.integration.test.ts`
- `src/features/booking/lib/booking-management.integration.test.ts`
- `src/features/booking/lib/booking-manual.integration.test.ts`
- `src/features/booking/lib/booking-public-voucher.integration.test.ts`
- `src/features/booking/lib/booking-email-worker.integration.test.ts`

U DB integračních seedů dostupnosti nepoužívej úzké fixní časové okno; při paralelním běhu CI to může náhodně kolidovat na `AvailabilitySlot_active_time_window_excl`. Bezpečnější je čas odvodit z UUID/hash rozptylu uvnitř booking window.

Pro rychlé unit ověření veřejné správy rezervace a reschedule pravidel jsou v repozitáři i cílené testy bez DB:

```bash
node --import tsx --test src/features/booking/lib/booking-management.test.ts
node --import tsx --test src/features/booking/lib/booking-rescheduling.test.ts
```

Pokud databáze ještě neobsahuje schema nebo přibyly nové migrace:

```bash
npm run db:migrate
```

### Lokální media storage
- Upload root se nastavuje přes `MEDIA_STORAGE_ROOT`.
- Kanonická `/media/public/*` i legacy `/media/*` URL sdílejí jediný handler `src/lib/media/public-media-route.ts`; ten zpřístupní pouze publikovaný `MediaAsset`.
- Pokud proměnná není vyplněná, aplikace použije výchozí cestu `/var/www/ppstudio/uploads`.
- Uvnitř rootu aplikace odděluje:
  - `public/` pro veřejně čitelná média
  - `temp/` pro budoucí drafty nebo přechodné upload workflow
- Veřejná média se zobrazují přes URL vrstvu `/media/public/<type>/YYYY/MM/<filename>`, ne přímým odkazem na fyzickou cestu.
- Statické assety verzované v repozitáři (`public/brand`) a uploady z adminu jsou dvě rozdílné věci; nové admin obrázky mají jít přes media storage vrstvu.
- Pro JPEG/PNG/WebP uploady nyní vzniká lehká server-side image pipeline přes `sharp`:
  - originál se při zápisu normalizuje přes EXIF auto-rotate a ukládá se jako `{assetId}-original.<ext>`
  - `optimized` varianta se generuje s auto-rotate podle EXIF, max šířkou 1920 px a rozumnou kompresí
  - `thumbnail` varianta se generuje pro admin grid s cílovou šířkou kolem 400 px
  - veřejný web čte `optimizedUrl`, admin grid čte `thumbnailUrl` a starší média bez variant padají zpět na původní `url`

### Lokální vývoj z jiného zařízení v LAN
- Next.js 16 v dev režimu blokuje cross-origin přístup k dev assetům a HMR endpointům, pokud origin výslovně nepovolíš.
- Projekt proto v `next.config.ts` povoluje `allowedDevOrigins` pro lokální host `192.168.0.143` i veřejnou doménu `ppstudio.cz` / `www.ppstudio.cz`, aby šel dev server otevřít i přes Synology reverse proxy nebo z jiného zařízení v síti.
- Po změně `allowedDevOrigins` je potřeba restartovat `npm run dev`.
- Pokud budeš používat jiný hostname nebo IP, doplň ho do `allowedDevOrigins` a změnu zapiš i do dokumentace.

### Import kategorií a služeb
- Import běží přes JSON soubor a upsertuje záznamy podle `slug`.
- Nejrychlejší postup:
```bash
node scripts/import-services.mjs --file scripts/services.import.example.json --dry-run
node scripts/import-services.mjs --file path/to/old-web-services.json
```
- Import očekává strukturu:
  - `categories[]` s poli `name`, `slug`, `description`, `pricingDescription`, `pricingLayout`, `pricingIconKey`, `sortOrder`, `pricingSortOrder`, `isActive`
  - `services[]` s poli `name`, `slug`, `categorySlug`, `publicIntro`, `seoDescription`, `pricingShortDescription`, `pricingBadge`, `durationMinutes`, `priceFromCzk`, `description`, `shortDescription` (legacy, volitelné), `publicName` (legacy, volitelné), `sortOrder`, `isActive`
- Pokud starý web exportuje data v jiném formátu, je potřeba je před importem namapovat do této struktury.
- Pro tvoje aktuální kategorie je připravený vzor v `scripts/old-web-categories.json`.
- Pro tvoje aktuální služby je připravený vzor v `scripts/old-web-services.json`.

### Backfill strukturovaných textů služeb v DB
- Produkční DB se sama nezmění pouhou úpravou seedu nebo souboru `src/features/public/lib/service-copy-overrides.ts`; veřejný web bere obsah služeb z DB.
- `service-copy-overrides.ts` je jen dočasný migrační zdroj pro naplnění nových polí `seoTitle`, `idealFor`, `includes`, `benefits` a `goodToKnow`.
- Pro bezpečný backfill nových polí existuje ruční skript:
```bash
npm run db:backfill-service-copy -- --dry-run
npm run db:backfill-service-copy -- --confirm
```
- První příkaz je dry-run: vypíše počet známých služeb, nalezené DB záznamy a pole, která by se měnila.
- Ostré spuštění vyžaduje `--confirm` a před ním je povinná aktuální záloha produkční DB.
- Skript hledá pouze známé služby podle stabilního `slug`, zastaví se při chybějícím známém slugu a nemění žádné neznámé služby.
- Aktualizuje jen `Service.seoTitle`, `Service.idealFor`, `Service.includes`, `Service.benefits` a `Service.goodToKnow`; nemění ID, slug, název, cenu, délku, pořadí, aktivitu, veřejnou rezervovatelnost ani kategorii.
- Starší textová pole `publicIntro`, `description`, `pricingShortDescription` a `seoDescription` upravuj přes admin nebo samostatně kontrolovaným DB updatem.

### Vyčištění testovacích rezervací a termínů
- Pro rychlý úklid testovacích provozních dat použij:
```bash
npm run db:clear-booking-data
npm run db:clear-booking-data -- --confirm
```
- Skript v první fázi jen vypíše počty rezervací, slotů a navázaných logů. Ke skutečnému smazání je potřeba explicitní `--confirm`.
- Mažou se `Booking`, `AvailabilitySlot`, jejich tokeny, historie, navázané e-mailové a submission logy a nakonec i osiřelé klientky bez aktivní vazby na rezervaci.
- Katalog služeb a kategorií, admin účty, `SiteSettings`, `CalendarFeed` ani `MediaAsset` se nemažou.

## Veřejný Web
- Navigace vede na klíčové konverzní a důvěryhodnostní stránky místo jedné přetížené homepage.
- Detail služby je renderovaný v request-time režimu nad DB katalogem služeb, takže změny z adminu nečekají na nový build. Nad hero sekcí má viditelnou drobečkovou navigaci `Domů -> Služby -> Název služby` a sekundární odkaz zpět na přehled všech služeb.
- `/rezervace` nyní obsahuje produkční V1 flow:
  - výběr kategorie služby a následně konkrétní služby
  - výběr konkrétního času v rámci ručně publikovaného volného okna
  - kontaktní údaje klienta
  - souhrn a potvrzení
- Výběr služby je nově rozdělený na dvě úrovně (`kategorie -> služba`), aby se klientka rozhodovala v kratších blocích a rychleji našla správnou variantu.
- Po výběru služby booking flow automaticky scrolluje na krok s termíny.
- Výběr termínu v kroku 2 teď začíná sekcí `Nejbližší dostupné termíny`; kalendář zůstává hned pod ní jako sekundární cesta pro jiný den.
- Krok 2 nabízí starty po 30 minutách uvnitř dostupného okna a bere v úvahu délku služby i už obsazené intervaly.
- Krok `Vyberte termín` používá větší a výraznější tlačítka časů s menší hustotou na řádek; detail termínu (`konec`, `délka`, případná poznámka) zůstává v souhrnu.
- Kontaktní krok přidává průběžnou inline validaci i helper text, proč je kontakt potřeba.
- Souhrn umožňuje upravit službu, termín i kontakt přímo z pravého panelu bez vracení přes předchozí kroky.
- Na mobilu je booking doplněný o sticky CTA lištu, která podle stavu výběru vede na další akci nebo rovnou na odeslání.
- Po úspěšném odeslání se zobrazí samostatný confirmation flow místo jednoho souhrnného cardu:
  - status blok `Rezervace přijata`
  - jasný stav `Čeká na finální potvrzení` a věta, že termín je předběžně rezervovaný
  - hlavní detail je kompaktní a drží skladbu `služba` + `datum · čas`; čas zůstává dobře čitelný (např. `09:30 – 10:30`)
  - stručný blok `Co bude následovat`
  - uklidňující věta, že termín je nyní rezervovaný a klientka nemusí dělat další kroky
  - samostatný kontakt na studio až pod hlavními informacemi (desktop může být v jedné řádce `e-mail · telefon`, mobil jako dvě samostatné akce)
  - referenční kód se nezobrazuje, dokud pro něj projekt nemá samostatné business pole používané v komunikaci
  - nad confirmation panelem se nezobrazuje intro z aktivního výběru termínu (`Vyberte si termín...`)
  - post-submit screen záměrně nezobrazuje akce `Změnit termín` ani `Zrušit rezervaci`; změny a storno patří do e-mailu nebo detailu rezervace, ne do uzavření flow
  - potvrzovací stránka je záměrně hustší než dřív (nižší hero, menší vertikální mezery, nižší karty), aby nepůsobila jako dlouhá landing page
- Provozní e-mail o nové rezervaci teď obsahuje tři akce:
  - `Potvrdit rezervaci`
  - `Přesunout termín`
  - `Zrušit rezervaci`
  - `Otevřít v administraci`
- Provozní e-mail je určený pro rychlé mobilní rozhodnutí: nahoře je služba, datum, čas, klientka, e-mail a telefon jen pokud existuje; dlouhé vysvětlení akčních odkazů, technické údaje a duplicitní patička se v této šabloně nezobrazují.
- Emailové approve/reject odkazy neprovedou změnu hned po otevření; vždy nejdřív zobrazí kontrolní obrazovku s přehledem rezervace a až následně potvrzovací CTA.
- Po potvrzení rezervace systém automaticky založí návazný klientský e-mail s výsledkem rezervace a přiloženou `.ics` událostí pro osobní kalendář klientky.
- Booking e-maily mají jednotný klidný design: nahoře `PP Studio`, jasný headline, krátký úvod, karta se službou / datem / časem, místo, relevantní akce, jednorázový kontakt a decentní patička. Čas se zobrazuje jako `09:30 – 10:30`.
- Potvrzovací e-mail po finálním schválení rezervace je záměrně krátký a praktický: potvrzuje rezervaci, ukazuje službu, termín a místo `PP Studio, Sadová 2, 760 01 Zlín`, připomíná přiloženou kalendářovou událost a dole nenápadně nabízí změnu nebo zrušení, pokud jsou v payloadu dostupné bezpečné odkazy.
- Reminder 24 hodin před termínem neobsahuje samostatné CTA `Ozvat se studiu`; kontakt je jednou jako `Napište nám: info@ppstudio.cz` a `Zavolejte: +420 732 856 036`.
- Pending confirmation screen kalendář záměrně nenabízí; `.ics` příloha patří až k e-mailu po přechodu rezervace do `CONFIRMED`.
- Rezervační stránka je renderovaná dynamicky při requestu, takže nově publikované nebo obsazené sloty jsou vidět bez dalšího buildu.
- Hero, sekce `O mně` a základní service copy jsou přepsané do klidnějšího a osobnějšího tónu; u `/o-mne` se vyhýbej defenzivním formulacím o praxi, agresivním slibům a superlativům typu `dokonalý`, `špičkový` nebo `okamžité výsledky`.
- Další jemné úpravy veřejné copy dělej centrálně v obsahové vrstvě `src/content/public-site.ts` nebo v DB copy mapě služeb, ne přímo v route souborech.
- Veřejný footer je záměrně klidný informační blok, ne marketingová patka:
  - na desktopu používá kompaktní 3sloupcové rozložení `brand -> navigace + informace -> kontakt`
  - na mobilu se skládá pod sebe v pořadí `brand -> navigace -> informace -> kontakt`
  - navigace a právní odkazy jsou oddělené do dvou samostatně nadepsaných skupin, ne do jednoho dlouhého seznamu
  - kontakt má vlastní opticky silnější blok s adresou a klikacími odkazy `tel:` a `mailto:`; telefon i e-mail se zobrazují přímo a bez textové obfuscace
  - spodní mikrořádek drží jen copyright a nemá přebírat roli další navigace
  - v `SiteShell` variantě `booking` je footer záměrně ještě kompaktnější (menší paddingy/gapy), ale obsah a odkazy zůstávají stejné
- Stránka `/gdpr` už není placeholder kostra; používá právní informační skladbu `hero s kontaktem správce -> obsahová navigace -> tematické sekce`.
- Stránka `/obchodni-podminky` už není pracovní návrh; používá finální právní strukturu `hero s kontaktním blokem poskytovatele -> obsahová navigace -> kompaktní sekce pro rezervace, storno, cenu, průběh služby, odpovědnost, reklamace, poukazy a závěrečná ustanovení`.
- GDPR sekce v `src/content/public-site.ts` teď počítají s jemně bohatším modelem (`id`, odstavce, seznamové body, volitelná poznámka), aby šla stránka rozšířit bez přepisování layoutu.
- Právní sekce v `src/content/public-site.ts` nově umí i volitelný `eyebrow`, takže dlouhé právní stránky drží čitelnou číslovanou hierarchii bez zavádění nové specializované page komponenty.
- Veřejné e-mailové odkazy jsou jemně obfuskované:
  - výchozí text se zobrazuje v běžném čitelném tvaru s `@`; textový zápis `lokalni-cast [at] domena` používej jen tam, kde je to vědomě zvolený copy pattern
  - skutečný `mailto:` odkaz se skládá až na klientu po načtení stránky
  - pro návštěvnici zůstává chování stejné, ale jednoduché scrapery nevidí čistý e-mail přímo v HTML
- Stránka `/kontakt` má nově silnější orientaci na rychlou akci:
  - hero drží text + CTA vlevo a vyhrazený placeholder prostor pro budoucí fotografii vpravo
  - spodní část kontaktu kombinuje kompaktní mapový náhled, quick contact blok s telefonem, e-mailem, Instagramem a údajem o provozovateli a pod nimi samostatný full-width blok `Parkování` s 4 rychlými tipy (`Hradská`, `Gahurova`, `Sadová`, `Kongresové centrum Zlín`)
  - parkovací blok je záměrně krátký a pomáhá rozhodnout hlavně pro běžnou návštěvu cca 90-120 minut: nejlevněji, kompromis cena/vzdálenost, nejblíže nebo kryté parkování
  - spodní CTA blok rozlišuje dvě cesty rozhodnutí (rovnou rezervace vs. nejdřív kontakt)
  - na mobilu je dole sticky CTA lišta s rychlou rezervací, voláním a e-mail kontaktem
- Stránka `/o-mne` je nově poskládaná jako scan-friendly landing page:
  - výraznější hero s dvěma CTA a badge služeb
  - stručná sekce „Proč klientky volí PP Studio“ s klidným podnadpisem a třemi konkrétními benefity
  - civilnější příběh, samostatný blok přístupu a klidná sekce o kosmetice FOR LIFE & MADAGA
  - samostatná mřížka certifikací, která funguje i bez finálních admin dat díky placeholder kartám
- Následný polish pass nad `/o-mne` už nemění strukturu; upravuje hlavně proporce hero, vnitřní spacing karet, rytmus sekcí a jemnou textovou hierarchii.
- Finální UI polish ještě mírně navýšil váhu textového hero sloupce, sjednotil benefit boxy do stabilnější výšky a přidal jemné hover stavy pro benefit karty a certifikace.
- Další doladění stránky `O mně` má už být jen přes drobné utility změny, ne přes nové bloky nebo přepis IA.
- Texty a struktura stránky `O mně` jsou centralizované v `aboutContent`; layout počítá s polem `whyChooseMe` včetně volitelného podnadpisu sekce, popisu benefit karet, hero badge, CTA kartou i pozdějším napojením certifikací na admin data bez dalšího přepisu sekcí.
- Homepage copy teď vědomě navazuje na konverzně funkční strukturu starého webu (`služba + lokalita`, rychlé CTA na rezervaci/ceník, sekce pro nejistý výběr služby), ale běží na současném komponentovém základu.
- Homepage hero podporuje i vizuální brand prvky přes obsahový config (`logoImage`, `portraitImage` v `src/content/public-site.ts`); lokální assety jsou v `public/brand/`.
- Browserové a PWA ikony držíme odděleně od homepage brand assetů: favicon sada žije v `src/app/favicon.ico`, `src/app/apple-icon.png` a `public/android-chrome-*` / `public/apple-touch-icon*.png`.
- Homepage hero lze obsahově ladit blíž původnímu webu přes `homepageContent` (`benefits`, `ctaNote`) bez zásahu do routy.
- Hero na homepage je záměrně klidnější: portrét je menší a pravý sloupec nepoužívá doprovodné mini boxy.
- CTA na rezervaci je dostupné v hlavičce, hero sekcích i obsahových blocích.
- Stránka `/studio` představuje prostředí PP Studia před první návštěvou:
  - navigace používá název `Studio`
  - hero má nadpis `Klidné místo pro vaši péči`, dvě CTA `Rezervovat termín` a `Kontakt` a jako úvodní vizuál bere první publikovanou fotku studia
  - galerie používá až další publikované fotky po hero (maximálně 6 kusů), takže se úvodní fotka v galerii neduplikuje; layout se přizpůsobuje i při 1-6 galerijních fotkách
  - veřejný read model vrací jen publikované `MediaType.SALON_PHOTO` assety, u kterých existuje reálný soubor ve storage
  - obsahové fotky studia používají `MediaAsset.altText`; při chybějícím alt textu se vypíše fallback `Fotografie prostoru PP Studio`
  - pokud DB obsahuje publikovaný záznam bez fyzického souboru, asset se do `/studio` nezařadí a nevzniká broken image box
  - ve `development` režimu je povolený fallback na lokální obrázky `public/dev/studio/*`; v produkci se fallback nikdy nepoužívá
  - navazující bloky krátce popisují atmosféru, adresu a finální cestu k rezervaci nebo kontaktu
- Veřejné napojení modulu `Média` je nyní centrální:
  - `/o-mne` načítá certifikáty přes `MediaType.CERTIFICATE` a hero portrét přes `MediaType.PORTRAIT_ABOUT`
  - homepage používá hero portrét přes `MediaType.PORTRAIT_HOME`; pokud chybí, zůstává verzovaný brand asset
  - `/studio` používá publikované `MediaType.SALON_PHOTO`; první dostupná fotka je hero a následující dostupné fotky tvoří galerii
  - `/kontakt` používá pouze publikované `MediaType.CONTACT_PHOTO`; pokud není nahrané, zobrazí placeholder bez fotky studia
- Certifikáty, fotky prostor, reference a další budoucí obsahové obrázky mají sdílený základ přes `MediaAsset` a lokální upload storage.
- V admin modulu `Média` používej pro fotky studia tab `Prostory`; upload formulář v tomto tabu předvybere typ `SALON_PHOTO` a pole `Pořadí` určuje pořadí hero/galerie na `/studio`.
- Pro samostatnou fotku na kontaktní stránce používej tab `Kontakt`; upload formulář v tomto tabu předvybere typ `CONTACT_PHOTO` a nejnižší `Pořadí` určuje aktivní hero fotku.

## Přihlášení Do Adminu
- Admin login je dostupný na `/admin/prihlaseni`.
- Přihlašovací obrazovka používá krátké netechnické copy, neutrální e-mailový placeholder a viditelný focus stav pro klávesnicové ovládání.
- Login route `POST /api/auth/login` má nově server-side rate limit (okno 10 minut) nad hashovanou IP a hashovaným e-mailem, aby omezila brute-force pokusy.
- Při překročení limitu se login ukončí bezpečným přesměrováním na `/admin/prihlaseni?error=rate_limited` bez založení session.
- Databázové účty vytvořené přes owner sekci `Přístupy` se přihlašují vlastním heslem nastaveným přes pozvánku.
- Recovery nikdy neotevírá webový bootstrap účet. Pro vytvoření nebo obnovu DB OWNERa použij offline příkaz `npm run admin:recover-owner -- --email owner@example.com --name 'Jméno' --confirm < heslo.txt`; příkaz vyžaduje heslo alespoň 12 znaků, obnoví aktivní DB účet, revokuje otevřené pozvánky a zapíše audit `ADMIN_RECOVERY_OWNER_RESTORED` bez hesla.
- Posledního aktivního OWNERa nelze v UI ani server action deaktivovat či degradovat. Vlastní degradace je možná až tehdy, když zůstává další aktivní OWNER.
- Session je ukládaná do `httpOnly` cookie a podepisovaná pomocí `ADMIN_SESSION_SECRET`.
- Životnost admin session cookie `ppstudio-admin-session` je 14 dní (stejná expirace je i v podepsaném JWT tokenu).
- Při běžném provozu adminu se session průběžně prodlužuje (sliding refresh): pokud při admin requestu zbývá do expiry méně než 48 hodin, `proxy` vystaví novou cookie.
- Bezpečnostní strop je 45 dní od prvního přihlášení; po překročení je vyžadované nové přihlášení.
- Časování session lze upravit env proměnnými `ADMIN_SESSION_IDLE_MAX_AGE_SECONDS`, `ADMIN_SESSION_REFRESH_WINDOW_SECONDS` a `ADMIN_SESSION_ABSOLUTE_MAX_AGE_SECONDS`.
- Po přihlášení aplikace přesměruje uživatele na domovskou admin cestu podle role:
  - `OWNER` -> `/admin`
  - `SALON` -> `/admin/provoz`

## Admin Sekce a Role
- Sekce dostupné pro obě role:
  - Přehled
  - Rezervace
  - Volné termíny
  - Klienti
- Mobilní admin navigace používá vlastní drawer; při jeho otevření se horní lišta dočasně schová, aby se menu nepřekrývalo s vlastním obsahem.
- Owner sekce `Nastavení` nově obsahuje i blok `Kalendář`:
  - zapnutí feedu
  - zkopírování subscription URL
  - rotaci tokenu
  - vypnutí feedu
  - stručný návod pro Apple Kalendář / iCloud subscription
- ICS feed je určený jen jako přehled pro majitelku:
  - ukazuje pouze rezervace ve stavu `CONFIRMED`
  - neumožňuje editaci ani obousměrnou synchronizaci
  - po rotaci nebo vypnutí starý odkaz přestane fungovat
- Sekce `Přehled` na `/admin` a `/admin/provoz` je nyní operativní dashboard dne:
  - layout je rozdělený na hlavní pracovní plochu a pravý sidebar; levý navigační sidebar zůstává součástí shellu
  - nahoře je sjednocený blok `Provozní přehled`, který v jednom cardu spojuje datum, dominantní počet dnešních rezervací, další klientku a hlavní CTA `Vytvořit rezervaci / Dnešní plán / Dostupnost`
  - pokud existují čekající potvrzení, dashboard je ukáže jako výrazný akční alert nad dnešním plánem; bez pending stavu zůstávají alerty menší a sekundární
  - `Dnešní plán` je hlavní pracovní sekce: používá kompaktní server-rendered seznam rezervací s výrazným časem vlevo, stavovým badge a přímým proklikem na detail rezervace
  - pokud má dnešní rezervace poznámku, plán ji ukáže přímo u klientky s původem `Klientka` nebo `Interně`; rezervace bez poznámek zůstávají bez doplňkového řádku
  - pravý sidebar je podpůrný: obsahuje `Rychlé akce`, `Tento týden` a `Výkon webu`; primární CTA pro ruční rezervaci zůstává nahoře v hero liště
  - KPI strip už neopakuje všeobecný reporting; drží jen provozní metriky `Dnes rezervace`, `Volná okna dnes`, `Týdenní obsazenost` a `Volné sloty tento týden`
  - na mobilu dashboard přepíná do jednoho svislého proudu: hero, alerty, KPI, dnešní plán, volné termíny a až potom pravý podpůrný sloupec
  - overview používá server-rendered Suspense fallback se skeletonem, takže při načítání nepůsobí jako prázdná stránka
- Sekce `Rezervace` je nyní přepracovaná jako kompaktní pracovní seznam na `/admin/rezervace` a `/admin/provoz/rezervace`:
  - místo vysokých karet používá hustý řádkový grid se sloupci `Rezervace`, `Čas`, `Status`, `Zdroj`, `Kontakt`, `Akce`
  - každá rezervace drží klientku + službu a datum + čas ve dvou krátkých řádcích bez zbytečné výšky
  - na mobilu se každá položka skládá do dvousloupcové karty s názvem přes celou šířku, přehlednými metadaty a plnošířkovým footerem pro akce
  - horní statistiky jsou zmenšené do jedné souhrnné řady místo velkých karet
  - hlavička seznamu zůstává sticky při scrollu, takže jsou sloupce stále čitelné
  - přímo v řádku jsou rychlé akce `Potvrdit`, `Zrušit` a `Otevřít`; na menších šířkách fungují jako plný footer pod řádkem a od `lg` výše mají úsporný vlastní sloupec s kompaktnější kapslí
  - sloupec `Status` je centrovaný jako samostatný grid item, aby badge seděly přesně pod hlavičku
  - `Zrušená` rezervace má ve sloupci `Status` jen lehce červený tón pro rychlé rozpoznání
  - stav se zobrazuje přes barevné badge, aby bylo na první pohled vidět, co čeká, co je hotové a co je zrušené
  - sloupec `Zdroj` kombinuje provozní původ rezervace (`Web`, `Telefon`, ...) a akviziční zdroj (`Google`, `Facebook`, `Instagram`, `Firmy.cz/Seznam`, `Direct`, `Other`), pokud je dostupný
  - toolbar nově obsahuje CTA `Přidat rezervaci`, které pro `OWNER` i `SALON` otevírá pravý drawer pro plnohodnotné ruční vytvoření rezervace
  - ruční rezervace stále vzniká jako běžný `Booking`; používá stejnou doménovou create logiku jako veřejný booking a ukládá jen doplňková metadata `source`, `isManual`, `manualOverride`, `createdByUserId`
  - drawer umí vyhledat nebo propojit existující klientku podle jména, telefonu i e-mailu, případně rovnou založit novou
  - termín lze založit buď ze slotů respektujících veřejnou dostupnost, nebo ručně přes datum a čas; pokud ruční čas neleží ve veřejné dostupnosti, systém upozorní na interní výjimku a uloží ji auditovaně
  - sticky footer nabízí `Vytvořit rezervaci` a `Vytvořit a poslat potvrzení`; při odeslání e-mailu se používá stejné email/log/ICS flow jako u běžných rezervací
- Sekce `Klienti` je nyní produkčně použitelná pro obě role na `/admin/klienti`, `/admin/provoz/klienti` a v detailu na `/admin/klienti/[clientId]`, `/admin/provoz/klienti/[clientId]`:
  - seznam podporuje hledání přes jméno, e-mail, telefon i interní poznámku
  - filtry umí omezit aktivní/neaktivní profily a přepnout řazení podle poslední návštěvy, počtu rezervací, jména nebo vytvoření
  - rychlé filtry přepínají provozní řezy `Vše`, `S rezervací`, `Bez rezervace`, `Bez kontaktu`, `S poznámkou` a `Nové za 30 dní`
  - hlavní přehled klientů je záměrně kompaktní: horní statistiky ukazují celkový počet, nové profily za 30 dní, profily bez kontaktu a profily s poznámkou v nízkém stripu
  - desktopový seznam je tabulkový CRM přehled se sloupci `Klientka`, `Kontakt`, `Rezervace`, `Poslední návštěva`, `Poznámka`, `Stav`, `Akce`; na mobilu se skládá do kompaktních karet
  - chybějící kontakt rozlišuje `bez e-mailu`, `bez telefonu` a `bez kontaktu`; dlouhé e-maily i technické názvy jsou zkrácené přes ellipsis
  - testovací profily podle bezpečných signálů (`example.com`, voucher/collision názvy nebo e-maily) se pouze jemně označí badge `test`, nikdy nemažou
  - detail klientky ukazuje kontakty, poslední a budoucí termín, nejčastější službu a posledních 10 rezervací
  - interní poznámka se upravuje přímo v detailu klientky a po uložení se propisuje do obou admin oblastí
- Sekce `Přístupy` je nyní vyhrazená jen pro `OWNER` na `/admin/uzivatele`:
  - obrazovka je rozdělená na hlavní blok `Seznam přístupů` a vedlejší read-only blok `Přehled rolí`
  - systém používá pouze dvě role `OWNER` a `SALON`; neexistuje žádná role `ADMIN`
  - každý přístup ukazuje jméno, e-mail, roli, stav účtu, krátký helper text a dostupné akce
  - stavy účtu jsou `Aktivní`, `Pozvánka čeká`, `Deaktivovaný` a `Systémový účet`
  - systémové přístupy z env se v UI zobrazují pouze jako `Systémový účet` a zůstávají read-only bez technických detailů
  - owner může u databázových účtů založit pozvánku, upravit jméno a e-mail, přepnout roli, deaktivovat nebo znovu aktivovat účet a otevřít detail
  - akce `Pozvat uživatele` i `Znovu poslat pozvánku` odesílají reálný e-mail přes SMTP vrstvu
  - pozvánka vede na route `/admin/pozvanka/[token]`, kde si uživatel nastaví heslo a dokončí aktivaci přístupu
  - pokud SMTP dočasně selže, přístup se i tak uloží a UI zobrazí, že e-mail nebylo možné doručit

## Média a obrázky
- Lokální filesystem adapter je v `src/lib/media/*`.
- Sdílená feature service pro budoucí owner/salon upload workflow je v `src/features/media/lib/media-library.ts`.
- Metadata se ukládají do tabulky `MediaAsset`, zatímco binární soubor zůstává na filesystemu.
- Podporované typy jsou aktuálně obrázky `jpg`, `jpeg`, `png`, `webp`.
- Maximální velikost souboru je 8 MB.
- Každý upload dostane krátký generovaný identifikátor a ukládá se jako `{id}-original.<ext>`, `{id}-optimized.<ext>` a `{id}-thumbnail.<ext>` bez použití původního názvu souboru.
- Relativní storage path má tvar `certificates/2026/04/<id>-original.<ext>`; běžné veřejné typy používají kořeny `spaces/`, `contact/`, `portraits-home/` nebo `portraits-about/`.
- Publikace je řízená jen přes `MediaAsset.isPublished`; nové uploady se nepřesouvají mezi `public/private`.
- Modul `Média` má první produkční napojení:
  - admin upload, editaci a mazání přes `/admin/media` a `/admin/provoz/media`
  - běžné admin typy `CERTIFICATE`, `SALON_PHOTO`, `CONTACT_PHOTO`, `PORTRAIT_HOME` a `PORTRAIT_ABOUT`; legacy/nepoužívané typy `PORTRAIT` a `GENERAL` zůstávají jen v DB schématu kvůli kompatibilitě
  - admin UI je záměrně kompaktní pracovní nástroj: krátký header, 4 rychlé statistiky, upload panel s dropzónou, tabs s počty a hustší grid karet
  - každá karta média ukazuje náhled, titulek nebo soubor, typ, publish stav, rozměry, velikost a zřetelné `Použití` + `Sekce`
- Logo pro PDF dárkové vouchery se nenahrává zvláštním workflow. Admin nejdřív nahraje PNG/JPEG do `Média` a potom ho vybere v `/admin/nastaveni` v poli `Logo pro PDF vouchery`; reference se ukládá do `SiteSettings.voucherPdfLogoMediaId`.
  - publish/unpublish jde přímo z karty bez otevírání editace; detailní změny zůstávají v kompaktním dialogu
  - prázdná knihovna i prázdné filtry mají vlastní CTA zpět na upload panel
  - veřejné zobrazení certifikátů v sekci `Certifikace` na stránce `/o-mne`
  - veřejné zobrazení publikovaných fotek studia na stránce `/studio`
  - backend napojený na `createMedia()`, `listMedia()`, `updateMedia()` a `deleteMedia()`
  - stránka `/o-mne` bere pouze `MediaType.CERTIFICATE` a `isPublished = true`
  - stránka `/studio` bere pouze `MediaType.SALON_PHOTO` a `isPublished = true`

## Provoz a zálohy
- Zálohuj databázi i upload root; jedna bez druhé nestačí pro úplnou obnovu médií.
- Při deployi se upload root nemaže ani nepřegenerovává, protože není součástí build artefaktů.
- Pokud upload začne selhávat, první kontrola má být:
  - existence cesty z `MEDIA_STORAGE_ROOT`
  - práva procesu k zápisu
  - dostupnost veřejné URL `/media/public/*` nebo legacy `/media/*`
  - Služby
  - Kategorie služeb
- Sekce `Služby` je nyní provozně použitelná pro obě role na `/admin/sluzby` a `/admin/provoz/sluzby`:
  - seznam nově funguje jako rychlá pracovní plocha: fulltext, filtr stavu, veřejné rezervace, kategorie a řazení
  - v kartách jsou rychlé akce `aktivovat/deaktivovat`, `veřejná/interní`, `duplikovat` a jednoduché posuny v pořadí
  - každá karta ukazuje provozní kontext, stavové badge a upozornění na problematické stavy
  - formulář podporuje `Uložit` i `Uložit a zavřít` a novou službu lze založit přes jasné CTA `Nová služba`
  - při přepnutí mezi službami se detail vždy přenačte podle skutečně vybrané položky (nepřebírá hodnoty z předchozí karty)
  - v detailu služby lze ručně zapnout zobrazení na homepage a nastavit pořadí v sekci `Doporučené služby`
  - v detailu služby lze nastavit `Čas na úklid po službě`; hodnota se ukládá jako interní metadata služby, klientce se nezobrazuje jako délka služby a při rezervacích se používá pro interní blokaci po skončení služby
  - v detailu služby je jediný obsahový blok `Veřejná prezentace`; pole `Veřejný úvod` je zdrojem textu pro web i rezervační krok výběru služby, takže se stejný text neudržuje duplicitně
  - detail se otevírá jako pravý overlay drawer (desktop i mobil), takže seznam zůstává viditelný v pozadí a obsluha neztrácí kontext
  - skutečná změna ceny v detailu služby zapisuje audit do `ServicePriceChangeLog`, takže lze dohledat původní i novou cenu, čas a admin aktéra
  - detail služby zároveň ukazuje sekci `Historie ceny` s posledními auditními změnami, takže není nutné kvůli běžnému dohledání chodit přímo do databáze
  - veřejný booking flow bere službu jen pokud je `isActive = true`, `isPubliclyBookable = true` a její kategorie je aktivní
- Sekce `Kategorie služeb` je nyní produkčně použitelná pro obě role na `/admin/kategorie-sluzeb` a `/admin/provoz/kategorie-sluzeb`:
  - horní přehled používá kompaktní souhrnnou lištu místo vysokých stat karet
  - seznam kategorií je hustší a víc provozně orientovaný: název, pořadí, kontext služeb, stav badge, toggle a akce jsou na jednom řádku
  - detail se otevírá jako pravý overlay drawer (desktop i mobil), takže je možné rychle procházet kategorie bez skákání mezi stránkami
  - nahoře jsou 4 stat karty (`Aktivní`, `Kategorie se službami`, `Prázdné`, `Potřebují pozornost`) a filtry s chipy `Prázdné`, `Bez veřejné služby`, `S upozorněním`
  - seznam ukazuje název, pořadí, aktivitu, počet všech služeb i kontext aktivních a veřejných služeb
  - problémové kategorie mají zvýrazněný warning stav a jemně odlišený border
  - přímo v seznamu jsou rychlé akce `aktivovat/deaktivovat`, `otevřít detail`, `zobrazit služby` a posuny v pořadí
  - přepnutí aktivního stavu a posun v pořadí probíhá okamžitě optimistic UI přes server action bez reloadu
  - editor umožňuje upravit název, volitelný popis, pořadí a aktivní stav; kategorie už nemá samostatný `Veřejný název`, web i ceník vždy používají `Název kategorie`
  - detail dál nabízí CTA `Vytvořit službu` a `Otevřít služby této kategorie`
  - novou kategorii lze založit přes jasné CTA `+ Nová kategorie`; editace i create běží ve stejném pravém drawer flow
  - mazání je povolené jen pro prázdné kategorie bez služeb; jinak je doporučené kategorii pouze vypnout
  - změna pořadí nebo aktivity se promítá do adminu, veřejných výpisů `/sluzby` a `/cenik` i do veřejného booking flow
- Sekce jen pro `OWNER`:
  - Přístupy
  - Email logy
  - Nastavení
- Sekce `Nastavení` je nyní produkčně použitelná pro `OWNER` na `/admin/nastaveni`:
  - blok `Salon` spravuje název salonu, adresu, telefon, kontaktní e-mail a Instagram
  - blok `Rezervace` drží jen skutečně globální booking pravidla: minimální předstih, horizont dopředu a storno limit pro self-service storno
  - blok `E-maily a notifikace` spravuje admin notifikační e-mail, sender name, sender email a krátkou patičku potvrzovacích e-mailů
  - formuláře mají jednotný footer se stavem ukládání, kratší popisky a mobilní rozložení, aby šly snadno používat i na telefonu
  - nahoře je malý orientační blok, který rychle vysvětlí, co do které části patří
  - technické SMTP údaje, app URL a session secret zůstávají správně mimo admin v env
- Tón admin obrazovek je záměrně jednotný: klidný, krátký a ne-technický, aby se v něm obsluha zbytečně neztrácela.
- Lite provozní menu je záměrně kratší a drží jen to, co recepce a tým potřebují nejčastěji:
  - Přehled
  - Dnešní rezervace
  - Termíny
  - Klientky
  - Nabídka
  - Kategorie služeb
- Levý sidebar zůstává i po redesignu dashboardu záměrně úzký; když budeš upravovat shell spacing, priorita je ponechat co nejvíc šířky pro operativní obsah, ne pro dekorativní chrome.
- Detail rezervace je nyní dostupný jak pro `OWNER`, tak pro `SALON`:
  - `OWNER` na `/admin/rezervace/[bookingId]`
  - `SALON` na `/admin/provoz/rezervace/[bookingId]`
  - nahoře používá kompaktní statickou hlavičku s návratem do seznamu, termínem, badge stavu, zdrojem a rychlými kontaktními akcemi
  - pod hlavičkou je jeden kompaktní souhrn místo více podobných boxů se stejnými daty
  - hlavní blok `Akce s rezervací` drží dostupné změny stavu a krátký stavový kontext bez dlouhých odstavců
  - poznámky jsou rozdělené na klientskou a interní; interní poznámku lze uložit samostatně i bez změny statusu
  - historie změn zůstává dole jako hustší časová osa se stavem, aktérem, časem a dostupným zdrojem změny
- Správa slotů je nyní produkčně použitelná pro obě role:
  - jediný FullCalendar planner na `/admin/volne-terminy` a `/admin/provoz/volne-terminy`
  - route `detail` a `upravit` vrací zpět do planneru ve správném týdnu; samostatná route `novy` už neexistuje
- Slot workflow podporuje:
  - plánování po týdnech ve FullCalendar mřížce po 30 minutách v pracovním okně `06:00-20:00`
  - kliknutím přidání či odebrání dostupnosti a tažením úpravu rozsahu přímo v mřížce
  - na mobilu pohledy Den, Po–Pá a Víkend bez druhé plannerové implementace
  - automatické sloučení sousedních půlhodin do souvislých intervalů `AvailabilitySlot`
  - zobrazení rezervací, omezených intervalů, neaktivních slotů a minulého času
  - server-side ochranu proti zásahu do rezervací, omezených slotů a překryvům

## Stav Sekce Volné Termíny
- K datu `19. dubna 2026` je sekce `/admin/volne-terminy*` a `/admin/provoz/volne-terminy*` znovu aktivní jako týdenní planner.
- Hlavní práce probíhá jen přes týdenní kalendář; samostatný formulář pro běžnou úpravu dostupnosti už není potřeba.
- Aktuální podoba adminu dává prioritu mřížce týdne; levý sidebar je užší a mobil používá drawer pro navigaci.
- 30min mřížka slouží jen jako editace v admin UI. Do databáze se ukládají souvislé intervaly `startsAt`-`endsAt`, aby zůstala kompatibilita s veřejným booking flow i delšími službami.
- FullCalendar ukládá každou změnu dostupnosti průběžně; při chybě lze zápis zopakovat nebo obnovit poslední uložený stav.
- Planner přímo neupravuje sloty, které už obsahují rezervace, omezení služeb, poznámky nebo jinou kapacitu než `1`; takové intervaly jsou v kalendáři vidět jako omezené a zůstávají chráněné.
- Za „obsahují rezervace“ se pro rychlou planner editaci počítají hlavně aktivní nebo provozně relevantní vazby. `CANCELLED` historie se při změně dostupnosti přesouvá do archivovaného slotu na pozadí, takže obsluha v mřížce nevidí zbytečný blok jen kvůli storno minulosti.
- Výchozí týden v planneru je počítaný nad lokálním datem `Europe/Prague`, takže týden vždy začíná pondělím i kolem časových posunů.
- Autor změny dostupnosti je vždy aktivní databázový `AdminUser`; nouzový webový bootstrap účet neexistuje.
- Z detailu rezervace lze bezpečně změnit stav pouze v povolených krocích:
  - `PENDING -> CONFIRMED`
  - `CONFIRMED -> COMPLETED`
  - `PENDING/CONFIRMED -> CANCELLED`
  - `CONFIRMED -> NO_SHOW`
- Akce `CONFIRMED -> COMPLETED` je dostupná až po skončení naplánovaného termínu (`scheduledEndsAt`); budoucí potvrzená rezervace proto nemůže omylem přestat blokovat kapacitu a objevit se v dashboardu jako volné okno.
- Dnešní dashboard timeline zobrazuje i dokončené dnešní rezervace jako tlumené `Hotovo`; volná okna se počítají jen od aktuálního času dopředu, takže minulý úsek po hotové službě nevypadá jako nově dostupný termín.
- Sekce `Volné termíny` v denním planneru zobrazuje také dokončené rezervace jako tlumené cyan `Hotovo`, takže historicky obsazený čas zůstává čitelný místo anonymního technického omezení a nesplývá se zelenou dostupností.
- Inspektor výběru v gridu u hotové rezervace používá historický text a odkazuje obsluhu na detail rezervace místo obecné hlášky o rezervovaném čase.
- Volba akce v bloku `Změna stavu` je řešená přes klikací karty místo selectu; aktivní karta je barevně zvýrazněná podle typu akce (potvrzení zeleně, zrušení červeně), aby obsluha hned viděla, co je vybrané.
- Blok `Změna stavu` nově předvybírá nejčastější další krok a pod výběrem ukazuje krátké shrnutí dopadu akce, takže je menší riziko chybného uložení ve spěchu.
- Každá změna stavu z detailu zapisuje položku do `BookingStatusHistory` včetně admin aktéra, důvodu a poznámky.
- Aby se owner sekce `Email logy` neopírala o ručně zastaralý Prisma klient, `npm run dev` i `npm run build` si nyní předem samy spouštějí `prisma generate`.
- Ochrana není řešená jen skrytím položek v menu:
  - `proxy.ts` na `/admin/*` validuje podpis i expiraci session JWT cookie (ne jen přítomnost); neplatnou cookie smaže a přesměruje na login
  - server-side guard helpery kontrolují oprávnění každé admin route
  - nedovolený vstup se přesměruje na domovskou admin stránku role nebo skončí `notFound` pro neplatnou sekci
- Owner a salon route soubory nyní používají sdílené factory wrappery (`src/features/admin/lib/admin-route-factories.tsx`), takže URL i oprávnění zůstávají stejné, ale logika není duplikovaná.
- Admin shell byl vizuálně zpevněný pro provozní použití:
  - širší sidebar na desktopu a sticky navigace při scrollu
  - hlavní obsah má ochranu proti horizontálnímu přetečení (`min-w-0`, `overflow-x-clip`)
  - hlavičky a metriky v admin kartách mají responzivní velikosti pro menší šířky

## Datový Model Rezervací
- `AvailabilitySlot` je hlavní entita dostupnosti a nese časový interval, stav, kapacitu a interní/veřejné poznámky.
- Admin CRUD slotů nepoužívá pevnou otevírací dobu; každý slot se zakládá ručně jako samostatný časový interval.
- `AvailabilitySlot` má explicitní `serviceRestrictionMode`, takže je zřejmé, zda slot přijímá jakoukoli službu nebo jen vybrané služby.
- `AvailabilitySlotService` umožňuje slot omezit jen na konkrétní služby, když je `serviceRestrictionMode = SELECTED`.
- Server-side slot validace navíc hlídá:
  - `endsAt > startsAt`
  - kapacitu minimálně `1`
  - kolizi s jiným aktivním slotem ještě před zápisem
  - zákaz snížení kapacity pod počet aktivních rezervací
  - zákaz výběru služeb, které by rozbily už navázané aktivní rezervace
- Kategorie a služby jsou samostatné DB entity, které se dnes plní přes import nebo admin správu, ne přes hardcoded seed.
- `Service.isPubliclyBookable` odděluje interně aktivní službu od služby skutečně nabízené ve veřejné rezervaci.
- `Service.cleanupMinutes` drží volitelný interní čas na úklid po službě s defaultem `0`; při vytváření/přesunu rezervace se snapshotuje do `Booking.cleanupMinutes` a zaokrouhlený blok do `Booking.cleanupBlockMinutes`.
- `Booking.blockedUntil` drží interní konec blokace (`scheduledEndsAt + cleanupBlockMinutes`), zatímco klientský termín zůstává `scheduledStartsAt -> scheduledEndsAt`.
- `Booking` drží snapshot klienta, služby i času, takže pozdější změny ceníku nebo názvů služeb nepoškodí historická data.
- Voucher zadaný u rezervace je jen záměr uložený na `Booking.intendedVoucherId` a snapshot polí; skutečné uplatnění voucheru smí vzniknout až v rámci dokončení návštěvy, kdy se atomicky vytvoří `VoucherRedemption` a rezervace přejde do `COMPLETED`.
- Samostatné veřejné ověření voucheru přes `/vouchery/overeni` smí pouze číst voucher přes bezpečný serverový helper a nesmí měnit žádná voucherová ani booking data.
- `Booking` drží metadata posledního přesunu (`rescheduledAt`, `rescheduleCount`) a reminder queue stav (`reminder24hQueuedAt`, `reminder24hSentAt`); historický self-relation chain zůstává jen jako legacy pole a nové reschedule flow ho nepoužívá.
- `BookingRescheduleLog` je samostatná auditní tabulka pro přesuny termínu s původním a novým intervalem, aktérem a volitelným důvodem změny.
- `Booking.reminder24hSentAt` drží informaci, že klientský 24h reminder už byl úspěšně uzavřený; `Booking.reminder24hQueuedAt` zase brání duplicitnímu enqueue stejného reminderu pro aktuální termín.
- `Booking` nově ukládá i akviziční metadata (`acquisitionSource`, `acquisitionReferrerHost`, `acquisitionUtmSource`, `acquisitionUtmMedium`, `acquisitionUtmCampaign`) odvozená z `utm_*` a referrer hostu.
- `BookingStatusHistory` slouží jako audit změn stavu a rozlišuje akci uživatele, klienta nebo systému.
- `ServicePriceChangeLog` je samostatná auditní tabulka pro změny `Service.priceFromCzk`; ukládá starou a novou cenu, aktéra a čas změny.
- Admin detail rezervace zobrazuje historii změn jako provozní timeline, takže salon i owner vidí, kdo a kdy stav upravil.
- `BookingActionToken` ukládá pouze hash tokenu pro storno a přesun termínu, nikdy ne surovou hodnotu tokenu.
- Klientský manage flow `/rezervace/sprava/[token]` přijímá jen hashovaný token typu `RESCHEDULE`; bez validního tokenu neukáže žádná data rezervace.
- Klientský manage flow při obyčejném načtení nevydává nový storno token. Tlačítko `Zrušit rezervaci` nejdřív přes server action vytvoří jednorázový `CANCEL` token a až potom přesměruje na potvrzovací storno stránku.
- `EmailLog` umožňuje trasovat odeslané i neúspěšné e-maily navázané na klienta, rezervaci a případný token.
- `EMAIL_DELIVERY_MODE=log` je jen vývojový/safe-mode režim; loguje maskovaného příjemce a anonymizovaný subject, ne plnou zákaznickou komunikaci.
- Health je rozdělený na veřejnou bez-DB liveness `/api/health/live`, veřejný readiness `/api/health` s jediným `SELECT 1` a owner-only `/api/health/diagnostics` s detailem workeru, fronty, incidentů a release identity.
- Owner-only sekce `Email logy` nyní funguje jako business-first přehled `Email logy`:
  - nahoře ukazuje health stav `OK / Warning / Error` podle aktivních delivery incidentů, retry, pending fronty a poslední relevantní chyby
  - krátké metriky shrnují `Dnes odesláno`, `Za posledních 7 dní`, `Čeká na odeslání`, `Aktivní incidenty` a `Poslední odeslání` v nižším KPI stripu; součty odeslaných zpráv znamenají předání providerovi, nikoli potvrzené doručení
  - health copy zůstává stručné; při čistém stavu používá text `Emaily fungují správně` a krátké vysvětlení o prázdné frontě
  - hlavní sekce `Poslední emaily` propojuje typ zprávy, stav, příjemce, vazbu na rezervaci, časy, pokusy a rychlé akce `Otevřít rezervaci / Detail emailu / Zkusit znovu`
  - badge typu rozlišuje `Přijetí rezervace` pro `booking-confirmation-v1` a finální `Potvrzení rezervace` pro `booking-approved-v1`
  - tracking badge v přehledu e-mailů je napojený na reálné Resend webhook eventy (`email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.failed`, `email.suppressed`); fallback bez eventů zůstává `Tracking připraven`
  - při chybových Resend eventech (`email.bounced`, `email.complained`, `email.failed`, `email.suppressed`) systém naváže owner Pushover notifikaci o následném problému doručení po předání e-mailu providerovi; upozornění se posílá jen při prvním zachycení konkrétního chybového stavu
  - Resend produkční setup:
    - v produkčním `.env` nastavte `EMAIL_DELIVERY_MODE=background`, `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` a `RESEND_WEBHOOK_SECRET`
    - po změně schématu nasaďte migrace (`npx prisma migrate deploy`), aby `EmailLog` obsahoval tracking sloupce
    - v Resend dashboardu nastavte webhook endpoint `POST https://<produkční-doména>/api/webhooks/resend`
    - do webhooku zapněte email eventy minimálně `sent`, `delivered`, `delivery_delayed`, `opened`, `clicked`, `bounced`, `complained`, `failed`, `suppressed`
    - signing secret z Resend webhooku uložte do `RESEND_WEBHOOK_SECRET`
    - po deploy restartujte `ppstudio-web` a `ppstudio-email-worker`
    - ověřte v `/admin/email-logy`, že nové záznamy mají vyplněné tracking stavy (`Doručeno`, `Doručeno - otevřeno`, `Nedoručeno - odmítnuto serverem (bounce)` apod.)
  - `Další pokus` se v hlavním seznamu ukazuje jen u stavů `Čeká` a `Retry`
  - původní pending/retry/error fronty zůstávají níž v debug bloku `Technický stav fronty`, který je defaultně sbalený do kompaktního souhrnu
- Detail konkrétního e-mailu na `/admin/email-logy/[emailLogId]` je nově business-first:
  - používá stejný jediný levý navigační sloupec jako přehled `Email logy`; navigace se v detailu nesmí duplikovat
  - nahoře ukazuje kompaktnější header s názvem emailu, jedním finálním stavem `Odesláno / Čeká / Retry / Selhalo / Nedoručeno`, příjemcem, klientkou, rezervací a klíčovým časem `Odesláno / Poslední pokus`
  - hned pod headerem drží zhuštěné rychlé akce `Zpět na přehled`, `Otevřít rezervaci`, případně `Zkusit znovu` nebo `Uvolnit zaseknutý job` v nízké operativní liště
  - pravý sloupec tvoří hustší souhrn `Typ emailu / Šablona / Příjemce / Provider / Poslední pokus / Odesláno / Počet pokusů`
  - levý sloupec drží navázané entity `Rezervace / Klientka / Token akce` jako kompaktní řádky; token je defaultně maskovaný a plně se ukáže až po kliknutí na `Zobrazit`
  - payload, provider metadata a raw debug data jsou až dole v nižším rozbalovacím bloku `Technické detaily`, defaultně zavřeném, s dalším rozbalením `Zobrazit citlivá data`
  - pokud existuje chyba, detail ukáže nejdřív stručný čitelný popis a až pak kompaktní rozbalitelný technický detail chyby
- Po úspěšné akci se na detailu objeví krátká potvrzovací hláška, aby bylo zřejmé, že operace proběhla.
- Veřejný booking flow po odeslání:
  - veřejný web `/`, `/sluzby`, `/cenik` a detail služby nyní čerpá z databáze v request-time
  - admin změny se do něj promítnou bez rebuildů
  - route `/rezervace` podporuje query parametr `service` ve tvaru `/rezervace?service=<slug>` pro marketingové deep linky na konkrétní službu
  - předvýběr služby podle `service` slug funguje jen pro službu, která je v právě načteném veřejném katalogu; neplatný, neaktivní nebo neveřejný slug se bezpečně ignoruje
  - globální booking pravidla čte ze `SiteSettings`, ne z natvrdo zapsaných konstant
  - znovu validuje službu a termín server-side
  - naváže nebo vytvoří klienta podle e-mailu
  - vytvoří rezervaci se stavem `PENDING` (čeká na schválení) a se snapshotem služby a času
  - k veřejné rezervaci uloží i akviziční zdroj z cookie trackeru (`ppstudio-booking-acq`)
  - zapíše audit změny stavu
  - připraví storno token a e-mailový log s informací o přijetí rezervace
  - uloží e-mail jako `PENDING` v background režimu nebo `SENT` v log režimu
- Confirmation screen a klientské booking e-maily sdílejí stejnou obsahovou hierarchii:
  - jasný stav rezervace
  - dominantní karta `služba / datum / čas`
  - místo `PP Studio, Sadová 2, 760 01 Zlín`
  - akce mimo informační copy a bez dominantního storna
  - kontakt až jako spodní podpůrná sekce, pouze jednou
- 24h reminder e-mail je úsporný: služba, datum, čas, místo, sekce `Potřebujete změnu?`, sekundární akce `Změnit termín` / `Zrušit rezervaci` a jednorázový kontakt.
- Referenční kód rezervace už se v klientské komunikaci nezobrazuje; pro změnu nebo storno se používají konkrétní tokenizované odkazy a textové shrnutí služby s termínem.
- Pokud se termín mezitím obsadí, služba přestane být aktivní nebo slot přestane odpovídat délce služby, uživatel dostane konkrétnější chybu místo obecného selhání.
- Při krátkodobém DB konfliktu (`Prisma P2034`, např. serializační/write konflikt) veřejné vytvoření rezervace transakci automaticky zopakuje až 5× s krátkým backoff, aby flow méně padal na náhodné souběhy.
- Veřejný submit je lehce rate-limitený podle IP a e-mailu; opakované pokusy v krátkém čase skončí blokací s user-friendly hláškou.
- Krok 2 už skrývá i sloty, které jsou pro vybranou službu příliš krátké.
- Server při odeslání rezervace navíc kontroluje i zvolený `startsAt`, takže klientka nemůže odeslat čas mimo hranice slotu ani čas kolidující s už existující rezervací.
- Pokud rezervace obsadí jen část delšího slotu s kapacitou `1`, systém slot interně rozdělí na rezervovaný úsek a samostatné volné zbytky, takže v admin planneru lze s volnými částmi dál pracovat po blocích.
- `/rezervace/storno/[token]` je produkční self-service storno stránka:
  - ověří hash tokenu server-side
  - zobrazí bezpečný potvrzovací krok
  - po potvrzení zruší rezervaci a zapíše audit, ale jen pokud rezervace ještě splňuje globální storno limit ze settings
  - uloží storno potvrzení do `EmailLog` pro worker nebo do `SENT` v log režimu
- `/rezervace/sprava/[token]` je produkční self-service změna termínu:
  - ověří hash tokenu typu `RESCHEDULE` server-side
  - ukáže službu, aktuální datum, čas ve formátu `13:30 – 14:00` a stav rezervace
  - nabídne jen veřejně dostupné nové časy pro stejnou službu a délku
  - primárně zobrazuje nejbližší dostupné dny jako větší klikatelné chips a sekundárně kalendář se zvýrazněnými dny s dostupností
  - po výběru dne zobrazí jen sloty pro tento den a po výběru času plynule posune klientku na potvrzení
  - storno je až na konci stránky jako slabý textový odkaz, aby nekonkurovalo změně termínu
  - online změnu zablokuje při zrušené/uzavřené rezervaci, neplatném tokenu nebo méně než `bookingCancellationHours` před termínem
  - po potvrzení volá stejné `rescheduleBooking(...)` jako admin detail a do historie zapisuje `changedByClient = true`

## Řešení Problémů (Troubleshooting)
- Pokud se rezervace přesune, ale klientce nepřijde e-mail o změně termínu:
  - zkontrolujte v admin sekci `Email logy`, jestli vznikl záznam `BOOKING_RESCHEDULED`
  - pokud log nevznikl, hledejte v server logu chybu `Booking reschedule notification enqueue failed`
  - samotný přesun termínu i auditní historie zůstávají uložené, protože e-mail se zakládá až po úspěšném commitnutí změny rezervace
- Pokud po přesunu nevzniká nový 24h reminder:
  - ověřte, že booking má po přesunu `reminder24hQueuedAt = null` a `reminder24hSentAt = null`
  - spusťte `npm run email:worker:once`
  - zkontrolujte, že nový termín ještě nezačal a není více než 26 hodin od aktuálního času; scheduler umí dohnat i termín po původním okně `25h-26h`
- Pokud worker selhává na chybě `Invalid input: expected string, received undefined` s cestou `manageReservationUrl`:
  - jde typicky o starší `EmailLog.payload`, který pole `manageReservationUrl` ještě neobsahuje
  - aktuální renderer je backward-compatible a e-mail odešle i bez tohoto pole, jen bez CTA `Změnit termín`
  - pokud chyba přetrvává, restartujte worker a ověřte, že běží nová verze aplikace
- Pokud se v adminu změnila cena služby a potřebujete dohledat, kdo zásah provedl:
  - ověřte, že je nasazená migrace `20260424103000_service_price_change_log_v1`
  - hledejte záznam v `ServicePriceChangeLog` podle `serviceId` a času změny
  - historické rezervace zůstanou konzistentní, protože `Booking` dál drží vlastní `servicePriceFromCzk` snapshot
- Pokud `/admin/sluzby` v devu vrací odpověď velmi pomalu a browser hází `ChunkLoadError` na Turbopack chunks:
  - ověřte, že list view bez `serviceId` nenačítá detail služby
  - ověřte, že seznam služeb načítá jen sloupce potřebné pro list
  - ověřte, že stavové metriky běží přes jeden agregační dotaz (`groupBy`) místo více samostatných `count`
- Pokud `/vouchery` v devu po načtení nebo při opakované navigaci hlásí `ChunkLoadError` nebo `Failed to fetch RSC payload`:
  - ověřte, že route nenačítá celý veřejný katalog služeb jen kvůli několika doporučeným kartám
  - pro voucher landing page používejte limitovaný helper `getVoucherSuggestedServices(3)`, ne plné `getPublicServices()`
- Chyba `Route "... " used params.slug. params is a Promise` v Next.js 16 znamená, že route používá starý synchronní přístup k dynamickým parametrům.
- Oprava:
  - v `page.tsx` a `generateMetadata` typuj `params` jako `Promise<{ ... }>`
  - nejdřív proveď `const { slug } = await params` (nebo odpovídající pole)
  - až potom parametr použij v DB dotazech nebo renderu
- Referenční implementace v projektu: [`src/app/(public)/sluzby/[slug]/page.tsx`](src/app/(public)/sluzby/[slug]/page.tsx).
- Chyba build procesu `Invalid segment configuration export detected` znamená, že některý App Router segment config export není staticky analyzovatelný.
- Oprava:
  - v route souboru používej pro `revalidate`, `dynamic`, `fetchCache`, `runtime`, `preferredRegion`, `maxDuration` přímo literály nebo jiné staticky vyhodnotitelné hodnoty
  - nepoužívej výrazy typu `60 * 60 * 24`; použij rovnou `86400`
  - v tomto projektu je referenční oprava v [`src/app/sitemap.ts`](src/app/sitemap.ts)

## Provozní Poznámky
- V detailu voucheru lze v adminu upravit jen provozní údaje: jméno kupujícího, e-mail kupujícího, platnost do a interní poznámku. Kód, typ, hodnota, měna, služba, čerpání ani PDF identita se běžnou editací nemění.
- Voucher se v adminu ruší destruktivní akcí `Zrušit voucher`, která vyžaduje důvod. Zrušení voucher nemaže, nastaví stav `CANCELLED`, čas zrušení, admin uživatele a důvod; zrušený voucher už nejde uplatnit.
- Zrušení je povolené jen pro voucher bez čerpání. Částečně nebo plně čerpaný voucher se v první verzi neruší přes tuto akci.
- OWNER i SALON mají u voucherů stejná provozní práva pro editaci a zrušení. Veřejné ověření zrušeného voucheru nikdy nezobrazuje interní důvod ani metadata zrušení.
- `proxy.ts` filtruje požadavky na `/admin/*` podle platné session JWT cookie; neplatná/expirovaná cookie neprojde.
- Finální autorizace probíhá server-side v admin layoutu a stránkách.
- Prisma klient používá singleton pattern pro vývoj i produkci.
- Databáze blokuje překrývající se aktivní sloty přes PostgreSQL exclusion constraint.
- Sloty s historickými rezervacemi nemažeme ani když už nejsou aktivní; pro zachování auditní stopy se místo toho archivují.
- Po každé změně Prisma schematu je potřeba spustit alespoň `npm run db:generate`; při změně struktury DB i `npm run db:migrate`.
- Technické SEO minimum je nyní pokryté přes globální metadata, per-page metadata, `robots.ts`, `sitemap.ts` a JSON-LD.
- Veřejné stránky staví metadata přes `buildPageMetadata(...)` a každá musí předat vlastní `path`; canonical a OpenGraph URL nesmí zůstávat na homepage pro všechny podstránky.
- Smoke E2E kontroluje, že veřejné canonical/OG URL používají stejnou URL pro danou stránku a že `robots.txt` se `sitemap.xml` nepouští historickou `http://ppstudio.cz` variantu; zároveň vyžaduje sitemap `<loc>` pro indexovatelnou route `/studio`. Produkční canonical origin má zůstat `https://ppstudio.cz`.
- Veřejný layout vkládá JSON-LD `BeautySalon`/`WebSite` přes `buildLocalBusinessJsonLd(...)`, homepage vlastní `WebPage`, stránka `O mně` přidává `Person` pro Pavlínu Pomykalovou a detail služby přidává `Service` přes `buildServiceJsonLd(...)` i samostatný `BreadcrumbList` přes `buildBreadcrumbListJsonLd(...)`. `BeautySalon` obsahuje i `geo` souřadnice studia a `Service.offers` se vkládá jen při jasně číselné ceně.
- JSON-LD serializer čistí `undefined`, `null` a prázdné hodnoty, escapuje `<` pro bezpečné vložení do script tagu a ponechává českou diakritiku. Délka služby v JSON-LD používá ISO 8601 helper `durationMinutesToIsoDuration(...)`.
- `public/llms.txt` je záměrně krátký veřejný rozcestník pro AI crawlery: uvádí kanonickou URL, hlavní veřejné landing pages a autoritativní kontakt. Nesmí odkazovat na admin routy ani tokenové self-service URL.
- Web Vitals měří samostatná klientská komponenta `WebVitalsReporter` v public/booking `SiteShell`. Pokud `NEXT_PUBLIC_WEB_VITALS_ENABLED` není `true`, komponenta se nespustí. Pokud je flag zapnutý, ale Matomo je vypnuté nebo chybí konfigurace, reporting zůstává no-op; při zapnutém Matomu odchází jen anonymní event `Web Vitals / <metric>` s ratingem a číselnou hodnotou.
- `sitemap.ts` nepoužívá jednotné „teď“ (`new Date()`) pro všechny URL: detail služby má `lastModified` z `Service.updatedAt`, statické stránky mají stabilní datum poslední obsahové revize.
- `sitemap.xml` běží jako Next.js metadata route s ISR revalidací (`revalidate = 86400`), takže se po změnách veřejných služeb průběžně regeneruje bez ručního zásahu.
- Produkční `robots.txt` pouští crawl celého veřejného webu přes `Allow: /`; neveřejné admin a tokenové routy zůstávají blokované, aby se neindexovaly citlivé odkazy. Veřejné noindex stránky, které nemají token v path, necháváme crawl přístupné, aby si roboti mohli přečíst `noindex`.
- Celý admin strom `/admin/*` má zároveň explicitní HTML metadata `robots: noindex,nofollow` v `src/app/(admin)/admin/layout.tsx`; `robots.txt` a stránkové metadata se záměrně doplňují.
- Root metadata branding (`applicationName`, title template a OpenGraph `siteName`) se načítá z `SiteSettings.salonName`; `metadataBase`, root `og:url` a page canonical/OG URL používají `siteConfig.canonicalUrl` (`NEXT_PUBLIC_SITE_URL` s fallbackem na `NEXT_PUBLIC_APP_URL`).
- Veřejné SEO landing pages (`/`, `/sluzby`, `/cenik`, `/vouchery`, `/o-mne`, `/sluzby/[slug]`) zbytečně neoznačuj `connection()` markerem. Request-time render má zůstat jen tam, kde opravdu záleží na aktuálním requestu nebo čerstvé slotové kapacitě, typicky u `/rezervace`.
- Voucher PDF kontaktní doména je od runtime URL oddělená: použij `VOUCHER_PUBLIC_DOMAIN` (priorita) nebo `NEXT_PUBLIC_SITE_DOMAIN`; fallback na `NEXT_PUBLIC_APP_URL` hostname se použije jen pro bezpečně veřejné hosty.
- Veřejné čtení `SiteSettings` už při renderu nezapisuje do DB; pokud singleton dočasně chybí nebo DB read selže, veřejný web a e-mailové šablony použijí bezpečné defaulty a bootstrap zápis zůstává jen v owner admin sekci `Nastavení`.
- Rezervační část má vlastní error boundary a loading fallback, takže výpadek booking vrstvy nepoškodí celý web.
- Background e-mail worker lze spustit přes `npm run email:worker` jako samostatný proces; pro jednorázové dohnání fronty je k dispozici `npm run email:worker:once`.
- Každý background job je chráněn `processingToken`; ruční okamžité doručení job nejdřív stejným způsobem atomicky claimuje. Resend REST používá pro jeden `EmailLog` stabilní idempotency key, zatímco obecné SMTP zůstává at-least-once (stabilní `Message-ID` může duplicity omezit, ale nemůže je absolutně vyloučit).
- Stejný `email:worker` každých 5 minut skenuje potvrzené rezervace od aktuálního času do 26 hodin před termínem a idempotentně zapisuje jeden reminder `EmailLog` typu `BOOKING_REMINDER`; tím dohání i pozdní potvrzení nebo výpadek původního enqueue okna.
- Po přesunu termínu resetuje doménová akce `rescheduleBooking(...)` oba reminder markery, takže se starý reminder neposílá pro původní termín a nový čas může znovu projít standardním enqueue flow.
- Před produkční aplikací migrací je k dispozici `npm run db:check-migrations`, který odhalí otevřené failed/incomplete záznamy v `_prisma_migrations`.
- Pro systemd provoz použij [`deploy/systemd/ppstudio-web.service`](deploy/systemd/ppstudio-web.service) pro hlavní app a [`deploy/systemd/ppstudio-email-worker.service`](deploy/systemd/ppstudio-email-worker.service) pro worker.
- Systemd unity i `.example` šablony povinně používají vyhrazený neprivilegovaný účet/skupinu `ppstudio`, které připraví instalační a release skript.
- Jednorázová instalace obou units je připravená v [`deploy/deploy.sh`](deploy/deploy.sh).
- Pro Docker Compose provoz použij [`deploy/docker-compose.email-worker.yml`](deploy/docker-compose.email-worker.yml).

## Týdenní Planner Dostupností
- Desktop používá klasický týdenní grid se 7 dny a 30min řádky v rozsahu `06:00-20:00`.
- Mobil drží týdenní režim přes přehled sedmi dnů a jeden editační panel vybraného dne.
- Základní význam barev:
  - zelená = běžná dostupnost
  - růžová = rezervace
  - písková = omezený interval, který nejde měnit přímo z planneru
  - šedá = neaktivní slot
  - tmavší podklad = minulý čas
- Kliknutí nebo tažení přes prázdné buňky dostupnost přidá.
- Kliknutí nebo tažení přes zelené buňky dostupnost odebere nebo zkrátí.
- Při ukládání se sousední půlhodiny automaticky sloučí do co nejmenšího počtu souvislých intervalů.
- Planner nikdy nepřepisuje rezervace ani technicky složitější sloty; pokud by změna zasáhla do chráněného úseku, vrátí srozumitelnou chybu.

## Kontrola Letního A Zimního Času
- Salonové časy se berou jako `Europe/Prague`; v UI, e-mailech a ICS má termín 09:00-10:00 zůstat 09:00-10:00 v zimě i v létě.
- Při kopírování dne nebo týdne v planneru se přenáší lokální půlhodinové buňky, ne pevný počet milisekund.
- Ruční QA po změně časové logiky: vytvoř slot 09:00-10:00 v lednu a červenci, zkontroluj veřejný booking, potvrzovací e-mail i `.ics` přílohu.
- Ruční QA kolem DST: zkopíruj den přes poslední březnovou neděli a poslední říjnovou neděli a ověř, že zůstaly stejné lokální hodiny.
