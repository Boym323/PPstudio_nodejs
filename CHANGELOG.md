# Changelog

Všechny důležité změny v tomto projektu se zapisují do tohoto souboru.

Formát je inspirovaný Keep a Changelog.

## [Unreleased]

### Opraveno

- Veřejný výběr termínu i samoobslužný přesun rezervace nyní nabídnou první čtvrthodinový začátek bezprostředně po automatickém obědě, pokud je pro vybranou službu zachována obědová pauza.

## [3.28.1] - 2026-09-08

### Opraveno

- Ruční uvolnění e-mailového jobu je nyní dostupné i serverově pouze pro skutečně stale claim; atomická kontrola původního tokenu a času claimu zabrání přepsání nového workeru nebo dokončeného odeslání.

## [3.28.0] - 2026-09-08

### Opraveno

- Odesílací tlačítko v dialogu pro pozvání administrátora používá v mobilním Safari explicitně kontrastní bílý text.
- Dokončení návštěvy nyní opakuje celý PostgreSQL serializační konflikt v bounded retry mechanismu; souběžné voucherové dokončení tak zachová atomický stav rezervace a voucheru.
- Admin poznámka a individuální cena rezervace nyní odmítnou stale formulář podle `expectedUpdatedAt` místo tichého přepsání novější změny; formulář nabídne načtení aktuální hodnoty.
- Expirované rate-limit rezervace se průběžně uklízejí z existujícího email workeru po malých dávkách; SMTP exactly-once omezení zůstává explicitně zdokumentované a produkční background SMTP při startu varuje.

## [3.27.0] - 2026-09-06

### Změněno

- Sekce Události má jednodušší záložky, přehled problémů k vyřešení, historii seskupenou podle data a kompaktní e-mailové i technické záznamy. Pokročilé filtry a technické údaje jsou sbalené; prázdné výsledky rozlišují aktivní filtry.
- Provozní Přehled upřednostňuje dnešní klientky, umožňuje potvrzení a dokončení návštěvy s úhradou přímo v dialogu a dokončené návštěvy seskupuje do rozbalovacího seznamu. Upozornění a rychlé akce popisují další krok, týdenní souhrn se neopakuje a webová analytika je ve Statistikách.

### Opraveno

- Admin voucherový formulář v mobilním WebKitu zachová částku vyplněnou před dokončením hydratace, takže ji následný render nesmaže a vytvoření nevrátí chybu nulové hodnoty.
- Souběžné přidávání fotografií do galerie služby správně opakuje konflikt pořadí s PostgreSQL adaptérem Prisma 7 místo pádu při zpracování chyby.
- Souběžné storno stejné rezervace bezpečně zopakuje serializační konflikt a oběma požadavkům vrátí aktuální výsledek; neplatné časové razítko při přesunu už neobchází kontrolu souběžné změny.
- Ruční retry a uvolnění e-mailového jobu nepřepíše výsledek odeslání ani nový claim workeru vzniklý během akce; administrace oznámí souběžnou změnu.

- Z detailu rezervace lze nyní přímo otevřít profil dané klientky z jejího jména i řádku v souhrnu rezervace.

- Security Audit nyní používá opravené verze tranzitivních balíčků `fast-uri` a `mysql2`; PostgreSQL runtime a Prisma verze zůstávají beze změny.
- Pushover upozornění na blokace veřejného rezervačního formuláře nyní používají perzistentní atomický cooldown 10 minut pro hash skutečného limiteru (IP nebo e-mail); opakované blokace se dál zapisují do `BookingSubmissionLog`, ale nezaplňují notifikace duplicitními zprávami.

### Zabezpečení

- Absolutní limit stáří admin relace se kontroluje i při autorizaci API a server actions.
- Interní zápisy galerie a denního režimu oběda jsou oddělené od veřejných exportů server actions.

## [3.26.2] - 2026-09-01

### Změněno

- Test webhooků Svix nyní vytváří časové razítko dynamicky, takže ověření zůstává stabilní i při běhu v různých časech.

## [3.26.1] - 2026-08-31

### Odstraněno

- Z detailu klientky byla odstraněna redundantní akce „Obnovit detail“, která pouze navigovala na stejnou URL bez vlastního obnovení dat nebo jiného side effectu.

### Změněno

- GitHub CI nyní v existujícím mobilním shardování spouští také booking E2E coverage přes Playwright WebKit na profilu iPhone 15.
- E2E build artefakt v GitHub CI už nepřenáší nepotřebnou Turbopack cache, takže navazující browser shardy stahují výrazně menší balík.
- Databázové integrační testy už mezi izolovanými procesy nečekají na timeout neaktivního PostgreSQL poolu, takže GitHub CI dokončí testovací fázi výrazně rychleji.

### Opraveno

- Odesílací tlačítko v dialogu pro pozvání administrátora má v mobilním Safari dostatečný kontrast i mimo stav ukládání.
- Odesílací tlačítko v dialogu pro pozvání administrátora zůstává čitelné i během ukládání, včetně mobilního Safari.
- KPI obsazenost nyní sjednocuje překrytou historicky publikovanou kapacitu a doplňuje skutečně odpracované manuální rezervace; retenční drill-down odpovídá dashboardu i při budoucí rezervaci a kalendářní období, hranice grafu i dostupnost srovnání respektují pražský kalendář a význam jednotlivých metrik.
- Pozdní potvrzení rezervace a výpadek reminder scheduleru už nezpůsobí ztrátu 24h připomínky; potvrzovací cesty ji zakládají okamžitě a scheduler idempotentně dohledá všechny dosud nezačaté rezervace až do horní hranice reminder okna.

### Zabezpečení

- Produkční release nyní před databázovou migrací zastaví a ověří web i e-mailový worker; při selhání migrace nebo nového runtime zůstávají writeři fail-closed zastavení a starý release se nad změněným schématem automaticky nespustí.
- Post-provider finalizace klientského e-mailu nyní před reminder markerem pod zámkem ověří současné vlastnictví `EmailLog` claimu, booking delivery lease, generaci i příjemce, takže převzatý claim nemůže zanechat `reminder24hSentAt` u čekajícího logu.

## [3.26.0] - 2026-08-30

### Přidáno

- Admin Planner nyní ve hlavičce a časové mřížce vizuálně označuje české státní a ostatní svátky jako informativně zavřené a zobrazuje školní prázdniny pro okres Zlín bez omezení vytváření dostupnosti nebo rezervací.
- KPI a statistiky nyní umožňují zobrazit celý příští kalendářní měsíc.

## [3.25.2] - 2026-08-30

### Opraveno

- Admin přihlášení nyní správně nastavuje session cookie při běhu přes HTTP E2E server ve WebKitu/Safari.
- Admin ovládací prvky v mobilním WebKitu mají dostatečný kontrast a odkazy v přehledu jsou zřetelně odlišené.
- KPI statistiky už při zobrazení budoucího měsíce neselžou u rezervací bez navázaného dostupnostního slotu.
- Testovací prostředí nyní spolehlivě vynucuje logovací režim e-mailového doručování a neobsahuje nepoužívanou pomocnou funkci.

## [3.25.1] - 2026-08-30

### Zabezpečení

- CLIENT booking e-maily nyní rozlišují zastaralou autorizaci od dočasně obsazeného delivery lease; job při cizím platném lease zůstane `PENDING`, zachová payload i idempotency key a pokračuje až po bezpečné expiraci lease.
- Všechny lifecycle změny rezervace, včetně admin statusů, `NO_SHOW`, owner approve/reject a veřejného storna, nyní atomicky respektují aktivní delivery lease a zvyšují generaci komunikace; starý worker proto nemůže odeslat zneplatněný klientský e-mail.
- Provider delivery má explicitní timeout kratší než delivery lease a rollout `communicationGeneration` selektivně backfilluje pouze legacy logy s prokazatelně aktuálním příjemcem, službou, termínem a lifecycle stavem.
- Tokenizovaný CLIENT resend nyní před rotací odkazů respektuje aktivní delivery lease, zvýší komunikační generaci a přepíše všechny aktuální čekající tokenové e-maily na nové credentials; zastaralé logy se bezpečně systémově přeskočí.
- Úspěšná finalizace 24h reminderu nyní zapisuje `EmailLog=SENT` a `Booking.reminder24hSentAt` atomicky v jedné post-provider fencing transakci.
- Tokenizovaný resend při kanonickém přepsání čekajícího CLIENT logu nyní atomicky ruší jeho starý worker claim, takže zastaralý worker nemůže novou komunikační generaci systémově přeskočit ani dokončit.

## [3.25.0] - 2026-08-30

### Zabezpečení

- Klientské booking e-maily a 24h reminder nyní používají generaci komunikace a krátký delivery fence; změna kontaktu, služby nebo termínu proto zneplatní i claimnutý starý job bez držení databázového locku přes provider HTTP.

### Opraveno

- Starý reminder už nemůže po úspěšném provider delivery označit novou reminder generaci jako `SENT`; stale retry skončí systémovým přeskočením.

## [3.24.0] - 2026-08-30

### Zabezpečení

- Public self-service mutace nyní v jedné serializovatelné transakci zamknou a znovu ověří použitý `RESCHEDULE` manage token; revokovaný, použitý nebo prošlý odkaz proto nevydá storno token ani nezmění termín rezervace.
- Změna nebo odstranění e-mailu klientky nyní v transakci okamžitě revokuje aktivní self-service odkazy na všechny její budoucí aktivní rezervace, jejichž e-mailový snapshot se skutečně změnil; platí to i při propsání snapshotu na nezměněný master e-mail a čekající klientské e-maily s novou adresou dostanou novou dvojici tokenů.
- Doručené booking/admin e-maily už v `EmailLog.payload` nezachovávají raw bearer URL; ruční resend tokenových e-mailů vydává nové tokeny a zneplatní staré aktivní odkazy.
- Terminálně neúspěšné booking/admin e-maily nyní při přechodu do `FAILED` atomicky redigují raw bearer URL v `EmailLog.payload`; retryable failures zůstávají pro automatický retry nezměněné.
- Neověřený public booking ani public reschedule už nemění master jméno, e-mail ani telefon existující klientky; právě odeslané údaje zůstávají pouze ve snapshotu rezervace.

### Opraveno

- Reschedule potvrzené rezervace nyní při přesunu do 24h reminder policy založí nový 24h reminder okamžitě uvnitř nebo po enqueue window; replacement vzniká ve stejné serializovatelné transakci s aktuálním termínem, službou a klientským snapshotem, a `notifyClient=false` na tom nic nemění.
- Adminské potvrzení, adminské storno a owner approve/reject nyní používají e-mailový snapshot konkrétní rezervace; při prázdném snapshotu lifecycle dokončí bez klientského `EmailLog` a nových `RESCHEDULE`/`CANCEL` tokenů.
- Změna e-mailu klientky už znovu nepoužije čekající booking e-mail se zastaralým termínem, stavem nebo službou; takový log systémově přeskočí a založí nový e-mail s kanonickým payloadem aktuální rezervace a novými self-service odkazy.
- Změna e-mailu klientky už neztratí neodeslaný 24h reminder: aktuální pending log se včetně nových self-service URL kanonicky obnoví bez duplicity, zastaralé logy se systémově přeskočí a změna uvnitř nebo po enqueue window vytvoří replacement okamžitě; při odstranění e-mailu se nový klientský reminder nevytvoří.
- Admin storno rezervace nyní nabízí volitelné odeslání klientského potvrzení o zrušení; vypnutí e-mailu nemění změnu stavu, obnovu dostupnosti, historii ani revokaci self-service tokenů.
- Změna služby u aktivní rezervace nyní resetuje neodeslaný 24h reminder; pokud je rezervace uvnitř nebo po scheduler enqueue window, ve stejné transakci okamžitě založí replacement s kanonickým payloadem aktuální služby, zatímco starý e-mail lze systémově přeskočit podle `serviceId` a již odeslaný reminder zůstává beze změny.
- CLIENT resend konkrétní rezervace nyní rozhoduje adresáta z `Booking.clientEmailSnapshot` až po zamknutí aktuálního `Booking` uvnitř stejné transakce jako preflight, tokeny a nový `EmailLog`; `Client.email` jej proto nemůže přebít a chybějící snapshot odmítne resend bez mutace.
- Admin cancellation UI nyní povoluje klientské oznámení podle e-mailového snapshotu konkrétní rezervace, takže checkbox i zobrazený booking kontakt odpovídají skutečnému příjemci backendu.
- Booking e-mailový preflight nyní u nových klientských potvrzení, přijetí, přesunů a reminderů ověřuje také stabilní `serviceId`; staré payloady bez tohoto pole zůstávají kompatibilní.
- Aktivní klientské odkazy pro správu a storno rezervace nyní po každém úspěšném přesunu expirují podle nového termínu i bez klientského e-mailu; historické budoucí odkazy se jednorázově srovnají při migraci.
- Ruční resend tokenovaných booking e-mailů nyní před revokací existujících odkazů atomicky ověří aktuální stav a termín rezervace; zastaralý zdroj proto nezaloží nový e-mail ani tokeny a ponechá dosavadní odkazy použitelné. Ruční resend reminderu obchází jen deduplikaci dříve odeslaného reminderu, nikoli kontrolu aktuálního termínu, stavu nebo začátku rezervace.
- Reschedule se zapnutým klientským oznámením nyní ukládá změnu rezervace, nové self-service tokeny a klientský `BOOKING_RESCHEDULED` `EmailLog` v jedné serializovatelné transakci; selhání zápisu proto přesun rollbackne a selhání providera po commitu řeší pouze outbox worker.
- Booking e-mailový worker nyní před doručením klientských potvrzení, přijetí, přesunů a storen ověřuje aktuální stav a termín rezervace; zastaralé logy označí jako systémově přeskočené bez dalšího retry, zatímco administrační historické notifikace a retry při nezměněné rezervaci zůstávají zachované.
- Voucherové čerpání nyní vzniká pouze uvnitř atomického dokončení návštěvy po přechodu rezervace do `COMPLETED`; samostatné admin uplatnění je vypnuté, nedokončené rezervace nové čerpání nepřijmou a historické nekonzistentní čerpání zablokuje storno, `NO_SHOW` i přesun bez mazání finanční historie.
- Self-service odkazy pro správu a storno rezervace nyní expirují až krátce po plánovaném začátku rezervace, takže zůstávají použitelné i u termínů vytvořených 60–90 dní dopředu; storno a přesun dál samostatně respektují své business limity.
- Ruční resend klientského e-mailu nyní po explicitním odstranění aktuální adresy klientky nepoužije historického příjemce, pokud ani booking snapshot neobsahuje použitelný kontakt.
- Změna e-mailu klientky nyní vytvoří aktuální klientský booking e-mail i tehdy, když předchozí klientské logy už byly odeslané; odpovídající čekající log se pouze znovu opatří odkazy a neaktuální čekající logy se systémově přeskočí.

## [3.23.2] - 2026-08-29

### Opraveno

- E-mailový outbox nyní rozlišuje klientské, administrační a externí příjemce; změna kontaktu klientky proto nepřepíše čekající admin/externí log a ruční resend administrační zprávy nemůže použít adresu klientky.
- Zkrácení nebo prodloužení aktivní ruční výjimky při změně služby nyní synchronizuje `DRAFT` s `blockedUntil`, obnoví uvolněnou původní PUBLISHED dostupnost a bezpečně odečte nově blokovaný úsek; chráněné sloty zůstávají nedotčené nebo změnu odmítnou.
- Ruční booking a admin přesun nyní před vytvořením interního DRAFT override atomicky odečtou pouze překrývající běžnou PUBLISHED dostupnost; částečné překryvy tak neporuší exclusion constraint a po cancellation/reschedule se původní dostupnost znovu zkompaktuje, zatímco protected sloty operaci bezpečně odmítnou.
- Klientský katalog nyní pro automatický oběd načítá celou publikovanou dostupnost všech relevantních pražských dnů, zatímco skutečně rezervovatelné termíny dál respektují booking window; nabídka proto používá stejný denní kontext jako autoritativní serverová kontrola.
- Klientský katalog nyní odděluje booking-window bookingy pro kandidátní termíny od full-day aktivních booking bloků pro `scheduleOptimization`, takže automatický oběd zohlední i starší rezervace a jejich cleanup stejně jako authoritative kontrola serveru.
- Změna služby v administraci nyní stejně jako veřejná rezervace a přesun ověřuje zachování poslední platné automatické obědové přestávky nad aktuálním stavem dne; prodlužující změna služby proto nemůže uložit termín, který by oběd znemožnil.
- Změna služby v administraci nyní vyžaduje souvislou publikovanou dostupnost jen do konce samotné služby, nikoli do konce úklidové blokace; archivovaný původní slot se přitom nepovažuje za ruční výjimku bez příznaku `manualOverride` rezervace.
- Změna služby u aktivní rezervace nyní běží v opakované serializovatelné transakci a před uložením globálně kontroluje časový překryv aktivních rezervací, takže souběžné vytvoření rezervace nemůže obsadit stejný čas.
- Odeslání pozvánky novému administračnímu uživateli má nyní dostatečný kontrast textu tlačítka i v mobilním dialogu.
- Volné termíny nyní atomicky ukládají denní režim automatického oběda a bezpečně zpracují neplatný nebo nekanonický týden planneru; souběžná úprava ani PostgreSQL konflikt překryvu už neskončí falešným úspěchem či obecným incidentem.
- Administrace nyní serverově odmítne označení rezervace jako no-show před uplynutím 15 minut od jejího začátku, takže předčasná změna nemůže uvolnit termín v dostupnosti.
- Planner dostupnosti nyní při úpravě dne zachová identitu všech nezměněných běžných intervalů; přegenerují se pouze sloty, které se změnou skutečně dotkly.
- Veřejná rezervace i přesun rezervace už neodmítají stále dostupný termín jen kvůli zastaralému `slotId` po přegenerování planneru: v serializovatelné transakci ověří a uzamknou aktuální souvislé publikované pokrytí služby, zatímco interní cleanup blokace dál chrání kolize až do `blockedUntil`.
- Volné termíny nyní načítají i dostupnost začínající před rezervačním oknem a zachovávají její původní časový rastr; veřejná i administrační rezervace a přesuny proto správně nabídnou první platný termín, aniž by nabídly začátky po konci okna.
- KPI obsazenosti nyní zohledňuje kapacitu historicky zveřejněných slotů, automatický oběd i úklidové blokace, aby nepočítala nedostupný čas jako volné termíny; tooltipy a dlouhé texty KPI se na úzkých obrazovkách zalamují a zůstávají uvnitř viewportu.
- KPI „Neuhrazená částka“ nyní odečítá od ceny dokončených návštěv také uplatněné voucherové částky, takže voucherem plně uhrazené rezervace již nevykazují falešný dluh.
- Dashboard nyní upozorní na dnešní aktivní rezervace po termínu a zobrazí je v dnešním plánu i v případě, že nejsou navázané na načtený dostupný slot.
- KPI očekávaných tržeb nyní započítává všechny potvrzené budoucí rezervace s uloženou cenou, i když planner při úpravě dostupnosti archivoval jejich původní slot.
- Karta očekávaných tržeb nyní jasně uvádí, že při filtru „Tento měsíc“ zahrnuje potvrzené návštěvy až do jeho konce.
- Osa grafu tržeb nyní přesně zobrazuje mezilehlé hodnoty v tisících, takže zaokrouhlené popisky nematou čtení výše tržeb.

## [3.23.1] - 2026-08-27

### Změněno

- CI E2E běhy nyní používají zapisovatelný izolovaný adresář pro lokální média, takže testy uploadu nejsou závislé na právech checkoutu runneru.

### Opraveno

- Nové zařazení média do kolekce Reference nyní stejně jako Studio a Certifikáty vyžaduje publikovaný veřejný asset bez aktivního mazání; existující historické vazby lze dál upravovat nebo odebrat.
- Veřejný lightbox certifikátů nyní vrací fokus na konkrétní certifikát, který dialog otevřel, protože každý certifikát používá vlastní Radix Dialog root.


## [3.23.0] - 2026-08-27

### Zabezpečení

- Lokální náhled souboru v administrativním nahrávání nyní před vložením do URL atributu explicitně kóduje URL, aby se text z file inputu nemohl interpretovat jako HTML.
- Next.js a navazující ESLint konfigurace byly aktualizovány na bezpečnostní verzi 16.3.3.
- Reference media actions nyní serverově validují oblast, cuid identifikátory, směr přesunu, viditelnost a limity metadat před změnou databáze.

### Přidáno

- Filtry Studio a Certifikáty v Media Library nyní otevírají vlastní správu celé kolekce s přidáním z knihovny, viditelností, řazením a bezpečným odebráním pouze vazby.
- Administrace médií nyní umožňuje spravovat fotografie referencí z existující Media Library včetně pořadí, viditelnosti a vlastních popisků; použití v referencích bezpečně blokuje smazání assetu.
- Administrace Media Library nyní bezpečně zobrazuje náhled i nepublikovaných médií pouze po autorizaci sekce Média, aniž by jim přidělovala veřejnou URL.

### Opraveno

- Veřejný náhled certifikátů nyní používá přístupný dialog s udržením a návratem fokusu, zavřením klávesou Escape a blokováním interakce s pozadím.
- Tlačítka v administračních dialozích nyní používají správnou světlou barvu textu a jsou na tmavém pozadí čitelná.
- Ovládání pořadí Nahoru a Dolů v detailu média je nyní seskupené a při zalomení rozvržení zůstává zarovnané.
- Správa kolekcí Studio a Certifikáty nyní používá vlastní kanonickou URL bez nefunkčních filtrů knihovny; po nahrání či jiné akci zůstává uživatel ve stejné kolekci.
- Studio a Certifikáty nyní odmítnou nově zařadit nepublikované, neveřejné, mazané nebo neexistující médium, takže v administraci nevznikne vazba potlačená na veřejném webu.
- Náhrada souboru u média používaného na webu nyní před provedením zobrazí počet a místa použití a vyžádá potvrzení, aby se obrázek nechtěně nezměnil všude.
- Publikování a skrytí média nyní mění pouze stav publikace, takže už nemůže přepsat souběžně rozepsaný titulek nebo alt text.
- Náhled certifikátů v administrativní Media Library se nyní v gridu nezkracuje a neaktivní stránkovací ovladače nejsou fokusovatelné odkazy.
- Zrušení publikace média používaného na webu nyní před provedením ukáže jeho použití a vyžádá potvrzení, aby fotografie nechtěně nezmizela z veřejného webu.
- Akce v administrativní Media Library nyní po uložení, publikaci, náhradě souboru, správě kolekce i smazání zachovají aktivní stránku a filtry; návratová URL je omezená na aktuální bezpečnou administrační oblast médií.
- Picker při přidávání referencí nyní nabízí všechny publikované assety z Media Library nezávisle na aktivním filtru REFERENCES a nezobrazuje už přidané reference.
- Media Library nyní stránkuje assety po 48 položkách a jejich použití načítá hromadně; nové veřejné vazby v galeriích, referencích a nastavení odmítají neveřejné, nepublikované či mazané assety a paralelní přidání do galerie služby bezpečně opakuje jen očekávaný konflikt pořadí.
- Mazání MediaAsset nyní nejprve atomicky ověří všechny vazby a odstraní DB záznam; fyzické soubory uklízí až po commitu, takže souběžně vzniklá vazba nemůže zanechat používané médium bez souboru.
- Reorder galerie služby nyní nejprve použije unikátní dočasné pořadí, takže přesun položek nekoliduje s immediate unique constraintem.
- Media Library zachovává aktivní filtry při hledání, v pohledu `REFERENCES` nezobrazuje duplicitní knihovní grid a detail assetu umožňuje spravovat membership Reference.
- Media Library v administraci nyní zřetelně rozlišuje lidský název od názvu souboru, vysvětluje blokované smazání konkrétními vazbami a při úpravách, nahrazení i správě vazeb zobrazuje průběh akce; MediaPicker má jasný výběr, prázdný stav a ovladatelnější mobilní prvky.
- Správa médií nyní blokuje smazání assetu používaného v nastavení webu; bezpečná náhrada zachovává jeho identitu a při selhání nepřijde o dosavadní funkční soubor.
- Veřejná media route nyní přijímá neutrální cesty nových uploadů `images/YYYY/MM/...`, aniž by odvozovala význam média z URL; dosavadní legacy URL zůstávají dostupné.

### Změněno

- Výběr médií v kolekcích, referencích, službách a nastavení se nyní načítá až po otevření dialogu, vyhledává a stránkuje serverově a neposílá do administračních stránek celou publikovanou Media Library.
- Pořadí fotografií Studio a Certifikátů se v Media Library nyní upravuje srozumitelnými tlačítky Nahoru a Dolů místo ručního zadávání čísla; přesun bezpečně zachovává jednoznačné pořadí kolekce.
- Uživatelské texty administrace médií nyní používají běžnou češtinu (médium, použití a zařazení) místo interní technické terminologie.
- Administrace Media Library nyní filtruje publikovaná a skrytá média a v horních statistikách zobrazuje celkové počty aktivních assetů podle stavu publikace.
- Nahrávání v administrativní Media Library se nyní otevírá v dialogu přímo z horního tlačítka, jasně uvádí publikování nového média i limity souboru a během zpracování zobrazuje průběh.
- Nastavení webu nyní pro kontaktní fotografii a oba portréty nabízí vizuální výběr publikovaných veřejných médií s náhledem, změnou a odebráním fotografie.
- CI, Security Audit a CodeQL lze nyní ručně spustit v GitHub Actions bez vytváření dalšího commitu.
- Produkční backfill médií nyní vyžaduje přesnou databázi `ppstudio` a explicitní příznak `--confirm-production`; bez něj i při běžném `--confirm` provede pouze rollbackovaný dry-run.
- Detail assetu v administrativní Media Library se nyní otevírá mimo stabilní grid v přístupném dialogu; odděluje náhled, metadata, použití, kolekce a destruktivní akce, přičemž fyzické smazání nepoužívaného assetu vyžaduje nezvratné potvrzení.
- Výběr médií pro hlavní fotografii a galerii služby i pro reference se nyní otevírá v přístupném dialogu; detail zůstává kompaktní a výběr nadále vytváří jen existující vazby na assety.
- Media Library v administraci má kompaktnější responsivní grid, přehlednější hierarchii karet a oddělené části detailu pro soubor, použití, úpravy a destruktivní akci.
- Detail služby v administraci nyní umožňuje vybrat hlavní fotografii a řazenou galerii z Media Library; veřejný detail zobrazuje pouze publikované veřejné assety a zachovává dosavadní vzhled bez fotografií jako fallback.
- Administrace Média je nyní relační knihovna assetů s vyhledáváním, filtry skutečného použití, správou kolekcí a bezpečným nahrazením souboru; nové uploady ukládá do neutrální cesty `images/YYYY/MM/...`.
- Veřejné certifikáty, galerie studia, kontaktní fotografie a portréty nyní čtou relační vazby Media Library v2; respektují viditelnost a pořadí membershipů i publikovatelnost assetů, zatímco stávající URL a bezpečné fallbacky zůstávají zachované.
- Přibyl ručně spouštěný, transakční a opakovatelný DEV/test backfill, který podle auditované mapy naplní kolekce médií a singularní vazby nastavení bez přepnutí runtime nebo změny legacy assetů.
- Datový model médií nově podporuje relační kolekce certifikátů, galerie studia a referencí i samostatné vazby pro kontaktní fotografii a portréty, aniž by měnil dosavadní zobrazování nebo data.
- Odstraněn historický media kontrakt `MediaType`, `MediaAssetKind`, globální pořadí a duplicitní metadata; použití médií nyní určuje relační model.
- Detail služby v administraci nyní nabízí bezpečný odkaz na veřejnou stránku, kontrolu chybějících částí obsahu a při převaze obecných úprav jednotnou historii změn včetně cenového auditu.
- Detail služby v administraci nyní zobrazuje jednotný stav Veřejná, Interní nebo Neaktivní a před uložením srozumitelně vysvětluje dopad na rezervace, dostupnost a změnu délky.
- Detail služby v administraci nyní upozorní na neuložené změny, chrání je při zavření a nabízí sticky akce pro uložení i uložení se zavřením.
- Detail služby v administraci nově seskupuje provozní údaje, webový obsah a propagaci pro rychlejší každodenní správu; propagace, SEO a historie ceny jsou standardně sbalené.

### Opraveno

- Typecheck nyní ignoruje pouze deployment release artefakty `current`, `previous` a `releases`, takže staré release symlinky neblokují přípravu nového nasazení.
- Mobilní návrat ze služby v administraci nyní stejně jako desktopový drawer chrání neuložené změny před nechtěným zahozením.

## [3.22.10] - 2026-08-25

### Zabezpečení

- Admin redirecty nyní přijímají pouze interní `/admin` cíle a stránka aktivace pozvánky neukládá token do cache ani referrerů a není indexována.
- Produkční web a e-mailový worker nyní běží pod vyhrazeným neprivilegovaným účtem; deploy připravuje chybějící systemd konfigurační adresáře, omezená oprávnění release, médií a stavového snapshotu, bezpečně uklízí runtime-vlastněné cache a zpřesňuje povinnou izolaci portu 3000 za důvěryhodnou proxy.
- Veřejný health endpoint nyní provádí pouze jediný DB readiness dotaz a vrací minimální odpověď; bez-DB liveness je oddělená a detailní diagnostika fronty, incidentů i release identity je dostupná pouze ownerovi.
- Resend webhook nyní streamovaně omezuje raw request body na 256 KiB i při chybějícím či nepravdivém `Content-Length` a nadlimitní požadavky odmítá stavem `413` před ověřením podpisu.

## [3.22.9] - 2026-08-23

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.22.9` po doplnění regresního testu obnovy rezervace.

## [3.22.8] - 2026-08-23

### Opraveno

- Storno nyní podle původní hranice dostupnosti správně obnoví i úklidový čas, pokud původně ležel uvnitř volného termínu.

## [3.22.7] - 2026-08-23

### Opraveno

- Web Vitals se při nezadaném veřejném feature flagu znovu reportují podle výchozí konfigurace; hodnota `false` reporting explicitně vypne.
- Storno rezervace už nezveřejní úklidový čas, který původně ležel mimo vypsaný volný termín.

## [3.22.6] - 2026-08-20

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.22.6` kvůli opravám obnovy dostupnosti při stornu, odmítnutí a ručním přesunu rezervací.

### Opraveno

- Zamítnutí čekající rezervace z administrátorského e-mailového odkazu nyní stejně jako ostatní storna obnoví archivovaný či rozdělený dostupný termín.
- Storno veřejné i administrativní rezervace nyní odstaví osiřelý dočasný DRAFT slot vytvořený ruční výjimkou, takže zrušený termín dál neblokuje dostupnost; běžné administrativní DRAFT blokace zůstávají zachované.
- Storno rezervace nyní nesloučí termín s vlastním omezením služby nebo jinou kapacitou se sousedním běžným intervalem.
- Ruční přesun rezervace nyní obnoví i archivovaný termín s vlastním omezením služeb a při rozdělení zachová jeho pravidla i poznámky.
- Lifecycle ručního přesunu do dočasné výjimky už neztrácí původní veřejnou dostupnost: po storno či dalším přesunu obnoví bezpečné volné části a zachová skutečné aktivní blokace.

## [3.22.5] - 2026-08-19

### Opraveno

- Automatický oběd se nyní zachová i ve dni, kde pozdější úprava dostupnosti archivovala sloty s existujícími rezervacemi; aktivace zohledňuje skutečné rezervace a jejich úklid.
- Storno klientské rezervace znovu zveřejní i archivovaný původní termín s omezením služby, aniž by rozšířilo jeho pravidla na sousední intervaly.

## [3.22.4] - 2026-08-19

### Opraveno

- Pracovní seznam rezervací nyní u položek v pohledu „Pozornost“ zobrazuje vedle času také datum termínu, takže lze rozlišit dnešní a budoucí rezervace.

### Změněno

- Databázové integrační testy už v CI neběží duplicitně a zaseknutý produkční build skončí v samostatném časovém limitu.
- CI nyní hledá unit testy přes Node.js, Playwright browser instaluje přímo v každém E2E shardu a sdílí jeden E2E build přes artifact.

## [3.22.3] - 2026-08-18

### Opraveno

- E2E běh už nepřepisuje produkční canonical URL lokální adresou Playwright serveru, takže sitemap testy v CI ověřují správný veřejný doménový prefix.

## [3.22.2] - 2026-08-18

### Změněno

- Produkční build nyní používá nový generátor `prisma-client` s CommonJS module formatem; Prisma Client se generuje do aplikačního zdrojového stromu před buildem a runtime webu i e-mailového workeru používají jednotný klient.

### Zabezpečení

- Produkční závislosti nyní používají opravenou řadu `deepmerge-ts`, takže Prisma konfigurace již nepřitahuje auditované zranitelnosti typu high.

## [3.22.1] - 2026-08-16

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.22.1` kvůli zpřesnění integračních testů obnovování rezervací při použití paddingu slotu.

## [3.22.0] - 2026-08-16

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.22.0` kvůli zpětně kompatibilnímu rozšíření obnovování archivovaných termínů a zpracování rezervací.

### Opraveno

- Při ručním přesunu aktivní rezervace z archivovaného původního slotu se nyní původní volný čas bezpečně znovu publikuje a podle potřeby sloučí se sousední dostupností; při překryvu s novým interním override se obnoví jen jeho volná část. Interní override nového termínu zůstává blokující.
- Úspěšné veřejné rezervace ani konflikty termínu nyní nevyčerpávají e-mailový limit pro skutečná selhání; validační a ostatní booking chyby se do něj nadále započítávají.

### Zabezpečení

- Interní mutace storna plateb a zařazení voucher e-mailu už nejsou veřejně dosažitelnými Server Actions; chráněné action entrypointy nyní předávají ověřený kontext do server-only helperů.
- Databázové rate-limit buckety nyní atomicky rezervují pokus v PostgreSQL, takže paralelní requesty nemohou obejít nastavený limit.

## [3.21.0] - 2026-08-16

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.21.0` kvůli zpětně kompatibilnímu rozšíření správy e-mailových incidentů a administrativních filtrů.

### Opraveno

- Doručený explicitní resend nyní uzavírá pouze skutečně aktivní delivery incident; čistý chain odeslaných e-mailů proto v historii ani v administraci chybně nevzniká jako „Vyřešeno následným odesláním“.
- Nový explicitní resend po již vyřešeném e-mailovém incidentu nyní zachovává technickou historii resendu, ale při dalším selhání zakládá samostatný aktivní incident; původní resolution audit zůstává neměnný.
- Události v administraci nyní pro stránkování načítají jen bezpečně omezené kandidáty z jednotlivých zdrojů; přesný deduplikovaný total a cílené ověření voucherových identit zachovávají pořadí i hranice stránek bez načítání celé historie redemptionů.
- Mobilní hledání v administrativních Událostech a logách nyní při odeslání zachová aktivní filtry příslušného pohledu a vždy začne od první stránky výsledků.
- Ruční uzavření i filtrování Pozornosti nyní jednotně vyhodnocují celý resend chain: OWNER tak může uzavřít incident se selháním až na resendu a zobrazený failure vždy splňuje všechny aktivní e-mailové filtry.
- Datumové filtry Událostí a logů nyní vždy vymezují kalendářní den v Europe/Prague včetně změn letního času, nezávisle na timezone produkčního Node.js procesu.

## [3.20.0] - 2026-08-16

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.20.0` kvůli zpětně kompatibilnímu rozšíření administrativních událostí, auditů a filtrování e-mailových incidentů.

### Opraveno

- Události v administraci nyní zahrnují kanonický audit změn ceny služby včetně autora, názvu služby a srozumitelné ceny před změnou i po ní; starší samostatný přehled e-mailů byl odstraněn, zatímco URL `/admin/email-logy` zůstává kompatibilním přesměrováním na E-maily v Událostech a logách.
- Události a logy v administraci nyní rozlišují skutečné změny stavu rezervace od provozních auditů ceny, poznámky, kontaktu, služby, plateb a voucheru; úprava rezervace ve stavu `CONFIRMED` se proto již chybně netváří jako další potvrzení.
- Společný feed Události nyní u dokončení návštěvy zobrazí uplatnění voucheru jen jednou: kanonický `VoucherRedemption` potlačí pouze odpovídající booking audit se stejnou rezervací a kódem voucheru; historický audit bez redemption zůstává viditelný.
- Deduplikace voucherových uplatnění v Událostech nyní probíhá nad celým serverovým read-modelem před řazením a stránkováním, takže total i hranice stránek nezobrazí duplicitní audit; datum filtru se jednotně řídí kanonickým časem redemption.
- Aktivní e-mailové incidenty nyní počítají každý neuzavřený resend chain jen jednou podle stabilního rootu; Pozornost zobrazuje jeho nejnovější selhaný resend, zatímco historie e-mailů zachovává všechny jednotlivé pokusy.
- Datumový filtr Pozornosti nyní vybírá nejnovější selhanou událost neuzavřeného e-mailového incidentu přímo v zadaném rozsahu; položka ani její timestamp proto nemohou pocházet z pozdějšího resendu mimo filtr.

## [3.19.0] - 2026-08-16

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.19.0` kvůli zpětně kompatibilnímu rozšíření administrace o ruční uzavření historických e-mailových incidentů.

### Opraveno

- Testovací a release běhy nyní bezpodmínečně blokují Pushover transport i při zděděné produkční konfiguraci, takže webhookové fixture nemohou odeslat skutečné owner upozornění.
- OWNER nyní může auditovatelně ručně uzavřít historický e-mailový incident bez resendování klientce; původní bounce, suppressed nebo FAILED záznam zůstává beze změny a incident se přestane zobrazovat v Pozornosti.

## [3.18.0] - 2026-08-16

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.18.0` kvůli zpětně kompatibilnímu rozšíření zpracování a sledování e-mailových delivery webhooků.

### Opraveno

