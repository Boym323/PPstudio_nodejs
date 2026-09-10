# PP Studio

Produkční web kosmetického studia s veřejnou prezentací, rezervačním flow a odděleným admin rozhraním pro role `OWNER` a `SALON`.

Aktuální verze: <!-- current-version -->**3.29.0**. README slouží jako rychlý GitHub rozcestník a onboarding. Detailní provozní a vývojová dokumentace je vedená přímo v repozitáři, ne jako primární GitHub Wiki.

Nejdůležitější dokumenty:
- [MANUAL.md](MANUAL.md) pro provozní souvislosti
- [ARCHITECTURE.md](ARCHITECTURE.md) pro architekturu systému
- [BOOKING_FLOW.md](BOOKING_FLOW.md) pro rezervační doménu
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) pro technická pravidla vývoje
- [docs/API.md](docs/API.md) pro hlavní HTTP endpointy a jejich kontrakty

## Aktuální stav

- veřejný web: homepage, služby, detail služby, ceník, studio, o mně, kontakt, FAQ a právní stránky
- veřejná voucher landing page na `/vouchery` a read-only ověření voucheru na `/vouchery/overeni`
- rezervační flow na `/rezervace` nad ručně publikovanými sloty
- self-service správa rezervace přes veřejné tokenové routy pro změnu termínu a storno
- admin pro owner i provoz se sekcemi rezervací, volných termínů, služeb, kategorií, klientů, médií, voucherů a nastavení
- evidence plateb rezervací, voucher lifecycle, PDF voucher a ruční e-mailové odeslání voucheru
- e-mailová fronta, auditní historie rezervací, owner `.ics` calendar feed a volitelný Matomo reporting pro dashboard

## Co je důležité vědět

- Tohle není "běžný Next.js projekt". Před změnou App Routeru nebo framework API si ověř relevantní guide v `node_modules/next/dist/docs/`.
- Route soubory mají zůstat tenké; business logika patří do `src/features`, infrastruktura do `src/lib`.
- Veřejné texty a část brand copy jsou v `src/content/public-site.ts`, ale katalog služeb, pricing metadata a část veřejného obsahu už bere data z DB read modelů.
- Dokumentace se udržuje v repu společně s kódem; GitHub Wiki není v tomhle projektu zdroj pravdy.

## Stack

- Next.js 16 App Router
- React 19 + TypeScript
- Tailwind CSS 4
- Prisma 7 + PostgreSQL
- Zod validace na serveru
- Nodemailer / Resend transport pro e-mailovou frontu
- Playwright + Node test runner + `c8` coverage
- Matomo Reporting API

## Struktura projektu

```text
src/
  app/
    (public)/                 veřejný web
    (booking)/                booking a veřejné tokenové akce
    (admin)/admin/            admin vstup a chráněné sekce
    api/                      auth, kalendáře a pomocné endpointy
    media/                    servírování uložených médií
  components/
    layout/                   sdílené layouty
    ui/                       malé znovupoužitelné UI prvky
  config/                     metadata, navigace, env
  content/                    editovatelný obsah veřejného webu
  features/
    analytics/                veřejný tracking a reporting helpery
    admin/                    admin workflow, formuláře a read modely
    booking/                  booking flow a booking business logika
    calendar/                 kalendářové exporty
    media/                    media knihovna a upload workflow
    public/                   homepage a veřejné stránky nad DB read modely
    vouchers/                 voucher doména, PDF a veřejné ověření
  lib/                        infrastructura, Prisma, auth, utility
scripts/                      provozní a importní helpery
tests/                        Playwright E2E scénáře
prisma/
  schema.prisma               datový model
prisma.config.ts              Prisma 7 CLI konfigurace
docs/
  ADR/                        architektonická rozhodnutí
  API.md                      hlavní HTTP endpointy a jejich kontrakty
```

## Hlavní routy

