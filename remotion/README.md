# Remotion — grafică peste videoul asamblat (Faza 1)

Adaugă peste videoul deja lipit de fal (`Link Video Final`): intro cu titlu, subtitrări
sincronizate pe scenă, progress bar, outro cu subscribe. Dacă rezultatul convinge,
Faza 2 înlocuiește fal complet (Remotion face și tăierea scenelor, cu tranziții).

## 1. Preview local — Remotion Studio

Studio e un player în browser cu timeline, scrubbing pe cadru și **reload la salvare**:
schimbi o valoare în `src/`, salvezi, și cadrul se redesenează. E singurul mod sensibil
de a regla grafica — o randare completă doar ca să vezi cum arată un card e risipă.

```
cd remotion
npm install
npm run studio        # trage ultimele modificări, apoi deschide localhost:3000
```

`npm run studio` (vezi `scripts/studio.mjs`) trage ultimele modificări înainte
să pornească și **scrie într-un banner ce s-a întâmplat** — ce commit-uri au
intrat, sau, dacă pull-ul a eșuat, faptul că rulezi cod vechi. Un pull sărit în
tăcere e cel mai prost rezultat posibil: preview-ul arată vechi și pare că
reparația n-a funcționat.

Trage cu `--autostash`, deci modificările tale locale nu-l pot bloca — nici
măcar un `package-lock.json` atins de `npm install`, care singur era de ajuns
înainte ca să te țină pe cod vechi la nesfârșit.

Ca să arăți preview-ul spre footage-ul tău, **pune un mp4 în `remotion/public/`
și atât** — scriptul îl găsește singur (`test.mp4` prin convenție, altfel cel
mai recent) și ți-o spune în banner. Nu edita niciun JSON.

Dacă vrei totuși alte props (alt proiect, alte scene), **nu edita fixture-ul
urmărit de git**: copiază-l în `trigger/studio-props.local.json` (gitignorat).
Scriptul îl preferă automat dacă există, deci nu se ciocnește cu un pull. Un
`finalVideoUrl` scris explicit acolo bate detectarea automată.

Scriptul refuză să pornească dacă portul 3000 e deja ocupat. Altfel Remotion
doar redeschide instanța veche — cod vechi, props vechi — și pare că nimic nu
s-a schimbat. Notă: site-ul din `platform/` folosește tot 3000.

`npm start` nu trage nimic niciodată.

**Studio se reîncarcă singur la salvare**, deci după un `git pull` cu fișiere
*modificate* nu trebuie repornit. Repornește-l doar când apare un fișier
**nou** — watcher-ul îl ratează uneori.

`npm run studio` încarcă `trigger/studio-props.json` — props capturate dintr-o execuție
reală de Final Assembly (proiect 9:16, ton Emotional, 41,8s, un card de capitol la 7,7s),
ca să nu te uiți la scene inventate. Panoul de props din dreapta e editabil live: comută
`showHookTitle` / `showChapterCards` / `showCaptions`, schimbă `tone` ca să vezi alt preset
tipografic, sau `aspectRatio` pe `16:9`. Nimic din ce editezi acolo nu se scrie pe disc.

`npm start` pornește Studio fără props, pe `defaultProps` din `src/types.ts`.

**Videoul sursă e efemer.** `finalVideoUrl` din fixture arată spre `/output` de pe
serverul de randare, iar Railway pierde directorul ăla la redeploy. Când dă 404, pune
orice mp4 asamblat în `remotion/public/` și repornește — restul se rezolvă singur.
Fișierele media din `public/` sunt gitignorate, deci nu ajung în repo; folderul însuși
vine cu repo-ul doar pentru că are un `README.md` în el — git nu urmărește directoare
goale, iar fără el calea din instrucțiuni pur și simplu nu exista.

**O cale ca `/test.mp4` nu se resolvă singură** — Remotion nu servește `public/` de la
rădăcina site-ului, dă `"/test.mp4" was requested but not found` și randarea moare.
`SourceVideo` o trece acum prin `staticFile()` automat (orice nu e `http(s):` / `blob:` /
`data:`), deci scrierea evidentă funcționează și URL-urile de producție trec neatinse.
Ce scria aici înainte — „un URL relativ se resolvă exact ca staticFile()" — era fals.

Ca să prinzi props proaspete pentru alt proiect: execuția de Final Assembly din n8n →
nodul `Build Remotion Props` → copiază `body` din output.

### Montajul — `npm run check:montage`

Videoclipurile ieșeau ca **o singură cadră**: la pragul folosit pe cele cinci
documentare de referință, filmul nostru înregistra un singur cut, pentru că
scene consecutive împart subiectul, locația și încadrarea.

`src/montage.ts` rezolvă asta **fără să atingă media** — nu reordonează și nu
taie nimic din timeline. Reîncadrează același footage continuu, iar saltul
brusc de scală/poziție e ceea ce se citește ca tăietură, exact cum un monteur
intră în plan pe aceeași dublă. Ritmul e planificat pe tot filmul, nu pe
scenă: un HOLD înghite mai multe scene (singurul mod de a ajunge la cadrele de
10s+ pe care le au toate referințele), un BURST taie o scenă în 4-8 inserturi
rapide, restul se taie ușor.

```
npm run check:montage                      # fixture-ul de Studio, intensity 1 si 2
npm run check:montage -- --intensity 2
npm run check:montage -- trigger/altele.json
```