- Selhání následné reconciliation Resend webhooku po úspěšném předání e-mailu již nespouští transportní retry ani nemění `SENT` na zavádějící stav; booking reminder se i v tomto případě označí jako odeslaný.
- Resend webhook, který dorazí před uložením `providerMessageId` workerem, se nyní po úspěšném předání e-mailu bezpečně zpracuje z ověřené perzistence; tracking ani Pushover se při souběhu nezdvojují.
- Admin metriky a health texty e-mailů nyní přesně rozlišují aktivní incidenty doručení od transportního stavu `FAILED`; součet odeslaných zpráv je popsaný jako předání providerovi, nikoli jako potvrzené doručení.
- Ruční opakování terminálně selhaného e-mailu nyní zakládá nový resend log a zachovává původní auditní historii i aktivní incident až do potvrzeného doručení resendu.
- Ruční resend e-mailu nyní přebírá aktuální adresu kontaktu pouze do nového `EmailLogu`; historický příjemce původního pokusu včetně bounce zůstává neměnný a auditně dohledatelný.
- Resend `email.complained` se nyní v administraci jednotně zobrazuje jako „Nahlášeno jako spam“, nikoli jako nedoručený e-mail. Zůstává reputačním warningem v Pozornosti a historii, ale nevstupuje do počtu delivery failures ani do kritičnosti `/api/health`.
- Recipient-specific e-mailové incidenty (bounce, suppression nebo provider failure) už neoznačují email worker jako porouchaný: `/api/health` je uvádí jako `warning` s HTTP `200`, takže samy nemohou zablokovat či rollbacknout release.
- Historické selhání doručení e-mailu nyní zůstává v logu, ale po potvrzeném doručení explicitního resendu se správně uzavře jako incident a nezůstává v administrativní sekci Pozornost ani v počtech aktivních e-mailových problémů.
- EmailLog nyní rozlišuje přijetí veřejné pending rezervace (`BOOKING_RECEIVED`) od finálního potvrzení po schválení (`BOOKING_CONFIRMED`), včetně bezpečného přeřazení jednoznačně rozpoznatelných historických e-mailů; klientka dál dostává stejné dva lifecycle e-maily.
- Resend webhooky nyní perzistentně a race-safe deduplikují ověřené Svix eventy, takže opakované doručení nemění tracking ani znovu neodesílá Pushover upozornění.
- Administrační přehled e-mailů a „Pozornost“ nyní při vyhodnocení výsledku doručení zohledňují i následný Resend tracking: bounce, suppression a provider failure se zobrazí jako nedoručené, i když transportní `EmailLog.status` zůstává `SENT`.
- Pushover alert po Resend `email.bounced` nyní správně rozlišuje následné nedoručení po předání providerovi od skutečného vyčerpání retry při odesílání; oba alerty zachovávají existující odkaz na rezervaci nebo e-mailový log.

## [3.17.3] - 2026-08-15

### Opraveno

- Matomo event `Doporučený termín vybrán` ve veřejné rezervaci nyní měří jen skutečný klik na doporučenou kartu; stejný čas zvolený přes kalendář zůstává pouze ve stávajícím funnel kroku `Čas vybrán`.

## [3.17.2] - 2026-08-15

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.17.2` kvůli analytickým, bezpečnostním a provozním opravám.

### Zabezpečení

- Deployment dokumentace nyní výslovně rozlišuje lokální a vzdálenou reverse proxy, protože IP rate limity důvěřují pouze proxy přepsané hlavičce `X-Real-IP`; pro vzdálenou proxy vyžaduje firewall allowlist portu 3000.

### Opraveno

- Rezervační flow nyní v Matomo samostatně měří zobrazení a výběr doporučených termínů včetně jejich pořadí, bez změny stávajícího funnel eventu výběru času.
- GitHub CI nyní povinně spouští izolovaný regresní test release mechanismu, který chrání kontrolu čistého working tree, pořadí quality gates a migrace, rollback i health-check ochrany.
- DB integrační testy nyní čtou SiteSettings stejnou databázovou cestou jako produkce; unit testy nadále zůstávají bez nechtěného přístupu k databázi.
- CI nyní po coverage unit vrstvě povinně spouští všech 27 DB integračních souborů proti migrovanému PostgreSQL, vždy sériově; připravená databáze už nezůstává nevyužitá kvůli guardu integračních testů.
- Provozní dokumentace nyní odpovídá aktuálnímu CI a release procesu: coverage je součástí jobu `test`, required checks zahrnují všechny čtyři E2E shardy a release preflight před buildem provádí také `npm run test:release`.
- Release testy e-mailových šablon už nevyvolávají očekávané Prisma chyby při běhu bez databáze; DB fallback zůstává pokryt samostatnými testy.
- Ve veřejném rezervačním flow Matomo u výběru termínu znovu zaznamenává lokální datum i přesný časový rozsah se slugem služby; událost `Čas vybrán` zachovává kompatibilitu stávajícího funnelu a nezdvojuje se při renderu stejné volby.
- Regresní test security headers nyní deterministicky ověřuje non-production i produkční HSTS konfiguraci a GitHub CI samostatně kontroluje produkční variantu, takže release preflight zachytí rozdíl konfigurací před nasazením.
- Release skript nyní v závěrečném přehledu zapisuje délku jednotlivých kroků přípravy, buildu, migrace a aktivace, aby bylo možné rychle určit pomalou část nasazení.

## [3.17.1] - 2026-08-14

### Opraveno

- Release build již nenačítá runtime nastavení ani veřejná data z produkční databáze před `prisma migrate deploy`, včetně dynamických položek sitemap; fallback snapshot nastavení se nadále aktualizuje pouze při administračních zápisech.
- Release nyní odmítne dirty working tree bez výjimky; odstraněná volba `--allow-dirty` nemohla zahrnout lokální změny do artefaktu z `HEAD` a mohla zavádět při synchronizaci provozních souborů.
- Node test runner nyní ve všech centrálních testovacích skriptech zahrnuje také komponentové soubory `.test.tsx`, takže je ověřuje lokální běh, release preflight i CI coverage.

## [3.17.0] - 2026-08-13

### Změněno

- Denní režim automatického oběda AUTO/OFF je nyní provozní oprávnění planneru: mohou jej měnit role OWNER i SALON při správě volných termínů, zatímco globální přepínač automatického oběda zůstává pouze v OWNER nastavení.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.17.0` kvůli zpětně kompatibilnímu rozšíření plánovače a rezervací o automatický oběd.

### Opraveno

- Tažení při přidávání dostupnosti v planneru se nyní vždy normálně dokončí a zarovná na půlhodiny, takže kliknutí do spodní poloviny prázdné buňky už nevyvolá zákaz výběru; rezervace, úklid a chráněné intervaly se bezpečně ověří před uložením a přesné čtvrthodinové zbytky po rezervaci nebo úklidu zůstávají zachované.
- Po uložení všech navazujících změn dostupnosti planner právě jednou obnoví data ze serveru, takže zobrazený automaticky vypočtený oběd vždy odpovídá aktuální dostupnosti.

- Veřejná rezervace chrání dynamickou 45minutovou obědovou přestávku během delších pracovních dnů při nabídce termínů, vytvoření i přesunu v serializovatelné transakci; standardní administrativní rezervace a přesuny ji také respektují, zatímco vědomě zvolený a auditovatelný manual override ji může obejít. Globální ochranu lze vypnout v nastavení, denní režim AUTO/OFF spravuje planner, který přesný odvozený oběd zobrazuje bez zápisu konkrétního času do databáze a se zachováním kompaktního layoutu FullCalendaru. Přesuny správně opakují PostgreSQL serializační konflikt `40001` vrácený Prisma jako `P2010`. Doporučené termíny nyní vybírají časově výhodné možnosti pro kompaktní využití pracovního dne a klientce je zobrazují chronologicky; kompletní nabídka dostupných termínů zůstává beze změny.
- Doporučené termíny při výběru lépe zohledňují krátké nevyužitelné mezery mezi rezervacemi podle skutečných délek aktivně nabízených služeb; plná nabídka termínů ani jejich validita se nemění.

## [3.16.5] - 2026-08-11

### Změněno

- Všechny produkční HTML e-maily (booking, administrace i voucher) nyní renderuje React Email; plain text, akční/ověřovací URL, ICS/PDF přílohy i delivery infrastruktura s EmailLogem, workery, retry/locking a providery zůstávají beze změny. Vývoj podporují interaktivní `email:dev` preview a regresní `email:previews` přes aplikační renderer.
- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.16.5` kvůli dokončení migrace produkčních e-mailových šablon.

## [3.16.4] - 2026-08-11

### Změněno

- Ruční vytvoření a přesun rezervace nyní používají přístupné Radix drawery se spolehlivým ovládáním fokusu, klávesou Escape a ergonomičtějším rozložením dlouhých formulářů.
- Detail kategorie a desktopový detail služby v administraci nyní používají přístupné Radix drawery se správným focusem, klávesou Escape a zavíráním do původního pohledu seznamu.
- Obnovení uloženého stavu planneru při zahození více neuložených úprav nyní používá přístupný Radix potvrzovací dialog s bezpečným výchozím focusem na zrušení akce.
- Akce služeb a krátké výsledky migrovaných administračních workflow nyní používají přístupné Radix DropdownMenu a Toast; validační chyby formulářů zůstávají přímo u polí.
- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.16.4` kvůli stabilizaci migrovaného administračního UI.

### Opraveno

- Finální audit Radix UI sjednotil vrstvení, overlaye a animace modalních prvků, doplnil mobilní safe-area u dlouhých drawerů a odstranil zbylý ruční focus trap a globální Escape obsluhu.
- Rychlé akce rezervací nyní oznámí každý dokončený submit právě jednou; mobilní filtry a navigace navíc dokončí zavírací Radix animaci a formulářové chyby se nezobrazují duplicitně také v Toastu.

## [3.16.3] - 2026-08-10

### Opraveno

- Matomo SPA pageview deduplikace při návratu z netrackované route již nepotlačí legitimní nové zobrazení původní stránky.
- Storno rezervace nyní znovu zveřejní i historický slot archivovaný při úpravě planneru a spojí jej s navazující volnou dostupností, takže po zrušení nezůstávají mezery ve volných termínech.

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.16.3` kvůli opravám Matomo pageviewů a obnovování volných termínů po stornu rezervace.

## [3.16.2] - 2026-08-09

### Opraveno

- Matomo pageview má jediného odesílatele pro první načtení i SPA navigace a bezpečná URL se zapisuje těsně před každým pageview, takže opožděný záznam fronty nepřevezme URL následné navigace.

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.16.2` kvůli opravám Matomo pageviewů a rezervačního CTA.

## [3.16.1] - 2026-08-09

### Změněno

- Fallback snapshot nastavení webu je provozní stav serveru a již se nesleduje ve verzování, takže jeho automatická aktualizace z databáze nevytváří nechtěné změny pracovního stromu.
- Browserové E2E ověření používá vlastní produkční build i TypeScript konfiguraci, takže může běžet současně s vývojovým serverem bez zásahu do jeho HMR cache nebo pracovního stromu; instalace závislostí má ověřitelný registry preflight a explicitní fallback konfiguraci.
- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.16.1` kvůli opravám souběžných administrativních úprav a stabilitě provozu.

### Opraveno

- Produkční Next.js build již nepadá na TypeScript validaci API route modulů; testovací factory jsou oddělené od veřejných route exportů, takže build může pokračovat bez falešného zavěšení workeru.
- Matomo při prvním načtení stránky synchronně nastaví tracker i pageview před načtením `matomo.js`, takže úvodní booking eventy sdílejí stejnou návštěvu místo rizika samostatných visitů.
- Rychlé změny aktivace a veřejné rezervovatelnosti služby nyní posílají cílový stav, takže opakování serializovatelné transakce nemůže hodnotu nechtěně obrátit; již nastavený stav nevytváří auditní záznam.
- Kontrola přeplatku při změně individuální ceny nyní po uzamčení rezervace načte aktuální platby i čerpání voucheru, takže souběžně zapsaná úhrada nemůže projít bez nového potvrzení přeplatku.
- Audit změny kategorie služby nyní ukládá i historický název kategorie, takže zůstane čitelný i po smazání již nepoužívané kategorie.
- Provozní audit voucherů nyní používá české popisky změněných údajů kupujícího a změna kategorie služby zobrazuje její název místo technického ID.
- Audit individuální ceny rezervace se při souběžných administrativních úpravách zapisuje podle skutečného bezprostředně předchozího stavu.
- Serializable transakce auditních změn administrátorů, voucherů, služeb a SiteSettings se při krátkodobém PostgreSQL write konfliktu automaticky zopakují, takže souběžná úprava zbytečně neskončí obecnou chybou.
- Úprava individuální ceny rezervace se při krátkodobém PostgreSQL serializačním konfliktu automaticky zopakuje, takže souběžný zásah nemusí skončit chybou pro administrátora.

## [3.16.0] - 2026-08-08

### Opraveno

- Kontrola produkčních závislostí již nenaráží na zranitelný parser obrazových metadat; metadata médií se bezpečně načítají pomocí existující knihovny Sharp a tranzitivní Nano ID je aktualizováno na opravenou verzi.
- Administrační „Události a logy“ správně rozlišují rezervace, přihlášení, aktivace přístupů, recovery a veřejné ověřování voucherů; běžné validační či rate-limit události nezvyšují provozní závažnost a skutečné serverové chyby jsou po 24 hodin viditelné v owner pohledu „Pozornost“.
- Auditní stopa individuální ceny rezervace nově ukládá stav před a po změně a veřejný booking rate-limit už nezapočítává audity aktivace administrátorských pozvánek ani offline recovery.
- Hluboké stránkování provozních logů se clampuje před načtením kandidátů a SALON mimo „Pozornost“ už neprovádí pět nezobrazovaných e-mailových health countů.

### Změněno

- Běžné zrušení rezervace a vytvoření voucheru se v provozních událostech zobrazují jako informace; technický panel přesněji nese název „E-mailová fronta“ a vyhledávací nápověda odpovídá aktuálnímu pohledu.
- Administrativní změny účtů, voucherů, služeb a SiteSettings mají doménové neměnné before/after logy s autorem, transakčním zápisem, serverovým OWNER/SALON omezením a minimalizací PII; cenový audit služby zůstává bez duplicit.
- Přehled „Události a logy“ nově lépe rozlišuje provozní, e-mailové a bezpečnostní záznamy pomocí stavových štítků, přehledného panelu Pozornost, kompaktnějších filtrů a čitelnějších mobilních karet.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.16.0` kvůli zpětně kompatibilnímu rozšíření auditní stopy a provozních přehledů administrace.

## [3.15.0] - 2026-08-07

### Změněno

- Veřejný rezervační funnel v Matomo používá jednotné české události `Rezervace` od skutečného zahájení až po backendem vytvořenou rezervaci; konverze se deduplikuje podle interního ID rezervace, ukládá jen technický slug služby a stávající Goal „Rezervace vytvořena“ dál používá událost `Vytvořena`. První vyplnění e-mailu, telefonu i poznámky se samostatně a bez obsahu polí měří pro vyhodnocení kontaktního kroku.
- Veřejný web má na mobilu kompaktní sticky hlavičku s přímou cestou k rezervaci a přístupným vysouvacím menu; na rezervační stránce ji nahrazuje návrat na web.
- Rezervace s platně předvybranou službou nyní místo celého katalogu ukazuje stručné shrnutí služby a rovnou výběr termínu; službu lze kdykoli rozbalit a změnit.
- Mobilní homepage, průběh rezervace včetně čtyř nejbližších termínů a katalog služeb lépe využívají vertikální prostor; kategorie služeb i ceníku jsou rychle dostupné přes zalamovanou anchor navigaci.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.15.0` kvůli zpětně kompatibilnímu rozšíření mobilního rezervačního toku a analytiky.

### Opraveno

- Automatické scrollování v rezervačním procesu i kotvy veřejných stránek nyní vychází ze skutečné výšky sticky hlavičky a formulářová pole na iOS nepřibližují stránku při získání fokusu.
- Otevřené mobilní menu se při přechodu na desktopové rozložení samo zavře a obnoví posouvání stránky.

## [3.14.2] - 2026-08-07

### Zabezpečení

- Administrační PWA zakládá ochranu cache výhradně na explicitním allowlistu offline shellu, vlastních ikon a build-time Next assetů; dynamické, administrační, API, navigační a RSC requesty se neukládají nezávisle na session cookies.

### Opraveno

- Administrační PWA již nezamyká orientaci obrazovky a při přidání na plochu iOS používá vlastní ikonu administrace.

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.14.2`.

## [3.14.1] - 2026-08-07

### Změněno

- Stránka dárkových voucherů má kratší a přehlednější cestu k jejich vystavení, jasněji rozlišuje voucher na službu a hodnotu, přesněji popisuje jeho využití při rezervaci a méně zvýrazňuje ověření existujícího voucheru.
- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.14.1`.

## [3.14.0] - 2026-08-06

### Změněno

- Meta Pixel nyní měří rezervační funnel jako `ViewContent` → `BookingServiceSelected` → `BookingDateSelected` → `BookingTimeSelected` → `InitiateCheckout` → `BookingContactStarted` → `Schedule`; zastaralé události `AddToCart` a `Lead` se už pro rezervace neposílají.
- PageView Meta Pixelu se při SPA navigaci porovnává s bezprostředně předchozí cestou, takže se správně změří i návrat na původní stránku bez duplicit.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.14.0`.

### Zabezpečení

- Meta Pixel nově bezpečně filtruje `content_ids` jako pole a nadále z payloadů odstraňuje PII, vouchery, booking ID, tokeny i citlivé URL.

## [3.13.6] - 2026-08-06

### Opraveno

- Meta Pixel nyní odešle `InitiateCheckout` až po výběru termínu nebo při přechodu do kontaktního kroku, takže samotné otevření rezervační stránky nenavyšuje počet zahájených checkoutů.
- Funnel rezervací v administraci nyní do kroku služby započítává také předvyplněnou službu z detailu služby, takže následné kroky nevypadají jako neexistující propad.
- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.13.6`.

## [3.13.5] - 2026-08-05

### Změněno

- FAQ nově vysvětluje rozdíl mezi korejským a klasickým lash liftingem a uvádí, že studio nabízí již jen korejskou variantu.
- Veřejné Matomo měření používá Heartbeat Timer s minimálním intervalem 15 sekund, takže přesněji zachytí délku návštěv bez vytváření dalších pageview.
- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.13.5`.

## [3.13.4] - 2026-08-04

### Zabezpečení

- Aktualizována závislost `jose` na verzi 6.2.8.
- Aktualizována tranzitivní závislost `fast-uri` kvůli opravě zranitelnosti při vyhodnocování URI autority.

### Změněno

- Aktualizovány patchové a minor verze produkčních i vývojových závislostí, včetně Next.js, Reactu, Playwrightu a Svixu.
- Kontrola changelogu už neběží jako blokující job GitHub Actions; požadavek na její posouzení zůstává v pull request šabloně.
- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.13.4`.

### Opraveno

- Veřejný rezervační kalendář nyní počítá mřížku dnů i čas vybraného termínu nezávisle na časovém pásmu telefonu; termíny nadále vždy odpovídají času salonu v Praze.
- Vyhledávání klientek při ruční rezervaci nyní předává dotaz pouze v chráněném POST těle, takže se citlivé údaje neobjevují v URL.
- Webhook Resend nyní zpracuje událost zpožděného doručení, takže se v administraci uloží a zobrazí stav „Doručení zpožděno“.

## [3.13.3] - 2026-08-02

### Opraveno

- Budoucí aktivní voucher se nyní jako koncept posuzuje také při pokusu o odeslání e-mailem z administrace.
- Vytvoření voucheru po zadání data platnosti opět projde i při interním opakovaném ověření formuláře.
- Data platnosti voucheru z administračních date inputů se nyní ukládají podle hranic dne v časové zóně Praha; datum konce se správně zobrazuje jako vybraný den a opakované uložení jej neprodlužuje ani při změně letního času.
- Admin lookup, seznamy, filtry a statistiky voucherů nyní shodně považují aktivní voucher s budoucím datem platnosti od za koncept; do aktuálně uplatnitelné hodnoty ani služeb se nezapočítá.
- Voucher s budoucí platností od se nyní jednotně odmítá při veřejném ověření, vytvoření rezervace i při jeho uplatnění; nastavené datum platnosti od přitom zůstává zachované.
- Souhrn veřejné rezervace nyní jasně rozlišuje neplatný, nekompatibilní, ověřovaný i použitelný voucher a neplatný kód už nenaznačuje pozdější uplatnění.
- SEO titulek služby se při vytvoření i úpravě na serveru zbaví opakované koncové značky PP Studio, takže se ve výsledných metadatech zobrazí právě jednou.
- Veřejné ověření voucheru a rezervační formulář mají oddělené limity pro neplatné kódy; úspěšná ověření ani interní chyby už nevyčerpávají ochranu proti hádání kódů.
- Veřejná rezervace i klientský přesun nyní bezpečně zaokrouhlují čtvrthodinové termíny před navazující rezervací dolů a po předchozí blokaci nahoru, takže nabízejí všechny volné termíny bez překrytí úklidu.
- Veřejná rezervace i klientský přesun vážou automatické obnovení dostupnosti na konkrétní serverovou konfliktní odpověď; další odeslání se starou chybou už nespouští další refresh a pozdní odpověď nepřepíše novější volbu služby, voucheru, dne ani termínu.

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.13.3`.

## [3.13.2] - 2026-08-01

### Opraveno

- Veřejná rezervace po obnovení dostupnosti znovu ověří zadaný voucher, během ověření jej nelze odeslat a veřejný popisek hodnotového voucheru už neprozrazuje jeho zůstatek.
- Veřejná rezervace i klientský přesun po zániku vybraného dne trvale přepnou na první volný den v odpovídajícím měsíci.
- Veřejné vytvoření rezervace a klientský přesun používají jako zdroj slotu výhradně aktuální publikované pokrytí; koncepty, archivy a zrušené sloty nelze použít jako fallback.
- Veřejná rezervace i klientský přesun nyní vedle půlhodinového rastru nabídnou bezpečný čtvrthodinový začátek dopočítaný těsně před následující aktivní rezervací; úklid přitom nesmí zasáhnout do jejího začátku.
- Rezervační formulář při každé změně služby znovu ověří voucher na serveru. Poukaz vázaný na jinou službu se ihned přestane uplatňovat, zachová se jeho kód i s vysvětlením a hodnotový poukaz zůstane použitelný; odpověď pro formulář přitom nepředává nepoužitý zůstatek voucheru.
- Průběžné ověřování voucheru v rezervačním formuláři má stejný auditovaný limit jako veřejné ověření: nejvýše 10 pokusů z jedné IP adresy za 10 minut.
- Veřejná rezervace i klientský přesun termínu po souběžném obsazení načtou čerstvou nabídku ze serveru, zruší neplatný vybraný čas, přesunou výběr na první volný den a zachovají službu i kontaktní údaje; chybová hláška je dostupná i pro čtečky obrazovky.
- Veřejný rezervační formulář už nenabízí poslední termín v publikovaném okně, pokud jeho interní úklidová blokace koliduje s navazující rezervací začínající na hranici nebo krátce za hranicí tohoto okna. Maximální nastavitelný čas na úklid je nyní 120 minut.
- Pushover nově okamžitě upozorní OWNERa i na odmítnutí veřejné rezervace kvůli skutečné kolizi s aktivní rezervací (`SLOT_UNAVAILABLE`), nejen na obecný `BOOKING_CONFLICT`.

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.13.2`.

## [3.13.1] - 2026-08-01

### Opraveno

- SEO titulky detailů služeb už neobsahují značku dvakrát; titul služby ukládá jen obsah titulku a globální metadata doplní `PP Studio`.
- Parametrické stavy rezervačního formuláře nyní kanonizují na `/rezervace` a vyhledávačům předávají `noindex, follow`, takže se ve výsledcích nezobrazují jako samostatné stránky.
- Týdenní kalendář nyní u obsazených termínů zachovává čas vedle jména klientky a pod ním zobrazuje název rezervované služby.
- Týdenní kalendář barevně odlišuje nepotvrzené rezervace od potvrzených a vysvětluje je v legendě.
- Přepínání responsivního pohledu týdenního kalendáře bezpečně pracuje s časovým scrollerem bez rušení planneru.
- Provozní administrace salonu už nezobrazuje boční navigaci duplicitně vedle sebe.

### Změněno

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.13.1`.

## [3.13.0] - 2026-07-30

### Přidáno
- Volné termíny používají pro OWNER i SALON jediný FullCalendar planner s průběžným ukládáním, opakováním neúspěšné změny a auditní stopou dostupnosti.

### Opraveno
- Ukládání změn dostupnosti je idempotentní, takže opakovaný požadavek nevytvoří duplicitní změnu ani auditní událost.
- Planner zachovává čtvrthodinové volné bloky po službě nebo úklidu a umožňuje je bezpečně přidat i odebrat.

### Odstraněno
- Původní draftový planner a jeho nepoužívané pracovní postupy byly odstraněny; správa volných termínů má jednotné rozhraní.

### Změněno
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.13.0` kvůli rozšíření správy volných termínů.

## [3.12.0] - 2026-07-29

### Přidáno
- Administrace podporuje úpravu a stornování plateb včetně idempotentního zpracování a auditních metadat.
- Planner volných termínů má sjednocené ovládání, frontu ukládání a auditní stopu změn dostupnosti.
- Voucher s předvolenou službou předává službu přímo do rezervačního toku.

### Opraveno
- Výběr času v planneru zachovává lokální datum a čas i při přechodech letního času.
- Mobilní zobrazení detailu rezervace a potvrzení rezervace je responsivnější a přístupnější.

### Změněno
- Administrativní ovládací prvky a pomocné texty splňují lepší kontrastní a ARIA pravidla.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.12.0` kvůli zpětně kompatibilnímu rozšíření správy plateb a planneru.

## [3.11.0] - 2026-07-28

### Přidáno
- Administrace umožňuje u služeb nastavovat kategorii, cenu a délku.
- CI workflow podporuje shardování Chromium a mobilního Chrome E2E běhu a ukládá coverage artefakt.

### Opraveno
- Voucher se správně předává do rezervace při platebním toku.
- Audit plateb ověřuje metadata při vytváření i mazání platebních záznamů.

### Změněno
- Aktualizovány závislosti včetně Prisma 7.9.1, Next ESLint konfigurace a `find-my-way`.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.11.0` kvůli zpětně kompatibilnímu rozšíření správy služeb.

## [3.10.0] - 2026-07-23

### Přidáno
- Analytika v administraci zobrazuje počet konverzí a konverzní poměr booking cíle z Matomo.
- KPI dashboard rozlišuje prázdné datové řady a zobrazuje pro ně srozumitelný prázdný stav.

### Změněno
- Grafy tržeb a rezervací používají sloupcové zobrazení a přesnější popisky hodnot i období.
- Hlavní administrační dashboard má přehlednější stavové informace, formátování poznámek a vyhodnocení volných slotů.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.10.0` kvůli zpětně kompatibilnímu rozšíření analytiky a KPI dashboardu.

## [3.9.0] - 2026-07-23

### Přidáno
- Administrace má jednotný přehled událostí a logů s pohledy pro provozní události, e-maily, automatizace, systémové záznamy a položky vyžadující pozornost.
- Logy lze filtrovat, prohledávat a stránkovat; na mobilu jsou dostupné v přehledných kartách a filtračním panelu.

### Změněno
- Původní cesta e-mailových logů přesměrovává na odpovídající pohled nového přehledu a navigace administrace používá název `Události a logy`.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.9.0` kvůli zpětně kompatibilnímu rozšíření administrace o centrální provozní logy.

## [3.8.0] - 2026-07-23

### Přidáno
- Administrativní CRM seznam klientek nabízí provozní pohledy pro nadcházející návštěvy, klientky k oslovení, nové klientky, chybějící kontakt a neaktivní profily.
- Seznam klientek podporuje stabilní stránkování a řazení podle poslední návštěvy, počtu rezervací, jména nebo založení profilu.

### Změněno
- Filtry CRM zachovávají zpětnou kompatibilitu se staršími odkazy pro stav, rychlé filtry a retenci; mobilní administrace má srozumitelnější popis obrazovky.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.8.0` kvůli zpětně kompatibilnímu rozšíření CRM seznamu klientek.

## [3.7.1] - 2026-07-23

### Opraveno
- Veřejná rezervace i přesun existující rezervace správně ignorují archivované a zrušené sloty; interně blokující zůstávají pouze koncepty.

### Změněno
- Integrační testy rezervací běží sériově, aby se nepřekrývaly při práci nad sdílenými daty.
- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.7.1` kvůli opravě vyhodnocení blokujících stavů slotů.

## [3.7.0] - 2026-07-22

### Přidáno
- KPI dashboard administrace zobrazuje grafy tržeb a rezervací.
- Veřejný rezervační tok rozpozná obsazený nebo archivovaný termín a vrátí přesnější informaci pro uživatelské rozhraní.

### Změněno
- Vyhledávání klientek a rezervací nabízí srozumitelnější nápovědy a automatické doplňování; vývojový server lze spustit explicitně přes Turbopack nebo Webpack fallback.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.7.0` kvůli zpětně kompatibilnímu rozšíření KPI dashboardu a rezervačního toku.

## [3.6.0] - 2026-07-22

### Přidáno
- Pracovní seznam rezervací v administraci má samostatné pohledy Dnes, Nadcházející, Vyžaduje pozornost, Historie a Všechny, včetně jednotného postupného načítání dalších výsledků.

### Změněno
- Parametry seznamu rezervací používají přehlednější `view` a `limit`; starší odkazy založené na `stat` a `showPast` zůstávají přeloženy pro zpětnou kompatibilitu.
- Aktualizovány zamčené transitive závislosti pro Babel, PostCSS a Sharp.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.6.0` kvůli zpětně kompatibilnímu rozšíření pracovního seznamu rezervací.

## [3.5.0] - 2026-07-21

### Přidáno
- Laboratorní planner podporuje denní pohled a mobilní zobrazení dostupných bloků a intervalů.

### Opraveno
- Navigace a načítání týdne v planneru správně inicializují datum a zachovávají konzistentní stav při přechodu mezi pohledy.

### Změněno
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.5.0` kvůli zpětně kompatibilnímu rozšíření planneru o denní a mobilní pohled.

## [3.4.0] - 2026-07-21

### Přidáno
- Laboratorní planner zobrazuje přesné patnáctiminutové intervaly dostupnosti a chrání bloky, které nepatří aktuálně spravované rezervaci.
- Výpočet dostupnosti odečítá úklidové bloky; pokrytí zahrnuje i zbylé části slotu po rezervaci.

### Opraveno
- Typy stavů a výpočet zbytku slotu po rezervaci přesněji zachovávají dostupné termíny planneru.

### Změněno
- Prisma a související balíčky byly aktualizovány na verzi `7.9.0`.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.4.0` kvůli zpětně kompatibilnímu rozšíření planneru o výpočet a ochranu dostupných intervalů.

## [3.3.0] - 2026-07-21

### Přidáno
- Tabulka služeb v provozním KPI dashboardu podporuje řazení kliknutím na záhlaví sloupců i výběrem řazení, včetně přístupného oznámení směru řazení.
- Laboratorní planner zarovnává kalendářní data podle týdnů a rozšířené E2E scénáře ověřují dostupnost i zachování místního času při přechodu na letní čas.

### Opraveno
- Události planneru používají správný jednotný název CSS třídy, takže se spolehlivě uplatní jejich styly a selektory v testech.

### Změněno
- KPI tabulka služeb využívá `@tanstack/react-table` pro řazení.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.3.0` kvůli zpětně kompatibilnímu rozšíření KPI tabulky a planneru.

## [3.2.1] - 2026-07-21

### Opraveno
- E2E pokrytí planneru nyní ověřuje plánování dostupnosti včetně přechodů letního času a návaznosti na rezervační flow.

### Změněno
- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.2.1` kvůli doplnění regresních E2E testů planneru.

## [3.2.0] - 2026-07-21

### Přidáno
- Administrace nyní podporuje instalovatelnou PWA s offline obrazovkou, service workerem, ikonami, zkratkami a upozorněním na nedostupné připojení.
- Experimentální laboratorní planner nabízí samostatnou týdenní navigaci, frontu ukládání a adaptér pro FullCalendar, aniž by měnil původní planner.

### Změněno
- Admin API pro analytiku, hledání rezervací a ověření voucherů mají sdílenou implementaci route handlerů; mobilní administrace má vylepšenou navigaci a přístupnost.
- Aktualizovány vývojové závislosti a workflow CI pro aktuální podporované verze.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.2.0` kvůli zpětně kompatibilnímu rozšíření administrace o PWA a laboratorní planner.

## [3.1.0] - 2026-07-17

### Přidáno
- Administrace má KPI dashboard pro OWNER i SALON roli: tržby, obsazenost, klientské a retenční metriky, storna, no-show, očekávané tržby, vývojové grafy, služby a akviziční zdroje včetně filtrů období.
- Aktivace administrátorské pozvánky nově eviduje pokusy a omezuje jejich frekvenci podle důvěryhodné IP adresy.

### Opraveno
- Seznam klientek zachovává retenční filtry při stránkování a zobrazuje poslední službu i budoucí rezervaci.
- Přihlášení administrace může v E2E scénářích ověřit očekávanou cílovou cestu; titul stránky „O mně“ je konkrétnější pro SEO.
- Provozní dokumentace přesněji popisuje podmínky databázových migrací a rollbacku.

### Změněno
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `3.1.0` kvůli zpětně kompatibilnímu rozšíření administrace o KPI dashboard.

## [3.0.1] - 2026-07-16

### Opraveno
- Ruční vytvoření rezervace správně obnoví předvyplněnou klientku při změně hledání, varuje při jejím nahrazení a stabilně zobrazuje otevřený stav formuláře.
- Přehled rezervací bezpečně zobrazí jméno klientky i při chybějící relaci; rozpoznání stavu rezervace je odolnější.
- E2E kontrola potvrzení rezervace správně ověřuje historii stavu a Playwright používá nastavený počet workerů.

### Změněno
- Release příprava pro produkční nasazení: projektová verze navýšena na patch `3.0.1`.

## [3.0.0] - 2026-07-16

### Nekompatibilní změny
- Produkční release po úspěšném nasazení ponechává pouze cíle `current` a `previous`; výchozí počet dalších uchovaných release se změnil ze sedmi na nulu. Pro delší historii rollbacků je nutné nově zadat `--keep-releases N` nebo nastavit `PPSTUDIO_RETAIN_RELEASES`.

### Přidáno
- Playwright E2E nyní obsahuje automatizovanou axe kontrolu přístupnosti reprezentativních veřejných, rezervačních i administrativních scénářů.
- Testovací runtime ukládá snapshot nastavení webu do dočasného adresáře a veřejný katalog bezpečně vynechá služby bez kategorie.

### Opraveno
- Zlepšen kontrast akcentu a administrativní navigace, struktura nadpisů rezervačního flow a popisky navigace pro čtečky obrazovky.
- Regresní test pro 24hodinovou lhůtu zrušení rezervace je nezávislý na čase spuštění.

### Změněno
- Release příprava pro produkční nasazení: projektová verze navýšena na major `3.0.0` kvůli nekompatibilní změně výchozí retenční politiky release artefaktů.

## [2.1.1] - 2026-07-14

### Opraveno
- Načítání Pushover notifikace pro systémovou chybu nastavení webu používá správný modul `pushover-core`.

### Změněno
- CI nově ověřuje importy e-mailového workeru, aby se chybný import zachytil před releasem.
- Release příprava pro produkční nasazení: projektová verze navýšena na patch `2.1.1`.

## [2.1.0] - 2026-07-14

### Přidáno
- Nastavení webu se ukládá také jako atomický snapshot s obnovou z databáze, takže runtime zachová konzistentní veřejnou konfiguraci i při dočasném výpadku databázového čtení.
- E2E fixture umí inicializovat nastavení webu a přibyl regresní test, který ověřuje, že ze dvou souběžných veřejných rezervací stejného slotu projde právě jedna.

### Opraveno
- E-mailové akce rezervace používají jednotné získání důvěryhodné IP adresy klientky.
- Veřejná stránka správně uvádí otevírací dobu pouze po předchozí rezervaci, rozšířené profilové odkazy v JSON-LD a odpověď ve FAQ k rozdílu lash liftingu a prodlužování řas.
- Test veřejného voucheru správně filtruje splněné rezervace.

### Změněno
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `2.1.0` kvůli zpětně kompatibilnímu rozšíření práce s nastavením webu.

## [2.0.1] - 2026-07-13

### Opraveno
- Voucher lookup route má správné typování závislosti pro vyhledání voucheru a bezpečně zpracuje chybějící kód.
- Next.js konfigurace inline vkládá Tailwind CSS pro rychlejší prvotní vykreslení.

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `2.0.1`.

## [2.0.0] - 2026-07-13

### Nekompatibilní změny
- Admin API `GET /api/admin/bookings/search` a `GET /api/admin/vouchers/lookup` byly odstraněny. Obě vyhledávací operace nyní přijímají pouze `POST` se stejným JSON tělem, ověřeným same-origin požadavkem a hlavičkou `Cache-Control: private, no-store`; integrace musí přejít na nový kontrakt.

### Přidáno
- Administrace klientů má stránkování a vyhledávání; ruční vytvoření rezervace využívá dostupné klientky podle hledaného dotazu.
- Média nově evidují okamžik žádosti o smazání, včetně indexu pro správu a filtrování tohoto stavu.

### Opraveno
- Veřejná media pipeline důsledně filtruje viditelnost assetů. Načítání rezervací a portrétu je paralelní, veřejná rezervace lépe popisuje chybu a manuální rezervace má opravené typování i práci s dostupnými klientkami.
- Zrušení rezervace je možné nejpozději 24 hodin před termínem.
- Důvěryhodná IP klientky se jednotně získává z bezpečně vyhodnocených hlaviček, včetně rate limitů pro přihlášení a ověření voucheru.

### Změněno
- Aktualizovány přímé závislosti `jose`, `nodemailer`, `svix`, `tailwind-merge`, `zod`, `tsx` a typy Node.js na řadu 24.
- Release příprava pro produkční nasazení: projektová verze navýšena na major `2.0.0` kvůli nekompatibilní změně admin API kontraktů pro vyhledávání rezervací a voucherů.

## [1.2.0] - 2026-07-12

### Přidáno
- Pushover upozornění na novou webovou rezervaci nyní uvádí, zda jde o novou, nebo vracející se klientku. Rozlišení vychází z existence starší rezervace stejné klientky a zpráva dál neobsahuje kontaktní údaje.
- Matomo analytika veřejného booking flow u chyby kontaktního pole nově zaznamenává stabilní, neosobní důvod validace. Self-service správa rezervace má pro své události samostatnou kategorii `Správa rezervace`.

### Opraveno
- Kanonická `/media/public/*` a zpětně kompatibilní `/media/*` route nyní reexportují jeden bezpečnostně citlivý handler. Ten dál povoluje výhradně publikované assety a regresní test hlídá, že se implementace nemůže rozdělit.