- `/` veřejná homepage
- `/sluzby`, `/sluzby/[slug]`, `/cenik`, `/studio`, `/o-mne`, `/kontakt`, `/faq`
- `/vouchery`, `/vouchery/overeni?code=...`
- `/rezervace` booking flow
- `/rezervace/sprava/[token]` veřejná správa rezervace
- `/rezervace/storno/[token]` veřejné storno
- `/rezervace/akce/[intent]/[token]` potvrzovací akce z provozních e-mailů
- `/admin/prihlaseni` admin login
- `/admin/*` owner admin
- `/admin/provoz/*` lite admin pro roli `SALON`
- `/api/calendar/owner.ics?token=...` owner calendar feed

## Autentizace a role

Admin používá podepsanou `httpOnly` session cookie přes `jose`, serverový login handler a role `OWNER` / `SALON`.

- `/admin/*` je plný owner backoffice
- `/admin/provoz/*` je zjednodušené provozní rozhraní
- admin přístupy jsou vždy databázové; pozvánky a offline recovery vytvářejí auditovatelný DB účet

## Datový model

Projekt už pokrývá hlavní provozní entity:

- `AdminUser`
- `ServiceCategory`
- `Service`
- `ServicePriceChangeLog`
- `AvailabilitySlot`
- `Client`
- `Booking`
- `BookingPayment`
- `BookingStatusHistory`
- `BookingActionToken`
- `BookingSubmissionLog`
- `Voucher`
- `VoucherRedemption`
- `EmailLog`
- `SiteSettings`
- `MediaAsset`

## Rychlý start

### 1. Požadavky

- Node.js 24 LTS
- npm 10+
- PostgreSQL 15+
- lokální přístup k zapisovatelnému adresáři pro `MEDIA_STORAGE_ROOT`

### 2. Instalace a lokální setup krok za krokem

```bash
npm run deps:install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run dev
```

Vývoj běží standardně na `http://localhost:3000`.

Praktický postup:

1. Naklonuj repozitář a přejdi do rootu projektu.
2. Vytvoř lokální `.env` z `.env.example`.
3. Uprav minimálně `DATABASE_URL`, `SHADOW_DATABASE_URL`, `ADMIN_SESSION_SECRET` a lokální `NEXT_PUBLIC_APP_URL`.
4. Připrav PostgreSQL databázi pro hlavní i shadow DB.
5. Přepni lokální runtime na `Node 24` přes `nvm use` nebo ekvivalent.
6. Spusť `npm run deps:install`. Skript používá ve výchozím stavu veřejný npm registry; pokud musíš použít firemní mirror, předej `PPSTUDIO_NPM_REGISTRY=https://… npm run deps:install`.
7. Spusť `npm run db:generate`.
8. Spusť `npm run db:migrate` pro lokální Prisma migrace.
9. Spusť `npm run dev`.
10. Otevři `http://localhost:3000`.

### 3. První přihlášení do adminu

- admin login je na `/admin/prihlaseni`
- pro první založení i obnovu přístupu použij offline `npm run admin:recover-owner -- --email owner@example.com --name 'Jméno' --confirm < heslo.txt`; webový bootstrap login neexistuje

### 4. Lokální e-mail a analytics režim

- pro bezpečný lokální vývoj je praktičtější `EMAIL_DELIVERY_MODE=log`
- veřejný Matomo tracking nech ve vývoji vypnutý, dokud opravdu netestuješ analytics flow
- pokud potřebuješ ověřit dashboard reporting, použij `npm run analytics:check`

Když dev server spadne na poškozenou Next/Turbopack cache, pomůže:

```bash
npm run dev:clean
```

`npm run test:e2e` vytváří vlastní produkční build v `.next-e2e`, takže jej lze bezpečně spustit i při běžícím `npm run dev`; neukončuj dev server ani nemaž jeho `.next`. Před čistou instalací ověř dostupnost registru příkazem `npm run deps:check`.

## Skripty

