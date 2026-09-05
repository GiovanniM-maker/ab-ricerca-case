# Scraping col browser (per i siti che rispondono 403)

StreetEasy, Zillow, Apartments.com e RentHop rifiutano gli script. Non è una
questione di login: bloccano **prima**, guardando l'IP e l'impronta del client.
Da un server in cloud arriva 403 anche con un account valido; dal tuo Mac, con
Chrome vero e IP residenziale, passa.

Quindi il download avviene **solo sul tuo Mac**. Lo script salva l'HTML grezzo;
a estrarre gli annunci ci pensa poi il solito Python.

```
fetch.mjs (Mac, browser vero)  ──►  pages/*.html  ──►  rental_radar (Python)  ──►  listings.json
```

## Preparazione (una volta sola)

```bash
cd ~/ab-ricerca-case && git pull
cd apps/scraper/browser
npm install && npx playwright install chromium
```

Lancia `npm install` **dentro questa cartella**: c'è un `package.json` apposta,
così `node_modules/` non finisce nella root del repo.

## Login (una volta per sito, e solo se serve)

```bash
node fetch.mjs --login streeteasy
```

Si apre una finestra vera. Loggati, risolvi l'eventuale captcha, apri una
ricerca qualsiasi per controllare che i risultati si vedano, poi premi INVIO nel
terminale. La sessione resta in `.profile/` e viene riusata dai crawl successivi.

Molti siti si fanno leggere anche **senza login**: prova prima senza, il login è
il piano B.

## Crawl

```bash
node fetch.mjs streeteasy      # un sito
node fetch.mjs --all           # tutti quelli in targets.json
node fetch.mjs --headed zillow # con finestra visibile, per capire cosa succede
```

Se becca 3 pagine-muro di fila si ferma e ti dice di rifare il `--login`.
Fra una pagina e l'altra aspetta 3-7 secondi a caso: è lento apposta, un ritmo
da bot è il modo più veloce per farsi bannare l'account.

## Estrazione

```bash
cd ..
python3 -m rental_radar.run --source streeteasy
```

Oppure lascia fare tutto a `bash crawl-all.sh`: se trova `pages/<sito>/` lo
include da solo, altrimenti lo salta senza lamentarsi.

## Quando un sito cambia forma

Il parser non insegue i nomi dei campi: cerca oggetti JSON con delle coordinate
dentro New York e da lì raccoglie prezzo, stanze, metratura e link. Regge bene i
restyling. Se però un sito smettesse di dare risultati:

```bash
python3 -m rental_radar.sources.saved_html streeteasy
```

Stampa quanti blob JSON ci sono in ogni pagina, quanti oggetti hanno coordinate
e con che nomi di campo. Da quell'output si capisce subito se il problema è il
parser o se hai salvato una pagina-muro.

## Cosa NON finisce nel repo

`.profile/` (i tuoi cookie di sessione) e `pages/` (HTML grezzo, centinaia di
KB a pagina) sono in `.gitignore`. Nel repo vanno solo gli annunci normalizzati.

## Nota

Questi portali vietano lo scraping nei termini d'uso. È uso personale a volume
basso, ma il rischio concreto è che l'account con cui ti logghi venga sospeso.
Se ti preoccupa, usa i siti senza login: nella maggior parte dei casi funziona
lo stesso.

## Modificare le ricerche

`targets.json`: sono URL normali. Aprili prima nel browser per verificare che
diano risultati, poi incollali lì. `pages` decide quante pagine di risultati
scaricare per ogni ricerca.