### Změněno
- Produkční release preflight nyní před `next build` explicitně spouští `npm run typecheck`. Povinné databázové testy a Playwright E2E zůstávají samostatnou CI branou před releasem, protože jejich spuštění proti produkční databázi by nebylo bezpečné.
- Sjednoceny AI instrukce: `AGENTS.md` je explicitně hlavní zdroj pravidel a `docs/CODEX_RULES.md` na něj pouze odkazuje, aby se instrukce nerozcházely.
- Opraven veřejný `public/llms.txt`: nyní začíná povinným Markdown nadpisem H1 a obsahuje veřejné stránky jako explicitní Markdown odkazy.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `1.2.0` kvůli zpětně kompatibilnímu rozšíření Pushover notifikací a analytiky rezervací.


## [1.1.0] - 2026-07-11

### Přidáno
- Zlepšena ergonomie mobilní administrace: filtry rezervací se na úzkém displeji posouvají v jednom řádku, akce i formulářové ovladače mají větší dotykové plochy a rychlé akce rezervace jsou zřetelná dvojice tlačítek.
- Týdenní planner má na mobilu větší buňky a ovladače, srozumitelnější navigaci týdnem, bezpečnou spodní mezeru pro sheet i lištu neuložených změn a jasně označený vybraný den.

### Opraveno
- Opraven detail v `Email logy`: `/admin/email-logy/[emailLogId]` už nevkládá druhý `AdminShell`, takže se levé menu nevykresluje dvakrát.

### Změněno
- Aktualizovány kořenové provozní a architektonické dokumenty, API reference a přehled závislostí podle release workflow 1.0.3, aktuálního stacku a runtime kontraktů.
- Release příprava pro produkční nasazení: projektová verze navýšena na minor `1.1.0` kvůli zpětně kompatibilnímu rozšíření mobilního adminu a planneru.

## [1.0.3] - 2026-07-10

- Release helper po restartu služeb nejdřív tiše vyčká na otevření webového endpointu. Očekávaný krátký start Next.js už proto nevypisuje falešný `curl: (7) Failed to connect`; skutečný timeout zůstává důvodem pro rollback.

## [1.0.2] - 2026-07-10

- Turbopack má v `next.config.ts` explicitní root aktivního checkoutu/release, takže staging build s vlastním `package-lock.json` už nevypisuje falešné varování o více lockfilech.
- Provozní dokumentace nově potvrzuje, že rollbacknutý auditní záznam `20260428133959_voucher_pdf_logo_settings` má stejně jako dva starší recover záznamy následnou úspěšně dokončenou migraci a při `Migration history check: OK` neblokuje release.
- Release health kontrola nově rozlišuje nedostupný či neúspěšný `/api/health` a homepage smoke test včetně konkrétního HTTP statusu; neúspěšný rollout tak lze diagnostikovat bez záměny obou endpointů.

## [1.0.1] - 2026-07-10

- Opraven `GET /api/health`: selhání detailních Prisma dotazů pro e-mailovou frontu už nepropadne jako neobsloužené HTTP `500`, ale degraduje na HTTP `200` se `status=warning` a bezpečným `error.code=EMAIL_HEALTH_UNAVAILABLE`. Release helper může ověřit živý web a serverový journal stále uchová příčinu pro diagnostiku.

## [1.0.0] - 2026-07-10

### Nekompatibilní změny
- Opraven kritický lockout administrace: webový bootstrap login byl odstraněn, protože vydával session bez DB identity. Nový auditovatelný offline příkaz `npm run admin:recover-owner` vytvoří nebo obnoví aktivního DB OWNERa, revokuje otevřené pozvánky a nezapisuje heslo. Změna role i deaktivace nyní v serializovatelné transakci chrání posledního aktivního OWNERa; self-demotion vyžaduje dalšího aktivního OWNERa.
- Odstraněn nefunkční zákaznický ICS endpoint `/api/bookings/calendar/[token].ics` a celý nepoužívaný tokenový tok `CALENDAR`. Klientské potvrzovací i reschedule e-maily dál přikládají jednu `.ics` událost; owner subscription feed zůstává beze změny. Migrace `20260710123000_remove_customer_calendar_endpoint` maže případné historické CALENDAR tokeny a enum vrací na skutečně používané hodnoty.
- Kapacita dostupnostního slotu je nyní pevný databázový invariant `1`. Nová migrace před změnou constraintu fail-fast zastaví rollout, pokud najde historický slot s jinou hodnotou; booking engine mezitím vždy připustí jen jednu souběžnou rezervaci.
- Produkční rollout už nemění jen `.next` a `node_modules`: každý build se ukládá jako úplný verzovaný adresář v `releases/` a atomický symlink `current` přepíná zdrojové soubory, Prisma klient i build společně. Při selhání startu, workeru nebo health/smoke testu se vrací celý předchozí release; databázové migrace se záměrně automaticky nevracejí.

### Změněno a opraveno
- Veřejný `GET /api/health` při výpadku DB už nevrací `Error.message` s interní diagnostikou; místo ní vrací stabilní `error.code=DATABASE_UNAVAILABLE`. Pushover alert pro tento stav je non-blocking a samostatný desetiminutový cooldown v procesu zabrání notifikační bouři při častém monitoringu.
- Úspěšný release automaticky maže staré verzované adresáře: vždy chrání `current`, `previous` a standardně sedm dalších nejnovějších release; limit lze změnit přes `--keep-releases N`.

- E-mailový outbox nyní váže doručení i finální zápis stavu na `processingToken`. Worker ani ruční okamžité odeslání tak nemohou dokončit cizí nebo zastaralý claim. Resend REST požadavky používají stabilní `Idempotency-Key` odvozený z `EmailLog.id`; SMTP používá stabilní `Message-ID` (a hlavičku Resend pro kompatibilní SMTP), proto po pádu mezi ACK poskytovatele a DB zápisem zůstává SMTP explicitně at-least-once.

- Opravena bezpečnostní chyba administrátorských pozvánek: deaktivace účtu nyní v téže databázové transakci revokuje všechny nepoužité pozvánky. Veřejná aktivace zamyká token i účet, atomicky spotřebuje pouze dosud platný token aktivního uživatele a už nikdy sama nemění `AdminUser.isActive`. Přibyly integrační regrese pro deaktivovaný účet i souběžné použití stejného odkazu.

- Admin booking parser už odmítá neplatná kalendářní data, časy mimo rozsah a neexistující pražské wall-clock časy v jarní DST mezeře. Při podzimní dvojznačnosti používá explicitně dřívější výskyt.

- Release preflight nově kontroluje lokální `prisma/migrations` proti `git ls-tree` a zastaví se na adresářích bez `migration.sql`, aby se předešlo chybě Prisma P3015.

- Opravena SEO discovery chyba: indexovatelná stránka `/studio` je znovu v `sitemap.xml`; Playwright SEO smoke test nyní její `<loc>` explicitně ověřuje.

- Release příprava pro produkční nasazení: projektová verze navýšena na major `1.0.0` kvůli nekompatibilním změnám veřejné routy, datového modelu a provozního deployment workflow.
- Aktualizován framework `next` z `16.2.9` na `16.2.10` a `eslint-config-next` z `16.2.9` na `16.2.10`; jde o bezpečný patch upgrade v rámci Next.js 16 s odpovídající aktualizací lockfile a dokumentace.
- GitHub workflow baseline je sjednocená s aktuálními Dependabot GitHub Actions upgrady: `actions/checkout@v7`, `actions/setup-node@v6`, `actions/upload-artifact@v7` a `actions/dependency-review-action@v5`.
- Tím se odstraňuje potřeba držet několik samostatných Dependabot PR jen pro GitHub Actions a snižuje se riziko runner warningů kolem starších Node-targeted action verzí.
- Opravená kompatibilita media pipeline s novějším `sharp`: `src/lib/media/media-pipeline.ts` už nepoužívá zastaralý namespace typ `sharp.Sharp`, ale explicitní type import `Sharp`, takže upgrade `sharp` znovu prochází `typecheck` i produkčním buildem.
- React stack je sjednocený na kompatibilní patch verzi `19.2.7`: `react` a `react-dom` se povyšují společně a doprovodné typy `@types/react` / `@types/react-dom` jsou sladěné s aktuální řadou, aby CI nepadalo na `Incompatible React versions`.

## [0.7.2] - 2026-07-09

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.7.2`.
- GitHub automation pro kvalitu a bezpečnost je rozšířená na prakticky kompletní baseline: hlavní CI nově vedle `lint` běží i `typecheck`, plný `npm test`, samostatný `npm run test:coverage`, produkční build a Playwright E2E; coverage i `playwright-report` se zároveň ukládají jako artifacty.
- Hlavní `CI` už není jeden velký job, ale šest samostatných checků `lint`, `typecheck`, `test`, `coverage`, `build`, `e2e`, takže GitHub UI i branch protection znovu vidí každou kontrolu zvlášť.
- Po rozdělení `CI` do samostatných jobů je workflow znovu sladěné s Prisma a App Router build chováním: `typecheck` po `npm ci` explicitně generuje Prisma klienta, `build` job má vlastní PostgreSQL service + migrace kvůli statickému sběru page dat a `e2e` job si dělá vlastní build, protože už nesdílí `.next` z jiného jobu.
- Repo nově obsahuje samostatné GitHub workflow pro `CodeQL`, `Dependency Review` a scheduled `npm audit --audit-level=high`, plus `.github/dependabot.yml` pro týdenní update PR závislostí i GitHub Actions.
- Dokumentace `MANUAL.md`, `docs/DEVELOPMENT.md`, `docs/DEPENDENCIES.md`, `docs/DEPLOYMENT.md`, `docs/INCIDENTS.md` a ADR `0105` je sladěná s novým CI/security stackem včetně poznámky, že branch protection a required status checks je ještě potřeba ručně zapnout v nastavení repozitáře.
- Opravená regrese veřejného Matomo trackingu na tokenových self-service stránkách: `MatomoTracker` si teď synchronizuje bootstrap stav s inline `afterInteractive` skriptem i s runtime helperem `ensureMatomoTrackingPath`, takže route `/rezervace/storno/[token]` spolehlivě zapíše bezpečné `setCustomUrl` bez `trackPageView` i při pomalejší hydrataci nebo CI běhu.
- CI e2e build teď explicitně dostává testovací `NEXT_PUBLIC_MATOMO_*` hodnoty stejně jako Playwright runtime, takže produkční bundle v GitHub Actions nevypne Matomo ještě před spuštěním browser testů.

## [0.7.1] - 2026-07-08

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.7.1`.
- Opravený vizuální rozpad admin detailu rezervace po ručním přesunu termínu: potvrzovací banner u akce `Přesunout termín` se v panelu `Další krok` nově vždy smrskne a zalomí uvnitř vlastní grid karty, takže nepřetéká přes completion flow ani sousední obsah.
- Matomo booking funnel už neduplikuje první krok vlastním eventem `Rezervace / Zobrazena`: dashboard teď bere `viewed` přímo z pageview reportu `/rezervace` (`Actions.getPageUrls`), zatímco klient posílá až navazující funnel eventy od `Služba vybrána` dál.
- Booking analytics se dál pročistily od menších duplicit: předvyplněná služba přes query teď zapisuje jen diagnostické `Služba předvyplněna` a už ne duplikované `Služba vybrána`, zatímco `Datum vybráno` se v hlavním booking flow posílá jen při změně dne, ne znovu při kliknutí na čas v tom samém dni.

## [0.7.0] - 2026-07-07

- Release příprava pro produkční nasazení: projektová verze navýšena na minor `0.7.0`.
- Matomo booking funnel je nově explicitnější a lépe čitelný pro business i provoz: veřejná `/rezervace` posílá event `Rezervace / Zobrazena`, submit pokus `Rezervace / Odeslána rezervace` a agregovaná chyba kroku/submitu se zapisuje jako `Rezervace / Formulář chyba`, zatímco detailní kontaktní mikro-kroky (`Kontakt zahájen`, `Kontakt pole fokus`, `Kontakt pole vyplnění začátek`, `Kontakt pole chyba`) zůstávají zachované pro diagnostiku UX.
- Veřejné booking Matomo měření je doplněné i o provozní signály `Rezervace / Bez služeb`, `Rezervace / Bez termínů` a `Rezervace / Termín konflikt při odeslání`, takže reporting nově odliší prázdný katalog/kapacitu od submit konfliktu nad mezitím obsazeným nebo neplatným slotem.
- Self-service Matomo měření nově pokrývá i bezpečné lifecycle eventy `Rezervace / Změna termínu otevřena`, `Rezervace / Změna termínu odeslána`, `Rezervace / Storno odesláno` a `Rezervace / Storno dokončeno`, bez vazby na raw tokenové URL nebo klientské kontakty.
- Matomo nově rozlišuje i vstup do booking flow s předvyplněnou službou z jiných veřejných stránek přes samostatný event `Rezervace / Služba předvyplněna`, takže reporty odliší CTA z ceníku/detailu služby od ruční volby služby až uvnitř `/rezervace`.
- Matomo privacy guard už neblokuje legitimní self-service eventy `Storno odesláno` a `Storno dokončeno` jen kvůli slovu `storno`; helper dál filtruje PII a raw tokenové cesty a nové unit testy to hlídají.
- Playwright e2e nově hlídá i self-service storno analytics: tokenová stránka nesmí poslat pageview s raw URL, ale po potvrzení musí do Matoma projít bezpečné eventy `Storno odesláno` a `Storno dokončeno` bez úniku tokenu.
- Admin analytics dashboard a `/api/admin/analytics` teď skládají hlavní rezervační funnel ve tvaru `viewed -> service -> term -> contact -> submitted -> created` místo starého internějšího `service/date/time/created`, aby widget odpovídal skutečným mikro-krokům booking flow.
- Dokumentace `MANUAL.md`, `docs/API.md`, `docs/DEVELOPMENT.md` a ADR pro Matomo/reporting jsou sladěné s novým funnel namingem a rozšířeným měřením booking formuláře.
- Dev DX: inline `DevChunkReload` guard v root layoutu už nepoužívá trvalý jednorázový `sessionStorage` lock. Při `ChunkLoadError` v `next dev` nově dovolí dva rychlé hard reload pokusy v krátkém 15s okně, přidá dočasný cache-busting query parametr a po úspěšném načtení ho zase uklidí, takže browser nezůstane viset po prvním nepovedeném refreshi.
- Opravený lint/admin build blocker v draweru `Přidat rezervaci`: lokální `resetForm()` je nově vedený přes `useEffectEvent` místo ručního `useCallback`, takže Next.js/React compiler znovu dokáže zachovat invarianty `react-hooks/preserve-manual-memoization` i `exhaustive-deps` bez změny chování formuláře.
- Admin refaktoring bez změny chování zmenšil několik přetížených modulů: detail rezervace i weekly planner přesunuly čistou rozhodovací logiku do samostatných helperů, route factory pro admin nastavení nově deleguje serverový read model do odděleného modulu a shared admin URL podle role se skládají přes typed helper místo ručně kopírovaných ternárů.
- Přibyly cílené regresní testy pro nové helper vrstvy (`admin-paths`, `admin-booking-detail-helpers`, `admin-weekly-planner-helpers`), aby refaktor velkých admin komponent neoslaboval typovou kontrolu ani business rozhodování kolem planneru a detailu rezervace.
- Přibyla nová kořenová technická dokumentace `ARCHITECTURE.md`, `BOOKING_FLOW.md`, `DEPLOYMENT.md`, `ENVIRONMENT.md` a `TROUBLESHOOTING.md`, která sjednocuje popis databáze a Prisma modelů, e-mail workeru, ICS feedů, Matomo/UTM analytiky, admin rolí a deploye na Proxmox/LXC.
- `MANUAL.md`, `docs/DEVELOPMENT.md`, `docs/DEPLOYMENT.md` a `docs/ENVIRONMENT.md` nově na tyto kořenové dokumenty přímo odkazují, aby byl onboarding i provozní orientace rychlejší.
- Zpevněný admin auth proti login/logout CSRF: `POST /api/auth/login` i `POST /api/auth/logout` nově explicitně vyžadují stejný origin/host jako administrace PP Studia a cross-origin submit končí odmítnutím ještě před autentizací nebo smazáním session cookie.
- Admin UX pro každodenní provoz kosmetičky je rychlejší ve třech klíčových tocích: hlavní CTA `Vytvořit rezervaci` na dashboardu teď otevírá rovnou drawer ruční rezervace, seznam `Dnešní plán` přidal přímé akce `Volat` / `E-mail` / `Nová rezervace` u nejbližších klientek a dashboard/planner umí otevřít ruční rezervaci s předvyplněným dnem a časem z konkrétního volného okna.
- Drawer `Přidat rezervaci` nově čte query parametry `create=1`, `clientId`, `date` a `time`, takže ho lze bezpečně otevírat jako deep-link z detailu klientky, dashboardu i z týdenního planneru bez obcházení serverové validace dostupnosti.
- Admin planner `Volné termíny` přidal do `Inspektoru dne` přímé CTA `Přidat rezervaci do dne` a při výběru editovatelného bloku i `Rezervovat vybraný blok`, aby kosmetička nemusela přepisovat termín ručně mezi dvěma sekcemi adminu.
- Opravený admin preview ručního data/času v draweru rezervace i v draweru přesunu termínu: klientský náhled už nepřepočítává čas přes lokální timezone prohlížeče, ale přes stejný helper `Europe/Prague` jako server, takže kolem DST ani mimo české pásmo neukazuje jiný okamžik než se opravdu uloží.
- Ruční rezervace v adminu už nepřepne výběr ze slotu do tichého `manualOverride`, když je vybraný slot mezitím stale nebo už neodpovídá délce služby. `manualOverride` zůstává vyhrazený jen pro explicitní režim ručního data/času.
- Opravené doplňování rezervace pro vybranou existující klientku: když ruční booking formulář nechá e-mail prázdný, backend už klientce nemaže uložený kontakt na `null`; zachová se stávající adresa a booking jen používá aktuální výběr termínu/služby.
- Booking acquisition cookie nově bere `mtm_source`, `mtm_medium` a `mtm_campaign` jako fallback k `utm_*`, takže marketingové odkazy z Matomo kampaní nepřicházejí o akviziční kampaň při zápisu rezervace.
- Přibyly regresní testy pro Prague local time převod a DB integrační coverage pro admin ruční rezervaci: slot-mode teď ověřujeme proti tichému fallbacku na interní výjimku a manual-mode proti záměrnému vytvoření draft override slotu.
- Booking test coverage se rozšířila o další end-to-end business scénáře: veřejné vytvoření rezervace se snapshotem služby/ceny/délky, odmítnutí druhé rezervace do už obsazeného slotu, potvrzenou ruční admin rezervaci na publikovaném slotu a reminder/e-mail worker flow pro 24h připomínku. Současně se stabilizoval seed jednoho staršího voucher integračního testu, aby nehavaroval v paralelním DB běhu na kolizi s cizí aktivní rezervací.

## [0.6.0] - 2026-07-06

- Release příprava pro produkční nasazení: projektová verze navýšena na minor `0.6.0`.
- Opravený TypeScript build stránky `/o-mne`: `Person` JSON-LD teď dostává explicitní `businessName` mapované ze salon profilu, takže `buildPersonJsonLd(...)` znovu odpovídá svému kontraktu a produkční build nepadá na chybějícím poli.
- FAQ stránka rozšířila rozhodovací i SEO dotazy kolem výběru první služby, rozdílu mezi kosmetikou / lash liftingem / laminací obočí, příchodu s make-upem, výdrže lash liftingu a laminace obočí, problematické pleti, vhodnosti návštěvy při podráždění očí a volby mezi službovým a hodnotovým voucherem.
- Veřejné SEO landing pages `/`, `/sluzby`, `/cenik`, `/vouchery`, `/o-mne` a detail služby `/sluzby/[slug]` už nevolají `connection()` v page komponentě, takže je zbytečně neoznačujeme jako request-time dynamické jen kvůli SEO/read-model obsahu; tím se otevírá lepší prerender/cache chování pro veřejné dohledatelné stránky.
- Stránka `O mně` nově přidává samostatný `Person` JSON-LD pro Pavlínu Pomykalovou navázaný na entitu salonu, takže vyhledávače i AI systémy dostávají jasnější signál o osobě za značkou.
- Do `public/llms.txt` přibyl stručný strojově čitelný rozcestník veřejného webu s autoritativními kontaktními fakty, hlavními landing pages a upozorněním, že admin/tokenové URL nejsou určeny pro citace ani navigaci.
- Observability pro incident `Failed to find Server Action` nově loguje i sanitizované shrnutí `next-action` headeru (`length`, fingerprint, krátký sample, heuristika `looksMalformed`), takže provoz rychleji odliší stale klienta od scan/probingu s podvrženým action ID typu `"x"`.
- Opravené klientské dosynchronizování admin planneru po `Publikovat změny`: po úspěšném publishi se lokální `workingDays` znovu přepíšou čerstvými serverovými daty a smaže se aktivní selection, takže nové volné okno už nezůstane jen jako zelený obrys až do ručního refreshnutí stránky.
- Přibyla volitelná integrace Google Ads tagu (`gtag.js`, `AW-*`) na veřejný web přes `GoogleAdsTracker` s env konfigurací `NEXT_PUBLIC_GOOGLE_ADS_ENABLED` a `NEXT_PUBLIC_GOOGLE_ADS_ID`; tracker běží jen na veřejných/booking routách, respektuje admin session guard a při App Router navigaci posílá další `config` pageview bez tokenových URL.

## [0.5.1] - 2026-07-02

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.5.1`.
- Stabilizovaný Playwright scénář klientského přesunu rezervace přes veřejný token: test už pro konfliktní i úspěšný přesun vybírá reálně dostupné sloty z aktuální stránky a ověřuje je přes hidden `slotId`/`newStartAt`, takže nepadá na rozdílu mezi `-` a `–` v accessible name ani na tom, že sdílená test DB nabídne jinou kombinaci časů než předpočítaná fixture.
- Opravený merge sousedních editovatelných slotů po storno rezervace: compaction teď v transakci nejdřív vyřadí slučovaný sousední slot z active exclusion constraintu a teprve potom rozšíří anchor slot, takže storno už nepadá na PostgreSQL chybě `AvailabilitySlot_active_time_window_excl`.
- Storno rezervace nově po zrušení termínu automaticky znovu kompaktuje sousední běžné publikované fragmenty slotů zpět do souvislého okna, takže po starém bookingu nezůstávají trvalé zbytky typu `15:45–16:00`.
- Opravené `Nejbližší volné termíny` na admin dashboardu: read model už nebere volno jen podle `slot.capacity`, ale odečítá i interní booking blokace `scheduledStartsAt -> blockedUntil` a navazující volné úseky skládá do souvislých oken, takže po cleanup overflowu neukáže falešný čas a zároveň je výstup sjednocený s plannerem.
- Dokumentace byla srovnaná s aktuálním stavem repa: `README.md`, `MANUAL.md`, `docs/ENVIRONMENT.md`, `docs/DEVELOPMENT.md`, `docs/DEPENDENCIES.md` a `docs/DEPLOYMENT.md` teď odpovídají `Node 24`, současnému `.env.example`, veřejné voucher routě, coverage/dev skriptům a reálnému release flow přes staging workspace + `.release-env`.
- Stabilizován Playwright scénář vytvoření službového voucheru v adminu: výběr fixture služby už nepředpokládá `aria-pressed="false"`, takže test nepadá, když je CI seedovaná služba kvůli pořadí katalogu už předvybraná.
- Opravené vytváření voucheru na službu v adminu: picker služby už nepoužívá nativní `<select>` pro samotný výběr, takže v Chrome na Windows nezmizí názvy služeb kvůli systémovému renderingu bílého textu na světlém dropdownu. Přibyl i E2E scénář pro založení službového voucheru.
- Admin dashboard cleanup: z repozitáře zmizely dvě staré nepoužívané komponenty (`src/features/admin/components/admin-dashboard.tsx`, `src/features/admin/components/dashboard-today-timeline.tsx`) a read model `src/features/admin/lib/admin-dashboard.ts` už nevrací historická nepoužívaná pole, takže je přehled jednodušší na údržbu bez změny chování UI.
- Dev DX: `DevChunkReload` už neběží až po hydrataci jako client component, ale jako inline `beforeInteractive` guard v root layoutu. Jednorázový hard reload tak zachytí i selhání root/admin chunků v `next dev`, kde se původní klientský handler někdy vůbec nestihl načíst.

## [0.5.0] - 2026-06-30

- Release příprava pro produkční nasazení: projektová verze navýšena na minor `0.5.0`.
- Dev DX: browser v developmentu při známém `ChunkLoadError` z chybějícího Next/Turbopack chunku jednorázově provede hard reload místo zůstání v rozbitém HMR stavu; doplněná dokumentace v `MANUAL.md`, `docs/DEVELOPMENT.md` a `docs/INCIDENTS.md`.
- Opravená dev výkonnost veřejných route `/`, `/sluzby`, `/vouchery`, `/faq` a `/kontakt`: voucher landing page už nenačítá celý veřejný katalog služeb jen kvůli třem doporučením a všechny tyto route nově používají menší samostatné page moduly s odděleným metadata helperem místo importu celého monolitického `public-site.tsx`. Tím se zkrátil serverový čas renderu a omezilo riziko navazujícího Turbopack `ChunkLoadError` / selhání RSC payloadu při přechodech v devu.
- Veřejný web nově obsahuje indexovatelnou landing page `Dárkové vouchery` na `/vouchery`: samostatný hero, vysvětlení typů voucheru, orientační výběr vhodných služeb z aktuálního veřejného katalogu, FAQ blok a CTA na domluvu voucheru i na veřejné ověření kódu.
- Footer navigace a `sitemap.xml` jsou rozšířené o route `/vouchery`, zatímco technická route `/vouchery/overeni` zůstává noindex a mimo sitemap.
- Provozní dokumentace (`MANUAL`, `DEVELOPMENT`, `DEPLOYMENT`) je doplněná o novou veřejnou voucher route, její SEO postavení a ruční QA body po nasazení.
- Homepage a `/faq` nově obsahují jemné CTA na `/vouchery`, aby se dárkové vouchery lépe objevily i mimo footer a detail FAQ odpovědi.
- Samotná landing page `/vouchery` je rozšířená o praktičtější prodejní obsah: scénáře podle situace, doporučení kdy volit konkrétní službu vs. hodnotový voucher a krátký průběh domluvy voucheru.

## [0.4.0] - 2026-06-29

- Release příprava pro produkční nasazení: projektová verze navýšena na minor `0.4.0`.
- Přibyla centralizovaná API reference v [`docs/API.md`](docs/API.md), která shrnuje hlavní veřejné, admin-only a webhook endpointy včetně účelu, přístupu, status kódů a shape odpovědí; nově pokrývá i internější admin/UI route kontrakty jako booking search, voucher lookup, logout a resend invite.
- `GET /api/health` nově vrací i `release.version` převzatou z `package.json`, takže monitoring a ruční diagnostika snadno odliší aplikační verzi od deployment/commit identifikátoru.
- `GET /api/health` teď vrací i release metadata (`deploymentId`, `deploymentVersion`, `gitHash`) a `durationMs`, takže externí monitoring i ruční incident diagnostika rychleji poznají, na jakém buildu endpoint běží a jak dlouho vyhodnocení trvalo.
- Health endpoint má nově konzistentní payload i při DB chybě: chybová větev drží stejné sekce `emailWorker`, `emailQueue`, `emailDelivery` a vždy posílá `cache-control: no-store`.
- Pole `emailDelivery.hasRecentError` už odpovídá názvu i v semantice: bere jen chyby z posledních 24 hodin a endpoint explicitně vrací i `recentErrorWindowMs`.
- `deploy/release.sh` teď při každém releasu automaticky synchronizuje systemd unity z `deploy/systemd/` do `/etc/systemd/system/` a spouští `systemctl daemon-reload`, takže změny web/worker service definic se nasadí společně s aplikací a nezůstanou viset ve staré runtime konfiguraci.
- Release rollout teď zapisuje aktivní `NEXT_DEPLOYMENT_ID`, `DEPLOYMENT_VERSION` a `GIT_HASH` i do runtime souboru `.release-env`; systemd web service ho načítá při `next start`, takže startup/request logy konečně ukazují stejný `deploymentId` jako build a rollback vrací i předchozí runtime identitu releasu.
- Provozní dokumentace (`MANUAL`, `DEVELOPMENT`, `ENVIRONMENT`, `DEPLOYMENT`, `INCIDENTS`) nově výslovně popisuje rozdíl mezi build-time exportem release proměnných a runtime `.release-env`, aby byl runbook pro `Failed to find Server Action` v souladu se skutečným nasazením.

## [0.3.34] - 2026-06-09

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.34`.
- Přidán kořenový `instrumentation.ts` pro Next.js 16 produkční observability: při startu instance loguje deployment metadata a při request chybách zapisuje strukturovaný provozní záznam přes `onRequestError`.
- Incident `Failed to find Server Action` už nově loguje i pravděpodobnou příčinu (`deployment-id-mismatch`, chybějící/stale `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`), bezpečný fingerprint šifrovacího klíče, `x-deployment-id`, request context a sanitizovanou path bez tokenů.
- Provozní dokumentace (`MANUAL`, `DEVELOPMENT`, `ENVIRONMENT`, `DEPLOYMENT`, `INCIDENTS`) je doplněná o nový runbook pro čtení těchto logů v `journalctl`.

## [0.3.33] - 2026-06-09

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.33`.
- Aktualizován framework `next` z `16.2.6` na `16.2.9` a `eslint-config-next` z `16.2.6` na `16.2.9`; jde o bezpečný patch upgrade v rámci Next.js 16 ověřený lokálním lintem a production buildem.
- Provozní dokumentace nově eviduje i aktuální stav `npm audit`: po upgradu zůstává `1 low` a `6 moderate` transitive nálezů, ale automatické `npm audit fix` se záměrně nepouští, protože doporučené zásahy míří na nebezpečný downgrade `next` / `prisma`.
- Projekt je nově standardizovaný na `Node 24 LTS`: přibyl repový pin [`.nvmrc`](.nvmrc#L1), `package.json` deklaruje `engines.node = ^24.0.0` a GitHub Actions CI běží na `Node 24` místo `22`.
- Provozní a vývojová dokumentace byla doplněná o rollout poznámky k upgradu runtime, aby lokální vývoj, CI a produkce držely stejnou major verzi Node při `npm ci`, buildu a restartu systemd služeb.
- Opravená flakiness DB integračního testu `booking-rescheduling.integration.test.ts`: seed už nevolí pevně odvozené budoucí časy, ale aktivně hledá izolované okno bez překryvu s existujícími sloty a aktivními rezervacemi ve sdílené databázi.

## [0.3.32] - 2026-06-28

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.32`.
- Stabilizované DB integrační testy veřejné rezervace s voucherem: helper už nehledá fixní časové sloty v blízkých dnech, ale dynamicky vybírá izolované okno bez kolize s existujícími sloty a aktivními rezervacemi ve sdílené databázi.
- Opravený production build planneru pro Next.js 16.2.6: vnořené `flatMap<PlannerInterval>(...)` v `admin-slots/queries.ts` teď explicitně drží sjednocený návratový typ pro větve `available` i `locked` a detail výběru v planner UI už null-safe čte `cleanupBlockedUntilLabel`, takže `next build` nepadá na TypeScript zúžení ani na `selectionBooking is possibly null`.
- Admin planner `Volná okna` už při výpočtu běžné dostupnosti započítává i cleanup blokaci přetékající z navazující rezervace do sousedního slotu, takže se další slot falešně neukáže jako volný jen proto, že booking visí na předchozím `slotId`.
- Přibyl DB regresní test pro týdenní planner, který hlídá, že `blockedUntil` v sousedním slotu zneplatní odpovídající `availableIntervals`, ale zbytek dne zůstane editovatelný.
- Planner mřížka teď cleanup zobrazuje jako skutečný 15min/30min žlutý segment uvnitř půlhodinové buňky: při overflowu může být horní nebo dolní polovina žlutá nad zeleným/červeným základem, celá buňka je žlutá při plné 30min cleanup blokaci a legenda má samostatnou položku `Úklid`.
- Opravená regrese planner mřížky pro 15min zbytky po cleanup overflowu: vizuální vrstva už neztrácí spodní zelenou polovinu buňky u úseků typu `11:45–12:00`, i když z nich nevznikne samostatné 30min editační okno.
- Seznam `Volná okna` nově mergeuje navazující editable sloty ještě před převodem na půlhodinová okna, takže rozdělené publikované intervaly typu `14:00–14:45` + `14:45–15:00` znovu tvoří jedno okno `14:00–15:00`.
- Admin pracovní seznam rezervací už není svázaný pevným globálním limitem `take: 80`; souhrnný počet výsledků se počítá přes samostatný `count(where)` a UI dál pracuje se skutečným počtem nalezených rezervací.
- Sekce `Rezervace` nově používá progresivní odkrývání dlouhých seznamů: `Minulé` jsou defaultně sbalené, každá skupina má vlastní URL-driven limit a dlouhé bloky se rozšiřují přes `Zobrazit další` bez ztráty aktivních filtrů.
- Pole `Hledat` v rezervacích nově používá živé našeptávání nad databází přes admin lookup endpoint, takže návrhy reagují na aktuální klientky, kontakty a služby místo jednorázového snapshotu při načtení stránky.
- Hledání v rezervacích se po krátké pauze při psaní odesílá samo, takže běžné filtrování už nevyžaduje klik na `Filtrovat`; výběr návrhu z našeptávače dál filtr spouští okamžitě.
- Přibyly validační testy pro nové query parametry seznamu rezervací (`showPast`, `*Limit`), aby se nerozbilo serverové čtení URL stavu pracovního seznamu.

## [0.3.31] - 2026-06-09

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.31`.
- CI build pro Playwright smoke testy teď nastavuje i dummy `NEXT_PUBLIC_META_PIXEL_ENABLED=true` a `NEXT_PUBLIC_META_PIXEL_ID=123456789`, takže se Meta Pixel nevypne už při `next build` a browser funnel test čte stejné build-time env jako lokální `pretest:e2e`.
- Webová ikonová sada (`src/app/favicon.ico`, `src/app/apple-icon.png`, `public/apple-touch-icon*.png`, `public/android-chrome-*.png`) je znovu vygenerovaná podle aktuálního loga PP Studio, takže favicon a PWA ikony odpovídají současnému brandingu.

## [0.3.30] - 2026-06-09

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.30`.
- Meta Pixel už nesbírá jen `PageView`: detail služby posílá `ViewContent`, booking flow posílá `InitiateCheckout`, `AddToCart`, custom funnel eventy `BookingDateSelected` / `BookingTimeSelected` / `BookingContactStarted` a po úspěšném odeslání rezervace standardní `Lead`.
- Přibyl sdílený Meta Pixel helper se sanitizací payloadu, který z eventů odstraňuje e-maily, telefony, tokeny, klientské poznámky a další hodnoty vypadající jako PII nebo tokenová URL.
- Dokumentace a QA checklisty jsou doplněné o očekávané Meta Pixel eventy a rychlou kontrolu booking/service funnelu po deployi.

## [0.3.29] - 2026-06-06

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.29`.
- Admin vyhledávací pole napříč klientkami, rezervacemi, službami, vouchery, e-mail logy i interními pickery klientky/služby už nepobízí prohlížeč k autofillu uložených kontaktů: search inputy mají vypnuté autocomplete/autocorrect heuristiky a kontaktně laděné placeholdery jsou neutrálnější tam, kde to dávalo smysl.
- Rezervační engine nově dovolí poslední klientský termín v publikovaném okně i tehdy, když interní cleanup blokace přeteče za konec slotu; navazující dostupnost zůstává správně blokovaná až do `blockedUntil`, takže se další rezervace nenabídne před dokončením úklidu.

## [0.3.28] - 2026-06-04

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.28`.
- Admin detail rezervace nově umí akci `Změnit službu` přímo na existujícím bookingu: přepíše snapshot služby, délku, cleanup blokaci i ceníkový základ a uloží auditní stopu do historie rezervace.
- Změna služby je serverově omezená jen na `PENDING`/`CONFIRMED` rezervace a odmítne se, pokud nová služba nesedí do stávajícího času, poruší slotové omezení nebo koliduje se službovým voucherem navázaným na jinou službu.
- Admin booking detail read model nově do detailu posílá i nabídku dostupných služeb pro bezpečnou výměnu přímo z cockpit view bez ruční DB opravy.
- Opravená dokumentační nejednotnost v onboardingu a provozních docs: `README.md` znovu explicitně uvádí `npm run db:generate` v krokovém lokálním setupu, `MANUAL.md` má aktuální verze `next 16.2.6` a `prisma 7.8.0` a `docs/DEPLOYMENT.md` odpovídá současnému chování dashboard sekce `Vyžaduje pozornost`.

