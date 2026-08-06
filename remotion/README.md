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

`npm run studio` face `git pull` înainte să pornească, ca să nu te uiți la cod
vechi fără să-ți dai seama. Dacă ai modificări locale (de exemplu ai schimbat
`finalVideoUrl` în fixture ca să arate spre footage-ul tău), pull-ul e sărit cu
un mesaj și Studio pornește oricum pe checkout-ul curent. `npm start` nu trage
nimic niciodată.

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
orice mp4 asamblat în `remotion/public/` și schimbă `finalVideoUrl` pe `/<fișier>.mp4` —
un URL relativ se resolvă față de serverul Studio, exact ca `staticFile()`. Fișierele
media din `public/` sunt gitignorate, deci nu ajung în repo.

Ca să prinzi props proaspete pentru alt proiect: execuția de Final Assembly din n8n →
nodul `Build Remotion Props` → copiază `body` din output.

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
