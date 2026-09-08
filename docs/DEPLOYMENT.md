# Deployment

Postup nasazení aplikace do produkce.

Stručný architektonický a provozní přehled nasazení na Proxmox/LXC je v kořenovém [`DEPLOYMENT.md`](../DEPLOYMENT.md). Tento soubor zůstává detailním release checklistem.

## Databázová preflight kontrola

- Před releasem s migrací `20260710110000_availability_slot_capacity_one` ověř `AvailabilitySlot` dotazem `WHERE "capacity" <> 1`. Migrace se při nálezu bezpečně zastaví; hodnoty neopravuj hromadně bez kontroly souběžných rezervací.

## Artefakty a zavislosti
- `node_modules` nesmi byt soucasti Git repozitare ani release ZIP/TAR artefaktu.
- Build/deploy host musi vzdy instalovat zavislosti z cisteho checkoutu pomoci `npm ci` podle `package-lock.json`.
- Pokud dojde k prenosu projektu mezi stroji, prenasi se zdrojove soubory + lockfile, ne predinstalovane zavislosti.
- Cílový runtime tohoto repa je `Node 24 LTS`; před releasem ověř `node -v` a `npm -v` přímo na deploy hostu.
- Pokud produkční systemd služby používají systémový `node` z `PATH`, po upgrade ověř, že stejnou verzi vidí i restartované jednotky `ppstudio-web` a `ppstudio-email-worker`.

## Release checklist
1. `npm ci --include=dev`
   - Před tím ověř, že server už běží na `Node 24 LTS`; po skoku z `22` čekej čistý reinstall nativních balíčků typu `sharp`.