## [0.3.27] - 2026-06-03

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.27`.
- Opravená kolize sticky vrstev v admin seznamu rezervací: sticky zůstává jen horní filtrační panel a desktopová hlavička tabulky už se nepřilepuje samostatně, takže nepřekrývá filtry černým pruhem ani se neobjevuje uprostřed seznamu.
- Admin seznam klientek v `/admin/klienti` a `/admin/provoz/klienti` už u sloupce `Poslední návštěva` neukazuje `Client.lastBookedAt` z poslední booking aktivity; nově bere poslední minulou rezervaci ve stavu `COMPLETED`, stejně jako detail klientky a CRM souhrn.
- Řazení `Poslední návštěva` v seznamu klientek je sjednocené se stejnou definicí: klientky s novým budoucím nebo ještě neuzavřeným termínem už kvůli tomu neskáčou nahoru jako kdyby už návštěva proběhla.
- Stejná oprava platí i pro legacy read model sekce `Klienti` v `admin-section-page`: stručný přehled a jeho pořadí už neberou `Client.lastBookedAt`, ale poslední minulou `COMPLETED` rezervaci.
- `/admin/email-logy` má nově vlastní explicitní route soubor místo nepřímého průchodu přes dynamické `/admin/[section]` a interní přepojení v `AdminSectionPage`; detail email logu zůstává beze změny.
- `AdminSectionPage` byla odstraněná: po zavedení explicitní route pro `/admin/email-logy` už fallback neobsluhoval žádnou reálně dosažitelnou sekci. `createAdminSectionRoute(...)` teď po vyčerpání známých sekcí končí `notFound()`.
- `src/features/admin/lib/admin-data.ts` je po tomto kroku zúžené na skutečně používané exporty. Root `/admin/email-logy` už čte přímo `getEmailLogsData()` a starý obecný sekční switch plus nepoužívané fallback read modely (`slots/clients/media/services/categories/settings`) byly odstraněné.
- Opravený vizuální kontrast rootu `/admin/email-logy`: route dostala vlastní `layout.tsx` s `AdminShellLayout`, takže znovu běží na tmavém admin shell backgroundu místo světlého veřejného gradientu pod poloprůhlednými kartami.
- Email logy prošly density passem do provoznější podoby: hlavička používá `denseIntro`, health panel je nižší, filtry i karty posledních emailů mají menší padding a CTA, takže se hlavní seznam dostane výš bez zbytečného „landing page“ dojmu.
- Sjednocení intro copy napříč admin sekcemi: kratší provozní eyebrow/title/description u rezervací, kategorií, médií, nastavení, přístupů a e-mailových logů, plus sladění názvů v admin navigaci.
- Sekundární panel copy v adminu je sjednocené stejným provozním tónem: kratší názvy a popisy u nastavení, přístupů, médií, rezervací a detailu e-mail logu.
- Mikrocopy v adminu je sladěné i v CTA a empty states: `Reset filtrů`, `Nahrát médium`, čitelnější české empty states a provozní labely v e-mail observability.
- Sidebar popisy admin sekcí jsou kratší a skenovatelnější, aby seděly s kompaktním provozním tónem celého adminu.
- E2E smoke test `tests/e2e/site-smoke.spec.ts` je sladěný s novým admin namingem (`Provozní přehled`, `Média`, `Přístupy`, `Email logy`, `Volné termíny`), aby po copy refactoru znovu validoval správné headingy.
- Provozní dokumentace a QA checklisty jsou sladěné s novým admin namingem (`Provozní přehled`, `Média`, `Přístupy`, `Email logy`) v `MANUAL.md` a `docs/*`, historické ADR/Changelog záznamy zůstávají beze změny jako auditní stopa.

## [0.3.26] - 2026-06-01

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.26`.
- Přidána volitelná integrace Meta Pixel (`fbq`) na veřejný web přes `MetaPixelTracker` s env konfigurací `NEXT_PUBLIC_META_PIXEL_ENABLED` a `NEXT_PUBLIC_META_PIXEL_ID`.
- Meta Pixel se nenačítá v adminu, API, Next internals ani na tokenových self-service routách (`/rezervace/sprava/*`, `/rezervace/storno/*`, `/rezervace/akce/*`) a je vypnutý i při aktivní admin session cookie `ppstudio-admin-session`.

## [0.3.25] - 2026-05-31

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.25`.
- Veřejné odkazy na `/rezervace` už implicitně nepoužívají Next.js prefetch (`prefetch={false}`), aby se na stránkách mimo booking route zbytečně nepřednačítal booking CSS chunk (`0_9_05p0o1dxa.css`) a nevznikalo upozornění na nevyužitý preload.
- Opraven PWA manifest icon 404: soubory `android-chrome-192x192.png` a `android-chrome-512x512.png` jsou nově dostupné v `public/`, takže odkazy z `app/manifest.webmanifest` fungují na root URL bez chyby načtení.

## [0.3.24] - 2026-05-31

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.24`.
- Homepage hero logo (`PP Studio`) je nyní explicitně označené jako LCP kandidát přes `next/image` `preload` + `fetchPriority="high"` pouze na tomto jednom prvku, bez změny layoutu a bez zásahu do ostatních log na webu.
- Homepage hero portrét (`Portrét homepage PP Studio 1`) má nově explicitní `sizes` atribut v `next/image`, aby browser stahoval menší responzivní variantu podle reálné šířky layoutu místo zbytečně velkého zdroje.

## [0.3.23] - 2026-05-31

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.23`.
- Opraven Matomo booking funnel pro předvyplněnou službu z query parametru (`/rezervace?service=...`): event `Rezervace / Služba vybrána` se nově odešle i při vstupu z ceníku nebo detailu služby bez dalšího kliku ve výběru služby, takže je v návštěvě vidět konkrétně vybraná služba.
- Přidán Playwright E2E regresní scénář `service detail CTA opens booking with preselected service and immediate slot selection`, který v CI hlídá cestu `detail služby -> rezervace` včetně předvyplnění `serviceId` a okamžitého výběru termínu bez opětovné volby služby.

## [0.3.22] - 2026-05-27

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.22`.
- Homepage LCP logo v hero sekci nově používá u `next/image` atribut `fetchPriority="high"` místo `preload`, aby prohlížeč priorizoval načtení LCP prvku bez rizika duplicitního preloadu.
- Test suite dostala TypeScript housekeeping pro `npx tsc --noEmit`: doplněné povinné `cleanupBlockMinutes` ve fixture, opravený zastaralý enum `BOOKING_PENDING -> BOOKING_CREATED`, bezpečnější guardy u volitelných JSON-LD polí a odstraněné přímé přepisování read-only `process.env.NODE_ENV`.
- CSS audit homepage: landscape-only styly pro booking header a sticky CTA byly přesunuty z `src/app/globals.css` do route-level souboru `src/app/(booking)/booking-layout.css`, takže se už nenačítají na veřejné homepage.

## [0.3.21] - 2026-05-25

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.21`.
- Opravený viewport po odeslání veřejné rezervace: po přechodu na success confirmation se stránka jednorázově posune na začátek, takže uživatelka nezůstane „dole“ po výměně formuláře za kompaktnější potvrzení.
- Veřejná potvrzovací stránka po vytvoření rezervace je kompaktnější: nižší hero `Rezervace přijata`, menší vertikální mezery mezi bloky, hustší detail rezervace a kratší blok `Co bude následovat`, aby stránka nepůsobila jako dlouhá landing page.
- Detail rezervace na success screenu nově preferuje strukturu `služba` + `datum · čas`; čas zůstává vizuálně nejvýraznější a klientka dál vidí jen čas služby (bez interní úklidové blokace).
- Blok `Potřebujete pomoc?` je nižší a na desktopu zobrazuje kontakt kompaktněji (`email · telefon`), zatímco mobil zachovává samostatné dobře klikatelné akce.
- `SiteFooter` přidal volitelnou `compact` variantu a booking shell (`variant="booking"`) ji používá jen na rezervačních stránkách; odkazy i kontaktní obsah zůstávají stejné.

## [0.3.20] - 2026-05-25

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.20`.
- Admin detail služby nově umí uložit volitelný `Čas na úklid po službě` (`Service.cleanupMinutes`, default `0`) s nápovědou, že jde o interní blokaci dostupnosti; klientce se nezobrazuje jako délka služby.
- Rezervační engine nově při vytvoření a přesunu rezervace ukládá snapshot `cleanupMinutes`, `cleanupBlockMinutes` (zaokrouhlení nahoru na 15 minut) a `blockedUntil`; klientský konec služby (`scheduledEndsAt`) zůstává beze změny.
- Veřejné i admin generování termínů a serverové kontroly kolizí nově používají interní interval rezervace `scheduledStartsAt -> blockedUntil`; běžná půlhodinová mřížka zůstává, ale první termín po cleanup blokaci se může nabídnout i v `:15` nebo `:45`.
- Detail rezervace v administraci nově ve sbalitelných technických metadatech ukazuje nenápadný provozní údaj `Úklid po službě` a při nenulové blokaci také `Interně blokováno do`, zatímco hlavní termín rezervace dál zůstává čistý čas služby.
- Opravené mapování čtvrthodinových hran (`:15`/`:45`) v admin týdenním planneru: rezervace a locked úseky teď blokují všechny dotčené půlhodinové buňky (`cover`), zatímco editovatelná dostupnost se zobrazuje jen pro celé půlhodiny (`inside`), takže ukládání konceptu už nedělá falešně volné buňky kolem cleanup blokace.
- Admin týdenní planner je odolnější při hydrataci draftu: první render je SSR-safe bez čtení `localStorage`, lokální draft/feedback se načítá až po mountu a při chybějících dnech komponenta vrátí bezpečný fallback místo pádu.
- Detail výběru v admin planneru nově u rezervace prioritně ukazuje klientský čas služby, zvlášť vypisuje interní blok v mřížce a při cleanup blokaci i řádek `Úklidová blokace do`; přímo v buňkách je cleanup část nenápadně označená jemným pravým pruhem a v seznamu rezervací je tlumený badge `úklid`.
- Playwright E2E coverage veřejné rezervace je rozšířená o cleanup scénář: test ověřuje, že čas na úklid blokuje dostupnost (první nabídnutý termín může být až na `:15`) a klientský souhrn přitom dál zobrazuje jen reálný konec služby bez interních textů o blokaci.

## [0.3.19] - 2026-05-24

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.19`.
- Horní hlavička detailu rezervace v adminu je výrazně kompaktnější: má dvouřádkové provozní rozložení, rychlé akce jsou v horním řádku vpravo, zmizel duplicitní odkaz `Zpět na rezervace` a termín už není ve velkém boxu, ale jako stručný text v sekundárním řádku se službou a délkou.
- Pokud je u rezervace doplněná klientská nebo interní poznámka, detail rezervace ji nově výrazněji signalizuje badge štítky už v hlavičce i v panelu `Poznámky`, aby byla vidět bez scrollování historie.
- Admin detail rezervace je vizuálně přeřazený do pracovního cockpit režimu: u potvrzené rezervace je hlavní akcí `Dokončit návštěvu`, `Přesunout termín` a `Nedorazila` jsou sekundární provozní kroky a `Zrušit rezervaci` je oddělené do samostatné nebezpečné sekce s důvodem zrušení.
- Souhrn rezervace se na mobilu zobrazuje hned pod hlavičkou, technická metadata jsou sbalitelná a tlumená, panel `Úhrada` výrazněji ukazuje doplatek a poznámky oddělují klientskou poznámku od interní týmové poznámky.
- Admin detail rezervace je kompaktnější: panel `Další krok` používá stručný stavový řádek bez duplicit, potvrzení vybrané akce je v jednom kompaktním řádku a `Nebezpečné akce` jsou výchozně sbalené pod accordion.
- `Úhrada` je zhuštěná do rychlého souhrnu `Doplatek / Uhrazeno / Voucher` se zvýrazněným doplatkem, detail plateb je pod rozbalením `Detail úhrady` a historie změn v detailu rezervace výchozně ukazuje jen poslední položku.
- Panel `Další krok` v potvrzené rezervaci nově používá hlavní akci `Dokončit návštěvu` a zobrazuje platební kontext (`Doplatek` / `Platba vyřešena`) přímo u akce.
- Přidán serverový completion flow `completeBookingVisitAction`: při doplatku umožňuje v jednom potvrzení dokončit návštěvu přes `Hotově`, `QR platba`, `Voucher`, `Kombinovaně` nebo `Bez platby` (u `Bez platby` je povinný důvod). Flow umí zapsat platbu a/nebo voucher a následně uzavřít rezervaci jako `Hotovo`.
- Completion flow nyní před zápisem úhrady znovu ověřuje, že rezervaci lze dokončit až po termínu a že zvolená platba/voucher pokrývá celý doplatek; částečný voucher už neuzavře návštěvu bez vědomé volby `Bez platby` s důvodem.
- V completion flow přibyla pomocná akce `Načíst voucher`: po zadání kódu načte stav a zbývající hodnotu voucheru a u hodnotového voucheru předvyplní doporučenou částku do pole `Částka voucheru`.
- Audit při completion flow je rozšířený o záznamy `Platba zapsána při dokončení návštěvy`, `Voucher uplatněn při dokončení návštěvy` a u varianty bez úhrady o text `Rezervace označena jako hotová s neuhrazeným doplatkem...` v důvodu změny stavu.
- Opraven owner flow `Znovu odeslat e-mail` u reminderu: nově po akci otevírá detail nově vytvořeného email logu (ne původního záznamu), takže je hned vidět skutečný výsledek resend pokusu.
- Ruční admin resend reminderu (`BOOKING_REMINDER`) nyní nastavuje explicitní override flag `manualReminderResend`, takže worker reminder preflight záznam nepřepne automaticky na `system-skip` a zpráva se skutečně zkusí odeslat na opravený kontakt.

## [0.3.18] - 2026-05-24

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.18`.
- Opraven TypeScript kontrakt v owner dashboardu `Komunikace se zákaznicemi`: `trackingStateValue` v `EmailLogsDashboardData.recentEmails` nově zahrnuje i stav `processing`, aby byl v souladu s `deriveTrackingState(...)` a build nepadal na nekompatibilní unii typů.

## [0.3.17] - 2026-05-24

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.17`.
- Admin detail klientky nově umožňuje upravit e-mail a telefon přímo v rozhraní; změna se propíše i do aktivních rezervací klientky a do dosud neodeslaných e-mail logů, aby oprava překlepu nevyžadovala zásah přes DB.
- Owner detail `Email logu` nově nabízí akce `Načíst e-mail z kontaktu` (synchronizace `recipientEmail` z aktuální klientky) a `Znovu odeslat e-mail` (vytvoření nového `PENDING` email logu bez přepisu původního záznamu), včetně nových flash hlášek.
- Owner přehled `Komunikace se zákaznicemi` teď ve sloupci tracking používá barevný stavový badge navázaný na aktuální stav email logu (`Tracking aktivní`, `Tracking připraven`, `Tracking čeká`, `Tracking v retry`, `Tracking selhal`) místo jednotného neutrálního štítku.
- Delivery tracking je nově napojený na Resend webhooky: přidán endpoint `POST /api/webhooks/resend` s ověřením `svix` podpisu, ukládání eventů (`delivered/opened/clicked/bounced/failed/suppressed`) do `EmailLog` a odvozování tracking badge z reálných event dat.
- Email provider podporuje transport `EMAIL_TRANSPORT=resend` vedle SMTP; při odeslání přes Resend se ukládá `providerMessageId = email_id`, takže webhook události se párují jednoznačně na konkrétní `EmailLog`.
- Resend webhook chybové eventy (`email.bounced`, `email.complained`, `email.failed`, `email.suppressed`) nově navazují na owner Pushover notifikace typu `EMAIL_FAILED`; notifikace se posílá jen při prvním zachycení daného chybového stavu.

## [0.3.16] - 2026-05-21

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.16`.
- Přidána volitelná integrace Microsoft Clarity na veřejný web přes nový klientský `ClarityTracker` (`next/script`, `lazyOnload`) s env konfigurací `NEXT_PUBLIC_CLARITY_ENABLED` a `NEXT_PUBLIC_CLARITY_PROJECT_ID`.
- Clarity se nenačítá v adminu, API, Next internals ani na tokenových self-service routách (`/rezervace/sprava/*`, `/rezervace/storno/*`, `/rezervace/akce/*`) a je vypnutá i při aktivní admin session cookie `ppstudio-admin-session`.

## [0.3.15] - 2026-05-21

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.15`.
- Admin dashboard už neeskaluje jako problém samotnou absenci publikovaných slotů dnes/zítra; sekce `Vyžaduje pozornost` nově drží jen skutečně akční provozní alerty (čekající potvrzení, selhané e-maily, rezervace po termínu k uzavření).
- Sekce `Nejbližší volné termíny` používá neutrální copy pro nulovou dostupnost (`Momentálně nejsou publikované žádné nadcházející volné termíny.`) a při existujících draftech ukazuje užitečný stav s počtem návrhů čekajících na publikování a odkazem do dostupnosti.
- Admin dashboard má klidnější provozní hierarchii: sekce `Vyžaduje pozornost` nově skutečně zvýrazňuje primární alert podle `emphasis`, sekundární alerty jsou kompaktnější a CTA labely zůstávají konkrétnější (`Dostupnost`, `Rezervace`, `E-mail logy`).
- Rychlé akce v dashboardu už neduplikují horní CTA `Vytvořit rezervaci`; čtvrtou akcí jsou nově `Vouchery`. KPI strip zobrazuje i krátký detail metriky a read model dashboardu byl očištěn od nepoužívaných polí.
- Admin session cookie `ppstudio-admin-session` má nově prodlouženou platnost z 12 hodin na 7 dní (`maxAge` + JWT expirace), aby nebylo potřeba tak časté opětovné přihlášení během běžného provozu.
- Admin auth nově používá sliding session refresh v `src/proxy.ts`: při admin requestu se session automaticky obnoví, pokud do expiry zbývá méně než 48 hodin; současně platí absolutní limit 45 dní od prvního přihlášení, po kterém je nutné nové přihlášení.
- Session timeouty jsou nově konfigurovatelné přes env (`ADMIN_SESSION_IDLE_MAX_AGE_SECONDS`, `ADMIN_SESSION_REFRESH_WINDOW_SECONDS`, `ADMIN_SESSION_ABSOLUTE_MAX_AGE_SECONDS`) se zachovanými defaulty `14 dní / 48 hodin / 45 dní`.

## [0.3.14] - 2026-05-20

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.14`.
- Majitelce (`notificationAdminEmail`) nově chodí i e-mail `admin-booking-rescheduled-v1`, když klientka přes self-service web přesune termín rezervace; e-mail obsahuje původní i nový termín a odkaz na detail rezervace v administraci.
- Reschedule engine (`rescheduleBooking`) nově po klientském online přesunu zakládá vedle klientského `booking-rescheduled-v1` i admin email log, pokud je vyplněný notifikační admin e-mail.
- E-mail renderer a testy byly rozšířené o novou šablonu `admin-booking-rescheduled-v1`; integrační test reschedule flow teď při kontrole klientského e-mailu filtruje explicitně podle `templateKey`.
- Opravené zasekávání quick akce `Potvrdit` v admin seznamu rezervací: `updateBookingStatusAction` už nečeká synchronně na Pushover dispatch, takže tlačítko nezůstává viset na `Ukládám...` při pomalé nebo nedostupné Pushover API vrstvě.
- Přidán DB integrační test `admin-booking.integration.test.ts` pro flow `applyAdminBookingStatusChange` (`PENDING -> CONFIRMED`) včetně side effectů (`BookingStatusHistory`, `BookingActionToken`, `EmailLog`), aby byl potvrzovací zápis krytý nad reálným Prisma modelem.
- Test coverage batch rozšířen o nové unit testy pro `admin action-state` moduly a early-fail validace v `booking-public/engine` (neplatný `startsAt`, neplatný telefon), aby se zvedlo pokrytí kritických low-coverage oblastí.
- `npm run test:coverage` po doplnění testů: `Statements 29.22%` (6451/22073), `Branches 72.31%` (948/1311), `Functions 63.98%` (524/819), `Lines 29.22%` (6451/22073).
- Test coverage batch 2 doplnil validační unit testy pro server actions (`client-actions`, `service-actions`, `booking-actions`, `settings-actions`) nad early error větvemi bez DB přístupu.
- `npm run test:coverage` po batch 2: `Statements 33.04%` (7294/22073), `Branches 69.27%` (1035/1494), `Functions 62.72%` (589/939), `Lines 33.04%` (7294/22073).
- Test coverage batch 3 rozšířil validační unit testy o `service-category-actions` (`createServiceCategoryAction`, `updateServiceCategoryAction`) pro malformed/incomplete payload větve před auth/DB.
- `npm run test:coverage` po batch 3: `Statements 34.20%` (7551/22073), `Branches 68.88%` (1056/1533), `Functions 62.02%` (606/977), `Lines 34.20%` (7551/22073).

## [0.3.13] - 2026-05-19

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.13`.
- Matomo event taxonomy je sjednocená do češtiny: booking funnel a CTA eventy na veřejném webu i self-service správě rezervace nově používají názvy `Rezervace / ...` a dashboard reporting mapuje nové české labely se zpětnou kompatibilitou na starší anglické eventy.
- Dokumentace analytics byla aktualizovaná o pravidlo, že nové Matomo eventy se mají pojmenovávat primárně česky (s výjimkou standardních technických termínů typu `Web Vitals`).
- Rezervační kontaktní krok nově sleduje neosobní interakce s poli (`Kontakt pole fokus`, `Kontakt pole vyplnění začátek`, `Kontakt pole chyba`) a event `Rezervace / Kontakt zahájen` se nově spouští až při první interakci s kontaktním polem, ne už při výběru času.
- Admin analytics widget má nově mini sekci `Kvalita kontaktního kroku` (`zahájeno`, `fokus pole`, `začátek vyplnění`, `chyba pole`) a procenta počítaná vůči `Kontakt zahájen` z API payloadu `contactStepQuality`.
- Matomo tracking se nově automaticky vypíná pro přihlášené adminy i na veřejných stránkách: `SiteShell` server-side kontroluje cookie `ppstudio-admin-session` a `MatomoTracker` v tom případě nenačte init script ani `matomo.js`.
- Opraven admin prefetch CORS regres: trusted host validace pro `buildAbsoluteUrl(...)` a same-origin admin kontrolu teď bere bezpečně i aliasy `apex <-> www`, takže RSC prefetch na `/admin/*?_rsc=...` při redirectu neskončí na cross-origin `Fetch API cannot load ... due to access control checks`.

## [0.3.12] - 2026-05-18

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.12`.
- Kontaktní krok veřejného booking flow má explicitně propojené popisky, nápovědy a chyby přes stabilní `id`/`htmlFor`/`aria-describedby`, chybové hlášky jsou oznamované asistivním technologiím a formulářové prvky mají výraznější `focus-visible` stav v akcentu PP Studia.
- Veřejné booking error stavy teď nabízejí konkrétní další krok: kontaktovat PP Studio ve Zlíně, zobrazit služby/ceník nebo se vrátit k výběru služby či termínu.
- Sjednoceny veřejné canonical a OpenGraph URL: root metadata i `buildPageMetadata(...)` používají `siteConfig.canonicalUrl`, takže page metadata, JSON-LD, `robots.txt` a `sitemap.xml` sdílí stejný veřejný canonical origin.
- Odstraněna nepoužívaná legacy homepage komponenta `src/features/home/components/home-page.tsx` a duplicitní starý export `PricingPage` z `src/features/public/components/public-site.tsx`; veřejný ceník dál používá samostatnou komponentu `src/features/public/components/pricing-page.tsx`.
- Ve fallback copy veřejných služeb (`src/content/public-site.ts`) byly odstraněny interní placeholder formulace; texty v `description` teď používají finální produkční tón PP Studia pro kosmetické studio ve Zlíně.
- Opravená přístupnost anchor navigace v ceníku: `CategoryChips` už nenastavuje statické `aria-current="page"` na první položku, aby čtečky obrazovky nedostávaly zavádějící informaci o aktuální kategorii.
- Veřejný booking kalendář v kroku `Vyberte termín` má přístupnější popisky dnů: `aria-label` tlačítek dne nově používá `formatDateKeyLabel` (např. `Vybrat den neděle 17. května`) místo technického ISO `YYYY-MM-DD`.
- Den, který obsahuje jen disabled časy, už v booking kalendáři není klikací: tlačítko dne je semanticky `disabled`, takže klávesnice ani čtečka nenarazí na falešně interaktivní volbu bez dostupného času.
- Sjednocen canonical origin v technickém SEO: `src/app/robots.ts` a `src/app/sitemap.ts` používají pro `Host`, `Sitemap` i generované sitemap URL `siteConfig.canonicalUrl` místo `siteConfig.url`, aby byly konzistentní s JSON-LD a page metadata.
- Opraven cleanup timeoutů v rezervačním flow (`booking-flow`): `useEffect` při unmountu čte aktuální hodnoty `*.current` timeout refů místo hodnot zachycených při mountu, po `clearTimeout` je navíc nulují; tím se spolehlivě čistí i timeouty nastavené později během života komponenty.
- Opraveno přetékání dlouhých textů v admin detailu rezervace: success banner po `Přesunout termín`, auditní historie i souhrnové hodnoty typu e-mail/jméno se teď zalamují uvnitř karet místo horizontálního přesahu přes layout.
- Opraven pád admin stránky `Média webu` při nahrání většího obrázku: Next.js `Server Actions` teď mají zvýšený `bodySizeLimit` na `10mb`, takže uploady do aplikačního limitu `8 MB` neselhávají ještě před vlastní validací formuláře.
- Stabilizován veřejný self-service přesun rezervace: výběr dne a času teď skáče na cílové sekce přes sdílený offset vůči reálné sticky hlavičce a E2E helper před výběrem vzdálenějšího času otevře správný den v kalendáři, takže sloty nezůstávají mimo DOM, viewport nebo uprostřed smooth scroll animace.
- Veřejný booking rate-limit už nepočítá audit záznamy admin přihlášení ani veřejného ověření voucheru; E2E fixture navíc čistí krátké auditní rate-limit okno, aby opakované lokální browser běhy neblokovaly další scénáře.
- Zpevněny Playwright locatory veřejného booking flow: kontaktní pole se vyplňují přes aktuální textbox labely `E-mail`/`Telefon` a unknown-slug scénář si před kontrolou fixture služby otevře vlastní E2E kategorii.

## [0.3.11] - 2026-05-17

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.11`.
- Self-service přesun rezervace přes `/rezervace/sprava/[token]` už při nabídce dostupných termínů nepočítá právě spravovanou rezervaci jako cizí obsazenost, takže klientka může posunout termín na dřívější začátek v navazujícím volném bloku před původním začátkem.
- Admin detail rezervace používá pro drawer `Přesunout termín` stejný výpočet dostupnosti bez právě upravované rezervace, takže nabídne i 30min dřívější začátek, pokud ho spolu s původním slotem pokryje délka služby.
- Backend coverage validace přesunu je tolerantnější k původnímu `slotId`: pokud nový čas začíná v předchozím publikovaném segmentu a pokračuje přes aktuální slot rezervace, vyhodnotí celý souvislý řetězec místo chybného odmítnutí kotvy.

## [0.3.10] - 2026-05-16

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.10`.

## [0.3.9] - 2026-05-16

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.9`.
- Opraven React warning v admin správě kategorií (`CategoryManagementWorkspace`): optimistic update (`applyOptimistic`) se nyní spouští uvnitř `startTransition`, takže mutace `toggle`/`move` už nehlásí `An optimistic state update occurred outside a transition or action`.
- Sjednoceno mapování veřejných kategorií služeb mezi `/cenik`, `/sluzby` a `/rezervace` podle aktuálních DB dat (`ServiceCategory.name`), aby se stránky řídily stejným zdrojem pravdy.
- Ceník na `/cenik` nově řadí kategorie primárně podle katalogového `sortOrder` (stejně jako služby/rezervace), s fallbackem na `pricingSortOrder`.
- Do public pricing read modelu byla přidána runtime validace, která hlídá, že jedna služba není v ceníku zařazená ve více kategoriích; při porušení vrací explicitní chybu.

## [0.3.8] - 2026-05-14

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.8`.
- Ve veřejném rezervačním formuláři klik na den v kalendáři nově přesune fokus na sekci `Dostupné časy`, takže po výběru data uživatelka hned pokračuje na seznam časů bez ručního dohledávání níž na stránce.

## [0.3.7] - 2026-05-13

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.7`.

## [0.3.6] - 2026-05-13

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.6`.
- Ztišeno Prisma stderr logování v `NODE_ENV=test`: E2E a DB integrační testy už nevypisují zachycené retry konflikty jako `AvailabilitySlot_active_time_window_excl`, zatímco development dál loguje `warn`/`error` a production jen `error`.
- Opraven planner pro historicky zrušené rezervace: `CANCELLED` booking už znovu nebarví interval jako provozní překážku a při publish mutaci může z mřížky zmizet, aniž by se ztratila historie rezervace.
- Publikace konceptu týdne už při práci se slotem navázaným jen na `CANCELLED` booking nespadne na hlášce `Koncept týdne se teď nepodařilo publikovat.`; historický slot se bezpečně archivuje a query vrstva ho pak v planneru schová.
- Přidán regresní DB integrační test pro read/write chování planneru nad slotem se `CANCELLED` bookingem, aby se storno znovu nevrátilo mezi blokující nebo barevně matoucí intervaly.

## [0.3.5] - 2026-05-12

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.5`.
- Open Graph i Twitter náhled používají nový asset `public/brand/ppstudio-og-logo.png` ve formátu `1200x630`; stejný asset je nově i v JSON-LD `logo/image` (`BeautySalon`), zatímco původní `ppstudio-logo.png` zůstává pro ostatní UI použití.
- Aktualizován framework `next` z `16.2.4` na `16.2.6` a `eslint-config-next` z `16.2.4` na `16.2.6` (patch upgrade v rámci Next.js 16).
- Po upgradu závislostí byl ověřen produkční build (`npm run build`), lint (`npm run lint`) a testy (`npm test`); opakovaný běh testů skončil bez pádů (`# fail 0`).
- Aktualizovány balíčky `prisma`, `@prisma/client` a `@prisma/adapter-pg` z `7.7.0` na `7.8.0`.
- Po Prisma upgradu znovu ověřen průchod `prisma generate`, `npm run build`, `npm run lint` a `npm test` (`# fail 0`).

## [0.3.4] - 2026-05-12

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.4`.
- SEO/JSON-LD helpery nově používají kanonický origin `NEXT_PUBLIC_SITE_URL` (fallback `NEXT_PUBLIC_APP_URL`), takže `BreadcrumbList` i další structured data zůstávají produkčně kanonické i když CI/Playwright běží na `http://127.0.0.1:3100`.
- Opraven regresní test `src/features/public/components/seo-json-ld.test.ts`: test explicitně simuluje CI split (`NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100` + `NEXT_PUBLIC_SITE_URL=https://ppstudio.cz`) a dál ověřuje kanonické breadcrumb URL.

## [0.3.3] - 2026-05-12

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.3`.
- Detail služby `/sluzby/[slug]` má nově viditelnou drobečkovou navigaci, samostatný `BreadcrumbList` JSON-LD a jasnější sekundární odkaz zpět na přehled všech služeb.
- ESLint už ignoruje generovaný `coverage/` výstup, takže `npm run lint` nehlásí warningy z lokálních coverage reportů.
- Web Vitals reporting má nově samostatný env přepínač `NEXT_PUBLIC_WEB_VITALS_ENABLED` (default `true`), takže lze klientské měření zapnout/vypnout nezávisle na Matomo pageview trackingu.
- Opraven test discovery pro `npm test`: Node runner teď dostává quoted glob `src/**/*.test.ts`, takže se místo jednoho souboru opravdu spouští celá unit/integration sada a coverage už odpovídá reálnému pokrytí.
- Přidán coverage reporting nad business logikou přes `c8` a nový skript `npm run test:coverage`; generuje `coverage/` reporty ve formátech HTML, LCOV a `json-summary` pro booking, admin, voucher a e-mailové moduly.
- Doplněny unit testy pro rozhodovací logiku owner e-mail akcí rezervace (`resolveBookingEmailActionPageState`) a pro admin dashboard timeline routing/notes, aby byla lépe pokrytá business vrstva rezervací, e-mailů a admin provozu.
- README a provozní dokumentace byly rozšířeny o praktičtější onboarding: krokový setup projektu, doporučený deploy flow, základní SLA/monitoring minimum a ukázkový `.env` blok s vysvětlením hlavních proměnných.
- Opraveno mobilní tažení v admin planneru `Volné termíny`: výběr buněk při drag gestu nově funguje konzistentně pro `touch/pen` pointery a buňky mají `touch-action: none`, takže se při tažení nepřebíjí výběr nativním scroll gestem.
- Přehled `Nejbližší volné termíny` v admin dashboardu už u slotů se zbývající kapacitou `1` nezobrazuje redundantní text `kapacita 1`; metadata zůstávají jen jako `volno` a explicitní kapacita se ukáže až pro hodnoty `> 1`.
- Opraveno mobilní přetékání alertů v admin dashboardu (`Vyžaduje pozornost`): text se na úzkých viewports zalamuje místo ořezu mimo kartu a akční tlačítko se skládá pod text, takže blok zůstává čitelný bez horizontálního přesahu.
- Admin dashboard už nezobrazuje sekci `Vyžaduje pozornost`, pokud nejsou žádné actionable alerty; při čistém stavu se blok úplně skryje místo zobrazování neutrální informace.
- Dashboard `Vyžaduje pozornost` má rozšířenou sadu actionable alertů: upozornění na dnešní stav bez volného okna při aktivních rezervacích, na neuzavřené rezervace po konci termínu a na nízkou týdenní kapacitu (vysoká obsazenost + málo zbývajících slotů).

## [0.3.2] - 2026-05-11

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.2`.
- Stabilizován flaky Playwright scénář `inactive or non-public service slug is not preselected`: test už před ověřením fallback služby explicitně přepne na kategorii fallback fixture, takže nepadá na náhodném pořadí kategorií/služeb ve veřejném katalogu.
- Dokumentace byla srovnána s aktuálním stavem release workflow a dostupných skriptů: README nyní obsahuje i `email:previews` a `db:backfill-service-copy`, a README/MANUAL/DEVELOPMENT explicitně uvádí krok `db:check-migrations` v produkčním rolloutu.
- Opraven mobilní UX v admin sekci `Rezervace`: horní filtr panel už na mobilu není sticky, takže při scrollu nepřekrývá obsah seznamu; sticky chování zůstává od `md` breakpointu výš.
- Opraveno přetékání veřejného headeru na iPadu na výšku: desktop navigace a desktop CTA se nově zapínají až od `lg` breakpointu, zatímco `md`/tablet používá kompaktní mřížkové menu bez useknutého tlačítka.

## [0.3.1] - 2026-05-10

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.3.1`.
- Dokumentace prostředí nově upozorňuje, že identita konkrétního serveru patří do lokální `.env` / deploy konfigurace, protože verzovaná dokumentace se synchronizuje i na produkci.
- Veřejná rezervace podporuje marketingový query parametr `?service=<slug>` pro předvýběr služby z veřejného katalogu; neplatný, neaktivní nebo neveřejný slug se bezpečně ignoruje a detail služby vede na `/rezervace?service=<slug>`.

## [0.3.0] - 2026-05-10

- Release příprava pro produkční nasazení: projektová verze navýšena na minor `0.3.0`.
- Bezpečnostní hardening administrace: session se po ověření JWT znovu kontroluje proti aktuálnímu DB uživateli, neaktivní admin session zneplatní a změna role se projeví při další autorizaci.
- Bootstrap admin login přes `ADMIN_OWNER_*` / `ADMIN_STAFF_*` je nově výchozím nastavením vypnutý a vyžaduje explicitní recovery přepínač `ADMIN_BOOTSTRAP_ENABLED=true`.
- Owner approve/reject odkazy z provozního e-mailu už nemění stav rezervace bez aktivní admin session; audit změny se zapisuje jako admin uživatel, ne systémová tokenová akce.
- Přidány základní globální security headers a no-store/no-referrer hlavičky pro tokenové rezervace a kalendářové token route.
- Druhá bezpečnostní várka: self-service správa rezervace už nevytváří storno token při GET načtení stránky; token vzniká až po explicitním kliknutí na storno.
- Mazání přímých plateb rezervace nově zapisuje auditní stopu do `BookingStatusHistory` včetně `bookingId`, `paymentId`, částky, metody, admin uživatele a času smazání.
- Admin mutační API pro opětovné odeslání pozvánky kontroluje `Origin`/`Host` proti `NEXT_PUBLIC_APP_URL` a při nesouladu vrací `403`.
- E-mailové subject/from-name hodnoty mají centrální CRLF ochranu, `EMAIL_DELIVERY_MODE=log` maskuje příjemce a anonymizuje subject, a akviziční booking cookie dostává v produkci atribut `Secure`.
- Admin planner mutace (`copy week`, `publish draft`, `apply template`, `selection`) nově automaticky opakují serializable transakce při Prisma `P2034` / `TransactionWriteConflict`, takže paralelní CI a provozní souběhy už nevyhazují náhodné pády při `deleteMany()` nad `AvailabilitySlot`.
- Veřejné čtení služeb je odolnější proti krátkému závodu mezi více Prisma dotazy na službu a kategorii: pokud se při souběžném cleanupu dočasně vrátí `service.category = null`, homepage ani detail služby už nespadnou na `Cannot read properties of null (reading 'name')` a použijí bezpečný fallback štítek kategorie.
- Sitemap metadata route je nyní explicitně ISR (`revalidate = 86400`) v `src/app/sitemap.ts`, takže `sitemap.xml` se dynamicky průběžně obnovuje bez nutnosti ručního přegenerování při každé změně veřejných služeb.
- Opraven build fail `Invalid segment configuration export detected`: `src/app/sitemap.ts` už používá pro `revalidate` přímo číselný literál `86400` místo výrazu `60 * 60 * 24`, aby Next.js 16 správně aplikoval segment config při produkčním buildu.
- Stabilizován DB integrační test `booking-rescheduling.integration.test.ts`: seed slotů už negeneruje termíny z úzkého náhodného okna, ale z UUID-odvozeného rozptylu v rámci online booking window, takže při paralelním CI běhu nedochází k náhodným kolizím na DB constraintu `AvailabilitySlot_active_time_window_excl`.
- Stabilizován success feedback po publikaci admin planneru: klient si jednorázově přenese publish hlášku přes `sessionStorage` i po `router.refresh()`, takže E2E scénáře a obsluha už nenaráží na flaky zmizení textu `Změny týdne byly publikované do dostupností.` během rerenderu.

## [0.2.5] - 2026-05-09

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.2.5`.
- JSON-LD helpery pro veřejné SEO byly sjednoceny na `buildLocalBusinessJsonLd(...)`, `buildServiceJsonLd(...)` a `durationMinutesToIsoDuration(...)`; detail služby nově doplňuje ISO 8601 délku, provider PP Studio a testované čištění prázdných hodnot před serializací.
- Public/booking shell nově obsahuje malý `WebVitalsReporter`, který přes existující Matomo helper posílá anonymní Web Vitals eventy pouze při zapnuté Matomo konfiguraci.
- Tisková A4 varianta voucheru už nemá žluté okraje kolem horního slotu: horní a boční 3mm trim se uvnitř rozměru voucheru dorovnává hlavní béžovou plochou voucheru, plocha mimo voucher zůstává bílý A4 papír, ořezová čára je posunutá na novou spodní hranu 201 mm a obsah voucheru včetně QR, loga, textů, fontů i rozložení zůstává beze změny.
- Refaktor `voucher-print-a4-pdf-core`: layoutové hodnoty jsou sjednocené v `VOUCHER_PRINT_LAYOUT` a kreslení voucheru je rozdělené na menší sekce (`drawVoucherBaseFrame`, `drawVoucherHeader`, `drawVoucherMainValue`, `drawVoucherFooter`, `drawVoucherQrBlock`) pro snazší orientaci a bezpečnější úpravy bez změny výsledného vzhledu.
- `voucher-print-a4-pdf-core` nově podporuje definici barev ve formátu `#hex` i `rgb(...)` přes `VOUCHER_PRINT_THEME_INPUT`; interní helper je při generování převádí na `pdf-lib` barvy, takže ve VS Code funguje color picker přímo nad zdrojovou paletou.
- Barevná paleta voucheru má české inline poznámky k významu jednotlivých klíčů a doplněné stručné komentáře k důležitým částem (QR barvy, layout konstanta, normalizace barevných kanálů) pro rychlejší orientaci při úpravách.