- `npm run dev` spustí rychlý vývojový server s Turbopackem
- `npm run dev:webpack` spustí pomalejší Webpack režim jako fallback při potížích s Turbopack HMR
- `npm run build` vytvoří produkční build
- `npm run start` spustí produkční server
- `npm run lint` spustí ESLint
- `npm run typecheck` ověří TypeScript bez zápisu výstupu
- `npm run test` spustí unit a DB integrační testy nad Node test runnerem
- `npm run test:coverage` vygeneruje coverage report do `coverage/`
- `npm run test:e2e` spustí Playwright E2E testy
- `npm run clean:e2e` smaže pouze izolovaný E2E build `.next-e2e`
- `npm run deps:check` ověří dosažitelnost registru pro instalaci závislostí
- `npm run deps:install` provede reprodukovatelnou instalaci z lockfile (`npm ci --include=dev`); volitelný `PPSTUDIO_NPM_REGISTRY` přepne registry
- `npm run analytics:check` ověří server-side Matomo reporting
- `npm run test:db:booking` spustí booking DB integrační testy
- `npm run db:generate` vygeneruje Prisma Client
- `npm run db:migrate` spustí `prisma migrate dev`
- `npm run db:check-migrations` zkontroluje historii migrací
- `npm run db:push` synchronizuje schema bez migrací
- `npm run db:studio` otevře Prisma Studio
- `npm run db:import-services` importuje katalog služeb
- `npm run db:backfill-service-copy` provede backfill strukturovaných textů služeb (nejdřív používej `-- --dry-run`, teprve potom `-- --confirm`)
- `npm run db:clear-booking-data` vypíše počty booking/slot dat a s `-- --confirm` je smaže bez zásahu do služeb, admin účtů a settings
- `npm run email:worker` spustí e-mailový worker
- `npm run email:worker:once` jednorázově zpracuje frontu e-mailů
- `npm run email:previews` vygeneruje lokální HTML náhledy e-mailových šablon do `tmp/email-previews`

Pro produkci používej Prisma deploy flow přes `npx prisma migrate deploy`. Lokální `npm run db:migrate` je určené pro vývoj.

## Příklad `.env`

Zkrácený příklad pro lokální vývoj:

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
ADMIN_OWNER_EMAIL=owner@example.com

EMAIL_DELIVERY_MODE=log
EMAIL_TRANSPORT=smtp

MEDIA_STORAGE_ROOT=/var/www/ppstudio-uploads
```

Co je důležité:

- `NEXT_PUBLIC_APP_URL`: veřejný základ URL pro metadata, redirecty a odkazy v e-mailech
- `NEXT_PUBLIC_SITE_DOMAIN` a `VOUCHER_PUBLIC_DOMAIN`: textová veřejná doména pro voucher PDF a kontaktní výstupy
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`: stabilní klíč pro Next.js Server Actions; v produkci musí zůstat stejný mezi instancemi stejného buildu
- `DATABASE_URL`: hlavní PostgreSQL databáze aplikace
- `SHADOW_DATABASE_URL`: pomocná DB pro `prisma migrate dev` v lokálním vývoji
- `ADMIN_SESSION_SECRET`: tajný klíč pro podpis admin session cookie; v produkci musí být dlouhý a unikátní
- `ADMIN_OWNER_EMAIL`: kontaktní fallback pro systémové e-maily; není to přihlašovací účet
- `EMAIL_DELIVERY_MODE=log`: bezpečný lokální režim bez reálného SMTP odesílání
- `EMAIL_TRANSPORT`: transport pro background odesílání (`smtp` nebo `resend`)
- `MEDIA_STORAGE_ROOT`: absolutní cesta mimo repo, kam se ukládají nahraná média

Plný seznam proměnných a detailní vysvětlení je v `docs/ENVIRONMENT.md`.

## Dokumentační rozcestník

- [MANUAL.md](MANUAL.md): provozní a uživatelský přehled projektu
- [ARCHITECTURE.md](ARCHITECTURE.md): architektura, datový model a integrační hranice
- [BOOKING_FLOW.md](BOOKING_FLOW.md): rezervační tok a jeho pravidla
- [ENVIRONMENT.md](ENVIRONMENT.md): rychlý přehled produkčního prostředí
- [DEPLOYMENT.md](DEPLOYMENT.md): praktický postup nasazení
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md): rychlá diagnostika problémů
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): technické konvence a workflow
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md): úplný katalog env proměnných
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): release checklist a nasazení
- [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md): přehled hlavních závislostí
- [docs/INCIDENTS.md](docs/INCIDENTS.md): provozní incidenty a jejich řešení
- [docs/ADR/README.md](docs/ADR/README.md): architektonická rozhodnutí

