# Remotion — grafică peste videoul asamblat (Faza 1)

Adaugă peste videoul deja lipit de fal (`Link Video Final`): intro cu titlu, subtitrări
sincronizate pe scenă, progress bar, outro cu subscribe. Dacă rezultatul convinge,
Faza 2 înlocuiește fal complet (Remotion face și tăierea scenelor, cu tranziții).

## 1. Preview local

```
cd remotion
npm install
npm start        # deschide Remotion Studio în browser
```

Editează `trigger/example-props.json` cu date reale (un `finalVideoUrl` valid, scenele
tale) și încarcă-le în Studio ca să vezi exact ce va ieși înainte de a plăti o randare.

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