## [0.2.4] - 2026-05-08

- Release příprava bez funkčních změn: projektová verze navýšena na patch `0.2.4`.
- Booking a voucher e-maily nově berou název, adresu, telefon a e-mail salonu z `SiteSettings` přes `getPublicSalonProfile()` / `getEmailBrandingSettings()`; pevné údaje PP Studia zůstávají jen jako fallback a mapový odkaz se skládá z aktuálního názvu a adresy.
- Klientské booking e-maily mají klidnější českou copy bez změny `templateKey`, payloadů, `EmailLog` modelu, workeru nebo pravidel `.ics` příloh; admin notifikace zůstává stručná a provozní.
- Reminder `booking-reminder-24h-v1` má lidštější headline `Zítra se na vás těšíme`, kratší praktický úvod a předmět `Zítra se na vás těšíme v PP Studiu`.
- Reminder `booking-reminder-24h-v1` nově používá stejný nenápadný linkový blok `Správa rezervace` jako ostatní klientské e-maily místo výrazných tlačítek.
- Reminder `booking-reminder-24h-v1` doplnil u místa nenápadný odkaz na `/kontakt#parkovani` s bezpečnými UTM parametry `utm_source=email`, `utm_medium=booking_reminder` a `utm_campaign=parking_info`.
- Přidán dev skript `npm run email:previews`, který generuje HTML náhledy booking/admin šablon do `tmp/email-previews` bez nové knihovny.
- Opraveno kopírování dne/týdne v admin planneru přes změnu letního/zimního času; dostupnost se nově přenáší podle lokálních půlhodinových buněk `Europe/Prague`, ne podle milisekundového posunu.
- Doplněny regresní testy pro zimní/letní salonové časy v planneru, veřejném booking flow, e-mailech a ICS přílohách.
- Přidán Playwright E2E scénář `tests/e2e/planner-dst.spec.ts`, který v UI klikací cestou ověřuje kopírování dne přes jarní/podzimní DST změnu a kopírování týdne přes DST se zachováním lokálních hodin 09:00-10:00 v `Europe/Prague`.
- Přidán veřejný monitoring endpoint `GET /api/health`, který vrací stav webu/DB, souhrn email workeru a fronty (`pending`, `retrying`, `processing`, `staleProcessing`, `failed`) plus `alerts`; při chybovém stavu endpoint odpovídá HTTP `503`.
- Stabilizován flaky Playwright scénář `client can reschedule a booking through a public token`: pokud fixture „success“ slot po očekávané runtime kolizi stále spadne na další kolizi (paralelní CI booking), test nyní automaticky zkouší další dostupné sloty, dokud nepotvrdí úspěšný přesun nebo nevypíše diagnostický stav formuláře.
- Stabilizovány Playwright admin smoke testy `owner can open the core backoffice sections` a `salon role can open the operational workspace but not owner-only sections`: oba scénáře mají explicitní timeout `90_000 ms`, protože sekvenčně ověřují více admin rout a v CI překračovaly výchozí limit `45_000 ms` bez funkční regrese.
- Hardened fallback výběr slotu v reschedule E2E scénáři: helper už nečeká tvrdě na `input[name="slotId"]` při mezistavech formuláře po kliknutí, ale při chybějícím/odpojeném inputu pokračuje dalším kandidátem a tím eliminuje timeouty `locator.inputValue`.

## [0.2.3] - 2026-05-08

- Release příprava pro produkční nasazení: projektová verze navýšena na patch `0.2.3`.
- Služby mají nová DB pole pro kompletní strukturovaný veřejný obsah (`seoTitle`, `idealFor`, `includes`, `benefits`, `goodToKnow`) a admin sekce `Služby` je umí vytvářet i upravovat bez zásahu do kódu.
- Veřejný web, ceník, detail služby, homepage a rezervační flow čtou službovou copy z DB; `service-copy-overrides.ts` zůstává jen jako dočasný zdroj pro backfill nových DB polí.
- Přibyl ruční bezpečný skript `npm run db:backfill-service-copy`, který po dry-runu a explicitním `--confirm` propíše podle stabilních slugů pouze nová strukturovaná pole služeb a SEO title.

## [0.2.2] - 2026-05-08

- Release příprava bez funkčních změn: projektová verze navýšena na patch `0.2.2` pro produkční nasazení.
- Veřejné rezervační flow nově u kolizí klientských kontaktů (`BOOKING_CONFLICT` ve kroku kontaktu) zobrazuje zákaznicky srozumitelnou hlášku bez interní instrukce `vyberte profil ručně`; detailní technický důvod kolize zůstává zachovaný v interním audit logu.
- Veřejné rezervační flow přesunulo chybovou hlášku kontaktu z horního progress panelu přímo do kroku `Kontaktní údaje` nad pole `E-mail` a `Telefon`, aby byla při opravě údajů viditelná bez návratu na začátek formuláře.
- Admin seznam služeb má zarovnaný stavový badge blok v kompaktních řádcích, takže volitelný štítek `Homepage` neposouvá `Aktivní` / `Veřejná` mezi jednotlivými službami.
- Služby mají nový ruční výběr pro homepage (`Zobrazit v doporučených službách` + `Pořadí na homepage`); úvodní stránka zobrazuje maximálně první tři aktivní veřejné vybrané služby a při prázdném výběru zachová katalogový fallback.
- Homepage už neoznačuje první tři katalogové položky jako `Nejoblíbenější služby`; sekce používá přesnější copy `Doporučené služby`.
- Admin seznam a detail rezervací nově jasně oddělují `Kanál rezervace` (`Web`, `Telefon`, `Instagram zpráva`, `Osobně`) od akvizičního původu (`Odkud přišla` z UTM/referreru jako `Google`, `Instagram`, `Firmy.cz / Seznam`, `Direct`). Seznam u webových rezervací zobrazuje vedle kanálu i akviziční štítek, aby `Instagram` z UTM nepůsobil jako samostatný ne-webový zdroj.

## [0.2.1] - 2026-05-07

- Admin sekce `Rezervace` nově odděluje proběhlé aktivní rezervace do horní sekce `K uzavření`: jakmile termín skončil a rezervace je pořád `Čeká` nebo `Potvrzená`, vystoupí nad běžný pracovní seznam, aby šla rychle označit jako hotová, zrušená nebo no-show.
- Telefon klientky z veřejné i ruční rezervace se nově server-side ukládá v jednotném mezinárodním tvaru bez mezer (`+420777123456`); česká 9místná čísla se doplní na `+420`, prefix `00` se převede na `+` a text/HTML vstup validace odmítne.

## [0.2.0] - 2026-05-07

- Admin detail rezervace v panelu `Úhrada` má kompaktnější souhrn: úprava ceny se otevírá přímo u položky `Cena k úhradě`, samostatný viditelný blok `Cena rezervace` zmizel z výchozího zobrazení, platby se nevypisují duplicitně mimo `Přehled úhrad` a prázdný voucher stav je spojený s akcí `+ Uplatnit voucher`.
- Detail rezervace v panelu `Úhrada` podporuje individuální cenu rezervace se zdůvodněním pro `OWNER` i `SALON`. Platební souhrn, hodnotový voucher doplatek i CRM souhrn počítají z finální ceny rezervace, zatímco službový voucher dál kryje konkrétní službu bez ohledu na individuální cenu a `BookingPayment` eviduje pouze skutečně přijaté platby mimo voucher.
- Admin layout má vlastní title `Administrace | PP Studio`, takže název záložky už nepřebírá veřejný marketingový titulek.

## [0.1.11] - 2026-05-07

- Release příprava bez funkčních změn: projektová verze navýšena na patch `0.1.11`.

## [0.1.10] - 2026-05-07

- README bylo aktualizované jako přesnější GitHub rozcestník: nově shrnuje aktuální stav voucherů, plateb, analytics a deploymentu a explicitně říká, že hlavní dokumentace žije v repozitáři (`MANUAL.md`, `docs/*`), ne v GitHub Wiki.
- Provozni hygiene zavislosti: z pracovního ZIP prenosu byla odstranena rozpracovana slozka `node_modules`; dokumentace nasazeni a zavislosti ted explicitne vyzaduje cisty serverovy install pres `npm ci` z `package-lock.json` a zakazuje pribalovat `node_modules` do repozitare/artefaktu.
- Opravena sanitizace akvizicni booking cookie: `landingPath` uz nepropusti scheme-relative URL a referrer hosty se neradi podle volneho substringu domeny.

## [0.1.9] - 2026-05-06

- CI workflow už po samostatném buildu spouští Playwright přímo přes `npx playwright test`, aby se E2E build neopakoval; timeout jobu byl navýšen pro rozšířenou testovací sadu.
- Rozšířena Playwright smoke kontrola technického SEO: veřejné stránky ověřují canonical/OG URL proti aktuálnímu originu a `robots.txt`/`sitemap.xml` hlídají kanonický sitemap origin bez staré `http://ppstudio.cz` varianty.
- Doplněn Playwright E2E scénář voucher lifecycle: owner vytvoří hodnotový voucher, ověří chráněné PDF a otevře předvyplněný panel pro ruční odeslání e-mailu.
- Doplněna integrační regrese admin planneru: publikace konceptu přes existující rezervaci zachová rezervovaný interval a znovu uloží jen okolní editovatelná volná okna.
- Doplněna Playwright smoke E2E vrstva pro hlavní veřejné stránky, detail služby, bezpečné chybové stavy utility rout, `robots.txt`/`sitemap.xml`, protected admin redirect a základní OWNER/SALON backoffice routy.
- Stabilizován E2E self-service přesun na půlnočních hranách: fixture label úspěšného slotu používá datum skutečného začátku náhradního termínu a seedované časy jsou kotvené do denního policy-safe okna, takže CI nekliká na stale slot se stejným textem.
- E2E booking fixture při paralelním běhu workerů vytváří availability sloty transakčně a při DB konfliktu `AvailabilitySlot_active_time_window_excl` zkusí další hashovaný časový kandidát, takže více speců už nespadne na překryvu seedovaných slotů.
- E2E assertion ruční rezervace počítá i s aktuální validační hláškou `Tento konkrétní čas už má klientka v systému rezervovaný.`, takže test dál ověřuje backend overlap validaci bez vazby na starší znění copy.

## [0.1.8] - 2026-05-05

- Přidán statický ověřovací soubor `seznam-wmt-cjKzOuv71FG0TOfkMT7WBqHwAXFWhvum.txt` pro Seznam Webmaster na kořen veřejného webu.
- Mobilní veřejný header zobrazuje všech šest veřejných sekcí jako čitelnou kompaktní mřížku `2 × 3`; primární `Rezervace` zůstává jako samostatné CTA a desktopová navigace dál používá plnou pill podobu.
- Rezervační stránka `/rezervace` má hlavní nadpis `Vyberte si termín, který vám nejlépe vyhovuje.` jako skutečné `h1`; vizuální podoba zůstala stejná, zlepšila se sémantika stránky pro přístupnost a SEO.
- Veřejné e-mailové odkazy přes `ObfuscatedEmailLink` už se nevykreslují jako `#`, ale rovnou jako funkční `mailto:` odkazy i v serverovém HTML; kontakt, footer i potvrzovací obrazovky tak otevírají e-mailového klienta bez závislosti na hydrataci.

## [0.1.7] - 2026-05-05

- Veřejný web má upravenou klientskou copy tak, aby mluvila za jednu provozovatelku salonu tam, kde to zní přirozeně; společné domlouvání služby s klientkou a studio jako místo zůstávají zachované.

## [0.1.6] - 2026-05-05

- Stabilizovány Playwright E2E booking scénáře pro CI:
  - fixture sloty se nově seedují dynamicky podle aktuálního booking policy okna (`bookingMinAdvanceHours` / `bookingMaxAdvanceDays` / `bookingCancellationHours`), aby self-service storno/přesun nekončil mimo povolené online okno,
  - testy už nevybírají sloty jen přes textový label a `.first()`, ale deterministicky ověřují očekávaný `slotId`, což odstraňuje flaky pády při více shodných časových tlačítkách.

## [0.1.5] - 2026-05-05

- Admin týdenní planner je odolnější při publikaci konceptu: klient i server nyní sanitizují intervaly draftu (ořez na rozsah mřížky `0..28`, odfiltrování prázdných úseků, sloučení překryvů) a tím brání falešnému pádu na hlášce `Koncept týdne už není platný` při mazání dostupnosti (např. 08:00-14:00).
- Publikace konceptu týdne už nepřebírá konfliktní hlášku z kopírování rozvrhu: při uložení konceptu server zachová rezervace a omezené intervaly z aktuální DB a běžnou dostupnost kolem nich bezpečně ořízne místo pádu na `Kopírovaný rozvrh zasahuje...`.
- Playwright E2E fixture pro booking flow nově rozkládá seedované termíny podle `runId` do širšího rozpětí budoucích dní a časů; self-service přesun tak v CI nekoliduje se stale aktivními E2E rezervacemi ze starších nedočištěných běhů.
- Admin sekce `Rezervace` má opravené mobilní zobrazení filtračního panelu: formulářové prvky se smršťují do šířky pracovní karty a nativní date inputy už neroztlačují layout mimo viewport.
- Veřejné ověření voucheru `/vouchery/overeni` má srozumitelnější QR úvod, upravenou hlášku platného poukazu a po úspěšném ověření jemné CTA na rezervaci nebo e-mail studiu; QR parametr `code`, server-side ověření a bezpečný read-only výstup zůstaly beze změny.
- Release příprava bez funkčních změn: ověřen průchod `npm run lint`, `npm run test` (190/190) a `npm run build`; projektová verze navýšena na patch `0.1.5`.

## [0.1.4] - 2026-05-04

- Release příprava bez funkčních změn: ověřen průchod `npm run lint`, `npm run test` (190/190) a `npm run build`; projektová verze navýšena na patch `0.1.4`.

## [0.1.3] - 2026-05-03

- `/studio` prošlo jemným density passem: desktopové a tabletové vertikální paddingy mezi hero, galerií, atmosférou, adresní kartou a spodním CTA jsou kratší bez změny textů, médií nebo struktury stránky.
- `/studio` nově renderuje jen publikované `SALON_PHOTO` assety, které mají fyzicky dostupný soubor ve storage; rozbité DB záznamy už nevedou k broken image placeholderům.
- `/studio` nyní používá první dostupnou fotku jako hero a další fotky (max 6) jako samostatnou galerii; pokud galerie data chybí, sekce se korektně skryje bez chybového boxu.
- `/studio` má jemně upravené texty hero, galerie, atmosféry, lokace a spodního CTA; galerie nově lépe rozkládá 1-6 navazujících fotek bez duplikace hero záběru.
- Studio fotografie bez DB alt textu používají bezpečný fallback `Fotografie prostoru PP Studio`.
- Ve `development` režimu má `/studio` fallback na lokální statické fotky z `public/dev/studio/*`, takže stránka zůstává laditelná i bez produkčních médií v DB.
- Admin upload v modulu `Média webu` nově na aktivním filtru předvybere stejný typ média, takže v tabu `Prostory` se fotky studia ukládají rovnou jako `SALON_PHOTO`.
- Media formuláře doplnily volitelné pole `Pořadí` nad existujícím `MediaAsset.sortOrder`; veřejné stránky po uploadu, editaci i publish/unpublish revalidují také `/studio` a `/kontakt`.
- `/kontakt` používá samostatný typ média `CONTACT_PHOTO` a při chybějící kontaktní fotce zobrazí placeholder místo fallbacku na fotku studia.
- Admin media selecty pro typ média používají stabilní hodnotu `CONTACT_PHOTO`, aby dev runtime nehlásil React warning o chybějícím `key` u option prvků po přidání nového typu.
- Media manager už v běžném UI nenabízí nepoužívané typy `PORTRAIT` (legacy) a `GENERAL`; veřejné portréty čtou jen cílené typy `PORTRAIT_HOME` a `PORTRAIT_ABOUT`.
- Stránka `/studio` je nově prolinkovaná z veřejného webu přes `mainNavigation` (`header` i sekce `Navigace` ve footeru).
- Veřejná route `/studio` je znovu publikovaná: `src/app/(public)/studio/page.tsx` už nevrací `notFound()`, ale načítá publikované fotky přes `getPublicStudioPhotos()` a renderuje `StudioPage`.
- Veřejná stránka `/o-mne` prošla evolučním density passem: hero, benefit karty, návaznost `Můj příběh` / `Můj přístup`, FOR LIFE & MADAGA blok a certifikace mají menší vertikální rozestupy a paddingy bez změny vizuální identity; copy příběhu je sebevědomější, `Rozvoj` je přejmenovaný na `Odbornost` a text FOR LIFE & MADAGA mluví víc jako benefit pro klientku.

## [0.1.2] - 2026-05-03