2. Ověř správné produkční env proměnné (`DATABASE_URL`, `ADMIN_SESSION_SECRET`, `ADMIN_OWNER_EMAIL` jako kontaktní fallback, email delivery, worker, `MEDIA_STORAGE_ROOT`, povinný `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, volitelně `NEXT_PUBLIC_MATOMO_*`, `NEXT_PUBLIC_CLARITY_*`, `NEXT_PUBLIC_META_PIXEL_*`, `NEXT_PUBLIC_GOOGLE_ADS_*`, serverové `MATOMO_*` pro dashboard reporting a `PUSHOVER_ENABLED` / `PUSHOVER_APP_TOKEN` pro owner notifikace).
   - Při používání Resend trackingu ověř i `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` a `RESEND_WEBHOOK_SECRET`.
   - Aktuální produkční `.env` je v safe-mode `EMAIL_DELIVERY_MODE=log`; před zapnutím background delivery nastav provider explicitně. SMTP má pouze at-least-once semantiku, zatímco Resend REST podporuje idempotency key.
   - V Resend dashboardu musí být webhook endpoint nastaven na `POST /api/webhooks/resend` (HTTPS produkční origin).
   - `NEXT_DEPLOYMENT_ID` při doporučeném rollout skriptu nenasazuj ručně do `.env`; `deploy/release.sh` ho exportuje automaticky z aktuálního git commitu, stejně jako `DEPLOYMENT_VERSION` a `GIT_HASH`, a před restartem webu je zapíše do `.release-env` pro runtime `next start`.
   - Ověř, že reverzní proxy předává správný veřejný `Host` / `X-Forwarded-Host` odpovídající `NEXT_PUBLIC_APP_URL`; admin login/logout teď tyto hodnoty používají i pro explicitní CSRF/origin kontrolu.
   - Před prvním releasem pod účtem `ppstudio` změň případné staré `SITE_SETTINGS_SNAPSHOT_PATH=/var/www/ppstudio/site-settings-snapshot.json` na `/var/lib/ppstudio/site-settings-snapshot.json`, nebo proměnnou odeber. Nový fallback umí existující snapshot jednorázově převzít; explicitní cesta přímo v kořeni checkoutu je bezpečně odmítnuta.
3. Ověř existenci a práva k upload rootu; web proces pod účtem `ppstudio` musí umět zapisovat do `MEDIA_STORAGE_ROOT` nebo do výchozí cesty `/var/www/ppstudio/uploads`. Release helper vlastnictví a režim cesty nastaví, ale předem zkontroluj, že `.env` neukazuje na příliš širokou či nesprávnou cestu.
4. Zálohuj databázi, pokud release obsahuje novou Prisma migraci.
5. Zálohuj nebo snapshotuj upload root, pokud release mění práci s médii nebo cleanup logiku.
6. `npm run db:generate`
7. `npm run db:check-migrations`
   - Známý historický stav: kontrola může upozornit na rollbacknuté migrace `20260419140000_site_settings_singleton`, `20260419103000_service_public_bookability` a `20260428133959_voucher_pdf_logo_settings`. Každá má následný úspěšný záznam stejného názvu; pokud výstup končí `Migration history check: OK`, jde o auditní stopu staršího recover postupu a ne o blocker releasu.
8. Pro běžný rollout spusť `./deploy/release.sh`; přesné pořadí quality gates je `git pull --ff-only` -> synchronizace systemd unitů -> kontrola lokálních migrací a deployment env -> staging `npm ci --include=dev` -> `npm run db:generate` -> `npm run db:check-migrations` -> `npx prisma validate` -> `npm run lint` -> `npm run typecheck` -> `npm run test:release` -> `npm run build` -> zápis `.release-env` a finalizace staging release -> stop webu i workeru a ověření neaktivního stavu -> `npx prisma migrate deploy` -> atomické přepnutí `current`, start webu i workeru a health + homepage smoke validace. `test:release` je bez DB integrací; `test` a E2E zůstávají CI branou.
9. Ověř pro commit určený k releasu povinné GitHub CI checky `lint`, `typecheck`, `test`, `build`, `e2e`, `e2e chromium shard 2`, `e2e mobile` a `e2e mobile shard 2`. `coverage` nevyžaduj samostatně: vzniká jako artefakt jobu `test`. Nespouštěj `test` ani E2E proti produkčnímu `.env`, protože obsahují databázové či zapisující scénáře.
10. Pokud build výjimečně spouštíš mimo `deploy/release.sh`, postupuj v uvedeném pořadí a aplikuj `npx prisma migrate deploy` až po úspěšném buildu a těsně před aktivací.
    - Doporučený `deploy/release.sh` před buildem automaticky synchronizuje `deploy/systemd/*.service` do `/etc/systemd/system/` a spouští `systemctl daemon-reload`, takže změny unitů není potřeba releasovat zvlášť.
    - Při runtime upgradu po buildu udělej minimálně smoke test: homepage, admin login, vytvoření testovací rezervace a kontrolu, že po restartu běží i `ppstudio-email-worker.service`.
    - Pokud build spouštíš mimo `deploy/release.sh`, exportuj předem `NEXT_DEPLOYMENT_ID` na aktuální release identifikátor, používej stejný `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` jako běžící produkce a zajisti, aby stejný deployment identifikátor viděl i runtime `next start` (např. přes `.release-env` nebo ekvivalentní systemd env override).
11. Ověř, že `package.json`, `package-lock.json` a `CHANGELOG.md` obsahují stejnou release verzi.
12. Ověř aktuálnost dokumentace (`MANUAL.md`, `docs/*`)
13. Po změně GitHub workflow nebo názvů jobů ručně ověř GitHub nastavení repozitáře:
   - branch protection / rulesets mají required status checks podle aktuálních GitHub job names: `lint`, `typecheck`, `test`, `build`, `e2e`, `e2e chromium shard 2`, `e2e mobile`, `e2e mobile shard 2`; `coverage` není samostatný check
   - security záložka má zapnuté CodeQL a Dependabot alerts
   - případné staré required check names po rename nezůstaly viset jako permanentně pending
14. Pokud release mění e-mailové šablony, spusť `npm run email:previews` a ručně otevři soubory v `tmp/email-previews`; zkontroluj HTML i textovou variantu v testech, kontakty ze `SiteSettings`, `.ics` přílohu u potvrzení a absenci přílohy u reminderu.
15. Pokud release mění veřejné SEO JSON-LD, ověř homepage a jeden detail služby přes Google Rich Results Test nebo Schema Markup Validator; zkontroluj, že kontakt odpovídá viditelnému webu a Service schema neobsahuje recenze/ratingy.
16. Pokud release mění voucher doménu, ověř že je aplikovaná migrace `20260427205720_add_vouchers`; aktuální serverová business vrstva nepřidává další migraci, worker ani public route.
17. Projdi ruční QA veřejného webu na mobilu i desktopu:
   - zkontroluj `robots.txt`:
     - veřejný web vrací `Allow: /`
     - admin a tokenové routy `/admin/*`, `/rezervace/storno/*`, `/rezervace/sprava/*`, `/rezervace/akce/*` zůstávají blokované
     - `sitemap.xml` je uvedená v `robots.txt`
     - `sitemap.xml` odpovídá aktuálním veřejným službám nejpozději po ISR okně (aktuálně do 24 hodin od změny)
     - `Host`, `Sitemap` a všechny sitemap `<loc>` hodnoty používají produkční HTTPS origin `https://ppstudio.cz`, ne `http://ppstudio.cz`
     - veřejné noindex stránky bez tokenu v path nejsou blokované v `robots.txt`
     - podstránky mají vlastní canonical URL a OpenGraph URL, ne canonical homepage
     - veřejný layout obsahuje JSON-LD pro salon/web, homepage vlastní `WebPage` a detail služby `Service`/`BreadcrumbList`
     - ověřovací soubor Seznam Webmasteru je dostupný na `/seznam-wmt-cjKzOuv71FG0TOfkMT7WBqHwAXFWhvum.txt`
   - homepage
   - `/o-mne`:
     - výrazný hero s oběma CTA
     - čitelnost badge služeb na mobilu
     - rozumný crop hlavní fotografie nebo elegantní fallback placeholder
     - CTA kartu v sekci „Co vás u mě čeká“
     - sekci certifikací s reálnými daty i bez nich
     - finální tmavý CTA blok
   - služby a detail služby
   - `/vouchery`:
     - hero a finální CTA vedou na veřejný kontakt nebo `mailto:` pro domluvu voucheru
     - odkaz `Ověřit voucher` vede na `/vouchery/overeni`
     - sekce s doporučenými službami používá aktuální veřejný katalog a neobsahuje interní nebo neveřejné služby
   - kontakt
   - FAQ a právní stránky
     - `/obchodni-podminky`: hero CTA, blok poskytovatele a obsahová navigace
     - `/studio`: hero, galerie publikovaných fotek studia z modulu `Média`, fallback bez fotek a finální CTA
     - `/studio`: při existenci publikovaného `SALON_PHOTO` záznamu bez fyzického souboru se obrázek nesmí renderovat jako broken image; orphan záznam má být bezpečně přeskočen
     - `/kontakt`: hero fotka se bere pouze z publikovaného `CONTACT_PHOTO`; pokud chybí, stránka zobrazí placeholder bez fotky studia
   - CTA na rezervaci
   - self-service změnu termínu `/rezervace/sprava/[token]`:
     - hero říká `Změna termínu rezervace`
     - aktuální rezervace má oddělenou službu, datum, čas a stav
     - nejbližší termíny jsou primární chips a kalendář je až sekundární
     - výběr dne scrolluje na sloty vybraného dne a výběr času scrolluje na potvrzení
     - na mobilu jsou sloty ve 2 sloupcích, kalendář nemá horizontální scroll a vybraný termín je ve spodním sticky souhrnu
     - `Zrušit rezervaci` je až na konci jako slabá akce
   - Matomo při zapnutých `NEXT_PUBLIC_MATOMO_*`:
     - veřejná stránka načte `matomo.js`
     - klientská navigace po veřejných stránkách odešle další pageview bez duplicitního prvního pageview
     - `/admin`, `/api` a Next internals tracking nespustí
     - při přihlášené admin session (`ppstudio-admin-session`) se na veřejných stránkách nenačte `matomo.js` ani init script
     - tokenové route `/rezervace/sprava/*`, `/rezervace/storno/*`, `/rezervace/akce/*` neodešlou pageview s tokenem
     - booking funnel odešle eventy bez jména, e-mailu, telefonu, poznámky nebo tokenu
     - veřejná rezervace uloží telefon `777 123 456` jako `+420777123456`, zobrazí ho v adminu čitelně a odmítne textový/HTML telefon s uživatelskou hláškou
     - self-service změna termínu odešle jen eventy `Rezervace / Datum vybráno` a `Rezervace / Čas vybrán` bez tokenu nebo PII
     - služba s `cleanupMinutes > 0` se dá rezervovat i na poslední klientský start v publikovaném okně, pokud se do slotu vejde samotná délka služby; navazující termín se ale nesmí nabídnout před `blockedUntil`
     - volitelný Matomo Goal `Rezervace vytvořena` pro custom event `Rezervace / Vytvořena` slouží jen pro Matomo UI; admin dashboard bere počet rezervací přímo z eventu
     - server-side dashboard reporting má nastavené `MATOMO_URL`, `MATOMO_SITE_ID` a `MATOMO_AUTH_TOKEN`, Reporting API token není dostupný v klientském bundle a při výpadku API dashboard zobrazí nulové fallbacky místo 500
     - `/api/admin/analytics` vrací po přihlášení agregovaný JSON bez tokenu a bez PII; bez session vrací `403`
     - admin widget `Zdroje návštěv` ukazuje jen business labely zdrojů a max. několik položek včetně případného `Ostatní`, bez raw Matomo payloadu; rezervace u zdrojů jsou označené jako odhad
     - `npm run analytics:check` vrací `status: ok` nebo srozumitelnou chybu reportingu; při lockoutu nebo neplatném tokenu musí dashboard ukázat provozní hlášku místo zavádějících nul
   - Clarity při zapnutých `NEXT_PUBLIC_CLARITY_*`:
     - veřejná stránka načte Clarity tag pouze při `NEXT_PUBLIC_CLARITY_ENABLED=true` a vyplněném `NEXT_PUBLIC_CLARITY_PROJECT_ID`
     - `/admin`, `/api`, Next internals a tokenové self-service route (`/rezervace/sprava/*`, `/rezervace/storno/*`, `/rezervace/akce/*`) Clarity neinicializují
     - při přihlášené admin session (`ppstudio-admin-session`) se na veřejných stránkách Clarity nenačte
   - Google Ads tag při zapnutých `NEXT_PUBLIC_GOOGLE_ADS_*`:
     - veřejná stránka načte `https://www.googletagmanager.com/gtag/js?id=AW-...` pouze při `NEXT_PUBLIC_GOOGLE_ADS_ENABLED=true` a vyplněném `NEXT_PUBLIC_GOOGLE_ADS_ID`
     - `/admin`, `/api`, Next internals a tokenové self-service route (`/rezervace/sprava/*`, `/rezervace/storno/*`, `/rezervace/akce/*`) tag neinicializují
     - při přihlášené admin session (`ppstudio-admin-session`) se na veřejných stránkách tag nenačte
     - klientská navigace po veřejných stránkách odešle další `gtag('config', ...)` pageview bez tokenové URL a bez citlivých query parametrů
   - Meta Pixel při zapnutých `NEXT_PUBLIC_META_PIXEL_*`:
     - veřejná stránka načte `fbevents.js` pouze při `NEXT_PUBLIC_META_PIXEL_ENABLED=true` a vyplněném `NEXT_PUBLIC_META_PIXEL_ID`
     - `/admin`, `/api`, Next internals a tokenové self-service route (`/rezervace/sprava/*`, `/rezervace/storno/*`, `/rezervace/akce/*`) Pixel neinicializují
     - při přihlášené admin session (`ppstudio-admin-session`) se na veřejných stránkách Pixel nenačte
     - detail služby odešle `ViewContent`
     - `/rezervace` odešle `InitiateCheckout` až po výběru termínu nebo při přechodu do kontaktního kroku; po výběru služby odešle custom `BookingServiceSelected`, po výběru dne/času custom `BookingDateSelected` / `BookingTimeSelected`, po první interakci v kontaktu `BookingContactStarted` a po úspěchu standardní `Schedule` bez ceny, pokud není jednoznačná finální cena rezervace
     - Meta Events Manager checklist po deployi:
       1. ověř správný Pixel ID a spusť Test Events
       2. ověř pořadí `ViewContent → BookingServiceSelected → BookingDateSelected → BookingTimeSelected → InitiateCheckout → BookingContactStarted → Schedule` a právě jedno `Schedule`
       3. nastav `Schedule` jako hlavní konverzi a zkontroluj, že GTM ani Event Setup Tool neposílají stejné eventy podruhé
       4. vytvoř publika `ViewContent` / `BookingServiceSelected` / `InitiateCheckout` bez `Schedule` a klientky se `Schedule` vyluč z kampaní nedokončené rezervace
16. Projdi ruční QA admin částí:
  - login redirect pro `OWNER` a `SALON`
  - opakované chybné přihlášení na `/admin/prihlaseni` po překročení limitu vrátí `error=rate_limited` a nepovolí session
  - dostupnost owner-only sekcí jen pro `OWNER`
  - stejné chování owner/salon párových route po refaktoru factory wrapperů (overview, section, booking detail, slot list/create/detail/edit)
  - detail rezervace: akce `Změnit službu` přepíše službu bez vytvoření nové rezervace, uloží auditní záznam do historie a při delší/nepovolené službě vrátí čitelnou chybu místo tiché nekonzistence
  - detail klientky v owner i salon oblasti: CTA `Vytvořit rezervaci` otevře `/admin/.../rezervace?create=1&clientId=...` a drawer předvyplní správnou klientku nebo ukáže jemný fallback
  - `CRM souhrn` v detailu klientky ukazuje poslední dokončenou návštěvu, nejbližší aktivní budoucí termín, hodnotu služeb, uhrazeno/neuhrazeno a rozpad rezervací; zrušené a no-show rezervace se nepočítají do doplatku a individuální cena rezervace se počítá jako hodnota i základ doplatku
  - lite admin navigaci a mobilní čitelnost na `/admin/provoz/*`
   - overview dashboard na `/admin` a `/admin/provoz`:
     - horní blok `Provozní přehled` ukazuje datum, počet dnešních aktivních rezervací, právě probíhající nebo další rezervaci a CTA `Vytvořit rezervaci / Otevřít dnešní plán / Upravit dostupnost`
     - horní blok je nízká operační lišta, ne vysoký hero s velkým číslem
     - sekce `Vyžaduje pozornost` se zobrazí jen při actionable alertech a řeší pouze čekající rezervace na potvrzení, selhané e-maily a rezervace po termínu čekající na uzavření
     - KPI jsou jeden kompaktní metric strip: `Dnes rezervace`, `Volná okna dnes`, `Týdenní obsazenost`, `Volné sloty tento týden`; nulové e-mailové chyby nejsou samostatná KPI karta
     - `Dnešní plán` ukazuje pouze dnešní rezervace jako kompaktní seznam, právě probíhající termín decentně zvýrazní a nulový stav nabízí `Vytvořit rezervaci`
     - `Nejbližší volné termíny` neduplikuje dnešní volná okna a při chybějící dostupnosti pro dnes/zítra ukazuje akce `Upravit dostupnost` a `Přidat termín`
     - v admin planneru `Volná okna` nesmí po deployi zůstat falešně zelená v sousedním slotu, pokud předchozí rezervace blokuje čas až do `blockedUntil`
     - pravý sloupec obsahuje 2x2 rychlé akce `Rezervace / Dostupnost / Klienti / Vouchery`, kompaktní `Tento týden` a nízkou kartu `Výkon webu`
     - alerty v `Vyžaduje pozornost` mají jasnou prioritu: jeden hlavní alert je výraznější, sekundární položky jsou kompaktnější a CTA texty zůstávají konkrétní (`Rezervace`, `E-mail logy`)
     - detailní zdroje návštěv a funnel nejsou viditelné v hlavním pohledu; jsou až pod rozbalením `Zobrazit analytiku`
   - sekci `Kategorie služeb` na `/admin/kategorie-sluzeb` a `/admin/provoz/kategorie-sluzeb`:
     - pravý overlay drawer detailu na desktopu i mobilu
     - vytvoření nové kategorie přes CTA
     - kombinaci search / stav / řazení / chip filtrů
     - změnu pořadí
     - přepnutí aktivní / neaktivní
     - optimistic reakci seznamu bez reloadu stránky
     - warning stavy `prázdná`, `bez veřejné služby`, `neaktivní s aktivními službami`
     - mobilní otevření detailu a návrat zpět na seznam
     - blokaci mazání kategorie se službami
     - smazání prázdné kategorie
   - sekci `Služby` na `/admin/sluzby` a `/admin/provoz/sluzby`:
     - vytvoření nové služby přes CTA
     - nastavení `Čas na úklid po službě` a ověření, že se uloží v admin detailu; veřejná délka služby se nesmí změnit, ale dostupnost musí respektovat interní blokaci po službě
     - filtr podle kategorie
     - rychlé akce `aktivovat / deaktivovat`, `veřejná / interní`, `duplikovat`, `posunout`
     - warning stavy v kartách seznamu
     - otevření detailu služby do pravého overlay draweru a jeho zavření zpět na stejný filtrovaný seznam
   - slot workflow na `/admin/volne-terminy*` a `/admin/provoz/volne-terminy*`:
     - přepínání týdnů a zachování vybraného dne
     - horní stránková hlavička zůstává nízká a datum týdne se ukazuje jen jednou v planner toolbaru vedle navigace týdne
     - FullCalendar toolbar drží kompaktně navigaci týdne, aktuální rozsah a přepínač pohledu bez velkých prázdných mezer
     - časová osa je dobře čitelná a rezervace, úklid i dostupnost jsou na první pohled rozeznatelné
     - plain published slot s čistě `CANCELLED` bookingem se má tvářit jako běžná dostupnost, ne jako `Omezené`
     - průběžné uložení po rychlé úpravě dostupnosti
     - otevření denního pracovního panelu z karty dne
     - inline změnu stavu z day workspace
     - rychlou úpravu času bez kolize
     - blokaci a archivaci
     - zákaz smazání slotu s navázanou rezervací
   - sekci `Vouchery` na `/admin/vouchery` a `/admin/provoz/vouchery`:
     - horní metric strip ukazuje `Voucherů celkem`, `Aktivní`, `Částečně čerpané` a `Uzavřené` v jedné nízké kartě
     - filtry `Hledat / Typ / Stav / Filtrovat / Zrušit` jsou na desktopu v jednom řádku a zůstávají URL-driven
     - desktopová tabulka používá sloupce `Kód / Typ / Voucher / Čerpání / zůstatek / Stav / Platnost / Akce`
     - badge `Aktivní`, `Částečně čerpaný`, `Uplatněný` a `Propadlý` jsou přímo ve sloupci `Stav`, nelámou se přes více řádků a nepůsobí odděleně od řádku
     - tlačítko `Nový voucher` vede na správnou owner/salon route
     - vytvoření hodnotového voucheru s částkou, platností a volitelným kupujícím
     - vytvoření voucheru na aktivní službu a uložení snapshotu názvu, ceny a délky
     - po vytvoření redirect na odpovídající detail voucheru
     - neaktivní služby se v selectu ani server action nepovolí
     - v detailu voucheru tlačítko `Stáhnout voucher PDF` stáhne původní `application/pdf` s filename `voucher-<kod>.pdf`
     - detail voucheru nemá po načtení zobrazovat text `Rendering...`; loading indikace smí být vidět jen při skutečném načítání
     - summary karta je kompaktní a akce `Stáhnout PDF / Tisk A4 / Poslat e-mailem` jsou na desktopu v jedné řadě
     - karty `Detaily` a `Hodnota / služba` jsou sloučené do `Parametry voucheru`
     - karty `Kupující`, `Odeslat voucher` a základní stav odeslání jsou sloučené do `Kupující a odeslání`
     - odkaz `Tisk A4` stáhne samostatné A4 PDF na výšku s voucherem v horní třetině, bílým zbytkem stránky mimo voucher a beze změny původního e-mailového/běžného voucher PDF výstupu
     - PDF obsahuje kód, platnost, hodnotu nebo službu, QR kód a neobsahuje e-mail kupujícího, interní poznámku, historii čerpání ani technická ID
     - QR odkaz `/vouchery/overeni?code=...` vrací veřejné noindex ověření voucheru bez 404
     - veřejné ověření platného hodnotového voucheru ukáže kód, typ, zůstatek a platnost; službový voucher ukáže kód, typ, snapshot služby a platnost
     - veřejné ověření neplatného voucheru ukáže jen bezpečný důvod a při reloadu nemění `remainingValueCzk`, `Voucher.status` ani nevytváří `VoucherRedemption`
   - panel `Úhrada` v detailu rezervace na `/admin/rezervace/[bookingId]` a `/admin/provoz/rezervace/[bookingId]`:
     - horní souhrn ukazuje cenu k úhradě, uhrazeno voucherem, uhrazeno mimo voucher, celkem uhrazeno, zbývá doplatit nebo přeplaceno a stav úhrady `Neuhrazeno / Částečně uhrazeno / Uhrazeno / Přeplaceno`
     - `OWNER` i `SALON` umí přes `Upravit cenu` nastavit individuální cenu rezervace s důvodem a prázdnou hodnotou ji vrátit na ceníkový snapshot
     - `OWNER` i `SALON` umí zapsat platbu mimo voucher metodou `Hotově`, `Kartou`, `Převodem / QR` nebo `Jiné`
     - `OWNER` vidí smazání platby mimo voucher a `SALON` tuto akci nevidí
     - rezervace bez voucheru ukazuje prázdný stav v sekci `Dárkový poukaz` a dovolí ruční zadání kódu
     - intended voucher předvyplní kód a ukazuje typ, efektivní stav a bezpečný popis
     - hodnotový voucher předvyplní doporučenou částku podle zůstatku voucheru a zbývajícího doplatku
     - hodnotový voucher vyžaduje částku a po částečném čerpání zůstane `PARTIALLY_REDEEMED`
     - službový voucher lze uplatnit jen u odpovídající služby a individuální cena rezervace nemění jeho čerpání
     - historie uplatnění zobrazí datum, částku nebo službu, aktéra a poznámku
     - po existujícím redemptionu nebo nulovém doplatku se formulář dalšího voucheru nezobrazuje
   - owner sekci `/admin/email-logy` po každé změně Prisma schématu nebo e-mailové outbox vrstvy
   - owner sekci `/admin/nastaveni`:
     - uložení všech tří bloků
     - blok `Kalendář`: zapnutí feedu, zkopírování URL, rotaci tokenu a vypnutí feedu
     - po rotaci kalendáře starý subscription odkaz vrací 404 a nový vrací `text/calendar; charset=utf-8`
     - propsání kontaktů do footeru a `/kontakt`
     - propsání storno limitu do `/faq` a `/storno-podminky`
     - `/faq` po nasazení obsahuje viditelné otázky v HTML a `FAQPage` JSON-LD se stejnými otázkami/odpověďmi
     - na `/storno-podminky` správné kontakty v hero boxu `Jak zrušit rezervaci` a správné hodnoty v kartách hlavních pravidel
     - propsání booking limitů do `/rezervace`
     - blok `Pushover notifikace` je viditelný jen pro `OWNER`
     - ulozeni Pushover User Key, zapnuti/vypnuti hlavniho toggle a jednotlivych event typu
     - testovaci notifikace vrati jasny stav pro uspech, chybejici User Key, vypnuty `PUSHOVER_ENABLED` nebo chybejici `PUSHOVER_APP_TOKEN`
     - `SALON` nema v navigaci ani route pristup k `/admin/nastaveni`
   - owner sekci `/admin/uzivatele`:
     - seznam přístupů ukazuje jen role `OWNER` a `SALON`
     - systémové účty jsou read-only a zobrazují se jako `Systémový účet`
     - založení nové pozvánky vytvoří účet se stavem `Pozvánka čeká`
     - pozvánka dorazí na e-mail a odkaz vede na `/admin/pozvanka/[token]`
     - aktivace pozvánky dovolí nastavit heslo a následně přihlášení přes `/admin/prihlaseni`
     - po deaktivaci účtu ověř, že dříve odeslaný odkaz na pozvánku skončí chybou, účet zůstane deaktivovaný a owner pro obnovení přístupu případně vytvoří novou pozvánku
     - akce `Přepnout na OWNER/SALON`, `Deaktivovat` a `Znovu aktivovat` se ihned propšou do seznamu
  - modul `Média` na `/admin/media` a `/admin/provoz/media`:
     - veřejná stránka `/studio` zobrazí jen publikované fotky typu `SALON_PHOTO`
     - ve filtru `Prostory` upload předvybere typ `SALON_PHOTO` a volitelné pole `Pořadí` určuje pořadí hero/galerie
     - ve filtru `Kontakt` upload předvybere typ `CONTACT_PHOTO` a volitelné pole `Pořadí` určuje kontaktní hero fotku
     - po uploadu nebo publish/unpublish se po další návštěvě aktualizuje `/studio` i `/kontakt`
     - upload podporovaného obrázku s výběrem typu
     - pro JPEG/PNG/WebP vzniká při uploadu originál s EXIF normalizací a k němu `optimized` + `thumbnail` varianta přes `sharp`
     - editace titulku, alt textu, typu a publish/unpublish
     - tabs filtrů `Vše / Certifikáty / Prostory / Kontakt / Portrét Homepage / Portrét O mně` se správnými počty
     - quick publish/unpublish přímo na kartě média bez nutnosti otevírat editaci
     - smazání média
     - propsání publikovaných certifikátů na `/o-mne`
     - oddělený portrét pro homepage (`PORTRAIT_HOME`) a `/o-mne` (`PORTRAIT_ABOUT`) bez legacy fallbacku
15. Ověř booking, email a media vrstvu:
  - vytvoření testovací rezervace
  - propsání nové rezervace nebo změny slotu do overview dashboardu bez potřeby buildu nebo manuálního refresh flow navíc
  - `/admin/rezervace` a `/admin/provoz/rezervace`: kompaktní řádkový seznam, sticky header a inline akce `Potvrdit` / `Zrušit`
  - `/admin/rezervace` a `/admin/provoz/rezervace`: segmented filtr statistik bez duplicitního CTA, toolbar `hledat / stav / zdroj / datum`, seskupení `K uzavření / Čeká na potvrzení / Nadcházející / Minulé`, pending-first prioritu, click-to-open řádky, klávesy `Enter / ↑ / ↓`, tlumené řádky `Hotovo` a `Zrušená`, mobilní compact cards, živé našeptávání v poli `Hledat` a progresivní odkrývání (`Minulé` výchozně sbalené, `Zobrazit další` drží aktuální filtry)
  - detail klientky `/admin/klienti/[clientId]` a `/admin/provoz/klienti/[clientId]`: hlavička ukazuje stav, poslední a další návštěvu, rychlé akce fungují jen při dostupném kontaktu, historie návštěv otevírá detail rezervace a interní poznámka se uloží bez změny ostatních údajů
  - detail rezervace:
    - sticky header drží klientku, službu, termín, stav, zdroj a rychlé akce i při scrollu
    - akční panel je hned pod headerem a podle stavu nabízí správný další krok (`Potvrdit`, `Dokončit návštěvu`, `Nedorazila`), zatímco `Zrušit rezervaci` je až v oddělené nebezpečné sekci
    - u budoucí potvrzené rezervace se `Hotovo` nenabízí a serverový submit ho odmítne; akce je dostupná až po skončení termínu
    - po označení dnešní služby jako `Hotovo` zůstane rezervace v timeline viditelná a minulý úsek se nezačne tvářit jako volné okno
    - v sekci `Volné termíny` je dokončená rezervace vidět jako tlumené `Hotovo`, ne jen jako nejasný zamčený interval
    - potvrď, že `Přesunout termín` zůstává oddělené CTA do draweru, ne součást běžného chooseru
    - pravý summary card ukazuje kompaktně kontakt, službu, termín, zdroj a přesuny; technická metadata jsou sbalitelná nebo jasně upozaděná
    - na mobilu je souhrn rezervace hned pod hlavičkou a teprve potom následuje `Další krok`
    - panel `Úhrada` na první pohled ukazuje doplatek, celkem uhrazeno, voucher a platby mimo voucher, ale `+ Zapsat platbu` nepřebíjí hlavní akci `Dokončit návštěvu`
    - poznámky jsou v jednom bloku, ale klientská poznámka je vizuálně oddělená od interní týmové poznámky
    - historie ukazuje nejdřív poslední změnu a umí rozbalit celý audit
    - otevření draweru `Přesunout termín`
    - výběr nového času ze slotů i ručně
    - vznik auditního záznamu v historii detailu
    - korektní warning při interní výjimce mimo veřejnou dostupnost
    - založení `BOOKING_RESCHEDULED` v email logu při zapnutém oznámení
  - pravý drawer `Přidat rezervaci` v `/admin/rezervace` i `/admin/provoz/rezervace`:
    - vyhledání existující klientky podle jména / telefonu / e-mailu
    - založení nové klientky
    - založení nové klientky bez e-mailu
    - výběr služby a propsání délky/ceny
    - slotový výběr i ruční datum/čas
    - warning při interní výjimce mimo veřejnou dostupnost
    - vytvoření rezervace ve stavech `CONFIRMED` i `PENDING`
    - volitelné odeslání potvrzovacího e-mailu a `.ics` přílohy
    - bez e-mailu se booking uloží a potvrzení se přeskočí bez chyby
  - přepnutí kategorie nebo služby v kroku 1 `/rezervace` a reset nevalidního vybraného času
  - sekci `Nejbližší dostupné termíny` a jednoklikový přechod na kontakt
  - změnu dne v kalendářním fallbacku kroku 2 `/rezervace` a reset nevalidního vybraného času
  - větší grid časů na mobilu i desktopu včetně disabled stavů a návratu zpět ze souhrnu
  - sticky CTA lištu na mobilu a editaci jednotlivých bloků přímo ze souhrnu
  - kontaktní krok klávesnicí: label klik/fokus funguje u všech polí, nápověda i chyba se vážou přes `aria-describedby`, chybové hlášky se oznámí a `focus-visible` ring je jasně viditelný
  - po stabilizačním refaktoru také rychlou smoke kontrolu veřejného booking flow a týdenního planneru, protože jejich implementace je nově rozdělená do více interních modulů se stejným chováním
  - při rezervaci nebo přesunu přes navazující publikované sloty ověř, že volný okraj na začátku nebo konci coverage řetězce nezůstane v planneru jako `Omezené`, ale jako běžně editovatelná dostupnost
  - pokud QA najde starý nerozsekaný anchor slot vzniklý ještě před fixem chainingu, nejdřív spusť `node scripts/repair-legacy-chained-slots.mjs` jako dry-run; `--apply` používej jen pro jednoduché single-booking případy, které script sám označí jako `repairable`
  - zápis `EmailLog` ve stavu `PENDING` v background režimu nebo `SENT` v log režimu
  - funkční storno odkaz
  - provozní email akce `Schválit rezervaci` / `Zrušit rezervaci`:
    - otevření confirmation screen na `/rezervace/akce/[intent]/[token]`
    - korektní result screen po potvrzení
    - jednorázové použití odkazu
    - bezpečný stav po opětovném otevření stejného odkazu
    - korektní klientský email po schválení i zrušení
  - klientský potvrzovací e-mail po `CONFIRMED`:
    - obsahuje přílohu `pp-studio-rezervace.ics`
    - příloha obsahuje jeden `VEVENT` s `TZID=Europe/Prague`
    - potvrzovací email se korektně doručí i s attachmentem přes SMTP
    - HTML i text/plain používají jednotné bloky služba / datum / čas, místo `PP Studio, Sadová 2, 760 01 Zlín`, jeden kontakt a sekundární změnu/storno
  - 24h reminder, změnu termínu, storno a admin notifikaci:
    - ověř v Gmail desktop/mobile, iOS Mailu, Apple Mailu a pokud možno Outlooku
    - žádné duplicitní kontaktní věty, žádné CTA `Ozvat se studiu` v reminderu
    - tlačítka mají alespoň 44 px výšky, nelámou se a destruktivní akce není dominantní
  - doručení admin notifikačního e-mailu na `notificationAdminEmail`
  - zpracování email workerem nebo potvrzený `EmailLog` v log režimu
  - načtení testovacího veřejného media URL `/media/public/<kind>/...` nebo legacy `/media/<kind>/...`

## Go-Live šablona (release runbook)

Vyplň při každém nasazení. Slouží jako rychlý audit trail kdo/co/kdy ověřil.

| Krok | Stav | Owner | Čas (Europe/Prague) | Poznámka |
| --- | --- | --- | --- | --- |
| `npm run lint` | ☐ |  |  |  |
| `npm run typecheck` | ☐ |  |  |  |
| GitHub CI: `test` | ☐ |  |  |  |
| `npm run build` | ☐ |  |  |  |
| GitHub CI: `e2e` | ☐ |  |  |  |
| `npm run db:check-migrations` | ☐ |  |  |  |
| `npx prisma migrate status` | ☐ |  |  |  |
| `npx prisma migrate deploy` (cílové prostředí) | ☐ |  |  |  |
| Post-deploy smoke: admin nastavení `cleanupMinutes` | ☐ |  |  |  |
| Post-deploy smoke: veřejná rezervace bez interních textů | ☐ |  |  |  |
| Post-deploy smoke: dostupnost respektuje `blockedUntil` (`:15` / `:45`) | ☐ |  |  |  |
| Post-deploy smoke: admin detail rezervace ukazuje interní blokaci | ☐ |  |  |  |
| Post-deploy smoke: přesun rezervace respektuje cleanup | ☐ |  |  |  |
| Post-deploy smoke: ruční admin rezervace respektuje cleanup | ☐ |  |  |  |
| Monitoring 0-2h po release (error logy / failed jobs / kolize) | ☐ |  |  |  |
| Monitoring 24h po release | ☐ |  |  |  |

### Sign-off

- Release verze: ``
- Datum: ``
- Schválil/a (OWNER): ``
- Poznámka k releasu: ``
  - otevření `/api/calendar/owner.ics?token=...`:
    - validní `VCALENDAR` hlavička
    - `Content-Type: text/calendar; charset=utf-8`
    - ve feedu jsou jen `CONFIRMED` rezervace
    - po zrušení nebo přepnutí rezervace mimo `CONFIRMED` event zmizí při dalším fetchi
  - Pushover owner notifikace, pokud jsou v produkci zapnute:
    - nová webová rezervace obsahuje kromě služby, termínu a zdroje i údaj, zda jde o novou nebo vracející se klientku
    - nova webova rezervace posle `NEW_BOOKING`
    - manualni pending rezervace posle `BOOKING_PENDING`
    - potvrzeni, zruseni a presun poslou prislusny booking event
    - finalni selhani emailu/reminderu posle pouze jednu provozni chybu po vycerpani retry
    - duplicitni submit/retry stejneho `bookingId` nebo `emailLogId` se v jednom procesu potlaci 30s rate limitem
    - pri simulovaném DB outage proveď deset `GET /api/health`; každý musí vrátit `503` s `error.code=DATABASE_UNAVAILABLE` bez driver textu a `health-db-check` smí v jednom procesu vyvolat nejvýše jeden Pushover alert za 10 minut
    - vypnuti nebo chyba Pushover API nema zmenit vysledek rezervace ani email workeru

## Doporučené monitoring minimum
- Externí uptime check volej proti `GET /api/health`.
- Alarm nastav minimálně na HTTP `503` a timeout; veřejný readiness nevrací warning ani interní diagnostiku.
- Aktivní release identitu ověř ve startup logu `ppstudio.next.register` nebo po owner přihlášení přes `/api/health/diagnostics`.
- Sleduj oba systemd procesy `ppstudio-web.service` a `ppstudio-email-worker.service`.
- Při zapnutém Matomo dashboard reportingu měj po ruce i `npm run analytics:check` pro rychlou diagnostiku mimo UI.
- Po incidentu s e-maily vždy zkontroluj outbox stavy `failed`, `retrying`, `processing` a `stale`.

## Praktické SLA po releasu
- Do několika minut po nasazení ověř homepage, `/api/health`, admin login a jeden základní booking smoke test.
- Pokud release mění e-mail, voucher nebo analytics flow, rozšiř smoke test i o odpovídající provozní scénář.
- Když `/api/health` vrátí `error`/`503`, release nepovažuj za uzavřený, dokud není vysvětlená nebo opravená nedostupnost DB. Worker a recipient incidenty ověř samostatně přes owner-only diagnostiku.
- Pokud release helper hlásí HTTP `503`, vyčti bezpečný minimální JSON přes `curl -sS -D - http://127.0.0.1:3000/api/health` a konkrétní Prisma chybu z `journalctl -u ppstudio-web.service -n 200 --no-pager`.
- `release.sh` při neúspěchu explicitně vypíše `Health endpoint ...` nebo `Homepage smoke test ...` s URL a HTTP statusem. Podle této větve zkontroluj odpověď přes `curl -sS -D - <URL>` a `journalctl -u ppstudio-web.service -n 200 --no-pager`; společná hláška `Health/smoke test zatím neprošel` sama o sobě neurčuje vadný endpoint.
- Po restartu helper nejdřív tiše čeká na otevření webového endpointu (výchozích 20 pokusů po 0,25 s). Volitelně jej upravíš přes `PPSTUDIO_WEB_READY_RETRIES` a `PPSTUDIO_WEB_READY_RETRY_SECONDS`; teprve po vyčerpání čekání je selhání startu logované a následuje rollback.

## Ruční Fallback Rollout
Použij jen tehdy, když z nějakého důvodu nemůžeš použít `./deploy/release.sh`. Doporučený skript je bezpečnější, protože buildí ve staging workspace, zapisuje `.release-env`, synchronizuje systemd unity a umí vrátit předchozí artefakty při selhání startu.

1. Ověř `Node 24 LTS`, správné `.env`, upload root a existenci `ppstudio-web.service` / `ppstudio-email-worker.service`.
2. Proveď `git pull --ff-only`.
3. Spusť `npm ci --include=dev`.
4. Spusť `npm run db:generate`.
5. Spusť `npm run db:check-migrations`.
6. Spusť `npx prisma validate`, `npm run lint`, `npm run typecheck` a `npm run build`. Před produkčním releasem ověř úspěšné povinné CI checky včetně `test`, `e2e` a kroku `Test release mechanism`; nespouštěj jejich zapisující scénáře proti produkční databázi.
7. Zastav `ppstudio-web.service` i `ppstudio-email-worker.service` a přes `systemctl is-active` ověř, že ani jeden writer neběží.
8. Teprve potom spusť `npx prisma migrate deploy`. Při selhání nech oba writeři zastavené; starý runtime nespouštěj bez explicitního potvrzení kompatibility se skutečným stavem schématu.
9. Exportuj jednotný release identifikátor, například `export NEXT_DEPLOYMENT_ID=$(git rev-parse --short=12 HEAD)` a stejnou hodnotu nastav i do `DEPLOYMENT_VERSION` a `GIT_HASH`.
10. Zapiš stejné tři proměnné do `.release-env` uvnitř verzovaného release adresáře.
11. Před release potvrď, že `Unreleased` obsahuje všechny významné změny, přesuň jeho obsah pod novou verzovanou sekci s datem, aktualizuj případné odkazy pro porovnání verzí a založ novou prázdnou sekci `Unreleased`. V jedné release změně sjednoť verzi v `package.json`, kořenovém `package-lock.json`, `CHANGELOG.md` a dalších skutečně používaných místech.
12. Atomicky přepni symlink `current` na celý nový release a spusť `ppstudio-web` a `ppstudio-email-worker`.
13. Proveď minimálně smoke test `GET /api/health`, homepage, admin login a testovací rezervace.
14. Pokud běžíš v self-hosted režimu bez připraveného SMTP, nech dočasně `EMAIL_DELIVERY_MODE=log`, ať booking flow neblokuje start produkce; po ověření SMTP ho pro produkci vrať na `background`.

### Offline recovery OWNERa
- Z hostu s přístupem k produkčnímu `DATABASE_URL` spusť `npm run admin:recover-owner -- --email owner@example.com --name 'Jméno' --confirm < /bezpecna/cesta/heslo.txt`.
- CLI vytvoří nebo obnoví aktivního DB OWNERa, nastaví nové hashované heslo, revokuje nepoužité pozvánky a uloží audit `ADMIN_RECOVERY_OWNER_RESTORED`. Heslo není argumentem příkazu ani součástí auditu.
- Po recovery ověř přihlášení, platnost nové session a že nelze deaktivovat ani degradovat posledního aktivního OWNERa. Soubor s heslem bezpečně smaž podle provozního postupu.

### Automatizovaný rollout skript
- Pro běžný produkční rollout můžeš použít [`deploy/release.sh`](../deploy/release.sh).
- Skript provede:
  - kontrolu větve (výchozí `main`) a čistoty pracovního stromu; při jakékoli necommitnuté nebo untracked změně release skončí před synchronizací unitů a buildem. Release artefakt vždy vytváří z commitnutého `HEAD`.
  - fail-fast kontrolu, že systemd zná `ppstudio-web.service` a `ppstudio-email-worker.service`
  - fail-fast kontrolu, že stejné appky už neběží přes legacy PM2
  - `git pull --ff-only` (volitelně přeskočitelné)
  - build ve staging workspace mimo živý runtime
  - bez-zápisový preflight `npm ci --include=dev`, `npm run db:generate`, `npm run db:check-migrations`, `npx prisma validate`, lint, `npm run typecheck`, `npm run test:release` a build; `test:release` nespouští DB integrační testy nad produkčním `.env`
  - vytvoření plného release v `releases/<commit>-<čas>` včetně zdrojů, `.next`, `node_modules` a `.release-env`
  - stop webu i workeru a ověření, že oba writeři jsou neaktivní
  - `npx prisma migrate deploy` až po úspěšném buildu a stopu writerů
  - atomický `current` symlink, restart webu i workeru a povinný lokální health (`/api/health` s očekávaným deployment ID) + homepage smoke test
  - při selhání migrace žádná aktivace ani start; při selhání startu nebo health/smoke návrat symlinku, ale fail-closed ponechání služeb zastavených, dokud není ručně potvrzena kompatibilita DB
  - až po úspěchu bezpečný úklid: zůstávají jen `current` a `previous`; počet dalších nejnovějších release lze nastavit přes `--keep-releases N`
- Příklad:
```bash
cd /var/www/ppstudio
./deploy/release.sh
```
- Užitečné volby:
  - `--branch <name>`: nastav očekávanou release větev
  - `--skip-pull`: přeskočí `git pull --ff-only`
  - `--skip-lint`: přeskočí lint krok
  - `--yes`: bez interaktivního potvrzení
  - `--keep-releases N`: ponechá po úspěchu navíc N nejnovějších release (výchozí `0`); `current` a `previous` zůstávají vždy
- Volba `--allow-dirty` byla odstraněna. Necommitnuté změny nejdřív commitni nebo odlož; nelze je zahrnout do release.
- Pokud release skončí hned hláškou o chybějícím `ppstudio-web.service` nebo `ppstudio-email-worker.service`, server ještě nemá nainstalované produkční units; spusť `sudo /var/www/ppstudio/deploy/deploy.sh` a release opakuj.
- Pokud release skončí hláškou o legacy PM2 procesech, server ještě běží ve smíšeném režimu. Přepni ho na systemd:
```bash
pm2 delete ppstudio-web ppstudio-email-worker
pm2 save --force
systemctl disable --now pm2-root.service
```
- Teprve potom release opakuj.
- Při prvním provisioningu `deploy/deploy.sh` vytvoří dočasný symlink `current` na existující checkout, aby mohly nové unity bezpečně nastartovat. První úspěšný `release.sh` jej nahradí plným adresářem v `releases/`; po tomto okamžiku už `current` nikdy nesměřuje na pracovní git checkout.
- Regresní selhání startu webu, workeru a health/smoke rollbacku ověříš bez produkčních služeb příkazem `npm run test:release-script` (spouští `bash deploy/release.test.sh`); stejný příkaz je povinný CI krok `Test release mechanism` bez PostgreSQL. Skript navíc kontroluje pořadí build -> migrace -> aktivace, takže selhání buildu před DB zápisem a selhání migrace před přepnutím zůstávají kryté kontraktem releasu.

### Systemd
- Doporučený web unit je v [`deploy/systemd/ppstudio-web.service`](../deploy/systemd/ppstudio-web.service).
- Doporučený worker unit je v [`deploy/systemd/ppstudio-email-worker.service`](../deploy/systemd/ppstudio-email-worker.service).
- Obě unity i jejich `.example` varianty povinně používají vyhrazený účet/skupinu `ppstudio`; účet vytváří konfigurace `systemd-sysusers` a stavové adresáře `systemd-tmpfiles`.
- Jednoduchý instalační helper je v [`deploy/deploy.sh`](../deploy/deploy.sh).
- Kopíruj je do `/etc/systemd/system/`, potom spusť:
```bash
systemctl daemon-reload
systemctl enable --now ppstudio-web
systemctl enable --now ppstudio-email-worker
```
- Units očekávají stabilní `.env` v `/var/www/ppstudio/.env`, aktivní release přes `/var/www/ppstudio/current` a `npm` dostupné v PATH.
- `deploy/release.sh` načítá `.env` jako dotenv soubor, ne přes shellové `source`, takže bezpečně zvládá i hodnoty s mezerami bez uvozovek, například `NEXT_PUBLIC_APP_NAME=PP Studio`.
- Stejný skript používá `npm ci --include=dev`, protože po načtení produkčního `.env` může být `NODE_ENV=production`; bez toho by npm vynechal `devDependencies` a build by spadl třeba na chybě `eslint: not found`.
- Aktuální rollout model minimalizuje výpadek tak, že celý release včetně checkoutu, `.next` a `node_modules` vznikne ve staging adresáři mimo živý runtime. Po úspěšném buildu se uloží do `releases/` a po aplikaci kompatibilní migrace se atomicky přepne `current`; web i `tsx` worker proto nikdy nekombinují zdroje jednoho releasu s artefakty jiného.
- Praktické pořadí releasu je `git pull --ff-only -> synchronizace systemd unitů -> kontrola lokálních migrací a deployment env -> staging npm ci -> db:generate -> db:check-migrations -> prisma validate -> lint -> typecheck -> test:release -> build -> zápis .release-env a finalizace release -> stop + ověření writerů -> prisma migrate deploy -> current symlink -> start -> health + smoke`. Selhání před stopem nemění DB ani runtime; selhání od migrace dál ponechá runtime fail-closed zastavený. Před spuštěním releasu musí být pro stejný commit úspěšné všechny povinné CI joby (`lint`, `typecheck`, `test`, `build` a čtyři E2E shardy); krok `Test release mechanism` je součástí jobu `lint`.
- Stejný release helper po `git pull` automaticky přepíše i systemd unit soubory z `deploy/systemd/*` do `/etc/systemd/system/` a udělá `daemon-reload`, takže app release a unit release drží krok.
- Pro jednorázovou instalaci a zapnutí obou služeb můžeš použít:
```bash
sudo /var/www/ppstudio/deploy/deploy.sh
```
- `deploy/release.sh` s touto instalací počítá a bez ní záměrně nepokračuje do dlouhého buildu, aby neskončil až na finálním restartu.
- Pokud server historicky běžel přes PM2, vypni staré `ppstudio-web` a `ppstudio-email-worker` procesy ještě před prvním systemd restartem; jinak web skončí na `EADDRINUSE` a worker poběží duplicitně.

### Docker Compose
- Pro container deployment je připravený [`deploy/docker-compose.email-worker.yml`](../deploy/docker-compose.email-worker.yml).
- Službu používej vedle hlavního Next.js procesu, ne jako jeho náhradu.
- Před startem zajisti, že image `ppstudio:latest` už obsahuje build aplikace a že `env_file` ukazuje na správný `.env`.

## Poznámky k DB migracím
- Migrace `20260418184500_schema_v1_booking_core` převádí legacy `BookingRequest` na `Booking` a backfilluje nové tabulky.
- Migrace `20260418193000_booking_model_review_fixes` přidává explicitní slot restriction mode a DB constraint proti překrývajícím se aktivním slotům.
- Migrace `20260418220000_email_outbox_worker` doplňuje sloupce pro outbox, claimování a retry e-mailových jobů.
- Migrace `20260419103000_service_public_bookability` přidává sloupec `Service.isPubliclyBookable`; po deployi ověř, že `/rezervace`, `/sluzby` a `/cenik` zobrazují jen správné služby a že admin sekce `Služby` funguje v owner i salon oblasti.
- Migrace `20260421113000_public_pricing_metadata` rozšiřuje katalog služeb a kategorií o veřejná pricing metadata; po deployi ověř `/cenik`, `/sluzby`, detail služby a admin formuláře `Služby` + `Kategorie služeb`.
- Migrace `20260507143000_homepage_featured_services_v1` přidává ruční výběr doporučených služeb na homepage; po deployi ověř admin detail služby, nastavení `Zobrazit v doporučených službách`, pořadí a veřejnou homepage `/`.
- Migrace `20260525100000_service_cleanup_minutes_v1` přidává `Service.cleanupMinutes` s defaultem `0`; po deployi ověř admin vytvoření/editaci služby, validaci nezáporné hodnoty a načtení uložené hodnoty zpět do formuláře.
- Migrace `20260525113000_booking_cleanup_snapshot_v1` přidává snapshot sloupce na `Booking` (`cleanupMinutes`, `cleanupBlockMinutes`, `blockedUntil`); po deployi ověř, že veřejná i admin dostupnost respektuje interní blokaci a první termín po blokaci může být i v `:15`/`:45`.
- Migrace `20260422120000_admin_users_invited_at` přidává `AdminUser.invitedAt`; po deployi ověř owner sekci `/admin/uzivatele`, stav `Pozvánka čeká` a existující DB účty bez vyplněného `invitedAt`.
- Migrace `20260422170000_admin_invite_token_v1` přidává tabulku `AdminUserInviteToken`; po deployi ověř jednorázové použití pozvánky, expiraci a revokaci starších tokenů při novém odeslání.
- Migrace `20260422201500_booking_email_actions_v1` rozšiřuje enum `BookingActionTokenType` o `APPROVE` a `REJECT`; po deployi ověř vytvoření nových tokenů při veřejné rezervaci a funkčnost email route `/rezervace/akce/[intent]/[token]`.
- Migrace `20260422230500_manual_booking_admin_v1` přidává `Booking.isManual`, `Booking.manualOverride` a převádí `BookingSource` na nové provozní hodnoty; po deployi ověř `/admin/rezervace`, `/admin/provoz/rezervace`, ruční vytvoření rezervace a správné labely zdroje v listu i detailu.
- Migrace `20260423113000_booking_reschedule_logs_v1` přidává `Booking.reminder24hQueuedAt`, `Booking.rescheduleCount` a tabulku `BookingRescheduleLog`; po deployi ověř detail rezervace, auditní historii přesunu a nové reminder markery po změně termínu.
- Migrace `20260424103000_service_price_change_log_v1` přidává tabulku `ServicePriceChangeLog`; po deployi ověř editaci ceny v `/admin/sluzby` nebo `/admin/provoz/sluzby` a vznik auditního záznamu se starou i novou cenou.
- Migrace `20260427205720_add_vouchers` přidává enumy a tabulky pro databázový základ voucherů (`Voucher`, `VoucherRedemption`) a intent pole na `Booking`; po deployi stačí ověřit aplikaci migrace a `prisma generate`, protože UI ani public booking napojení zatím nejsou součástí releasu.
- Migrace `20260502085140_add_voucher_cancellation_and_operational_edit` přidává auditní vazby pro zrušení a poslední provozní úpravu voucheru. Po deployi ověř admin detail voucheru v owner i salon oblasti, zrušení aktivního voucheru bez čerpání, odmítnutí čerpaného voucheru a veřejné ověření zrušeného kódu.
- Klientský self-service manage/reschedule flow nevyžaduje novou migraci; po deployi ale ověř `/rezervace/sprava/[token]`, reminder CTA `Změnit termín` a zápis `changedByClient = true` do `BookingRescheduleLog`. Public post-submit confirmation screen už manage/reschedule CTA záměrně nezobrazuje.
- Migrace `20260710123000_remove_customer_calendar_endpoint` odstraňuje nepoužívaný `CALENDAR` z enumu `BookingActionTokenType` a maže případné historické tokeny. Po deployi ověř potvrzovací a reschedule e-mail s `.ics` přílohou; zákaznická URL `/api/bookings/calendar/*` musí vracet `404`.
- Migrace `20260422193000_calendar_feed_v1` přidává tabulku `CalendarFeed`; po deployi ověř owner sekci `/admin/nastaveni`, zapnutí feedu a úspěšný fetch `/api/calendar/owner.ics?token=...`.
- Pokud je databáze v divergentním stavu a `prisma migrate dev` by nabízelo reset, neprováděj ho naslepo. Pro tuto migraci lze bezpečně použít `npx prisma db execute --file prisma/migrations/20260421113000_public_pricing_metadata/migration.sql` a až potom ověřit build.
- Migrace `20260419140000_site_settings_singleton` přidává tabulku `SiteSettings`; po deployi ověř, že se `/admin/nastaveni` otevře bez chyby a že owner workflow `Nastavení` bezpečně založí výchozí singleton záznam i na prázdné DB.
- Migrace `20260419230000_media_storage_v1` přidává tabulku `MediaAsset` a enumy pro lokální media storage; po deployi ověř zápis souboru do upload rootu a načtení přes `/media/public/*` nebo legacy `/media/*`.
- Migrace `20260428133959_voucher_pdf_logo_settings` přidává nullable `SiteSettings.voucherPdfLogoMediaId` s FK na `MediaAsset`; po deployi ověř `/admin/nastaveni`, výběr `Logo pro PDF vouchery` a stažení PDF voucheru s vybraným PNG/JPEG i bez nastaveného loga.
- Admin workflow kategorií služeb nevyžaduje novou DB migraci; navazuje na existující model `ServiceCategory`.
- Přepracované admin workflow služeb a kategorií nevyžaduje novou DB migraci; změna je čistě v read modelech, server actions a UI vrstvách.
- Nový layout sekce `Kategorie služeb` také nevyžaduje novou DB migraci; změna zůstává čistě v komponentách, read modelu a server actions nad existujícím `ServiceCategory`.
- Next.js Server Actions hardening:
  - všechny instance stejného buildu musí mít stejný `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
  - při doporučeném rollout scriptu každý deploy automaticky dostane `NEXT_DEPLOYMENT_ID`, `DEPLOYMENT_VERSION` i `GIT_HASH` z aktuálního commitu; skript je před restartem webu zapíše i do `.release-env`, mimo skript to musí operátor dodat ručně i pro runtime
  - při rolling deployi tím Next.js pozná mismatch a vynutí reload místo pádu na `Failed to find Server Action`
  - při incidentu čti `journalctl -u ppstudio-web.service -n 200 --no-pager | rg 'ppstudio.next\\.(register|request-error)'`; startup log ukáže `deploymentId` a fingerprint action klíče jen pokud runtime opravdu dostal release env, request log navíc ukáže příchozí `x-deployment-id`, route context, shrnutí `next-action` headeru a odhad příčiny
- Strukturované texty služeb vyžadují migraci `20260508120000_service_structured_public_copy_v1`. Před produkcí udělej zálohu DB, nasaď migrace přes `npx prisma migrate deploy`, spusť dry-run `npm run db:backfill-service-copy -- --dry-run` a teprve po kontrole výstupu použij `npm run db:backfill-service-copy -- --confirm`. Skript mění pouze `seoTitle`, `idealFor`, `includes`, `benefits` a `goodToKnow` podle známých slugů.
- Stabilizační refaktor `booking-public`, `booking-flow` a `admin-slots` také nevyžaduje novou DB migraci; změna je čistě strukturální a zachovává stejné veřejné exporty i databázové chování.
- Před produkční aplikací migrace ověř data, která by mohla mít rezervaci bez přiřazené služby; tato migrace takové řádky záměrně odmítne.
- Pokud v databázi existují duplicitní rezervace stejného klienta do stejného slotu, nová migrace se zastaví a vyžádá jejich ruční vyčištění.
- Pokud nasazuješ jen frontend bez DB změn, `npx prisma migrate deploy` zůstává bezpečný no-op.
- `npm run db:migrate` v tomto repozitáři mapuje na `prisma migrate dev` a je určený pro lokální vývoj, ne pro produkční server.
- Produkční release flow proto používá `npm run db:check-migrations` a `npx prisma migrate deploy`.

## Rollback
1. Návrat na předchozí commit/release tag.
2. `npm ci && npm run db:generate && npm run build`
3. Pokud release obsahoval migraci, ověř kompatibilitu rollbacku s databází.
4. U datově transformačních migrací rollback neprováděj naslepo; nejdřív ověř, zda starší aplikace umí pracovat s novým schématem.
5. Restart procesu.
6. Ověření funkčnosti.

## Self-hosted poznámky
- Aplikace nevyžaduje externí queue; e-maily se ve v1 ukládají do PostgreSQL outboxu a worker je vytahuje na pozadí.
- Pro menší self-hosted provoz stačí běžný SMTP účet s app passwordem, běžící worker a monitoring `EmailLog` v owner adminu.
- `email:worker` nově zajišťuje dvě věci: enqueue 24h reminderů i samotné doručování `EmailLog`. Pokud worker stojí, stojí obě části flow.
- Doručování používá tokenovaný claim. Resend REST deduplikuje stejný outbox job 24 hodin přes `Idempotency-Key`; SMTP má stabilní `Message-ID`, ale po ACK SMTP serveru a před DB zápisem stále platí at-least-once doručení. Při incidentu proto neprováděj ruční resend naslepo a u SMTP případné duplicity řeš jako provozní možnost.
- Pokud worker stojí, klientský self-service přesun sice změní termín v DB, ale potvrzovací e-mail o změně zůstane jen ve frontě nebo se nedoručí; smoke test po deployi má vždy ověřit i vznik `BOOKING_RESCHEDULED`.
- Pokud SMTP dočasně nefunguje, přepni na `EMAIL_DELIVERY_MODE=log`; booking a storno zůstanou funkční a e-mailové pokusy se dál auditují.
- Když worker hlásí TLS chybu typu `wrong version number`, zkontroluj, že `SMTP_SECURE` odpovídá portu. Pro Resend a podobné providery je nejbezpečnější `SMTP_SECURE=auto`.
- Aplikace pro IP rate limiting používá výhradně `X-Real-IP`: veřejný booking, admin login, veřejné ověření voucheru a aktivace admin pozvánky přes něj vytvářejí IP hash. Nginx Proxy Manager proto musí aplikaci zpřístupňovat jako jediná reverse proxy a pro každou proxovanou žádost tuto hlavičku **přepsat**, ne pouze přidat, skutečnou vzdálenou adresou: `proxy_set_header X-Real-IP $remote_addr;`. Na `X-Forwarded-For` se nelze spoléhat, protože klient může jeho hodnotu podvrhnout. Pokud je před Nginx Proxy Managerem další proxy (např. CDN), nastav v Nginxu důvěryhodné adresy této vrstvy přes `set_real_ip_from`, obnov `$remote_addr` přes `real_ip_header` a až potom nastav uvedené `X-Real-IP`.
- Verzionovaná web unit zachovává Next.js bind na `0.0.0.0:3000`, protože repo neobsahuje konfiguraci NPM/Nginxu ani firewall a nelze z něj rozhodnout, zda proxy běží lokálně nebo vzdáleně. Přímý přístup klienta na port 3000 by dovolil podvrhnout `X-Real-IP` a obejít IP část limitů. Je-li proxy ve stejném síťovém namespace (typicky stejném LXC), v `deploy/systemd/ppstudio-web.service` i `.example` nastav `Environment=HOSTNAME=127.0.0.1` a ověř upstream na loopbacku; proxy v jiném LXC je vzdálená. Je-li proxy vzdálená, firewall musí povolit TCP/3000 pouze z reálných IP/CIDR proxy a zakázat jej všem ostatním zdrojům, včetně ekvivalentního IPv6 pravidla. Nevymýšlej zástupné adresy. Bez ověřeného loopback bindu nebo firewallového allowlistu deploy nedokončuj.
- Princip firewallu je: `allow tcp dport 3000 from <skutečný-proxy-ip-nebo-cidr>` a následně `deny tcp dport 3000 from any`; stejný princip platí pro IPv6. Zástupný text musí operátor nahradit doloženou adresou/sítí proxy. Pravidlo nastav na síťové hranici, která tento LXC/host skutečně chrání, nikoli jen v neúčinné lokální konfiguraci.
- Před uzavřením deploymentu ověř `ss -ltnp` na hostu aplikace, aktivní konfiguraci Nginx/NPM i firewall v jeho enforcement pointu. Z jiné než důvěryhodné proxy sítě musí být TCP spojení na port 3000 odmítnuto; přes veřejnou proxy musí požadavek fungovat a `X-Real-IP` musí být přepsané proxy. Tuto vlastnost nelze zaručit unit testem ani prokázat jen z repozitáře.
- Access log administračních API nesmí obsahovat query string. V log formátu Nginxu pro `/api/admin/` používej cestu bez parametrů (`$uri`, ne `$request_uri`), aby se případná citlivá hodnota z chybného requestu nedostala do logů.
- I když `npm run build` dnes předem volá `prisma generate`, v release checklistu necháváme explicitní `npm run db:generate`, protože chrání i jiné skripty a ruční servisní zásahy.
- `allowedDevOrigins` je čistě development nastavení pro `next dev`; produkční deploy ani `next start` na něm nestojí. Pokud někdo řeší vzdálené testování přes LAN nebo přes Synology reverse proxy na `ppstudio.cz`, upravuje se `next.config.ts`, ne produkční env.
- Verzionovaný release vytváří ve staging adresáři vlastní `package-lock.json`. `turbopack.root` proto musí zůstat explicitně nastavený na adresář aktivního `next.config.ts`; jinak může `next build` vydat falešné varování o více lockfilech.
- Upload root není build artefakt. Při deployi se nemaže a má být zálohovaný samostatně od repozitáře i databáze.
- Veřejná média se publikují přes `/media/public/*` a legacy `/media/*`, takže reverse proxy nemusí mapovat fyzickou cestu upload adresáře přímo do document rootu.
- Obě URL varianty obsluhuje stejný serverový handler; při smoke testu ověř jednu publikovanou variantu přes obě cesty a že nepublikovaný asset vrací `404`.

## Dodatečná QA pro týdenní planner
- Ověř všechny route varianty:
  - `/admin/volne-terminy`
  - `/admin/volne-terminy/[slotId]`
  - `/admin/volne-terminy/[slotId]/upravit`
  - a stejné cesty pod `/admin/provoz/volne-terminy/*`
- Ověř, že planner renderuje týdenní kalendář a že guardy rolí fungují stejně jako dřív.
- Ověř, že kliknutí do gridu vybírá blok pro pravý inspektor a že teprve tažení nebo akce z inspektoru mění koncept.
- Ověř přidání dostupnosti tažením, odebrání zeleného intervalu a copy week.
- Ověř průběžné uložení změny a možnost obnovit poslední uložený stav po chybě.
- Ověř, že pokus o zásah do rezervace skončí čitelnou chybou bez změny dat.

## QA Pro Letní/Zimní Čas
- Tento release nepřidává DB migraci ani novou knihovnu.
- Po deployi ověř v admin planneru slot 09:00-10:00 pro zimní i letní datum, copy week přes poslední březnovou a říjnovou neděli, veřejné zobrazení termínu, potvrzovací e-mail a `.ics` přílohu.