Raportează ritmul (variabilitate, cea mai scurtă/lungă cadră) **și** mărimea
reală a saltului la fiecare tăietură planificată. A doua parte e cea care
contează: statisticile de ritm pot arăta perfect în timp ce filmul se citește
tot ca o singură dublă, dacă încadrările consecutive se nimeresc egale. Iese cu
cod diferit de zero la orice tăietură slabă. Rulează-l după orice modificare în
planner.

`montageIntensity` (0 / 1 / 2) vine din props; implicit se ia din energia
tonului. **0 lasă scenele întregi, exact ca înainte de montaj** — deci
comutarea lui în panoul de props din Studio, pe același footage, e chiar
comparația înainte/după. E scris explicit în `studio-props.json` ca să-l
găsești fără să știi numele câmpului.

Ca să-l vezi pe un video real deja făcut — nu trebuie generat nimic, montajul
se aplică la randare, peste videoul deja asamblat:

```
cd remotion
mkdir -p public                                   # dacă nu există deja
cp ~/Downloads/<Link Video Final>.mp4 public/test.mp4
cp trigger/studio-props.json trigger/studio-props.local.json
#   … și în .local.json:  "finalVideoUrl": "/test.mp4"
npm run studio
```

## 2. Deploy pe Railway (fără AWS — calea aleasă acum)

Serverul din `server/index.mjs` randează pe cerere și servește fișierul rezultat prin
HTTP simplu — n8n îl apelează exact ca pe fal/useapi (POST → poll status → download).

**Pași:**

1. [railway.app](https://railway.app) → login cu GitHub (gratis, fără card la înscriere).
2. **New Project → Deploy from GitHub repo** → alege `fermafabiz-lab/n8n`.
3. **Settings → Root Directory** → setează `remotion` (repo-ul are și alte foldere,
   Railway trebuie să construiască doar din acesta).
4. Railway detectează `Dockerfile`-ul automat și îl folosește la build.
5. **Variables** → adaugă `RENDER_API_KEY` = un secret la alegerea ta (orice șir lung,
   random). Ăsta e header-ul cu care n8n se va autentifica.
6. După primul deploy, Railway îți dă un URL public (ex.
   `https://<proiect>.up.railway.app`). Notează-l — e `RENDER_SERVER_URL` de mai jos.
7. Testează sănătatea: `curl https://<proiect>.up.railway.app/health` → `{"ok":true}`.

## 3. Testează o randare manual

```
curl -X POST https://<proiect>.up.railway.app/render \
  -H "Content-Type: application/json" \
  -H "x-api-key: <RENDER_API_KEY>" \
  -d @trigger/example-props.json
# -> {"jobId": "..."}

curl https://<proiect>.up.railway.app/render/<jobId>/status \
  -H "x-api-key: <RENDER_API_KEY>"
# -> {"status":"done","outputUrl":"https://.../output/<jobId>.mp4"}
```

Primul render e mai lent (bundling + descărcarea Chrome-ului headless dacă nu a
prins buildul din Dockerfile); cele următoare refolosesc bundle-ul deja făcut.

## 4. Cum îl apelează n8n

Două noduri HTTP Request simple, adăugate în workflow 4 (Final Assembly) după
`Get Render Result` (output-ul fal):

1. **Submit Remotion Render** — `POST {RENDER_SERVER_URL}/render`, header
   `x-api-key: {RENDER_API_KEY}`, body = `FinalVideoProps` (vezi secțiunea 5) →
   întoarce `jobId`.
2. **Wait** (~15-20s) → **Poll Remotion Status** — `GET {RENDER_SERVER_URL}/render/{jobId}/status`
   → `If done` → ia `outputUrl`, altfel loop înapoi la Wait (identic cu pattern-ul de
   poll deja folosit pentru fal compose și Flow video în rest).
3. `outputUrl` devine noul `Link Video Final` (sau, mai robust, descarcă-l și
   re-urcă-l pe Google Drive întâi — fișierele de pe Railway nu sunt garantat
   permanente între redeploy-uri).

## 5. Datele pe care trebuie să le trimită n8n (`FinalVideoProps`)

Vezi `src/types.ts`. Workflow 4 (Final Assembly) are deja tot ce trebuie, calculat în
nodul `Prepare Clips` / `Get Clip Duration`:

- `finalVideoUrl` — output-ul de la `Get Render Result` (fal)
- `scenes[]` — `narratorText` (din `Script Scenă`), `startSeconds`/`durationSeconds`
  (din duratele reale deja calculate acolo — exact ce previne desync-ul audio)
- `projectTitle` — `Nume Proiect`
- `palette` — din `visual_style.palette` al Story Bible (necesită mapare simplă text→hex)

## Limitări știute (Faza 1)

- **Fără tranziții între scene** — Remotion primește un singur video deja lipit de fal
  cu tăieturi seci; nu are acces la clipurile individuale ca să pună tranziții. Asta
  vine în Faza 2, dacă înlocuim fal complet.
- **Subtitrări aproximative** — nu avem timestamp-uri per cuvânt (ASR), deci cuvintele
  sunt distribuite egal pe durata scenei. Sincronizare bună, nu perfectă. Upgrade
  posibil mai târziu: rulează Whisper pe voiceover pentru timestamp-uri reale, fără
  să schimbe forma props-urilor (`Captions.tsx` acceptă deja `startSeconds`/`durationSeconds`
  per cuvânt dacă vrem să extindem tipul).
- **Railway ține contul „treaz" doar cât are trafic** — la volum mare de producție,
  merită migrarea pe Remotion Lambda (`trigger/render.mjs`, deja scris, doar
  nefolosit acum) pentru scalare automată pay-per-render. Schimbarea e izolată la
  nivel de infrastructură — codul React din `src/` rămâne identic.