- Patch update CSS toolchain: `tailwindcss` a `@tailwindcss/postcss` byly zvednuty z `4.2.2` na `4.2.4` bez změny konfigurace nebo aplikační logiky.
- Celý `/admin/*` strom má nově explicitní `noindex,nofollow` přes App Router metadata v admin layoutu; `robots.txt` blokace adminu zůstává jako crawl ochrana.
- FAQ stránka doplnila konkrétní odpovědi k doporučené frekvenci kosmetiky, citlivosti úpravy obočí, výdrži barvení obočí, citlivé pleti a příchodu s make-upem.
- Pravý box hero sekce na `/faq` už neopakuje kontakt CTA; nově funguje jako informační karta `První návštěva` s jemným odkazem na příslušnou FAQ sekci.
- FAQ stránka má konkrétnější odpovědi pro rezervaci, první návštěvu a praktickou orientaci, nově pokrývá potvrzení rezervace, objednání bez přesného výběru služby, úpravu péče podle stavu pleti, dárkové vouchery, adresu studia a parkování přes `/kontakt#parkovani`.
- `/faq` nově generuje `FAQPage` JSON-LD ze stejného serverově renderovaného seznamu otázek jako viditelná stránka; accordion dál používá nativní `details/summary` a rychlá orientace má větší mobilní tap targety.
- JSON-LD `BeautySalon` už nepoužívá napevno zapsanou adresu bez diakritiky; `PostalAddress` a obsluhované město se skládají z veřejného profilu salonu / `SiteSettings`.
- JSON-LD detailu služby má sjednocené `areaServed` podle veřejného profilu salonu a české breadcrumb názvy `Domů` / `Služby`.
- JSON-LD pro veřejný web má lokálnější `BeautySalon` profil s `priceRange: "$$"`, popisem a `ReserveAction`; homepage dostala samostatný `WebPage` payload a detail služby doplňuje `url`/`inLanguage`, přičemž `Offer` vzniká jen z jasně číselné ceny.
- Dnešní dashboardový plán i rozšířená timeline nově ukazují u dnešních rezervací existující poznámky s původem `Klientka` / `Interně`, aby byly důležité informace vidět před návštěvou bez otevírání detailu rezervace.
- Detail klientky v historii návštěv nově rozlišuje poznámky rezervace podle původu (`Klientka` / `Interně`) a při vyplnění obou zobrazí obě místo dosavadního přebíjení `internalNote ?? clientNote`.
- Provozní admin e-mail `admin-booking-notification-v1` u nové čekající rezervace nově obsahuje `Poznámku od klientky`, pokud ji zákaznice ve veřejném formuláři nebo admin při ruční rezervaci vyplnil; klientské e-maily zůstávají bez této poznámky.
- Z repozitáře byly odstraněny dva omylem verzované jednorázové Prisma debug skripty `.tmp-check-2026-05-04.ts` a `.tmp-check-2026-05-07.ts`, které sloužily jen pro ruční kontrolu slotů a rezervací k pevným datům a nebyly součástí aplikace ani build pipeline.
- Detail emailu v admin sekci `Email logy` dostal stejný density pass jako hlavní přehled: nižší header, kratší copy, menší quick actions v jedné operativní liště, hustší souhrn, navázané entity místo vysokých karet používají kompaktní řádky a technické i error bloky jsou méně dominantní.
- Admin sekce `Email logy` prošla dalším density passem: horní KPI jsou nižší, health box má kratší copy, filtry drží na desktopu jeden kompaktní řádek, hlavní seznam emailů schoval placeholder tracking sloupce do jemného badge `Tracking připraven`, `Další pokus` ukazuje jen u `Čeká/Retry` a technický stav fronty je nově méně dominantní ve sbaleném debug bloku.
- Admin sekce `Email logy` nyní rozlišuje badge `Přijetí rezervace` pro šablonu `booking-confirmation-v1` a finální `Potvrzení rezervace` pro `booking-approved-v1`; filtr typů e-mailů má stejné dělení.
- Kontaktní stránka rozšířila spodní sekci `Parkování` z jednoho obecného odstavce na 4 kompaktní tipy (`Hradská`, `Gahurova`, `Sadová`, `Kongresové centrum Zlín`) s orientační cenou pro běžnou návštěvu 90-120 minut, docházkou, stručnou poznámkou a funkčním odkazem `Navigovat`; blok zůstal pod mapou a quick contact částí.
- Karta `Kongresové centrum Zlín` v parkování na `/kontakt` teď mluví přímo k nejčastějším návštěvám Po–Pá mezi 8:00–18:00: místo neurčitého rozpětí uvádí jako běžnou orientaci 70 Kč pro 90-120 minut ve všední den přes den.
- Kontaktní stránka má kompaktnější mapový náhled, odkazuje na konkrétní firemní profil v Google Maps a pod celou kontaktní mřížkou doplnila informaci o parkování v okolí Sadové ulice.
- Veřejné e-mailové kontakty jsou nově sjednocené na čitelný tvar s `@`; komponenta `ObfuscatedEmailLink` dál skládá skutečný `mailto:` až v klientu, ale už výchozím renderem ani kontaktní stránkou nemíchá `info(at)...` a `info@...`.
- Dokumentace byla srovnána s aktuálním stavem plateb, CRM a voucher operací: `DEVELOPMENT.md`, `MANUAL.md` a navazující ADR už nepopisují panel úhrady ani detail voucheru jako čistě read-only workflow.
- E2E fixture pro self-service přesun teď seeduje kolizní a úspěšný náhradní termín jako samostatné navazující published sloty a Playwright před druhým submittem čeká na shodu `slotId` i `newStartAt`; runtime kolize tak nemůže omylem zablokovat následný úspěšný submit ve stejném dlouhém slotu ani přes starý hidden `slotId`.
- Detail klientky v adminu a provozu prošel dalším density passem: CRM souhrn je nižší v jednom kompaktním řádku, historie návštěv nemá vysvětlující podnadpis ani placeholder poznámky, interní poznámka neduplikuje nápovědu a pravý přehled už neopakuje poslední/další termín.
- CRM metrika `Neuhrazeno` v detailu klientky už nezapočítává budoucí `PENDING`/`CONFIRMED` rezervace jako dluh; doplatek se sčítá jen z dokončených nebo minulých aktivních rezervací, zatímco `Uhrazeno` dál ukazuje skutečně evidované platby a voucherová čerpání.
- Detail klientky v adminu a provozu má nový kompaktní `CRM souhrn`: poslední dokončenou návštěvu, nejbližší aktivní budoucí termín, hodnotu dokončených služeb, uhrazeno, neuhrazeno a rozpad rezervací; platební část používá stejný `getBookingPaymentSummary(...)` helper jako detail rezervace včetně běžných plateb mimo voucher.
- Admin seznam `Klienti` nyní otevírá detail klientky kliknutím na celý řádek (desktop) i celou kartu (mobil), nejen přes samostatné tlačítko `Detail`.
- Detail rezervace v sekci `Úhrada` nově eviduje běžné platby mimo voucher (`Hotově`, `Kartou`, `Převodem / QR`, `Jiné`) přes nový model `BookingPayment`; souhrn počítá voucher i ručně zapsané platby a rozlišuje `Neuhrazeno / Částečně uhrazeno / Uhrazeno / Přeplaceno`.
- Booking transakční retry nově rozpoznává i Prisma 7 PG adapter `DriverAdapterError` s `TransactionWriteConflict`, takže CI ani produkční souběhy nekončí předčasně mimo existující retry smyčku.
- Admin výběr slotu v ruční rezervaci a přesunu rezervace má nově jednoznačné accessible labely s datumem i časovým rozsahem; E2E test prefillu klientky už proto nekliká na první shodný čas v předchozím dni.
- Opravené zobrazení draweru `Ruční rezervace`: při otevření z přehledu rezervací nebo z detailu klientky se panel nově renderuje přes React portal do `document.body`, takže už není ořezaný nebo vizuálně schovaný uvnitř hlavičky stránky.
- Detail klientky v adminu i provozu nově vede tlačítkem `Vytvořit rezervaci` na existující ruční booking flow `/admin/.../rezervace?create=1&clientId=...`; drawer se otevře s předvyplněnou klientkou pro `OWNER` i `SALON`, neplatný `clientId` zobrazí jemný fallback a booking validace dostupnosti/překryvů zůstávají beze změny.
- Playwright scénář `client can reschedule a booking through a public token` už po ověření konfliktu nevolí náhradní termín podle pořadí tlačítek; fixture nově exportuje explicitní label kolizního i úspěšného slotu a test přepíná na deterministický nekolizní čas stabilní v CI i lokálně.
- Kontaktní stránka nově používá v hero sekci reálnou publikovanou fotku interiéru studia jako pravý vizuál, s předepsaným `title` a detailním `alt` textem pro PP Studio ve Zlíně; render zůstal responzivní, nepřetéká mimo layout a na mobilu přirozeně padá pod text.
- Přidány dev helper skripty `clean`, `dev:clean` a `dev:webpack` pro rychlé řešení pádů Next.js 16 Turbopack cache (`Failed to restore task data`, chybějící `.sst` v `.next/dev/cache/turbopack`) bez ručního mazání adresářů.
- Admin sekce `Klienti` prošla CRM density refaktorem: nízká hlavička, provozní KPI `Klientů/Klientek celkem`, `Nové za 30 dní`, `Bez kontaktu`, `S poznámkou`, rychlé filtry `S rezervací`, `Bez rezervace`, `Bez kontaktu`, `S poznámkou`, `Nové za 30 dní` a kompaktní tabulkový seznam se zkrácenými kontakty.
- Admin sekce `Rezervace` prošla dalším provozním density refaktorem: vysoký hero nahradila nízká hlavička s CTA `Přidat rezervaci`, rychlé filtry a formulářové filtry se sloučily do jednoho pracovního panelu a pod ně přibyl tenký KPI strip `Čeká na potvrzení / Dnes / Tento týden / Bez kontaktu`.
- Admin sekce `Služby` dostala finální density pass běžného katalogu: KPI strip se zkrátil na `Veřejné služby / Kategorie / Interní / skryté / Vyžaduje kontrolu`, seznamová hlavička používá kratší copy, souhrnný řádek explicitně komunikuje skrytí systémových/testovacích položek a kategorie ukazují kompaktní provozní počty.
- Řádky služeb v admin katalogu jsou nově nižší a jednořádkové na desktopu: základ drží název, délku, cenu, rezervace, badge `Aktivní/Neaktivní`, badge `Veřejná/Interní` a menu `⋯`, zatímco sekundární kontext zůstává až v rozbalení.
- Horní část admin katalogu `Služby` při posledním polish kroku odstranila duplicitní texty a CTA: tlačítko `Nová služba` je už jen jednou v page headeru, `Rychlá správa katalogu` zmizela z toolbaru, legenda stavů se přesunula do malého rozbalovacího prvku a stav běžného katalogu se komunikuje jen přes kompaktní pills.
- Pracovní seznam rezervací se nově serverově seskupuje do `Čeká na potvrzení / Nadcházející / Minulé`, čekající rezervace jsou vždy nahoře, mají jemný levý akcent a desktopová tabulka je kompaktnější se sloupci `Rezervace / Termín / Status / Zdroj / Kontakt / Akce`.
- Text pro chybějící kontakt je v seznamu rezervací zjemněný na `bez kontaktu`; empty state teď používá jednotné hlášení `Nenalezeny žádné rezervace.` se zkratkou na zrušení filtrů nebo ruční přidání rezervace.
- Admin planner už nepovažuje `CANCELLED` booking za blokaci běžné dostupnosti; plain published slot bez aktivní nebo dokončené návštěvy zůstane editovatelný místo falešného `Omezené`.
- Přidán provozní helper `scripts/repair-legacy-chained-slots.mjs`, který v dry-runu vyhledá staré plain published anchor sloty po dřívějším contiguous chainingu a umí bezpečně rozseknout jen jednoduché případy s jedinou navázanou rezervací; složitější případy nechává ve `skipped` výstupu pro ruční kontrolu.
- Opraven edge case mezi contiguous slot chainingem a admin plannerem: když nová rezervace nebo přesun použije navazující publikované sloty, booking engine teď správně rozseká i krajní coverage segmenty, takže volný zbytek na začátku nebo konci řetězce zůstane v planneru jako běžná dostupnost místo falešného `Omezené`.
- Admin planner `Volné termíny / Týdenní plán dostupností` prošel UX density passem bez změny business logiky: horní hero je nově nízká hlavička s krátkou nápovědou, datum týdne se zobrazuje už jen jednou v toolbaru, hlavní lišta je hustší a pravý panel se sloučil do tří kompaktních karet `Inspektor dne / Akce dne / Detail výběru`.
- Legenda stavů v planneru už není samostatná výrazná karta; přesunula se do rozbalovací sekce v `Detailu výběru` a používá menší badge, aby hlavní pozornost zůstala na gridu.
- Týdenní grid dostupností má čitelnější časovou osu: celé hodiny mají výraznější horizontální rytmus, časové štítky vlevo vyšší kontrast a vybraný den i blok jsou v tmavém premium adminu jasněji zvýrazněné bez zahlcení textem.
- Admin seznam voucherů je zhuštěný do provoznější evidence: velká hero karta se změnila na nízkou stránkovou hlavičku s CTA `Nový voucher` vpravo, horní statistiky jsou v nízkém čtyřsloupcovém stripu, filtry jsou na desktopu v jednom řádku a desktopový hlavní obsah tvoří kompaktní tabulka se sloupci `Kód / Typ / Voucher / Čerpání a zůstatek / Stav / Platnost / Akce`.
- KPI pás voucherů je nově provoznější: místo čistých stavových počtů ukazuje `Zbývá k uplatnění`, `Otevřené vouchery`, `Brzy expirují` a `Uzavřené`; souhrn zbývající práce sčítá jen otevřené hodnotové zůstatky a počet otevřených službových voucherů.
- Stavové badge voucherů už jsou ukotvené přímo ve sloupci `Stav`, nepoužívají přehnaný uppercase tracking a `Propadlý` má samostatný varovný tón; mobil dál přechází do kompaktních karet se stejnou informační prioritou.
- Admin detail voucheru je přepracovaný do kompaktnějšího provozního layoutu: horní summary karta nově soustředí kód, typ, stav, platnost, čerpání a akce `Stáhnout PDF / Tisk A4 / Poslat e-mailem`, karty `Detaily` + `Hodnota / služba` se sloučily do `Parametry voucheru` a blok `Kupující + odeslání` sjednotil kontakt, disabled stavy i ruční potvrzení e-mailu.
- Sekce `Poslední e-mailové pokusy` a `Historie uplatnění` jsou nižší a méně roztahané; empty states zůstávají krátké a detail voucheru už nezobrazuje přetrvávající text `Rendering...` po načtení.
- Opraveny TypeScript test typy mimo dashboard: `voucher-domain.integration.test.ts` nyní předává kompletní voucher metadata (`purchaserName`, `recipientName`, `message`, `internalNote`) a `note` při redeem voláních, `templates.test.ts` bezpečně převádí obsah přílohy na string a `request-origin.test.ts` nastavuje `NODE_ENV` bez zápisu do readonly env property.
- Admin dashboard `Přehled` je zjednodušený na kompaktní denní provozní cockpit: vysoký hero nahradila nízká operační lišta, alerty a KPI jsou zhuštěné do stripů, dnešní plán má nižší řádky, rychlé akce jsou v 2x2 gridu a analytika zůstává defaultně zavřená.
- Admin detail klientky má kompaktnější vizuální hustotu: menší hlavičku, nižší KPI karty, zhuštěné pravé karty, kratší řádky historie a nižší formulář interní poznámky.
- Admin detail klientky už nebere `Poslední návštěvu` z aktivity profilu při vytvoření rezervace; nově ji odvozuje jen z dokončených rezervací, takže klientka s budoucím nebo zatím neuzavřeným termínem nefiguruje jako návštěva.
- Admin detail klientky je zkrácený na provozní CRM obrazovku: nahoře má jméno, stav, poslední/další návštěvu a rychlé akce, KPI už neopakují nejčastější službu jako velkou kartu a hlavní obsah je rozdělený na historii návštěv, interní poznámku, kontakt, přehled klientky a tlumená profilová metadata.
- Admin dashboard v dnešní timeline zobrazuje dokončené dnešní rezervace jako `Hotovo` a nevytváří z minulých úseků falešná volná okna po označení služby za hotovou.
- Admin sekce `Volné termíny` nově zobrazuje dokončené rezervace v denním planneru jako tlumené cyan `Hotovo`, aby historicky obsazený čas nevypadal jako nejasné technické omezení ani jako zelená dostupnost.
- Inspektor výběru v gridu `Volné termíny` rozlišuje dokončenou rezervaci a místo obecného textu o rezervovaném čase vysvětluje, že jde o historickou hotovou návštěvu.
- Admin rezervaci lze nově označit jako `Hotovo` až po skončení naplánovaného termínu; budoucí potvrzená rezervace tak omylem nepřestane blokovat kapacitu a dashboard ji nezačne ukazovat jako volné okno.
- `deploy/release.sh` nově fail-fast kontroluje, že jsou na serveru nainstalované systemd units `ppstudio-web.service` a `ppstudio-email-worker.service`, a zároveň blokuje rollout při běžících legacy PM2 procesech `ppstudio-web` / `ppstudio-email-worker`; při driftu vypíše konkrétní převod na čistý systemd provoz místo pádu až po buildu při restartu nebo port konfliktu.
- Admin login/logout redirecty nově ignorují nedůvěryhodné `x-forwarded-host` / request host hodnoty a při neznámém hostu používají kanonické `NEXT_PUBLIC_APP_URL`, aby reverse proxy hlavička nemohla změnit cílový origin přesměrování.
- Stabilizován flaky Playwright krok u self-service přesunu termínu: čekání na success heading má delší timeout a při selhání test vypíše konkrétní poslední stav formuláře (konflikt, validační chyba, obecná chyba), takže CI pád je rychleji diagnostikovatelný.
- Přidán produkční rollout helper `deploy/release.sh`, který sjednocuje bezpečný deploy flow (`git pull --ff-only`, `npm ci`, Prisma generate + migrate deploy, lint/build, restart `ppstudio-web` a `ppstudio-email-worker`) a má guardy pro větev, dirty working tree a interaktivní potvrzení.
- Zavedena jednotná politika verzování (SemVer) pro `package.json`: jasná pravidla pro `PATCH`/`MINOR`/`MAJOR`, povinná vazba na `CHANGELOG.md` a release commit s atomickou změnou verze i release poznámek.
- Homepage public shell má menší klientský bundle: `SiteHeader` je znovu server komponenta bez `TrackedLink` hydratační vrstvy, footer používá jen `ObfuscatedEmailLink` bez Matomo CTA wrapperů a Matomo skripty se načítají přes `lazyOnload` místo `afterInteractive`.
- Ve veřejném rezervačním flow je lehčí scroll navádění po výběru kategorie služby: `service-step` už při výpočtu cílové pozice nečte geometrii sticky headeru z DOM, ale používá stabilní breakpoint offsety, což snižuje riziko vynuceného reflow.
- Homepage hero upravuje LCP prioritu: logo používá `next/image` `preload`, portrait už není prioritní a stín loga je jemnější, aby se zkrátilo render delay hlavního prvku.
- Admin přihlášení má civilnější netechnické copy, neutrální e-mailový placeholder a výraznější `focus-visible` stav pro klávesnicové ovládání.
- Homepage SEO title drží lokální hledací frázi `Kosmetický salon Zlín`, aby technické SEO opravy nezhoršily dosavadní Google snippet.
- Opraveno technické SEO veřejných stránek: per-page metadata teď nastavují vlastní canonical URL, OpenGraph URL a Twitter metadata, root layout už nenutí canonical homepage na všechny podstránky.
- Přidána JSON-LD strukturovaná data pro salon (`BeautySalon`/`WebSite`) a detail služby (`Service`/`BreadcrumbList`); veřejné noindex ověření voucheru už není blokované v `robots.txt`, aby si robot mohl přečíst `noindex`.
- Veřejný katalog služeb a sitemap nově vynechávají aktivní/bookable služby bez veřejného obsahu, takže se do indexovatelných URL nedostanou technické nebo rozpracované záznamy.
- Stabilizován Playwright scénář self-service přesunu po runtime kolizi: test po výběru náhradního slotu čeká na potvrzený `aria-pressed` stav i změnu hidden `newStartAt`, takže v CI neposílá omylem původní kolidující termín.
- Admin dashboard widget `Návštěvnost → rezervace` je přepracovaný na poctivější denní business přehled: KPI rezervací teď používá stejný event `Rezervace / Vytvořena` jako funnel, zdroje jsou označené jako návštěvní zdroje s odhadem rezervací a funnel ukazuje procenta mezi kroky.
- Mobilní admin planner `/admin/volne-terminy` už po výběru buňky správně přepíná dny, ukazuje všech 7 dní týdne bez schovaného horizontálního posunu, nemá horizontální scroll v editoru dne, buňky mají větší dotykovou plochu a čitelné accessible labely s časem a stavem.
- Admin detail rezervace už při načítání reschedule slotů nepočítá celý veřejný katalog služeb: `getAdminBookingDetailData` nově volá `getPublicBookingCatalog({ includeServices: false })`, takže detail nepadá na cizí nekonzistenci v mapování `service.category.name` mimo svůj use-case.
- Voucher mutace už nejsou exportované z `"use server"` doménového modulu: tvorba/validace/uplatnění se přesunuly do `src/features/vouchers/lib/voucher-management.ts` a veřejně volatelné server actions zůstávají jen v admin wrappers s explicitní autorizací.
- Voucher PDF testy používají explicitní testovací `SiteSettings`, takže už nespouští zbytečný Prisma fallback dotaz na `SiteSettings` a nebublají falešné `prisma:error` logy.
- Přidána samostatná tisková A4 varianta voucher PDF: nový `generateVoucherPrintA4Pdf(...)` generuje A4 na výšku s jedním otočeným DL voucherem v horním slotu, admin detail má nový odkaz `Tisk A4` a původní e-mailový/běžný `generateVoucherPdf(...)` zůstal beze změny.
- Rozděleno generování voucher PDF na worker-safe core `src/features/vouchers/lib/voucher-pdf-core.ts` a Next.js wrapper `src/features/vouchers/lib/voucher-pdf.ts`; email worker už importuje core přímo a nepadá na `server-only`.
- V detailu voucheru je nová read-only sekce `Odeslání e-mailem`, která z `EmailLog` typu `VOUCHER_SENT` ukazuje poslední stav, příjemce a stručnou historii posledních 5 pokusů včetně bezpečně zkrácené chyby.
- V admin detailu voucheru (`/admin/vouchery/[voucherId]` a `/admin/provoz/vouchery/[voucherId]`) pribyla rucni akce `Poslat e-mailem`: obsluha muze otevrit panel, upravit prijemce/predmet a explicitne odeslat voucher pouze manualnim potvrzenim; telo e-mailu je pevne podle schvalene sablony.
- Odeslani voucheru pouziva existujici email outbox/worker workflow pres `EmailLog` s novym typem `EmailLogType.VOUCHER_SENT` a sablonou `voucher-sent-v1`; v `EMAIL_DELIVERY_MODE=background` se zapisuje do fronty s retry, v `log` modu se bez SMTP odeslani zaloguje jako odeslane.
- Voucher email obsahuje bezpecna data (typ, hodnota nebo sluzba, kod, platnost, overovaci URL, instrukce) a pripojuje PDF vygenerovane server-side pres existujici `generateVoucherPdf(...)` helper jako prilohu `voucher-KOD.pdf` (`application/pdf`) bez interni poznamky a bez historie cerpani.
- Opraven kontakt ve voucher PDF pro CI/runtime hosty: textová doména už nebere slepě `NEXT_PUBLIC_APP_URL` hostname. Nově má prioritu `VOUCHER_PUBLIC_DOMAIN` -> `NEXT_PUBLIC_SITE_DOMAIN` -> bezpečný veřejný hostname z `NEXT_PUBLIC_APP_URL`; localhost/privátní IP se do kontaktu nevypisují.
- Veřejné ověření voucheru `/vouchery/overeni` je nově chráněné server-side rate limitem podle IP hashe (okno 10 minut, limit 10 pokusů), zapisuje auditní stopu do `BookingSubmissionLog` s prefixem `PUBLIC_VOUCHER_VERIFY_*` a při překročení vrací bezpečnou hlášku bez prozrazení detailu.
- Stabilizováno veřejné vytvoření rezervace při souběžném DB provozu: retry pro serializační konflikt Prisma `P2034` byl navýšen z `3` na `5` pokusů a mezi pokusy je krátký lineární backoff, aby CI i produkční provoz méně padaly na náhodný write/deadlock konflikt.
- Finální polish layoutu PDF voucheru: horní blok logo/subtitle je bez překryvů, nadpis `Dárkový poukaz` začíná až pod brand blokem s větším odsazením, QR a kontaktní patička mají čistší rozestupy a dlouhé názvy služeb se bezpečně zalamují bez kolize s QR sloupcem.
- PDF voucher má samostatně nastavitelné logo přes existující Média webu: `SiteSettings.voucherPdfLogoMediaId` odkazuje na `MediaAsset`, PDF čte jen lokální PNG/JPEG soubor a při chybějícím nebo nepodporovaném logu použije textové `PP Studio`.
- PDF voucher má upravený dárkový layout s kontakty salonu ze `SiteSettings`, QR ověřením a typově správnými podmínkami: hodnotový poukaz zobrazuje postupné čerpání, službový poukaz jen pravidlo pro uvedenou službu.
- PDF voucher už nezobrazuje jméno kupujícího; výstup obsahuje jen kód, typ, hodnotu/službu, platnost, QR ověření a podmínky.
- Admin voucher UI se teď soustředí na evidenci kupujícího: create formulář i detail schovávají obdarovaného a věnování, zatímco doménová vrstva zůstává beze změny.
- Admin detail voucheru je teď kompaktnější: nahoře je jedna summary karta s kódem, stavem, typem, hodnotou nebo službou, platností, čerpáním a akcemi, duplicitní metriky zmizely a historie uplatnění je čitelnější na mobilu i desktopu.
- Admin evidence voucherů má teď čitelnější seznam: create CTA je v hlavičce nad filtry, spacing filtrů je vzdušnější a na menších šířkách se místo široké tabulky používají kompaktní voucher karty.
- Detail rezervace v adminu už u intended voucheru nepoužívá CTA `Uplatnit tento voucher` jako anchor skok na formulář níž na stránce. Formulář je nově vložený přímo do karty voucheru, takže obsluha zůstává ve stejném kontextu a klik nevyvolá jen nečekaný scroll.
- Panel `Úhrada` v admin detailu rezervace má další UX polish: horní souhrn je teď kompaktní receipt-like blok s badge stavem úhrady, doplatek je nejsilnější vizuální prvek, dárkový poukaz je civilnější a historie úhrad je zkrácená na provozní řádky.
- Panel `Voucher` v admin detailu rezervace byl v mezikroku přejmenovaný na panel `Úhrada`: nahoře počítal cenu služby, úhradu voucherem, zbývající doplatek a stav `Neuhrazeno / Částečně uhrazeno / Uhrazeno` čistě z existujícího `VoucherRedemption`; novější změny ho rozšířily i o běžné platby mimo voucher.
- Admin read model rezervace nově vrací `paymentSummary`; cenu bere ze snapshotu rezervace, fallbackově z aktuální ceny služby, voucherovou úhradu sčítá z `VoucherRedemption.amountCzk` a při neznámé ceně zobrazuje `Cena není nastavena` bez označení rezervace jako uhrazené.
- Success hláška po uplatnění hodnotového voucheru nově upozorní na částečnou úhradu: pokud voucher pokryje méně než zadanou částku, zobrazí uplatněnou částku i zbývající doplatek mimo voucher.
- Admin uplatnění hodnotového voucheru už při ručním zadání kódu neblokuje rezervaci s dražší službou než zůstatek voucheru; pokud zadaná částka převyšuje zůstatek, automaticky se uplatní dostupná zbývající hodnota voucheru.
- Admin uplatnění hodnotového voucheru má srozumitelnější chování při dražší službě než zůstatek voucheru: formulář u intended voucheru vysvětlí částečnou úhradu a serverová hláška říká, že se má zadat maximálně zbývající hodnota voucheru.
- Admin uplatnění voucheru nově blokuje druhý voucher na stejné rezervaci. Jakmile má rezervace zapsaný `VoucherRedemption`, další pokus vrátí bezpečnou hlášku, že voucher už je na rezervaci uplatněný.
- Opraveno uplatnění voucheru v admin detailu rezervace: pole `Částka k uplatnění` už nepoužívá `step=50` s `min=1` (kombinace blokovala běžné částky jako `1200` nativní browser hláškou „zadejte platnou hodnotu“); nově přijímá celé Kč po 1.
- Přidána veřejná noindex stránka `/vouchery/overeni?code=...` pro bezpečné ověření voucheru z QR kódu v PDF; zobrazuje jen kód, typ, zbývající hodnotu u hodnotového poukazu, službu u službového poukazu a platnost bez kupujícího, interních poznámek, technických ID nebo historie čerpání.
- Veřejné ověření voucheru má vlastní serverový helper `verifyVoucherPublic(...)`, který normalizuje kód, vrací bezpečné důvody neplatnosti a nikdy nevytváří `VoucherRedemption`, nemění zůstatek ani status voucheru.
- Opraveno HTML ověření částky při tvorbě hodnotového voucheru; běžné celé částky jako `1500` už prohlížeč neblokuje kvůli kroku číselného pole.
- Admin detail voucheru nově nabízí stažení PDF dárkového poukazu přes chráněné routy `/admin/vouchery/[voucherId]/pdf` a `/admin/provoz/vouchery/[voucherId]/pdf`. PDF se generuje server-side z aktuálních dat, obsahuje bezpečná veřejná pole a QR kód pro budoucí ověření voucheru.
- Veřejné booking flow nově přijímá volitelný kód dárkového poukazu v kontaktním kroku. Server kód při vytvoření rezervace bezpečně ověří, uloží pouze `Booking.intendedVoucherId`, `intendedVoucherCodeSnapshot` a `intendedVoucherValidatedAt` a skutečné uplatnění nechává dál výhradně na admin detailu rezervace.
- Hodnotové vouchery ve veřejné rezervaci zůstávají validní i při zůstatku nižším než cena služby, pokud je zůstatek kladný; veřejný flow nikdy nevytváří `VoucherRedemption`, nemění `remainingValueCzk` ani status voucheru.
- Formulář pro vytvoření voucheru je přepracovaný do kompaktnějšího dvousloupcového workspace s živým náhledem, výraznější volbou typu, kratšími sekcemi a podporou obdarovaného a věnování.
- Opraveny statické voucher routy `/admin/vouchery/*` a `/admin/provoz/vouchery/*`, které nově používají stejný tmavý admin shell jako ostatní administrace; create formulář má navíc pevnější tmavé povrchy a čitelnější inputy.
- Admin detail rezervace nově obsahuje panel `Voucher` pro OWNER i SALON: ukazuje intended voucher z rezervace, umožňuje ručně zadat jiný kód, uplatnit hodnotový nebo službový voucher přes server action a zobrazit historii všech `VoucherRedemption` záznamů u rezervace bez storna čerpání.
- Přidána tvorba voucheru v adminu pro OWNER i SALON na `/admin/vouchery/novy` a `/admin/provoz/vouchery/novy`: sdílený formulář umí hodnotový poukaz i poukaz na aktivní službu, ukládá volitelné údaje kupujícího a interní poznámku, serverově validuje vstup a po vytvoření přesměruje na detail voucheru.
- Přidán první read-only admin detail voucheru pro OWNER i SALON na `/admin/vouchery/[voucherId]` a `/admin/provoz/vouchery/[voucherId]`: zobrazuje kód, typ, efektivní stav, platnosti, kupujícího/obdarovaného, hodnotu nebo snapshot služby, historii uplatnění a interní poznámku; novější změny ho rozšířily o PDF, e-mail, provozní editaci a zrušení.
- Přidána admin sekce `Vouchery` pro OWNER i SALON na `/admin/vouchery` a `/admin/provoz/vouchery`: seznam podporuje hledání přes `q`, filtr typu a efektivní filtr stavu včetně aplikačně počítané expirace.
- Voucher read model nově vrací formátovaný zůstatek a při filtrování stavu používá efektivní `EXPIRED` pravidlo místo samotného DB statusu.
- Přidána serverová doménová vrstva voucher systému bez UI: generování a normalizace kódů, české formátování stavů, Zod schémata, vytvoření hodnotového i službového voucheru, bezpečná public validace, transakční admin čerpání a základní read modely.
- Voucher čerpání hodnotových poukazů nyní chrání zůstatek row lockem a podmíněným update; službové poukazy ukládají redemption snapshot služby a po uplatnění přechází do stavu `REDEEMED`.
- Přibyla integrační doménová coverage pro voucher normalizaci, tvorbu, public validaci a admin redemption scénáře.
- Přidán databázový základ voucher systému: Prisma enumy `VoucherType` / `VoucherStatus`, modely `Voucher` a `VoucherRedemption`, intent pole na `Booking` a vztahy na `Service` a `AdminUser`; veřejné booking UI, admin UI a PDF zatím zůstávají mimo rozsah.
- Opraven `sitemap.xml`: `lastModified` už nepoužívá jednotné aktuální datum pro všechny URL. Detail služby nyní bere `Service.updatedAt`, zatímco statické stránky mají stabilní datum poslední obsahové revize; přehledové stránky `/sluzby` a `/cenik` se navíc aktualizují podle nejnovější změny ve službách.
- Sjednoceny fallback kontakty a globální SEO popis: `siteConfig`, veřejný content, `SiteSettings` fallback i e-mailová vrstva už nepoužívají placeholder `+420 777 000 000` / `hello@ppstudio.cz`, ale skutečné údaje PP Studia ve Zlíně.
- Admin `src/proxy.ts` uz nepropousti `/admin/*` jen podle existence cookie: nove overuje podpis a expiraci session JWT, neplatnou cookie aktivne smaze a presmeruje na login.
- Stabilizovan E2E scenar self-service presunu terminu: Playwright test ma sirsi timeout jen pro tento krok a owner Pushover HTTP volani je ted omezene 3s timeoutem, aby pomale externi notifikace zbytecne nedrzely booking flow.
- Opraven crash loop `ppstudio-email-worker`: Pushover implementace je oddelena do worker-safe modulu a Next.js `server-only` wrapper zustava jen pro app/runtime importy, takže PM2 worker uz pri startu nepada na nacitani `server-only`.
- Ruční rezervace v adminu už nevyžaduje e-mail klientky; nové klientky lze založit i jen se jménem a telefonem a potvrzovací e-mail se při chybějící adrese bezpečně přeskočí.
- Veřejná hláška v rezervacích pro stav bez volných termínů už nepoužívá interní admin wording; místo technické formulace vysvětluje zákaznici jednoduše, že nové termíny přibývají průběžně.
- Přidána runtime závislost `server-only` a Node test runner teď před testy registruje cílený `--import ./src/test/register-server-only.mjs` hook, takže CI korektně načte server-only moduly i mimo Next bundler bez rozbití ostatních Next route testů.
- OWNER ma v `/admin/nastaveni` novy blok `Pushover notifikace`: uklada se per-user `UserNotificationSettings`, podporuje server-only `PUSHOVER_ENABLED` / `PUSHOVER_APP_TOKEN`, testovaci notifikaci, volitelne event typy pro rezervace/system a bezpecne Pushover odesilani s 30s in-memory rate limitem bez dopadu na booking, email ani reminder flow.
- Opraven self-service přesun termínu přes `/rezervace/sprava/[token]`: úspěšná server action už nerevaliduje aktuálně otevřenou veřejnou route, takže v Next.js 16 nezmizí potvrzovací heading kvůli route refreshi a E2E test zůstává stabilní.
- Přidána ochrana proti version skew u Next.js Server Actions: `next.config.ts` teď čte `deploymentId` z `NEXT_DEPLOYMENT_ID` nebo fallbacku `DEPLOYMENT_VERSION` / `GIT_HASH`, aby klient po deploy mismatch raději provedl hard reload místo pádu na `Failed to find Server Action`.
- `deploy/release.sh` teď před buildem načítá `.env`, vynucuje validní `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` a automaticky exportuje `NEXT_DEPLOYMENT_ID` / `DEPLOYMENT_VERSION` / `GIT_HASH` z aktuálního commitu, takže produkční release drží konzistentní Next.js Server Actions bez ručního nastavování deployment ID.
- Přibyl bezpečný CLI cleanup `npm run db:clear-booking-data`, který v dry-run režimu vypisuje počty booking/slot dat a s `-- --confirm` smaže testovací rezervace, termíny a navázané logy bez zásahu do služeb, admin účtů, settings nebo médií.
- Analytics endpoint a widget teď rozlišují stav Matomo reportingu `ok / disabled / blocked / error`, takže dashboard při zamčeném nebo neplatném API tokenu neukazuje jen tiché nuly; přibyl i CLI check `npm run analytics:check`.
- Matomo analytics pro admin dashboard nově vrací `sources` pole pro návštěvní zdroje; backend čte `Referrers.getCampaigns`, fallbackově mapuje `Referrers.getReferrerType` na business názvy a orientačně rozděluje dokončené rezervace podle podílu návštěv zdroje.
- Admin dashboard `Přehled` nově obsahuje sekundární widget `Návštěvnost → rezervace` vložený až pod hlavní provozní bloky; načítá `/api/admin/analytics`, drží kompaktní KPI + funnel layout a umí stavy `loading / error / disabled`.
- Přibyl klientský admin widget `AnalyticsWidget`, který načítá `/api/admin/analytics` a v kompaktní kartě ukazuje KPI `Návštěvy / Rezervace / Konverze %`, top source a jednoduchý vertikální funnel bez grafů.
- Přibyl admin-protected endpoint `/api/admin/analytics`, který vrací server-side Matomo dashboard agregaci jako JSON s `revalidate = 300`; při interní chybě vrací bezpečný nulový fallback bez tokenu a bez PII.
- Veřejný booking katalog nově skládá navazující kompatibilní publikované sloty do delších souvislých oken, takže služby s delší délkou (např. 120 min) umí nabídnout termín i přes více po sobě jdoucích slotů místo čekání na jeden ručně vytvořený dlouhý blok.
- Generátor časů v booking flow, self-service přesunu i admin výběru termínu nově kotví každou nabídnutou hodinu na skutečný podkladový segment, takže backend bezpečně pozná správný `slotId` i uvnitř sloučeného okna.
- Backend vytvoření rezervace a přesunu termínu nově validuje souvislý řetězec publikovaných slotů bez mezer a konfliktů; kapacitu počítá přes všechny pokryté segmenty a zachovává původní chybu `slot je moc krátký`, pokud zvolený segment na délku služby nestačí.
- Server-side Matomo Reporting API vrstva v `src/lib/analytics/matomo.ts` nově umí pro dashboard načíst návštěvy, goals, booking event funnel a referrery přes bezpečný server-only token s 300s revalidací a nulovými fallbacky.
- Veřejné copy storno pravidla na homepage a ve FAQ je klidnější a srozumitelnější: původní technický blok `Storno okno` a věta o komunikaci pravidel nahradily formulace zaměřené na to, co klientka může udělat (`Změna nebo zrušení termínu`, `24 h předem`, stručnější FAQ odpověď).
- 24h reminder enqueue window se posunulo z `23h-25h` na `25h-26h` před termínem, takže reminder s odkazy `Změnit termín` / `Zrušit rezervaci` nechodí až ve chvíli, kdy už online self-service naráží na 24h limit.
- Veřejná stránka `/rezervace/sprava/[token]` prošla UX refaktorem změny termínu: nový tok začíná kontextem a aktuální rezervací, pokračuje hybridním výběrem `nejbližší termíny + kalendář`, po výběru času scrolluje na potvrzení a storno odsouvá na konec jako slabý odkaz.
- Self-service výběr termínu je mobilně kompaktnější: sloty jsou ve dvou sloupcích, kalendář má zvýrazněné dostupné dny, vybraný čas je ve sticky spodním souhrnu a potvrzení zůstává jedinou dominantní CTA.
- Success stav po self-service přesunu už není jedna dlouhá věta přes široký panel; původní a nový termín se zobrazují jako dvě zarovnané souhrnné položky.
- Tokenové booking route dál neposílají Matomo pageview s tokenem, ale Matomo se na veřejném shellu umí inicializovat kvůli bezpečným self-service eventům `Rezervace / Datum vybráno` a `Rezervace / Čas vybrán` bez PII a bez volání při renderu.
- Všechny booking e-mailové šablony v `src/lib/email/templates.ts` jsou sjednocené do jednoho email-safe design systému: 600px shell, inline styly, tabulkové karty, jednotný detail `služba / datum / čas`, pevná adresa `PP Studio, Sadová 2, 760 01 Zlín`, jeden kontaktní blok a čitelný formát času `09:30 – 10:30`.
- Klientské šablony `booking-confirmation-v1`, `booking-approved-v1`, `booking-reminder-24h-v1`, `booking-rescheduled-v1`, `booking-cancelled-v1` a `booking-rejected-v1` mají klidnější stručné text/plain i HTML varianty bez duplicitních vět o pomoci; reminder už neobsahuje samostatné CTA `Ozvat se studiu` a kontakt se zobrazuje pouze jednou.
- CTA hierarchie e-mailů je sjednocená: klientské změny/storna jsou sekundární nebo textové odkazy, destruktivní akce používají tlumený danger-light styl a `admin-booking-notification-v1` drží jedinou primární akci `Potvrdit rezervaci`.
- ADR `0052-booking-email-design-system-v1` popisuje pravidla pro další úpravy booking e-mailů bez zásahu do workeru, fronty, tokenů, ICS příloh nebo booking flow.
- Klientský potvrzovací e-mail `booking-approved-v1` prošel UX/copy refaktorem: má jasnou hierarchii `termín / služba / místo / kalendář / pomoc / správa rezervace`, výrazně zobrazuje adresu PP Studio na Sadové 2 ve Zlíně, připomíná `.ics` přílohu a odkazy na změnu/storno drží dole jako sekundární textové akce.
- Doprovodné texty kroků veřejné rezervace jsou civilnější a přesněji popisují výběr služby, termínu, kontaktu a závěrečnou kontrolu před odesláním.
- Veřejný rezervační formulář po změně kategorie ve kroku `Vyberte službu` automaticky plynule posune viewport na seznam dostupných služeb v dané kategorii, takže není potřeba ručně scrollovat na mobilu.
- Mobilní auto-scroll po změně kategorie nově počítá offset podle skutečné výšky sticky hlavičky a přidává bezpečný odstup, takže první karta služby už nezůstává částečně schovaná pod horní navigací.
- Sticky hlavička na stránce rezervace (`variant=booking`) je na mobilu kompaktnější, ale zachovává horní navigační lištu: nav odkazy jsou v užším horizontálním řádku, spacing je menší a brand/CTA jsou lehce zmenšené.
- V landscape mobilním zobrazení rezervace se sticky hlavička skládá do jednoho řádku bez redundantního CTA `Rezervace`; navigace se přesune vedle brandu a spodní sticky CTA má nižší padding i menší tlačítko.
- Výběr nejbližšího termínu a mobilní karta `Termín` v souhrnu jsou kompaktnější: kratší mobilní paddingy, menší čas a doplňkové informace v jedné řádce místo vysokého bloku.
- Admin e-mail `admin-booking-notification-v1` má stabilnější rendering CTA tlačítek v mobilních klientech: helper `buildEmailActionButton` používá jednodušší bulletproof table variantu s explicitní typografií (`letter-spacing: 0`, `mso-line-height-rule: exactly`) a bez překryvného textu.
- Klientský potvrzovací e-mail `booking-confirmation-v1` už neobsahuje sekci `Další kroky`; CTA `Změnit termín` / `Zrušit rezervaci` i doprovodná věta byly odstraněné, aby e-mail po odeslání rezervace působil jako klidné potvrzení bez dalšího rozhodování.
- Veřejný success screen po vytvoření rezervace je nově čisté uklidňující potvrzení: zachovává hero `Rezervace přijata`, stav `Čeká na finální potvrzení`, detail služby / data / času a stručně říká, co se stane dál.
- Z confirmation panelu byl odstraněn blok `Potřebujete změnu?` včetně CTA `Změnit termín` a `Zrušit rezervaci`; post-submit obrazovka už nepůsobí jako další krok flow.
- Intro rezervační stránky `Vyberte si termín...` se už po úspěšném submitu nezobrazuje nad confirmation panelem; zůstává jen v aktivním výběru termínu.
- Confirmation panel doplnil krátký uklidňující blok `Termín je pro vás nyní rezervovaný...`, kontakt `Potřebujete pomoc?` zůstal poslední a Matomo event `Rezervace / Vytvořena` dál odchází pouze z `BookingFlow` po úspěšném submitu přes `createdBookingTrackedRef`.

- Provozní e-mail o nové rezervaci je zkrácený na rozhodovací obsah `služba / termín / klientka / kontakt / rychlé akce` a už neobsahuje dlouhé vysvětlování bezpečnostního mezikroku.
- Tlačítka v admin notifikaci jsou nově skládaná pod sebe přes email-safe tabulkové CTA, používají Arial/Helvetica bez letter-spacing a mají jasnou hierarchii `Potvrdit rezervaci` jako primary, `Přesunout termín` a `Otevřít v administraci` jako secondary a `Zrušit rezervaci` jako danger-light.
- Text/plain fallback admin notifikace je stručný a zachovává stejné approve/reject/admin odkazy bez změny token workflow, email workeru nebo booking flow.

- Veřejný success stav po odeslání rezervace má jasnější klidové copy: potvrzuje přijetí rezervace, předběžné držení termínu a čekání na finální e-mail bez zásahu do booking API či tokenových odkazů.
- Referenční kód se v confirmation panelu nezobrazuje, protože projekt nemá samostatný klientský reference-code atribut.

- Sticky action bar v admin týdenním planneru už neobsahuje nefunkční tlačítko `Uložit koncept`; zůstávají akce `Zahodit` a `Publikovat změny`.
- Koncept změn v planneru se nyní bere jako dočasný pracovní stav aktuální stránky a po refreshi bez publikace se neobnovuje.
- Veřejný web a rezervační flow nově podporují Matomo analytics přes `NEXT_PUBLIC_MATOMO_*` env proměnné; tracking běží jen mimo admin, neposílá PII ani tokenové URL a používá bezpečný no-op helper.
- App Router pageview tracking posílá klientské navigace bez duplicitního prvního pageview a booking flow posílá funnel eventy pro výběr služby, data, času, zahájení kontaktu a úspěšně vytvořenou rezervaci.
- Hlavní veřejné CTA na rezervaci a kontakt posílají Matomo custom eventy bez ukládání analytics dat do databáze PP Studio.

- Stránka `/o-mne` prošla copywritingovým refaktorem do klidnějšího, dospělejšího a méně marketingového tónu bez změny routingu, booking flow nebo admin napojení.
- Hero, sekce benefitů, příběh, přístup, kosmetika FOR LIFE & MADAGA a certifikace mají nové civilnější texty; defenzivní formulace o nahrazování praxe a přehnané sliby byly odstraněné.
- Benefit sekce `/o-mne` nově zobrazuje krátký podnadpis z `aboutContent.whyChooseMe.description`, aby textová hierarchie působila jasněji bez redesignu.

- Playwright scénáře pro self-service přesun a owner potvrzení rezervace jsou odolnější vůči současnému UI: admin test používá aktuální pole `Volitelný důvod` a submit `Potvrdit rezervaci`, public reschedule flow už nespoléhá na přesný dynamický timestamp v accessible labelu slotu.

- Admin overview dashboard na `/admin` a `/admin/provoz` prošel top-level UX refaktorem z přehledu metrik na skutečný provozní panel otázky `Co mám dnes udělat?`.
- Horní část nově tvoří sjednocený blok `Dnešní provoz`, který spojuje datum, dominantní počet dnešních rezervací, další klientku, hlavní CTA a kompaktní sekci `Dnešní úkoly`.
- `Čeká na potvrzení` se přesunulo z vedlejší KPI do výrazného akčního alertu nad dnešním plánem; duplicita počtu dnešních rezervací byla odstraněná z KPI i pravého panelu.
- `Dnešní plán` je nově mini timeline s click-to-open řádky, hover/focus stavy, rychlými akcemi pro rezervace, CTA pro volná okna a lehkým toast feedbackem po inline akci.
- Pravý panel je zjednodušený jen na `Nejbližší volné sloty` a `Rychlé akce`; `Vytvořit rezervaci` je nyní jednoznačně primární CTA.
- Overview page používá Suspense fallback se skeletonem, takže admin dashboard při serverovém načítání nezůstává prázdný.
- ADR `0050-admin-dashboard-today-operations-panel-v2` popisuje posun z dashboardu metrik na denní rozhodovací panel bez změny booking enginu, slot logiky nebo API kontraktů.

- Další hardening helperů pokračuje v `src/features/admin/lib/` a souvisejících booking modulech: label funkce mají explicitní návratové typy a fallbacky, aby TypeScript neodvozoval `string | undefined`.
- Admin helpery v `src/features/admin/lib/` dostaly explicitní návratové typy a fallbacky u label funkcí, aby production build nespadl na `string | undefined` inference.
- Detail email logu na `/admin/email-logy/[emailLogId]` prošel UX refaktorem z debug-first obrazovky na business + debug detail bez změny workeru, retry logiky, queue nebo payload kontraktu.
- Horní část detailu nově tvoří business header s názvem emailu, jednoznačným finálním stavem `Odesláno / Čeká / Retry / Selhalo`, příjemcem, klientkou, rezervací a klíčovým časem `Odesláno / Poslední pokus`.
- Pod headerem jsou vždy viditelné rychlé akce `Zpět na přehled`, `Otevřít rezervaci` a podle stavu `Zkusit znovu`; copy pro nerelevantní retry nově říká `Email byl úspěšně odeslán, opakování není potřeba.`
- Hlavní obsah detailu se rozdělil na kompaktní `Souhrn`, business sekci `Navázané záznamy`, čitelný panel poslední chyby a až spodní rozbalovací blok `Technické detaily` s maskovaným payloadem, raw daty a volbou `Zobrazit citlivá data`.
- ADR `0049-admin-email-log-detail-business-debug-split-v1` popisuje oddělení business a technického pohledu detailu email logu.

- Owner-only sekce `Email logy` prošla UX refaktorem z technického queue monitoringu na business-first přehled `Komunikace se zákaznicemi`.
- Nahoře je nově health panel `OK / Warning / Error` podle failed, retry, pending fronty a poslední relevantní chyby, plus krátké metriky `Dnes odesláno`, `Za posledních 7 dní`, `Čeká na odeslání`, `Selhalo` a `Poslední odeslání`.
- Hlavní obsah teď tvoří filtrovatelný seznam posledních emailů s badge typem/stavem, příjemcem, vazbou na rezervaci, časy, počtem pokusů, placeholdery pro tracking a akcemi `Otevřít rezervaci / Detail emailu / Zkusit znovu`.
- Původní sekce pending, retry a failed zůstaly zachované, ale přesunuly se níž do debug bloku `Technický stav fronty`; detail email logu zároveň doplnil přímý odkaz na rezervaci a srozumitelnější error kontext bez změny workeru nebo retry politiky.
- ADR `0048-admin-email-communication-overview-v1` popisuje nové business-first čtení email observability nad existující tabulkou `EmailLog`.

- Detail rezervace v adminu prošel zásadním UX refaktorem z dlouhé čtecí stránky na kompaktní rozhodovací panel.
- Horní část detailu nově drží sticky header s klientkou, službou, výrazným termínem, stavem, zdrojem rezervace a rychlými akcemi `zavolat / e-mail / přesunout termín / zpět`.
- Akční panel se přesunul hned pod header a používá zkrácený action chooser s primární akcí podle stavu rezervace; přesun termínu zůstává samostatné CTA do existujícího draweru.
- Souhrn rezervace je nově v kompaktním dvousloupcovém bočním cardu, poznámky jsou sjednocené do jednoho bloku a historie ukazuje nejdřív posledních 5 položek s možností rozbalit zbytek.
- OWNER i SALON mají v detailu stejné provozní možnosti; změna je čistě v IA, layoutu a copy, bez zásahu do booking engine, stavového modelu nebo databázové logiky.

- Admin sekce `Rezervace` prošla dalším UX refaktorem pracovního přehledu: horní statistiky jsou nově klikací rychlé filtry a přehled používá kompaktní toolbar pro hledání, stav, zdroj a datumový rozsah.
- Rezervační seznam se serverově seskupuje do bloků `Dnes`, `Zítra`, `Tento týden`, `Později` a `Dříve`, aby byla rychlejší orientace v dnešních a budoucích termínech.
- Čas rezervace má v řádku vyšší vizuální prioritu než datum, uzavřené stavy `Hotovo` a `Zrušená` jsou záměrně tlumené a inline akce se nově liší podle stavu rezervace (`PENDING` / `CONFIRMED` / uzavřené stavy).
- Mobilní zobrazení sekce `Rezervace` používá compact card per reservation se zachovanými rychlými akcemi a praktickými kontaktními odkazy `tel:` / `mailto:`.
- Finální polish sekce `Rezervace` sjednotil horní statistiky do segmented filtru bez duplicitního CTA, zvýraznil skupinu `Dnes`, přidal pending-first prioritu v rámci skupin a připravil selection shell pro budoucí bulk akce.
- Řádky rezervací jsou nově click-to-open s focus ringem, klávesami `Enter` / `↑` / `↓`, inline loading stavem u akcí a lehkým toast feedbackem po potvrzení nebo zrušení.
- Přibyl audit změn cen služeb přes novou tabulku `ServicePriceChangeLog`; admin editace služby nyní při skutečné změně `priceFromCzk` ukládá původní a novou cenu, aktéra a čas změny.
- Migrace `20260424103000_service_price_change_log_v1` přidává perzistentní auditní stopu pro změny ceníku bez zapisování cen do obecných aplikačních logů.
- Detail služby v admin draweru nově ukazuje kompaktní sekci `Historie ceny` s posledními změnami ceny, časem a admin aktérem, takže audit je dostupný rovnou při editaci služby.
- Admin sekce `Služby` prošla zásadním UX refaktorem seznamu: vysoké karty nahradil kompaktní group-first layout podle kategorií s hustšími řádky služeb.
- Každá kategorie v seznamu `Služby` nově zobrazuje počet položek a jde samostatně sbalit/rozbalit; název kategorie už se neopakuje u každé služby.
- Základní řádek služby je zkrácený na název, délku, cenu, statusy, rezervace a rychlé akce; `operationalContext`, warning detail, slotová omezení a pořadí jsou až v rozbalení řádku.
- Statusy v seznamu `Služby` jsou zjednodušené na malé badge `Aktivní/Neaktivní`, `Veřejná/Interní` a volitelně `Skrytá`.
- Rychlé akce služby se přesunuly do compact menu `⋯`; běžné toggly aktivity a veřejnosti jsou na desktopu dostupné i jako malé inline přepínače přímo v řádku.
- Filtry sekce `Služby` jsou kompaktnější a na desktopu sticky; horní statistiky i souhrnný řádek nad seznamem mají menší vizuální výšku.
- Portréty jsou nově rozdělené na cíle `PORTRAIT_HOME` (homepage hero) a `PORTRAIT_ABOUT` (`/o-mne` hero), takže každá stránka může používat vlastní obrázek bez nového upload systému.
- Veřejné read modely pro portréty už nepoužívají legacy `PORTRAIT`; homepage čte `PORTRAIT_HOME` a `/o-mne` čte `PORTRAIT_ABOUT`.
- Admin `Média webu` nyní v běžném workflow nabízí cílené typy `Portrét: Homepage` a `Portrét: O mně`; legacy `PORTRAIT` je z UI odstraněný.
- Admin sekce `Služby` nově otevírá detail/editaci jako pravý overlay drawer i na desktopu; původní fixní pravý panel byl odstraněný, seznam zůstává hlavní pracovní plochou.
- Admin sekce `Kategorie služeb` sjednotila detail na pravý overlay drawer pro desktop i mobil; původní desktop `sticky detail` panel byl odstraněný.
- `Média webu` v adminu prošla UX refaktorem bez změny storage strategie nebo datového modelu: kratší header, kompaktní statistiky `Celkem médií / Publikováno / Skryto / Certifikáty`, výraznější upload panel a hustší responsive grid karet.
- Upload panel nově používá klikací dropzónu s výběrem souboru, krátkou nápovědu pro `JPG/PNG/WebP` a kompaktní pole pro typ, titulek a alt text v jednom pracovním bloku.
- Filtry médií jsou teď tabs s počty pro `Vše`, `Certifikáty`, `Prostory`, `Kontakt`, `Portrét Homepage` a `Portrét O mně`; po uploadu, editaci, publish/unpublish i smazání se zachovává aktivní filtr.
- Karty médií nově zdůrazňují náhled, název, badge typu, badge publikace, rozměry, velikost a použití; quick akce `Upravit`, `Publikovat/Skrýt` a `Odstranit` zrychlují běžnou správu bez nového upload systému.
- Media Library má sjednocenou storage strategii pro nové uploady: výchozí root je `/var/www/ppstudio/uploads`, soubory jdou vždy do `public/{type}/YYYY/MM` a veřejná kanonická URL je `/media/public/{type}/YYYY/MM/{assetId}-{variant}.{ext}`.
- Naming uploadů už nepoužívá původní jména souborů; `storedFilename` se generuje jako krátký asset key se suffixy `original`, `optimized`, `thumbnail`.
- Publish/unpublish už neřídí filesystem: nové uploady se vždy ukládají do `public/`, `isPublished` zůstává čistě databázový flag a legacy route `/media/[kind]/[[...path]]` zůstává kvůli starším médiím.
- Originál se při uploadu nově také normalizuje přes `sharp.rotate()`, takže DB metadata `width`, `height`, `size`, `mimeType` odpovídají skutečně uloženému archivnímu souboru.
- Media Library upload nyní pro JPEG/PNG/WebP generuje přes `sharp` tři úrovně souboru: původní originál, `optimized` variantu do 1920 px a `thumbnail` variantu kolem 400 px pro admin grid.
- `MediaAsset` nově ukládá i variantová pole `optimized*` a `thumbnail*`; veřejný web používá `optimizedUrl`, admin grid `thumbnailUrl` a starší média bez variant automaticky padají zpět na původní `url`.
- Media route `/media/[kind]/[[...path]]` nyní umí bezpečně obsloužit i optimalizované a thumbnail soubory podle konkrétní variantové cesty uložené v databázi.
- Admin sekce už pracuje jen s novým modulem `Média webu`; legacy slug `certifikaty` byl odstraněn z routingu a URL `/admin/certifikaty` ani `/admin/provoz/certifikaty` už nejsou podporované.
- Upload policy pro média je zjednodušená jen na formáty `JPG/PNG/WEBP`, aby odpovídala nové server-side image pipeline přes `sharp`.

- Veřejné stránky now používají centrální `MediaAsset` read model i mimo certifikace: `/o-mne` bere hero z `MediaType.PORTRAIT_ABOUT` (fallback `PORTRAIT`), homepage bere hero portrét z `MediaType.PORTRAIT_HOME` (fallback `PORTRAIT` a pak brand asset) a `/kontakt` bere hero pouze z `MediaType.CONTACT_PHOTO`.
- Admin grid `Média webu` nyní u každého assetu jasně ukazuje typ, publish stav a text `Použití`, aby bylo vidět, kde se obrázek na webu propisuje.
- Přibyl sdílený public media helper pro publikované obrázky podle typu; `MediaType.GENERAL` má připravený read model pro budoucí hero/CTA bannery bez dalšího upload systému.