## Nasazení

### Doporučený deploy krok za krokem

1. Na serveru měj čistý checkout repozitáře a správně nastavené `.env`.
2. Ověř PostgreSQL připojení, e-mailovou konfiguraci, `MEDIA_STORAGE_ROOT` a validní `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.
3. Spusť `./deploy/release.sh`.
4. Skript provede `git pull --ff-only`, vytvoří úplný staging release (`npm ci --include=dev`, `npm run db:generate`, `npm run db:check-migrations`, `prisma validate`, `npm run lint`, `npm run build`), zastaví web i worker, ověří jejich neaktivní stav a teprve poté aplikuje `prisma migrate deploy`.
5. Po úspěšné migraci atomicky přepne symlink `current` a spustí nový runtime. Při selhání migrace nový release neaktivuje; při selhání startu, health nebo smoke testu ponechá služby fail-closed zastavené, aby starý writer neběžel nad změněným schématem.
6. Po releasu ověř `GET /api/health`, admin login, veřejnou homepage a testovací rezervaci. Homepage smoke test je diagnostikován samostatně; identitu releasu ověř ve startup logu, ne ve veřejném health payloadu.

### Kdy použít detailní deployment docs

- [DEPLOYMENT.md](DEPLOYMENT.md) nabízí rychlý provozní postup
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) obsahuje plný release checklist a ruční QA
- [MANUAL.md](MANUAL.md) shrnuje rollout z pohledu údržby
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) rozepisuje produkční env proměnné

## SLA a monitoring

Projekt už má připravené stavební bloky pro základní provozní dohled:

- `GET /api/health/live` vrací bez-DB liveness, `GET /api/health` lehký DB readiness a owner-only `/api/health/diagnostics` detail fronty a releasu
- `npm run analytics:check` ověří server-side Matomo reporting
- `ppstudio-web.service` a `ppstudio-email-worker.service` mají být pod systemd
- admin dashboard umí ukázat provozní a analytické varování, ale není náhradou externího monitoringu

Doporučené minimum:

1. Externí HTTP check na `/api/health` s alarmem na HTTP `503` nebo timeout.
2. Kontrola běhu obou systemd služeb.
3. Alert na růst `failed/retrying/stale` e-mailů.
4. Základní release SLA: po deployi ověřit homepage, admin login a vytvoření testovací rezervace.

`/api/health` provádí jediný DB ping a při nedostupné databázi vrací HTTP `503` se stabilním kódem `DATABASE_UNAVAILABLE`. Stav e-mailové fronty čti po owner přihlášení z `/api/health/diagnostics`; konkrétní příčinu chyb hledej v journalu webové služby.

Pokud chcete mít v repu přímo popsaný provozní standard, navazující detaily jsou v `docs/DEPLOYMENT.md`, `docs/INCIDENTS.md` a `MANUAL.md`.

## Dokumentace

Při každé významné změně udržuj aktuální:

- `MANUAL.md`
- `CHANGELOG.md`
- `docs/DEVELOPMENT.md`
- `docs/ADR/*`
- `docs/ENVIRONMENT.md`
- `docs/DEPLOYMENT.md`
- `docs/INCIDENTS.md`
- `docs/DEPENDENCIES.md`

Nejdůležitější doprovodné dokumenty:

- `MANUAL.md` pro provozní a uživatelský přehled
- `docs/DEVELOPMENT.md` pro detailní technické konvence
- `docs/ENVIRONMENT.md` pro env proměnné
- `docs/DEPLOYMENT.md` pro nasazení

## Commit zprávy

- commit message piš česky
- pro jednotný styl dodržuj pravidla pro české commit zprávy v `AGENTS.md`