- Přibyla veřejná stránka `/studio` s hero, galerií, pocitovým blokem, orientačním kontaktním CTA a finální rezervací; hlavní navigace i sitemap nově obsahují položku `Studio`.
- Stránka `/studio` načítá fotky přes `MediaType.SALON_PHOTO` a `isPublished = true`; pokud zatím nejsou nahrané žádné fotky, zobrazí klidný placeholder místo prázdné galerie.
- Stránka `/studio` je dočasně vypnutá: route vrací `404` přes `notFound()`, odkaz `Studio` je schovaný z hlavní navigace a URL je odstraněná ze sitemap.

- Admin sekce `Certifikáty` byla zobecněná na modul `Média webu`; UI nově nabízí upload obrázku, filtr typů, grid karet, editaci titulku, alt textu, typu a publikace.
- Modul `Média webu` nyní běží na adresách `/admin/media` a `/admin/provoz/media`.
- Prisma model `MediaAsset` má obecný enum `MediaType` (`CERTIFICATE`, `SALON_PHOTO`, `PORTRAIT_HOME`, `PORTRAIT_ABOUT`, `PORTRAIT`, `GENERAL`) a nová pole `fileName`, `url`, `size`, `altText`, `sortOrder`, `isPublished`; legacy storage pole zůstávají kvůli bezpečné kompatibilitě.
- Veřejná stránka `/o-mne` dál načítá pouze publikované certifikáty, nově přes `MediaType.CERTIFICATE` a `isPublished = true`.

- Stabilizační refaktor největších booking/admin modulů bez změny chování: `src/features/booking/lib/booking-public.ts`, `src/features/booking/components/booking-flow.tsx` a `src/features/admin/lib/admin-slots.ts` jsou nově rozdělené na menší odpovědnostní moduly se zachovanými veřejnými exporty.
- `booking-public` je nově rozdělený na `shared`, `catalog`, `engine` a `notifications`; původní soubor zůstal kompatibilní facade pro existující importy.
- `booking-flow` je nově rozdělený na helpery, typy a samostatné komponenty pro progress panel, krok služby, krok termínu, krok kontaktu a pravý summary sidebar.
- `admin-slots` je nově rozdělený na `time`, `helpers`, `queries`, `mutations` a `types`; původní `admin-slots.ts` dál slouží jako kompatibilní entrypoint.

- Admin login `POST /api/auth/login` nově používá server-side rate limit podobný veřejné rezervaci: omezuje pokusy za časové okno podle IP hashe a počtu neúspěšných pokusů na e-mail hash.
- Přibylo auditní logování admin login pokusů do `BookingSubmissionLog` s prefixem `ADMIN_LOGIN_*` (`SUCCESS`, `INVALID_PAYLOAD`, `INVALID_CREDENTIALS`, `RATE_LIMITED`).
- Přibyla Playwright E2E vrstva pro hlavní booking cesty: veřejné vytvoření rezervace, veřejné storno přes token, veřejný přesun termínu přes token a owner potvrzení pending rezervace v adminu.
- Nový script `npm run test:e2e` spouští browser testy proti lokálnímu `next start` serveru na samostatném portu a každý scénář si seeduje i uklízí vlastní unikátní Prisma data.
- Stabilizované booking test fixtures: unit testy už nepoužívají pevné datum těsně u aktuálního dne a DB integrační seed hledá nekolidující sloty vůči existujícím datům v lokální databázi.
- Opraven flaky Playwright scénář `client can reschedule a booking through a public token`: test teď deterministicky vytvoří runtime kolizi na právě vybraném slotu, ověří uživatelskou chybu `Nový termín koliduje...`/`...není k dispozici` a následně přesune rezervaci na jiný volný čas.
- DB integrační testy voucher booking flow už nesdílí společný seed mezi test casy: `booking-public-voucher.integration.test.ts` nyní vytváří a uklízí izolovaný seed per test a používá unikátní voucher kódy, čímž se odstranily náhodné transakční kolize mezi paralelními běhy.
- Public storno flow přes token (`cancelPublicBookingByToken`) má bezpečný retry serializable transakce pro Prisma `P2034` write-conflict/deadlock; business výsledek storna i email logika zůstávají beze změny.
- Přibyla GitHub Actions CI konfigurace `.github/workflows/ci.yml`, která nad PostgreSQL service containerem spouští lint, DB testy, production build a Playwright E2E.

- Přibyl token-based klientský self-service flow `/rezervace/sprava/[token]`, kde klientka bez přihlášení bezpečně uvidí svou rezervaci, dostupné nové termíny pro stejnou službu a až po potvrzení provede přesun.
- Self-service přesun používá stejné backend jádro `rescheduleBooking(...)` jako admin detail; validace slotu, kontrola kolizí, reset reminder markerů, auditní log i návazný e-mail běží nad jedním flow bez paralelní „lehké“ varianty.
- `BookingRescheduleLog.changedByClient` se nově plní i z veřejného flow, takže v admin historii zůstává vidět, že změnu provedla sama klientka bez přihlášeného uživatele.
- Klientské e-maily `booking-confirmation-v1`, `booking-approved-v1`, `booking-reminder-24h-v1` a `booking-rescheduled-v1` teď posílají bezpečný odkaz `Změnit termín`; původní placeholder `Požádat o změnu` přes `mailto:` byl odstraněn z web confirmation screenu i z e-mailů.
- Přibyly čisté unit testy pro veřejnou booking-management vrstvu a doménový `rescheduleBooking(...)`; pokrývají token-bound přístup, explicitní validaci stavů `PENDING` / `CONFIRMED` / `CANCELLED` / `COMPLETED` / `NO_SHOW`, kolize, stejné termíny, duration guard, optimistic concurrency, audit log i návazné notifikační volání bez DB integrace.
- Přibyly DB-backed integrační testy pro veřejný booking-management flow, které přes skutečné Prisma wiring ověřují token access, self-service storno, self-service přesun, reminder reset, audit/history zápisy, email orchestrace i odmítnutí neplatných tokenů, kolizí, terminal stavů a pokusů o přesun mimo online okno.

### Changed
- Email template renderer je backward-compatible vůči starším `EmailLog.payload` bez `manageReservationUrl`: šablony `booking-confirmation-v1`, `booking-approved-v1`, `booking-reminder-24h-v1` a `booking-rescheduled-v1` už na chybějícím poli nespadnou (`invalid_type`), pouze skryjí případné CTA `Změnit termín`.
- Opravené otevření draweru v admin sekci `Služby`: desktop detail se už neotevře automaticky po načtení stránky bez explicitního `serviceId`; otevře se až po kliknutí na detail nebo při `mode=create`.
- Opravené výchozí otevření draweru v admin sekci `Kategorie služeb`: detail se po načtení neotevírá automaticky jen kvůli defaultně vybrané kategorii.
- Opravená editace služby v admin sekci `Služby`: detail formuláře se při přepnutí na jinou službu remountuje podle `serviceId`, takže se už nepřenášejí staré `defaultValue` z první položky seznamu.
- Login stránka `/admin/prihlaseni` nově mapuje chybu `error=rate_limited` na čitelnou hlášku pro obsluhu.
- `npm test` nově explicitně zapíná `RUN_DB_INTEGRATION_TESTS=1`, takže běžný test run už neskipuje booking DB integrační scénáře a verifikace není falešně zelená jen na unit vrstvách.
- `npm run test:db:booking` nově spouští všechny booking DB integrační testy (`*.integration.test.ts`), takže jedním příkazem ověří jak centrální reschedule engine, tak veřejný token-based manage flow.
- Veřejný klientský přesun termínu už nesmí propadnout do admin-style manual override větve; pokus o přesun mimo online okno nebo mimo veřejně dostupný slot se teď zastaví na service vrstvě bezpečnou business chybou.
- Admin detail rezervace nově obsahuje samostatný drawer `Přesunout termín`; přesun už není tichá editace času, ale řízená doménová akce se stejnou validací slotů a interních výjimek jako veřejný booking a ruční admin booking.
- Historie detailu rezervace se rozšířila ze samotných stavových změn na sjednocenou timeline stavů a přesunů termínu, takže je vidět původní i nový čas, aktér změny a volitelný důvod.
- Reminder architektura už při výběru 24h kandidátek nestojí na samotné existenci reminder email logu; nově používá `Booking.reminder24hQueuedAt`, takže přesun termínu resetuje reminder návaznost pro nový čas bez paralelní reminder pipeline.
- Stránka `/faq` prošla úplným UX a copy refactorem: hero teď jemně uklidňuje nejistotu před první návštěvou, pravý brand box nahradil praktický kontakt do studia a samotný obsah je nově rozdělený do tematických accordion sekcí `Rezervace`, `První návštěva`, `Praktické otázky`, `Komfort a průběh`, `Organizace` a `Storno`.
- Stránka `/storno-podminky` prošla kompletním UX a copy refactorem: hero teď používá finální stručný text, vpravo má praktický box `Jak zrušit rezervaci`, pod ním jsou tři rychle skenovatelné karty s hlavními pravidly a šest krátkých sekcí s konkrétními, ale měkčími podmínkami pro změnu termínu, no-show, zpoždění, zálohy i storno ze strany salonu; stránka zároveň nově výslovně říká, že rezervaci lze upravit i přes odkaz v potvrzení rezervace a reminderu.
- Stránka `/obchodni-podminky` prošla kompletním refactorem z draftového placeholderu na plnohodnotnou právní stránku: hero nově používá finální copy a praktický blok poskytovatele, pod ním je obsahová navigace a devět stručných sekcí pro rezervace, storno, cenu, průběh služby, odpovědnost, reklamace, poukazy a závěrečná ustanovení.
- `LegalPage` dostala jemný CTA prompt v hero a kompaktnější rytmus právních karet; `LegalSection` zároveň nově podporuje volitelný `eyebrow`, takže delší právní texty zůstávají dobře skenovatelné bez rozbití sdíleného layoutu.
- Veřejný profil salonu nově vrací i provozní identitu (`operatorName`, `businessId`), takže kontaktní a právní stránky už neskládají jméno provozovatelky a IČ z natvrdo zapsaných lokálních hodnot.
- GDPR stránka `/gdpr` prošla úplným obsahovým a UX refactorem: hero už nepůsobí jako interní draft, vpravo nově zobrazuje praktický box správce osobních údajů a pod ním následuje plná právní osnova se sekcemi pro účely, dobu uchování, příjemce údajů, práva subjektu i závěrečný kontakt.
- Generická veřejná komponenta `LegalPage` už umí vedle textového hero i užitečný informační aside, lehkou anchor navigaci a bohatší právní sekce se seznamy a zvýrazněnou poznámkou, takže stejné UX páky můžeme použít i u dalších právních stránek bez dalšího přepisu.
- Kategorie služeb už používají jediný název `name` napříč adminem, webem i ceníkem; pole `Veřejný název` bylo z UI odstraněné, veřejný katalog ho nečte a při uložení se čistí jako legacy hodnota.
- Ve footeru zůstává klikací e-mailový kontakt, ale zobrazuje se už v běžném čitelném tvaru místo textu `[...] [at] [...]`; cílem je přímější a důvěryhodnější kontakt pro návštěvnici.
- Opraveno rozhraní server/client kolem obfuskovaného e-mailu: `formatObfuscatedEmail` je nově ve sdíleném server-safe helperu `src/lib/email-obfuscation.ts`, takže server komponenty (např. footer) už nevolají funkci z klientského modulu.
- Veřejné e-mailové odkazy na webu teď používají jemnou obfuscaci: footer, kontaktní stránka i booking confirmation panel už nevypisují ani nerenderují surový `mailto:` odkaz přímo v HTML, ale skládají ho až v klientu přes sdílený helper a návštěvnici dál nechávají e-mail otevřít jedním klikem.
- Veřejný footer prošel informačním redesignem bez změny brand směru: nově používá kompaktnější 3sloupcovou skladbu `brand -> navigace/informace -> kontakt`, odděluje hlavní a právní odkazy do dvou nadepsaných skupin a ve vlastním kontaktním bloku nově ukazuje adresu, telefon i e-mail.
- Klientský reminder e-mail `booking-reminder-24h-v1` prošel UX/copy refactorem: headline a intro jsou lidštější, detail rezervace má jasnější hierarchii `služba -> datum a čas -> kde nás najdete`, CTA sekce nově vede primárně ke kontaktu se studiem a storno už není vizuálně dominantní.
- Referenční kód rezervace byl úplně odstraněný z veřejného booking flow, storno screenů, provozních email action screenů, klientských e-mailů i zákaznické `.ics` události; komunikace se teď opírá jen o službu, termín a tokenizované odkazy.
- Dokumentace stacku byla zpřesněná podle aktuálního `package.json`: `next` `16.2.4`, `react/react-dom` `19.2.4`, `prisma/@prisma/client/@prisma/adapter-pg` `7.7.0`; zároveň byl v `MANUAL.md` sjednocený popis detailu služby na request-time DB režim.
- Opraven Turbopack/NFT tracing u route `/media/[kind]/[[...path]]`: media storage path operace jsou nově anotované přes `turbopackIgnore`, takže `next build` už nehlásí warning `Encountered unexpected file in NFT list` a netraceuje celý projekt.
- `email:worker` nově kromě doručování `EmailLog` také každých 5 minut skenuje potvrzené rezervace v okně `25h-26h` před termínem a enqueueuje jediný reminder `BOOKING_REMINDER` do stejného outbox flow.
- Delivery vrstva před odesláním reminderu znovu kontroluje stav rezervace; zrušený, přesunutý nebo už uzavřený reminder se označí jako `system-skip` místo reálného odeslání.
- Opraven detail služby `/sluzby/[slug]` pro Next.js 16 async dynamic APIs: route `params` je nově čtené jako `Promise` (`await params`) v `generateMetadata` i ve stránce, takže už nevzniká runtime chyba `sync-dynamic-apis`.
- Veřejné rezervace nově evidují akviziční zdroj (`Google`, `Facebook`, `Instagram`, `Firmy.cz/Seznam`, `Direct`, `Other`) odvozený z `utm_*` a referrer hostu; data se ukládají k rezervaci i do `BookingSubmissionLog` metadata a v adminu se ukazují v seznamu i detailu rezervace.
- Formulář detailu služby v adminu teď jasněji rozlišuje fallback texty od veřejné prezentace: blok `Text pro orientaci` byl přejmenovaný na `Základní popisy (fallback)`, pole popisují reálné použití v rezervaci/webu a veřejné texty explicitně uvádějí vyšší prioritu.
- Formulář detailu služby v adminu dál sjednotil copy pro textové vrstvy: blok fallback textů je nově pojmenovaný `Texty pro rezervaci a fallback webu`, labely/placeholdery explicitně popisují kde se text použije a veřejná vrstva zůstává označená jako prioritní.
- Admin formulář služby už nevede duplicitní krátké texty: samostatné pole `shortDescription` bylo odstraněné z editace, rezervační flow čerpá text z `publicIntro` a při uložení se `shortDescription` v DB nuluje jako legacy pole.
- Formulář služby v adminu má nově srozumitelnější slovník pro ne-technické uživatele: textová pole jsou rozdělená do sekcí `Web a rezervace`, `Ceník` a `Google (SEO)` a labely jasně popisují, kde se který text propisuje.
- Validační hlášky ve formuláři služby byly přejmenované do stejného slovníku jako UI (`Název na webu`, `Krátký popis (web + rezervace)`, `Štítek do ceníku`, `Popis pro Google`), takže chybové stavy působí konzistentně.
- Název služby je nově sjednocený na jedno pole `name` napříč webem, ceníkem, rezervacemi i adminem; službový `publicName` se už v UI neupravuje ani na webu nečte a při uložení služby se čistí jako legacy hodnota.
- Layout sekce `Základ služby` v admin formuláři byl upravený pro lepší čitelnost: `Název služby` je přes celou šířku řádku a pole `Kategorie` je posunuté pod `Pořadí`.
- Mobilní admin drawer už při otevření nenechává prosvítat horní sticky lištu s tlačítkem `Menu`, takže se navigace vizuálně nebije s vlastním obsahem draweru.
- Mobilní layout admin sekce `Rezervace` už nepůsobí jako zmenšená desktop tabulka; řádky se na malých displejích skládají do dvousloupcové karty s čitelnějším kontaktem a plnošířkovým footerem pro `Potvrdit`, `Zrušit` a `Otevřít`.
- Mobilní admin dashboard a navigace dostaly další compression pass: hero CTA se na telefonu skládají pod sebe, alerty a timeline mají čitelnější stack, quick actions už netvoří dvě příliš úzké karty vedle sebe a drawer menu má o něco pohodlnější šířku i tap targety.
- `BookingSource` už nově nepopisuje roli admina, ale skutečný původ rezervace (`WEB`, `PHONE`, `INSTAGRAM`, `IN_PERSON`, `OTHER`); role a audit zůstávají v `createdByUserId` a `BookingStatusHistory`.
- Rezervační doména byla rozšířená o sdílené create jádro pro public i admin vstup, takže ruční rezervace používá stejné validace služby, slotu, kolizí, klientky a navazujících e-mailů jako veřejný booking.
- Šablona `booking-approved-v1` umí nově volitelně vypnout `.ics` přílohu, aby admin mohl rozhodnout, jestli při ručním potvrzení klientce pošle i kalendářovou událost.
- Sekce `Rezervace` v adminu teď na menších šířkách zobrazuje rychlé akce jako plný footer pod řádkem rezervace a od `lg` výše je vrací do úsporného vlastního sloupce s kompaktnější kapslí; sloupec `Status` je centrovaný jako samostatný grid item, `CANCELLED` má jen lehce červený tón a CTA `Detail` je zkrácené na `Otevřít`.
- Zákaznický potvrzovací e-mail po stavu `CONFIRMED` nově posílá kalendář jako `.ics` přílohu místo CTA odkazu; pending confirmation screen už kalendář nenabízí před potvrzením.
- Owner sekce `Nastavení` nově obsahuje i blok `Kalendář`, kde majitelka bezpečně zapíná, vypíná, kopíruje a rotuje Apple Calendar subscription feed bez zásahu do databáze nebo deploye.
- Chráněný kalendářový endpoint `/api/calendar/owner.ics` vrací standardní iCalendar feed jen pro potvrzené rezervace (`CONFIRMED`); čekající a zrušené rezervace se do subscription kalendáře záměrně nepropisují.
- Provozní e-mail o nové rezervaci obsahuje bezpečné approve/reject/admin CTA, takže majitel nebo provoz může pending rezervaci zpracovat přímo z e-mailu bez předchozího otevření adminu.
- Nový token-based flow pro email akce používá hashovaný `BookingActionToken` typu `APPROVE` / `REJECT`, expiraci, jednorázové použití, revokaci souvisejících tokenů a audit metadat v `BookingStatusHistory`.
- Přibyla veřejná noindex route `/rezervace/akce/[intent]/[token]` s potvrzovacím mezikrokem, result screenem a bezpečnými error stavy pro neplatný, expirovaný nebo už použitý odkaz.
- Schválení z e-mailu nově mění rezervaci na `CONFIRMED`, zrušení na `CANCELLED`, a obě akce automaticky zakládají správný návazný klientský e-mail (`booking-approved-v1` / `booking-rejected-v1`).
- Owner sekce `Uživatelé / role` byla kompletně přepracovaná z technického placeholderu na skutečnou správu přístupů pro malé studio: používá jen role `OWNER` a `SALON`, lidské stavy účtů a read-only označení `Systémový účet` místo bootstrap/env slovníku.
- Admin přihlášení nyní preferuje databázové účty s `passwordHash` a bootstrap env účty používá jen jako fallback pro systémové přístupy.
- Invite flow v sekci `Uživatelé / role` byl dotažený na kompletní aktivaci přístupu: owner posílá pozvánku, příjemce nastaví heslo na veřejné invite URL a poté se přihlásí standardním loginem.
- Akce `Znovu poslat pozvánku` v řádku uživatele už neběží přes row-level server action binding, ale přes dedikovaný owner API endpoint, takže vrací spolehlivou success/error odpověď i v klientském seznamu.
- SMTP transport pro background e-mail worker teď defaultně používá `SMTP_SECURE=auto`, takže port 465/2465 přepne na implicit TLS a 587/2587 na STARTTLS; low-level OpenSSL `wrong version number` chyba je po novém překladu nahlášená s čitelnějším hintem na mismatch portu a TLS režimu.
- Finální cleanup pass veřejného confirmation flow zkrátil duplicity v hero copy, zpřesnil CTA na `Požádat o změnu`, doplnil službu do hlavního přehledu rezervace a zjednodušil kontaktní texty.

### Added
- DB-backed integrační testy pro `rescheduleBooking(...)`, které ověřují úspěšný přesun, auditní log, reset reminder markerů, cleanup starého override slotu i blokaci kolizí a uzavřených stavů; testy jsou záměrně gateované přes `RUN_DB_INTEGRATION_TESTS=1`.
- Přibyl script `npm run test:db:booking`, který spouští DB-backed integrační testy pro reschedule flow jedním příkazem.
- Migraci `20260423113000_booking_reschedule_logs_v1`, která přidává `Booking.reminder24hQueuedAt`, `Booking.rescheduleCount` a novou auditní tabulku `BookingRescheduleLog`.
- Doménovou službu `src/features/booking/lib/booking-rescheduling.ts` pro centrální backend flow `rescheduleBooking(...)` včetně validace nového termínu, concurrency guardu, cleanupu starého interního override slotu a navazujícího klientského email logu `BOOKING_RESCHEDULED`.
- Nové admin komponenty `RescheduleBookingButton` a `BookingRescheduleTimeSelector` pro specializovaný drawer s výběrem z dostupných slotů, ručním zadáním času, důvodem změny a sticky footerem.
- Novou e-mailovou šablonu `booking-rescheduled-v1` pro oznámení klientce o změně termínu včetně nového času, místa, storno odkazu a volitelné `.ics` přílohy.
- ADR 0037 pro rozhodnutí kolem admin reschedule flow nad jedním bookingem místo vytváření reschedule chainu mezi dvěma rezervacemi.
- Migraci `20260423100000_booking_reminder_24h_v1`, která přidává `Booking.reminder24hSentAt` a index pro výběr 24h reminder kandidátek.
- Doménovou vrstvu `src/features/booking/lib/booking-reminders.ts` pro výběr kandidátek, transakční enqueue reminder jobů a označení doručeného reminderu.
- Novou e-mailovou šablonu `booking-reminder-24h-v1` bez `.ics` přílohy a s CTA `Zrušit rezervaci` / `Kontaktovat studio`.
- ADR 0034 pro rozhodnutí kolem jediného 24h reminderu napojeného na stávající `email:worker`.
- Migraci `20260422230500_manual_booking_admin_v1`, která přidává `Booking.isManual`, `Booking.manualOverride` a převádí enum `BookingSource` ze starých rolových hodnot na nový provozní seznam původů rezervace.
- Produkční ruční vytvoření rezervace v admin sekci `Rezervace` přes pravý drawer `CreateManualBookingDrawer`.
- Nové admin komponenty `BookingClientSelector`, `BookingServiceSelector`, `BookingTimeSelector`, `BookingSourceField`, `BookingNotificationOptions` a `BookingInternalNoteField`.
- Server action `createManualBookingAction`, která přes stejné booking jádro jako veřejný web zakládá ruční rezervaci, řeší deduplikaci klientky, interní výjimku mimo veřejnou dostupnost a revalidaci souvisejících admin/public cest.
- ADR 0033 pro rozhodnutí kolem ručního admin vytvoření rezervace nad sdíleným booking enginem.
- Migraci `20260422194500_booking_calendar_event_v1`, která rozšiřuje enum `BookingActionTokenType` o `CALENDAR`.
- Rozšíření email delivery vrstvy o přílohy a serverovou vrstvu `src/features/calendar/lib/booking-calendar-event.ts` pro generování klientské `.ics` přílohy.
- ADR 0032 pro rozhodnutí kolem zákaznické `.ics` události po potvrzení rezervace.
- Migraci `20260422193000_calendar_feed_v1` s modelem `CalendarFeed` pro owner-only ICS subscription feed, aktivaci/deaktivaci a bezpečnou rotaci tokenu.
- Serverovou kalendářovou vrstvu `src/features/calendar/lib/*` pro odvozený podepsaný token, validaci feedu, mapování rezervace na `VEVENT` a generování validního `.ics` obsahu s `Europe/Prague` timezone blokem.
- Veřejný route handler `/api/calendar/owner.ics` pro read-only Apple Calendar / iCloud subscription nad potvrzenými rezervacemi.
- Owner admin UI `AdminCalendarSettingsForm` v sekci `Nastavení` s akcemi `Kopírovat odkaz`, `Obnovit token` a `Vypnout feed`.
- ADR 0031 pro rozhodnutí kolem chráněného ICS feedu jako jednostranného read-only přehledu rezervací.
- Novou owner-only obrazovku `Uživatelé / role` s rozdělením na hlavní seznam přístupů a vedlejší read-only blok `Role a oprávnění`.
- Komponenty `AdminUsersPage`, `AdminUsersWorkspace`, `UsersList`, `UserRow`, `InviteUserDialog`, `RoleCards`, `RoleBadge` a `AccountStatusBadge`.
- Server actions pro založení pozvánky, úpravu jména/e-mailu, přepnutí role, deaktivaci/aktivaci účtu, obnovení čekající pozvánky a aktivaci pozvánky přes nastavení hesla.
- Migraci `20260422120000_admin_users_invited_at`, která přidává pole `AdminUser.invitedAt` pro čitelný stav `Pozvánka čeká`.
- Migraci `20260422170000_admin_invite_token_v1` s modelem `AdminUserInviteToken` pro jednorázové a expirující aktivace pozvánek.
- Veřejnou route `/admin/pozvanka/[token]` a komponentu `AdminInviteActivationForm` pro bezpečné nastavení hesla po přijetí pozvánky.
- Password helper `src/lib/auth/password.ts` (scrypt hash + verify) pro DB admin účty.
- ADR 0029 pro rozhodnutí kolem jednoduché owner-only správy přístupů bez role `ADMIN` a bez granular permissions.
- Prémiovější potvrzovací vrstvu veřejné rezervace: success screen už není jen jeden souhrnný card, ale jasný confirmation flow se samostatným status blokem, přehledem služby / termínu / kódu, blokem `Co bude následovat`, akční sekcí a odděleným kontaktem.
- Novou klientskou komponentu `BookingConfirmationPanel` pro post-submit stav rezervace se sekundární akcí `Požádat o změnu` přes předvyplněný kontakt do studia a destruktivním self-service stornem; kalendářové CTA se nově nabízí až v potvrzovacím e-mailu po `CONFIRMED`.
- Výrazně přepracovanou šablonu `booking-confirmation-v1`, která kopíruje stejnou hierarchii jako web confirmation screen místo jednoho dlouhého textového e-mailového cardu.
- ADR 0028 pro rozhodnutí kolem hierarchie a akčního toku potvrzení veřejné rezervace.
- Rozšíření katalogu `Service` a `ServiceCategory` o veřejná pricing metadata pro `/cenik`, `/sluzby` a detail služby: `publicName`, `publicIntro`, `seoDescription`, `pricingShortDescription`, `pricingBadge`, `pricingDescription`, `pricingLayout`, `pricingIconKey`, `pricingSortOrder`.
- Admin formuláře `Služby` a `Kategorie služeb` pro správu těchto veřejných metadata bez zásahu do kódu.
- Databázovou migraci `20260421113000_public_pricing_metadata` a rozšířený import `scripts/import-services.mjs`, který umí nová public/pricing pole načítat z JSON.
- ADR 0027 pro rozhodnutí, že veřejná pricing metadata patří přímo do katalogu služeb a kategorií.
- Samostatný pricing page modul `src/features/public/components/pricing-page.tsx` s komponentami `PricingHero`, `CategoryChips`, `PricingSection`, `PricingItem`, `PricingGridSection` a `PricingCTA`.
- Prezentační pricing metadata pro badge, kratší popisy a layout kategorií, aby `/cenik` mohl věrněji kopírovat referenční design bez duplikace DB dat.
- ADR 0026 pro rozhodnutí kolem struktury a prezentační vrstvy veřejné stránky `/cenik`.
- Druhou iteraci veřejného booking flow na `/rezervace` zaměřenou na rychlost dokončení: výběr služby přes `kategorie -> služba`, sekci `Nejbližší dostupné termíny`, progress bar, inline validaci kontaktu, editovatelný souhrn a mobilní sticky CTA.
- Nové klientské booking komponenty `CategorySelect`, `SuggestedSlots` a `StickyCTA`, které zkracují cestu k rezervaci bez zásahu do existující serverové business logiky.
- ADR 0025 pro rozhodnutí kolem booking UX flow V2.
- Nový operativní admin dashboard na `/admin` a `/admin/provoz` s fixní skladbou `hero dneška -> alerty -> dnešní plán -> KPI` a samostatným pravým sidebar workspace pro quick stats, čekající potvrzení, nejbližší sloty a rychlé akce.
- Samostatný serverový read model `src/features/admin/lib/admin-dashboard.ts` a prezentační komponenty `DashboardPage`, `TodayHeroCard`, `AlertsRow`, `TodayTimeline`, `KPIGrid`, `RightSidebar`, `QuickStats`, `UpcomingSlots` a `QuickActions`.
- ADR 0024 pro rozhodnutí, proč overview adminu funguje jako operativní workspace dne místo manažerského přehledu.
- Třetí iteraci admin sekce `Volné termíny / Týdenní plán dostupností` s grid-first layoutem, užším sidebar shell layoutem, akčním inspektorem dne a mobilními drawery pro navigaci i detail.
- Lokální draft workflow pro týdenní planner: klik výběru bloku, drag editace do konceptu, sticky action bar `Zahodit / Publikovat změny` a novou server action synchronizaci celého týdne při publikaci.
- ADR 0023 pro rozhodnutí kolem draft-first pracovního rozhraní planneru.
- Samostatnou server action a kompaktní formulář pro interní poznámku rezervace, takže ji lze upravit i bez změny stavu a každá úprava se propíše do auditní historie.
- ADR 0022 pro rozhodnutí kolem operativního redesignu detailu rezervace.
- Kompaktní pracovní workspace pro admin sekci `Rezervace` na `/admin/rezervace` a `/admin/provoz/rezervace` s vlastním row-based layoutem místo generického seznamu.
- Inline server actions `Potvrdit` a `Zrušit` přímo v řádku rezervace bez nutnosti otevřít detail.
- ADR 0021 pro rozhodnutí kolem hustšího pracovního seznamu rezervací.
- Nový dark admin workspace pro `Kategorie služeb` s 3sloupcovým desktop layoutem (shell sidebar + list + sticky detail), samostatnými komponentami v `src/components/admin/categories/*`, stat kartami, chip filtry a mobilním full-screen drawer detailem.
- Inline server actions pro okamžité optimistic přepnutí aktivity a reorder kategorií bez reloadu stránky, při zachování stávající validace a business logiky.
- Výrazně přepracovaný admin workflow pro `Služby` a `Kategorie služeb` s jasnými CTA pro vytvoření nové položky, rychlými akcemi přímo v seznamu a mobilním list/detail flow bez dlouhého stacked scrollu.
- Server actions pro vytvoření služby, vytvoření kategorie, duplikaci služby, rychlé přepínače aktivního / veřejného stavu a jednoduchý reorder nahoru / dolů.
- Provozní warningy a kontext v seznamech služeb a kategorií, včetně detekce konfliktů stavů, prázdných kategorií a chybějících dat.
- ADR 0019 pro rozhodnutí kolem provozně orientovaného admin katalogu služeb a kategorií.
- Produkční admin sekci `Klienti` pro `OWNER` i `SALON` s fulltextovým hledáním, filtry a řazením nad reálnými Prisma daty.
- Samostatný detail klientky na `/admin/klienti/[clientId]` a `/admin/provoz/klienti/[clientId]` s kontakty, souhrnem historie a posledními rezervacemi.
- Server action a validační vrstvu pro bezpečnou editaci interní poznámky klientky přímo z detailu.
- Přehled klientů je teď kompaktnější: kratší statistiky, nižší toolbar a karty bez opakované věty u klientů bez interní poznámky.
- ADR 0018 pro rozhodnutí kolem lehkého CRM workflow v admin sekci `Klienti`.
- První konkrétní admin modul `Certifikáty` dostupný pro `OWNER` i `SALON` na `/admin/certifikaty` a `/admin/provoz/certifikaty`.
- Server actions pro upload a smazání certifikátů napojené na `saveMediaAsset()` a `removeMediaAsset()`.
- Veřejný read model `getPublicCertificates()` nad `MediaAssetKind.CERTIFICATE`.
- Stránka `/o-mne` nyní načítá certifikáty z DB v request-time režimu a zobrazuje je v nové sekci `Certifikace`.
- Obecný základ lokální media storage vrstvy pro certifikáty, fotky prostor, reference i další budoucí obsah webu.
- Prisma model `MediaAsset` a migraci `20260419230000_media_storage_v1` pro ukládání media metadat mimo binární data.
- Sdílenou infrastrukturní vrstvu `src/lib/media/*` pro validaci souborů, generování názvů, bezpečné cesty a lokální filesystem adapter.
- Sdílenou feature service `src/features/media/lib/media-library.ts` pro budoucí owner/salon upload workflow bez duplikace.
- Veřejný route handler `/media/[kind]/[[...path]]`, který servíruje jen veřejné assety evidované v databázi.
- Volitelnou env proměnnou `MEDIA_STORAGE_ROOT` s výchozí cestou `/var/www/ppstudio/uploads` mimo repo a mimo build artefakty.
- ADR 0017 pro architektonické rozhodnutí kolem lokálního media storage.
- Základní testy pro bezpečné názvy souborů, storage path validaci a upload validační vrstvu.
- Lokální brand assety `public/brand/ppstudio-logo.png` a `public/brand/ppstudio-portrait.jpg` pro homepage hero.
- Skript `npm run db:check-migrations`, který před deployem kontroluje otevřené failed/incomplete záznamy v `_prisma_migrations`.
- Produkční owner-only sekci `Nastavení` s rozdělením na bloky `Salon`, `Rezervace` a `E-maily a notifikace`.
- Explicitní singleton model `SiteSettings`; veřejné read cesty nyní používají bezpečný fallback bez DB zápisu a bootstrap singletonu zůstává jen v owner admin workflow `Nastavení`.
- Server action a Zod validační vrstvu pro bezpečnou správu veřejných kontaktů, globálních booking pravidel a e-mailového senderu.
- Admin notifikační e-maily o nové a zrušené rezervaci posílané na konfigurovatelnou provozní adresu.
- ADR 0016 pro rozhodnutí kolem scope admin sekce `Nastavení` a volby explicitního singleton modelu.
- Produkční admin sekci `Kategorie služeb` pro `OWNER` i `SALON` s responzivním seznamem, filtrováním, výběrem kategorie a krátkou editací nad reálnými Prisma daty.
- Server action a Zod validační vrstvu pro bezpečnou editaci názvu, volitelného popisu, pořadí a aktivního stavu kategorie.
- Bezpečné mazání pouze pro prázdné kategorie bez navázaných služeb.
- ADR 0015 pro admin workflow kategorií služeb a bezpečné chování vazby kategorie -> služby.
- Produkční admin sekci `Služby` pro `OWNER` i `SALON` s responzivním seznamem, filtrováním, výběrem služby a jednoduchou editací nad reálnými Prisma daty.
- Server action a Zod validační vrstvu pro bezpečnou editaci názvu, popisů, délky, ceny, kategorie, pořadí a publikačních přepínačů služby.
- Nové pole `Service.isPubliclyBookable`, které odděluje interně aktivní službu od služby skutečně nabízené ve veřejném booking flow.
- ADR 0014 pro admin katalog služeb a oddělení veřejné rezervovatelnosti od obecné aktivity služby.
- `allowedDevOrigins` konfiguraci v `next.config.ts` pro dev přístup z LAN hosta `192.168.0.143`, aby Next.js neblokoval `/_next/webpack-hmr` a další dev-only assety při testování z jiného zařízení.
- Sdílené admin route factory funkce v `src/features/admin/lib/admin-route-factories.tsx` pro owner/salon overview, section, booking detail a slot route varianty.
- Sdílený admin shell layout wrapper `src/features/admin/components/admin-shell-layout.tsx` používaný napříč admin layout soubory.
- Nový týdenní planner dostupností pro `OWNER` i `SALON` nad 30min gridem s přímou editací kliknutím nebo tažením.
- Serverovou merge/split vrstvu, která skládá půlhodinové editace do souvislých intervalů `AvailabilitySlot` kompatibilních s public booking flow.
- Denní rychlou akci `nastavit den jako zavřeno`, týdenní akci `zkopírovat týden na další` a jednoduchou lokální šablonu týdne.
- Produkční základ projektu pro veřejný web, rezervace a admin sekce.
- Route groups pro `public`, `booking` a `admin`.
- Design tokens a sdílené layout komponenty pro luxusní prezentační web.
- Prisma schema v1 pro admin uživatele, služby, ručně vypisované sloty, klienty, rezervace, historii stavů, e-mailové logy, settings a bezpečné action tokeny.
- Databázová migrace s backfillem klientů, slot-service omezení a převodem `BookingRequest` na plnohodnotný `Booking`.
- Server-side env validace a auth skeleton s rolemi `OWNER` a `SALON`.
- `proxy.ts` ochrana admin cest podle konvencí Next.js 16.
- Architektonická dokumentace v `README.md` a nové ADR.
- Navazující review migrace pro explicitní režim omezení služeb na slotu, reschedule chain a DB ochranu proti překrývajícím se aktivním slotům.
- Veřejný prezentační web pro kosmetický salon s kompletní sadou obsahových stránek, detailů služeb a právních podstránek.
- Centrální obsahová vrstva `src/content/public-site.ts` pro snadnou výměnu placeholder textů, cen a foto briefů.
- Rezervační flow V1 na `/rezervace` se 4 kroky, server action submit handlerem a mobilním wizard UI.
- Veřejná booking service vrstva pro načtení služeb, publikovaných slotů a transakční vytvoření rezervace.
- Příprava storno URL a `EmailLog` payloadu pro potvrzovací e-mail při vytvoření rezervace.
- Placeholder route pro tokenizované storno odkazy na `/rezervace/storno/[token]`.
- PostgreSQL driver adapter setup přes `@prisma/adapter-pg` a `pg` pro Prisma 7 runtime.
- Role-aware admin IA s oddělenou navigací a routami pro full admin (`/admin/*`) a lite admin (`/admin/provoz/*`).
- Přehledové admin sekce nad reálnými Prisma daty pro rezervace, sloty, klienty, služby, kategorie, uživatele, email logy a nastavení.
- Serverové guard helpery pro admin area a sekce, včetně role-based redirectů a `notFound` ochrany neplatných cest.
- Produkční email delivery vrstva s režimy `log` a `background`, renderováním šablon a SMTP providerem v background režimu nad `EmailLog`.
- Skutečné veřejné storno rezervace přes tokenizovaný odkaz, potvrzovací krok a audit změny stavu.
- Metadata routes pro `robots.txt` a `sitemap.xml`.
- Booking error boundary, loading fallback a základní unit testy pro e-mailové šablony.
- ADR 0008 pro rozhodnutí kolem e-mailů a veřejného storna.
- Systemd units pro hlavní Next.js app a background e-mail worker.
- Deployment notes pro systemd a Docker Compose provoz workeru.
- Owner-only admin obrazovka pro pending/retrying emaily a poslední chyby workeru.
- Owner-only detail email logu s payloadem, chybou, ručním retry a uvolněním zaseknutého jobu.
- První produkční detail rezervace v adminu pro `OWNER` i `SALON`, včetně napojení ze seznamů a dashboardu.
- Produkční admin CRUD pro `AvailabilitySlot` v owner i salon oblasti, včetně seznamu, filtrů, detailu, vytvoření, editace, blokace a bezpečného mazání.
- Týdenní planner dostupností pro `OWNER` i `SALON` nyní zobrazuje rezervace, omezené intervaly, neaktivní sloty i minulý čas v jednom klidném kalendáři.

### Changed
- FAQ, detail služby a starší shared public varianty už také nepoužívají CTA blok `Rezervace bez zbytečných kroků`; hero `/cenik` byl zároveň zjednodušený bez pravého rezervačního boxu.
- Stránky `Domů`, `Služby` a `/cenik` už nezobrazují spodní CTA blok `Rezervace bez zbytečných kroků`, aby se stejné výzvy k rezervaci zbytečně neopakovaly.
- Stránka `O mně` prošla čistým spacing compression passem: zkrátil se vertikální rytmus sekcí, utáhl se padding karet a zhušťily se certifikace, aby stránka působila kompaktněji bez redesignu.
- Sekce `O mně` už v bloku `Co vás čeká` nezobrazuje postranní CTA kartu `Rezervace`; layout se vrátil na jeden širší obsahový panel, aby stránka působila klidněji.
- Z veřejných stránek `Kontakt` a `O mně` byly odstraněny koncové CTA bloky, aby se snížilo opakování výzev k rezervaci a stránky působily klidněji.
- Druhé kolo polish admin dashboardu zvětšilo pracovní plochu overview, potlačilo levou navigaci a přetáhlo důraz na hero kartu `Dnes`, čitelnější timeline a klidnější pravý sidebar.
- Overview dashboard teď používá větší desktop workspace rytmus: silnější hero, delší CTA, kompaktnější pravý panel a sekundárnější spodní KPI.
- Admin overview už nepoužívá generický hero se statistikami; nově je to tmavý SaaS-style dashboard zaměřený na dnešek, další klientku, čekající potvrzení a nejbližší volná okna.
- Levý admin sidebar dostal jemně utažený spacing, aby vedle nového dashboard workspace působil kompaktněji a nechával víc prostoru samotnému obsahu.
- Detail rezervace na `/admin/rezervace/[bookingId]` a `/admin/provoz/rezervace/[bookingId]` už není dlouhá hero/detail stránka; nově používá sticky header, jeden kompaktní souhrn, akční zónu, oddělené poznámky a hustší timeline historie.
- Z detailu rezervace byly sloučené a odstraněné překryvné bloky `Další krok`, `Kontext rezervace`, `Základní přehled` a `Operační souhrn`; jejich obsah se přesunul do jednoho summary panelu a krátkého stavového info boxu.
- Rychlé kontaktní akce `Zavolat klientce` a `Napsat e-mail` jsou nově dostupné přímo v horním sticky headeru spolu se stavem, zdrojem a akcí `Obnovit detail`.
- Akční panel detailu rezervace byl zhuštěný na skutečně provozní blok: používá menší spacing, silnější hierarchii stavových akcí a důvod zapisuje bez vedlejší poznámkové duplicity.
- Historie změn rezervace nově zobrazuje i stručný zdroj změny z metadata payloadu (`Akce detailu`, `Interní poznámka`), pokud je k dispozici.
- Rezervační řádky teď drží stabilní šířku akčního sloupce, takže `Potvrdit` / `Zrušit` už neposouvají čas a sloupce zůstávají zarovnané.
- Rezervační workspace dostal lehký polish: jemnější panel, kompaktní stats v jedné řadě, subtilní hover na řádcích a sloučené inline akce do menšího capsule bloku.
- Sekce `Rezervace` už nepoužívá vysoké vertikální karty; nově funguje jako kompaktní grid řádků se sticky headerem a sloupci `Rezervace`, `Čas`, `Status`, `Zdroj`, `Kontakt`, `Akce`.
- Horní statistiky sekce `Rezervace` byly zmenšené z velkých karet do jedné řady kompaktních souhrnných pill bloků, aby na obrazovce zůstalo víc samotných rezervací.
- Rezervační řádky byly zhuštěné na 1-2 textové řádky na buňku, s menším paddingem a barevnými badge pro rychlé čtení stavů `čeká`, `hotovo`, `zrušeno`.
- Sekce `Kategorie služeb` byla vizuálně dotažená blíž produkčnímu dark admin návrhu: horní souhrn je v jedné kompaktní liště, řádky seznamu jsou hustší a pravý detail panel má čistší formulářový layout se sticky footrem.
- Sekce `Kategorie služeb` už není jen responzivní seznam s vedlejším formulářem; nově funguje jako provozní list/detail workspace s výrazně kompaktnějším seznamem, sticky detailem a mobilním drawer UX.
- Sekce `Služby` už nepůsobí jako čistý detail editor; seznam nově slouží jako hlavní pracovní plocha s fulltextem, filtrem kategorie, stavovými badge, upozorněními a rychlými akcemi bez otevírání detailu.
- Sekce `Kategorie služeb` nově ukazuje pořadí, počet všech / aktivních / veřejných služeb, stavová varování a rychlé přechody do navázaných služeb.
- Formuláře služeb a kategorií mají přehlednější informační bloky, viditelnější success/error feedback a akce `Uložit` + `Uložit a zavřít`.
- Mobilní admin flow pro služby i kategorie používá oddělený detail otevřený přes query-driven view místo dlouhého seznamu a detailu pod sebou.
- Admin týdenní planner dostupností nově považuje slot s jakoukoli navázanou rezervací (včetně historických stavů jako `CANCELLED`/`COMPLETED`) za needitovatelný, takže úprava už nepadá na FK chybě a místo toho se interval správně chová jako uzamčený.
- `Rychly kontakt` na `/kontakt` nově doplnuje i oteviraci dobu `Po-Pa: Dle objednavek`.
- Kontakt prošel dalsim UX polischem: hero znovu ukazuje lehky rychly kontakt uz nad foldem a pravy vizualni panel byl zjemneny, aby nepusobil jako interní placeholder; spodni `Rychly kontakt` ma stale ikonky, ale znovu i male textove labely pro lepsi scan.
- Stránka `/kontakt` byla zjednodušená podle aktuálního UX zadání: sekce `Když váháte`, `Provozovatel` a `Rezervační režim` byly odstraněny, `Rychlý kontakt` se přesunul do pravého sloupce pod mapu (včetně údajů provozovatele) a pravý panel hero nyní drží vyhrazený placeholder prostor pro budoucí fotografii.
- `Map preview card` na `/kontakt` už nepoužívá jen stylizovaný placeholder; nově zobrazuje skutečný mapový náhled adresy s jemným overlayem a odkazem do Google Maps.
- Kontaktní stránka doplnila pod praktické informace klidný `map preview card` s přímým odkazem do Google Maps; adresa už se nezobrazuje dvakrát jako samostatná malá karta.
- Stránka `/kontakt` už neopakuje stejné kontaktní údaje ve dvou blocích za sebou: hero drží rychlý kontakt, spodní karty teď slouží jen pro praktické informace (`adresa`, režim rezervace).
- Stránka `/kontakt` dostala konverznější UX bez změny design language: nový hero s quick contact kartou (telefon/e-mail/Instagram), dvě CTA akce (`Rezervovat termín`, `Napsat do studia`), plně klikací kontaktní karty včetně Google Maps odkazu pro adresu, kratší guidance text, upravený spodní CTA banner pro scénář „vím / nevím“ a mobilní sticky CTA lištu s rychlou rezervací a kontaktem.
- Veřejný booking krok `Vyberte termín` už nepoužívá velké slot karty; po výběru dne zobrazuje kompaktní grid malých časových tlačítek, volitelné seskupení `Ráno / Dopoledne / Odpoledne / Večer` a detail termínu přesouvá až do summary panelu.
- Admin detail rezervace už nezobrazuje ani nepřenáší `referenční kód`; v hlavičce zůstává jen termín a interní admin datový model už `referenceCode` neobsahuje.
- Admin detail rezervace (`Změna stavu`) už nepoužívá select `Vyber akci`; volba stavu je nově přes dvě/tři akční karty jako tlačítka a aktivní výběr se okamžitě vizuálně zvýrazní podle typu akce (např. potvrzení zeleně, zrušení červeně).
- Admin detail rezervace dostal nový stavový hero blok s doporučeným dalším krokem, rychlým kontaktem na klientku a stručným kontextem rezervace bez nutnosti scrollovat do dalších panelů.
- Detail rezervace teď používá klidnější dvousloupcové rozvržení s operačním souhrnem, lépe oddělenými poznámkami klientky vs. interními poznámkami a čitelnější timeline historií změn.
- Blok `Změna stavu` nyní předvybírá nejpravděpodobnější akci a pod výběrem rovnou ukazuje krátké shrnutí dopadu i kontextový placeholder pro auditní důvod.
- Při vytvoření veřejné rezervace uvnitř delšího slotu s kapacitou `1` se slot nyní automaticky rozdělí na rezervovaný úsek a navazující volné fragmenty, aby admin planner mohl volné části dál upravovat po samostatných blocích.
- Výpočet dostupných časů v kroku 2 veřejné rezervace byl optimalizovaný z opakovaného porovnávání každého času se všemi rezervacemi na lineární průchod nad seřazenými intervaly, takže i delší sloty s více rezervacemi reagují rychleji.
- Veřejné rezervace už se po odeslání automaticky nepotvrzují; nově se zakládají jako `PENDING` a čekají na schválení v adminu.
- Klientská success obrazovka, submit CTA a potvrzovací e-mail wording byly přepsané na režim „rezervace přijata ke schválení“ místo okamžitého potvrzení.
- Databázová ochrana duplicit rezervací byla zpřesněná: místo širokého `UNIQUE(slotId, clientId)` nyní platí partial unique index `Booking_exact_duplicate_active_key`, který blokuje jen přesně duplicitní aktivní interval stejného klienta (`slotId + clientId + scheduledStartsAt + scheduledEndsAt` pro `PENDING/CONFIRMED`).
- Krok 2 veřejného rezervačního formuláře už nebere celý publikovaný interval jako jediný termín; nově nabízí konkrétní starty po 30 minutách uvnitř volného okna (např. 09:00, 09:30, 10:00) podle délky vybrané služby a aktuální kapacity.
- Stránka `/o-mne` byla kompletně přepracovaná do výrazně konverznější landing-page skladby `hero -> proč právě PP Studio -> příběh -> přístup -> co vás čeká + CTA -> certifikace -> finální CTA`.
- Hero sekce `/o-mne` nově vytahuje CTA výš, používá badge služeb a podporuje reálnou brand fotografii z `public/brand/ppstudio-portrait.jpg` se záložním elegantním placeholderem.
- Obsahový model `aboutContent` v `src/content/public-site.ts` byl rozšířený o novou IA stránky (`whyChooseMe`, hero CTA/badges, zjednodušený story/approach/expectations flow).
- Galerie certifikátů na `/o-mne` nově funguje i bez nahraných admin certifikátů: renderuje placeholder karty a je připravená na pozdější napojení na reálná data bez další změny layoutu.
- Jemný polish pass stránky `/o-mne` dotáhl proporce a hierarchii bez dalšího redesignu: silnější hero textový sloupec, prostornější benefit karty, propojenější sekce příběhu, klidnější rytmus karet v „Můj přístup“, vzdušnější CTA kartu a výraznější finální tmavý CTA blok.
- Finální UI polish stránky `/o-mne` ještě lehce posílil hero text vůči fotografii, sjednotil výšku benefit boxů, přidal decentní hovery na certifikace a opticky odlehčil sekundární CTA.
- Poslední micro polish stránky `/o-mne` vyvážil headline na hero, zvětšil mezery mezi obsahovými bloky a zvedl vizuální váhu finálního dark CTA bez zásahu do obsahu.
- Veřejné vytvoření rezervace nyní přijímá explicitní `startsAt` z formuláře a server-side potvrzuje, že zvolený interval opravdu leží uvnitř slotu a nekoliduje s existujícími rezervacemi.
- Veřejný web už nikde nezobrazuje přímý odkaz do admin přihlášení (`/admin/prihlaseni`); z hlavičky i homepage CTA zůstává jen klientská cesta k rezervaci.
- Krok 2 veřejného booking flow byl přepracovaný na variantu kalendář + seznam časů: klientka nejdřív vybere den v měsíčním kalendáři a pak konkrétní čas pro daný den.
- Krok 2 veřejného booking flow (`Vyberte termín`) nyní na kartách zobrazuje jednoznačný začátek rezervace jako hlavní údaj; rozsah času je přesunutý do sekundární informace `Konec v ... • Délka ...`, aby termín nepůsobil jako neurčité časové okno.
- Jemný spacing polish veřejného webu a rezervace: sjednocený vertikální rytmus sekcí (`py-10 / sm:py-14 / lg:py-16`), kompaktnější mobile hero spacing a lehce utažené rozestupy v rezervačním flow bez změny funkčnosti.
- Sjednocené šířky veřejných layoutů: stránky `/o-mne`, `/cenik` a booking error fallback už nepoužívají dodatečné zúžené wrappery (`max-w-4xl`, `max-w-5xl`, `max-w-[52rem]`, `max-w-3xl`) a drží jednotný `Container` rytmus (`max-w-7xl`).
- Veřejná sekce certifikátů na `/o-mne` už neřeže portrait soubory (`object-contain`) a nově podporuje klikací zvětšení v lightboxu.
- Stránka `/o-mne` byla zjednodušená blíž původnímu webu: bez portrétní fotky a bez sekce certifikátů, s přímočařejší skladbou `hero -> profil -> Můj příběh -> Můj přístup -> Na co se můžete těšit -> jemné CTA`.
- Implementace stránky `O mně` v `src/features/public/components/about-page.tsx` byla vizuálně zklidněná a obsahový model `aboutContent` byl zúžený jen na bloky, které jsou teď na stránce skutečně použité.
- Hero portrét na desktopu už nepoužívá `lg:h-full`; má pevnou výšku `lg:h-[31rem]`, takže je reálně menší a lépe sedí k levému textovému bloku.
- Pravý hero sloupec byl přepnutý na `flex` layout, aby se výška portrétu na desktopu spolehlivě dorovnávala k levému obsahovému bloku až po CTA poznámku.
- Logo v homepage hero je nyní centrované v levém bloku a portrét na desktopu znovu používá `lg:h-full`, aby držel výšku levého obsahu.
- Logo v homepage hero bylo znovu zvětšené a dostalo jemný stín pro lepší čitelnost; portrét má teď explicitně menší výšku (`16/20/24rem`) pro klidnější horní fold.
- Na homepage byl odstraněn eyebrow text `Kosmetický salon Zlín`; hero je na desktopu zarovnaný výš a portrét se nyní na `lg+` natahuje na výšku levého bloku.
- Logo v homepage hero bylo zvětšené a už nepoužívá bílé kruhové pozadí ani rámeček, aby působilo přirozeněji a blíž původnímu webu.
- Umístění loga v homepage hero bylo posunuté blíž k hlavnímu nadpisu (`eyebrow` je nově nad logem), aby kompozice více odpovídala původnímu webu.
- Homepage hero portrét byl zmenšený a pod portrétem byly odstraněny tři doprovodné boxy, aby horní fold působil klidněji.
- Homepage hero nyní umí přes obsahový config vykreslit logo a portrét (`logoImage`, `portraitImage`) přes `next/image`.
- Homepage byla vizuálně přiblížená původnímu webu: hero teď používá brand nadpis `PP Studio`, benefit štítky, CTA poznámku a čistý pravý portrét bez doprovodných karet.
- Homepage public copy byla přeuspořádaná podle osvědčeného toku ze starého webu (jasnější hero, silnější CTA na rezervaci/ceník, přímější „nejste si jistá“ guidance) při zachování současného design systému a komponent.
- Subtitle `COSMETICS & LAMINATIONS` v levé části hlavičky se nově zobrazuje na všech stránkách používajících `SiteHeader`, nejen na homepage.
- Stejný brand subtitle `COSMETICS & LAMINATIONS` je nově viditelný i v admin sidebaru pod `PP Studio` pro konzistentní branding napříč webem i správou.
- Veřejný brand copy na homepage, stránce `O mně`, `Kontakt`, `Služby` a `Ceník` byl přepsaný do kratšího, osobnějšího a méně generického tónu bez interního placeholder jazyka.
- Public read model služeb v `src/features/public/lib/public-services.ts` nově umí přepisovat interní názvy na jemnější public varianty a drží ručně kurátorované krátké popisy podle skutečných služeb z databáze.
- Stránka `/cenik` je rozdělená do vizuálně oddělených kategorií ve stylu samostatných sekcí s vlastní hlavičkou; obsah je zúžený do čitelnější šířky, bez počtu služeb v kategorii a bez popisku `Cena od`, s novou typografickou hierarchií zvýrazňující cenu, klidnější názvy služeb a čitelnější popisy.
- Tón textů v adminu byl sjednocen napříč `Nastavení`, `Službami`, `Kategoriemi`, `Rezervacemi` i přehledy, aby celé prostředí působilo klidněji a konzistentněji.
- Admin sekce `Nastavení` dostala další vizuální a textový polish: orientační blok nahoře, kratší mikrocopy a jemnější hierarchii panelů bez změny logiky.
- Admin sekce `Nastavení` prošla druhým kolem UX úprav: společný formulářový skeleton, kratší popisky, jasnější názvy polí a lepší mobilní rozložení bez zásahu do business logiky.
- Admin ukládání `emailSenderEmail` nyní v `EMAIL_DELIVERY_MODE=background` odmítne adresu odlišnou od `SMTP_FROM_EMAIL`, aby se předešlo produkčním `EmailLog FAILED` kvůli SMTP policy.
- SMTP provider vrstva má bezpečný fallback envelope senderu na `SMTP_FROM_EMAIL` a warning log, pokud DB sender neprojde policy.
- Root metadata branding (`applicationName`, title template, OpenGraph `siteName`) bere název salonu ze `SiteSettings`; canonical URL base zůstává na `NEXT_PUBLIC_APP_URL`.
- Veřejný footer, kontaktní stránka, FAQ, storno podmínky a e-mailové šablony teď čerpají kontaktní údaje a storno pravidlo ze `SiteSettings` místo z natvrdo zapsaných placeholderů.
- Veřejný booking katalog i finální potvrzení rezervace nově respektují globální minimální předstih a maximální horizont rezervace ze settings.
- Self-service storno přes token nově respektuje globální storno limit před termínem; pozdější zásah už klientce srozumitelně doporučí kontaktovat salon.
- Běžný text webu nyní používá `Inter` místo `Manrope`, zatímco nadpisy a logo používají `Playfair Display` místo `Cormorant Garamond`.
- Domovská stránka teď v levé části hlavičky pod `PP Studio` zobrazuje doplněk `COSMETICS & LAMINATIONS`.
- Sekce `Kategorie služeb` už není jen read-only přehled v `admin-data`; route `/admin/kategorie-sluzeb` a `/admin/provoz/kategorie-sluzeb` renderuje samostatný pracovní workflow se seznamem a editací.
- Admin sekce `Služby` prošla druhým kolem UX zjednodušení: oddělený toolbar, čitelnější formulář po sekcích, kompaktnější seznam a lepší mobilní čitelnost bez změny business logiky.
- Veřejný booking katalog a server-side potvrzení rezervace nově vyžadují u služby nejen `isActive`, ale i `isPubliclyBookable`, takže admin může službu ponechat aktivní pro interní provoz a současně ji skrýt z veřejného bookingu.
- Veřejné stránky `/sluzby`, `/cenik` a detail služby jsou nově napojené na DB request-time read model, takže admin změny služeb se projeví bez rebuildů.
- Úvodní stránka teď používá stejný DB katalog pro featured služby, aby odkazy na detail služby zůstaly konzistentní.
- Sekce `Služby` už není jen read-only přehled v `admin-data`; route `/admin/sluzby` a `/admin/provoz/sluzby` renderuje samostatný pracovní workflow se seznamem a editací.
- Rezervační planner v adminu nyní používá pracovní okno `06:00-20:00` místo celého dne (`00:00-24:00`): mřížka má 28 půlhodinových buněk a serverové validace/cell mapování byly sjednocené na stejný rozsah.
- Admin shell layout byl vizuálně stabilizovaný pro desktop i mobil: širší sidebar na `lg+`, sticky pozice navigace, ochrana proti horizontálnímu přetékání a `min-w-0` pro hlavní obsah.
- Admin page shell dostal responzivní typografii (nadpisy/stats) a jemnější spacing, aby se sekce nelámaly na menších šířkách.
- Owner a salon route soubory v `src/app/(admin)/admin/*` a `src/app/(admin)/admin/provoz/*` byly zredukované na tenké wrappery, které pouze předávají `area` do sdílené factory logiky při zachování stejných URL a oprávnění.
- Route varianty sekce `volne-terminy` (`list`, `novy`, `detail`, `upravit`) teď vedou do stejného týdenního planneru; detail/edit URL se přesměrují do správného týdne.
- Výchozí Next.js demo bylo nahrazeno čistým škálovatelným scaffoldingem pro produkční vývoj.
- `.env.example` nyní pokrývá databázi a bootstrap admin přístupy.
- Lite admin role byla v databázové vrstvě přejmenovaná z `STAFF` na `SALON`.
- `AvailabilitySlot` už není navázaný na jednu službu; omezení služeb je řešené přes M:N vazbu.
- Slot teď explicitně říká, zda bere libovolnou službu nebo jen vybrané služby.
- Hlavní navigace a footer nyní odpovídají IA veřejného webu a posilují cestu k rezervaci i důvěru.
- SEO metadata veřejných stránek jsou sjednocená přes globální metadata base a per-page metadata.
- Rezervační stránka už není statický placeholder; načítá reálné služby a ručně publikované sloty z databáze.
- Veřejné booking flow má přesnější server-side validaci, retry při serializable konfliktech a konkrétnější chybové stavy pro stale službu, stale slot i duplicitní rezervaci stejného klienta.
- Veřejný booking submit má lehký rate limit, auditní log pokusů a blokací a krok 2 už schovává sloty kratší než vybraná služba.
- Admin UI už není jen dvojice placeholder dashboardů; `OWNER` a `SALON` mají odlišné rozhraní, navigaci a úroveň detailu.
- Přesměrování po loginu i při nedostatečném oprávnění se teď řídí centrální helper funkcí podle role.
- `SALON` rozhraní má kratší menu, méně technický jazyk a rychlé akce pro přidání termínu a práci s rezervací.
- Rezervační flow už po úspěšném commitu rovnou zpracovává potvrzovací e-mail a ve UI rozlišuje, zda delivery proběhla nebo selhala.
- Placeholder storno route byla nahrazená produkčním flow nad `BookingActionToken`.
- Root metadata byla rozšířená o základní SEO signály pro nasazení v1.
- Admin rezervace už nejsou jen read-only seznam; detail nyní umožňuje server-side změnu stavu s důvodem, interní poznámkou a auditní historií.
- Sekce `Volné termíny` se posunula z reset placeholderu na produkční týdenní planner bez samostatného formulářového workflow pro běžnou obsluhu.
- Ukládání dostupnosti nově chrání rezervace a složitější sloty server-side a zapisuje jen minimální sadu souvislých intervalů bez zbytečné fragmentace.
- Druhé kolo planneru zjednodušilo mobilní workflow na kompaktní výběr dne, přesunulo sekundární akce do klidnějšího bloku a rozdělilo velkou klientskou komponentu na menší UI části.
- Dokumentace byla srovnaná s aktuálním kódem: týdenní planner, `EMAIL_DELIVERY_MODE=background` a produkční migrace přes `prisma migrate deploy`.

### Fixed
- Admin detail voucheru nově podporuje bezpečnou provozní editaci kupujícího, e-mailu, platnosti a interní poznámky a ruční zrušení voucheru bez fyzického mazání.
- Zrušený voucher se ukládá jako stav `CANCELLED` s `cancelledAt`, `cancelledByUserId`, `cancelReason` a `updatedByUserId`; OWNER i SALON mají pro tyto provozní akce stejná práva.
- Veřejné ověření voucheru a admin uplatnění respektují stav `CANCELLED`; veřejnost vidí jen neutrální neplatný stav bez interního důvodu zrušení.
- Unit test `src/features/booking/lib/booking-management.test.ts` už nehlásí ESLint warning `@typescript-eslint/no-unused-vars`; byl odstraněn nepoužitý import `BookingStatus`.
- Import admin overview stránky na `DashboardPage` nyní používá absolutní alias `@/features/...`, takže v dev režimu už nedochází k chybě `Module not found: Can't resolve './admin-dashboard-page'`.
- Planner už neukládá každé kliknutí okamžitě na server; změny se nejdřív drží v lokálním konceptu týdne, takže při rychlé práci neodskakuje layout ani denní kontext vpravo.
- Admin shell a sidebar v sekci planneru už nemají zbytečně velkou vizuální váhu; hlavní prostor dostala týdenní mřížka a mobilní navigace se přesunula do draweru.
- Kalendář v kroku 2 na `/rezervace` už není závislý na locale formátu `Intl.DateTimeFormat().format()`: klíče dnů se teď skládají stabilně přes `formatToParts` do `YYYY-MM-DD`, takže se znovu správně vykreslí měsíce i dostupné dny napříč prostředími/browsery.
- Krok 2 veřejné rezervace má pro kalendářní mřížku explicitní `gridTemplateColumns: repeat(7, minmax(0, 1fr))` přímo v komponentě, takže při runtime CSS driftu nespadne do jednokolonového layoutu.
- Admin planner už při aktivním výběru (`Přidáváte/Odebíráte`) neskáče ve layoutu; status box má fixní výšku i v prázdném stavu, takže mřížka zůstává stabilní během kliknutí i tažení.
- Změna stavu rezervace v admin detailu už nepadá na FK `BookingStatusHistory_actorUserId_fkey` při bootstrap přihlášení; server action nyní mapuje session na reálné `AdminUser.id` podle e-mailu a při nenalezení ukládá historii s `actorUserId = null`.
- Admin weekly planner klient už nemění velikost dependency pole v `useEffect` během React Fast Refresh; zmizela dev chyba `The final argument passed to useEffect changed size between renders`.
- Admin weekly planner už při kliknutí/tažení v mřížce neprovádí okamžitý `router.replace` na query `day`, takže během editace „neuskočí“ rozložení stránky.
- Admin weekly planner při `router.refresh()` po uložení už zbytečně neremountuje client část podle `initialDayKey`; výběr dne proto zůstává stabilní i po úspěšné akci.
- Admin weekly planner už při `pointerdown` nemění aktivní den v postranním panelu; den se synchronizuje až po úspěšném dokončení akce, takže klik na jednu půlhodinu se neroztáhne na delší blok kvůli průběžnému reflow.
- Výběr rozsahu v planneru byl přepnutý z `pointerenter` na `pointermove` s kontrolou stisku tlačítka myši, aby se rozsah nepřepočítával bez reálného tažení a kliknutí na 30 minut zůstalo 30 minut.
- Planner při běžně úspěšném výběru už nezobrazuje success flash nad mřížkou a blok `SelectionStatus` má stabilní výšku i bez aktivního draftu, takže při kliknutí/tažení dál neuskakuje layout.
- Výběr dne v admin planneru je nyní odvozený z URL (`day`) a aktivního draftu místo lokálního sync state; kliky na dny nad kalendářem znovu spolehlivě přepínají den bez návratu původního „uskočení“.
- Admin týdenní planner už po vytvoření krátké rezervace uvnitř delšího slotu „neschová“ zbytek intervalu; slot se nyní v planneru rozpadá na rezervovanou část a navazující chráněný zbytek, takže blok zůstává vizuálně čitelný.
- Veřejná rezervace už nepadá při prázdném telefonu na Prisma `P2011` (`Null constraint violation`): DB sloupec `Booking.clientPhoneSnapshot` je nově nullable migrací `20260420125500_booking_client_phone_nullable_fix` a historicky rozjetý název PK constraintu byl sjednocen migrací `20260420130500_rename_booking_primary_key_constraint`.
- Admin auth redirecty (`/api/auth/login`, `/api/auth/logout` a guard v `proxy.ts`) nyní skládají absolutní URL přes `x-forwarded-host`/`x-forwarded-proto` (s fallbackem na `request.url`), takže při provozu za reverzní proxy nepřepisují doménu na interní `localhost`.
- Rozpadlý layout homepage hero po přidání loga: logo má nově fixní render box s `next/image` `fill`, takže už neroztahuje levý sloupec.
- Homepage hero na desktopu už není přilepený ke spodní hraně (`lg:items-center` místo `lg:items-end`) a portrét má klidnější výšku, takže vlevo nevzniká velká prázdná plocha.
- Hlavička veřejného webu už v browseru nespouští validaci serverových env proměnných; brand text je teď lokální a subtitle na domovce zůstává zachovaný.
- Opravené označování `Minulý čas` v admin planneru: budoucí dny už nejsou chybně blokované podle aktuální hodiny dneška.
- Planner UI nyní používá pevný počet 28 řádků pro pracovní okno `06:00-20:00`, takže se mřížka nerozjíždí ani při rozjetých datech nebo zastaralém client payloadu.
- Planner grid už negeneruje extra řádky bez časových popisků; výška mřížky se nyní primárně řídí `timeLabels` (pracovní okno), a ne nekonzistentní délkou buněk v payloadu.
- Opravené Next.js 16 `use server` chyby: server action soubory už exportují pouze `async` funkce; initial action state objekty byly přesunuté do samostatných modulů pro client komponenty.
- Root layout nově obsahuje `data-scroll-behavior=\"smooth\"`, takže při zapnutém `scroll-behavior: smooth` na `<html>` už nevzniká runtime warning při route přechodech.
- Planner inspektor už nehlásí React warning o duplicitním key (`4-5`) u seznamu `Volná okna`; klíče položek se nyní skládají z `dateKey + range + index`, takže zůstanou unikátní i při duplicitních fragmentovaných intervalech v read modelu.
- Planner grid už negeneruje přesažené prázdné řádky při rozjezdu mezi počtem `timeLabels` a počtem buněk v datech dne; vykreslení je nyní svázané s reálným počtem dostupných buněk.
- Planner kalendář už nemůže zmizet při nekonzistenci dat z klienta/serveru; počet vykreslených řádků se bere bezpečně z dostupného maxima (`timeLabels` vs. `cells`) místo průniku.
- Výpočet začátku týdne v planneru už nepoužívá UTC den týdne, ale lokální kalendářní den (Praha), takže týden se znovu otevírá správně od pondělí místo posunu na úterý.
- Ukládání změn dostupnosti už nepadá na FK `createdByUserId` při bootstrap přihlášení: server action nyní mapuje session na reálného `AdminUser` podle e-mailu a když záznam neexistuje, uloží slot s `createdByUserId = null`.
- Cross-origin blokaci Next.js dev serveru při otevření aplikace z LAN adresy `192.168.0.143`, která rozbíjela HMR přes `/_next/webpack-hmr`.
- Návrh datové vrstvy už nespoléhá na zjednodušený booking request model bez auditní historie a bez bezpečných tokenů.
- Datový model lépe chrání proti náhoditému duplicitnímu bookingu stejného klienta do stejného slotu.
- Veřejný web už není omezený na technický placeholder homepage bez struktury pro reálný salonní obsah.
- Veřejný booking zápis nyní znovu ověřuje slot v transakci a lépe chrání proti dvojité rezervaci při souběžném submitu.
- Storno odkaz už není slepý placeholder bez skutečné server-side akce.
- E-mailová komunikace kolem rezervací má auditovatelný stav `SENT` / `FAILED` místo pouhého připraveného payloadu.
- Admin `Email logy` už se nerozbije na zastaralém generovaném Prisma klientu; `dev` i `build` si předem automaticky generují aktuální client.
- Lite admin navigace znovu ukazuje všechny sdílené provozní sekce, takže dostupné routy odpovídají menu.
- Dynamické admin sekce `/admin/[section]`, `/admin/provoz/[section]` a `/admin/email-logy/[emailLogId]` už se renderují v admin shellu i při přímém otevření URL, takže se neresetuje vzhled na veřejný theme background.
- Slot formuláře a server actions nyní zachytí nekonzistence dřív, než spadnou na DB constraintu: časové pořadí, překryvy, podstřelenou kapacitu i neplatné omezení služeb.
- Slot status/delete akce nově vrací chybový flash kontext, takže obsluha hned vidí, proč akce neprošla.
- Admin sekce `/admin/sluzby` už nespouští zbytečný detailový dotaz při čistém list view (`serviceId` není v URL), seznam služeb načítá jen potřebné sloupce a agregace stavů běží přes jeden `groupBy` dotaz místo čtyř samostatných `count`; tím se výrazně zkrátil serverový čas odpovědi v devu a omezily navazující Turbopack `ChunkLoadError` při dlouhém renderu.

### Removed
- Výchozí create-next-app homepage.
- Reset komponenta `src/features/admin/components/admin-slots-reset-page.tsx`.
- Původní implementace planneru, formulářů a slot detail/edit workflow byla z feature vrstvy odstraněná:
  - `src/features/admin/components/admin-slots-page.tsx`
  - `src/features/admin/components/admin-slot-form.tsx`
  - `src/features/admin/components/admin-slot-planner-forms.tsx`
  - `src/features/admin/components/admin-slot-detail-page.tsx`
  - `src/features/admin/actions/slot-actions.ts`
  - `src/features/admin/lib/admin-slot-repository.ts`
- Produkční `robots.txt` už neomezuje crawl jen na vybrané veřejné sekce; celý veřejný web je nyní pro roboty otevřený přes `Allow: /`, zatímco admin a tokenové self-service routy (`/rezervace/storno/*`, `/rezervace/sprava/*`, `/rezervace/akce/*`) zůstávají blokované.
- Mobilní detail rezervace v adminu už při potvrzení služby nepřekrývá první akční kartu sticky hlavičkou; booking header je sticky až od desktop breakpointu, takže CTA a stavový chooser zůstávají na telefonu plně čitelné.
- Našeptávač v admin rezervacích už při běžném textu nenabízí e-mailové a telefonní kontakty; ty se zobrazí jen pro dotazy připomínající kontakt. Z pole zároveň zmizel rušivý text `OK` a spodní pomocná věta, takže dropdown nepůsobí průhledně ani přeplácaně.
- Z inspektoru dne v admin planneru `Volné termíny` zmizela celá karta `Akce dne`; pravý panel teď drží už jen souhrn dne a detail aktuálního výběru bez samostatných denních tlačítek.
- Z inspektoru dne v admin planneru `Volné termíny` zmizela sekce `Kopírovat rozvrh z jiného dne`, takže UI už nenabízí matoucí copy-day workflow.
- Z backendu planneru `Volné termíny` zmizela i nepoužívaná copy-day mutace a její integrační DST test; v kódu i dokumentaci zůstává už jen podporované kopírování celého týdne.
- V admin planneru `Volné termíny` zanikla i dřívější duplicitní CTA větev kolem `Vymazat dostupnost`; po zjednodušení inspektoru se denní akce už vůbec nezobrazují.
- Aktualizován `@playwright/test` z `^1.59.1` na `^1.61.1`, protože větev `1.59.1` se v GitHub Actions na `Node 24.18.0` zasekávala při `npx playwright install --with-deps chromium` po stažení Chrome for Testing; upgrade přebírá upstream fix extractoru pro novější Node a odblokovává CI bez dopadu na produkční runtime.
- `deploy/release.sh` už nenačítá produkční `.env` přes shellové `source`, ale vlastním dotenv parserem. Release tak nespadne na hodnotách s mezerami bez uvozovek, například `NEXT_PUBLIC_APP_NAME=PP Studio`, a místo toho korektně exportuje proměnné do buildu.
- `deploy/release.sh` teď při releasu používá `npm ci --include=dev`, protože po načtení produkčního `.env` s `NODE_ENV=production` npm jinak vynechal `devDependencies` a rollout padal na chybách typu `eslint: not found`.
- `package.json` nově drží npm 11 `allowScripts` whitelist pro `prisma`, `@prisma/engines`, `sharp`, `esbuild` a `unrs-resolver`, takže produkční release přestal spamovat `npm warn allow-scripts` a budoucí upgrady těchto balíčků zůstávají vědomě re-reviewované přes verzi připnuté záznamy.
- `deploy/release.sh` nově buildí v izolovaném staging workspace vedle repozitáře a na živé produkci už dělá jen krátký `stop -> swap .next + node_modules -> start`. Tím mizí přechodné `MODULE_NOT_FOUND` / chybějící `.next` artefakty, které dřív vznikaly při `npm ci` a `next build` nad běžícím webem.
- Provozní dokumentace teď explicitně popisuje i nové pořadí `git pull --ff-only -> staging npm ci --include=dev -> db:generate -> db:check-migrations -> prisma migrate deploy -> lint -> build -> stop/swap/start systemd`, aby byl zachovaný původní release obsah, ale s minimálním výpadkem.
- Owner Pushover alert `SYSTEM_ERROR` je nově centralizovaný přes shared helper a pokrývá i další runtime chyby serveru: selhání DB checku na `/api/health`, fallback `admin analytics` API, self-service i admin booking reschedule, ruční tvorbu rezervace, public booking schema drift, selhání enqueue navazujícího reschedule emailu, planner mutace volných termínů, kritické voucher operace/email akce a owner resend invite flow.
- Playwright E2E build teď explicitně nastavuje `NEXT_PUBLIC_APP_URL` podle `PLAYWRIGHT_BASE_URL` a současně drží `NEXT_PUBLIC_SITE_URL=https://ppstudio.cz`, takže produkční admin login/logout redirecty a proxy přesměrování už v testech neskočí na build-time interní host a neshodí browser flow na `ERR_CONNECTION_REFUSED`.
