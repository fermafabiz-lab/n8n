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

## 2. Deploy pe AWS (Remotion Lambda)

Necesită un cont AWS. **Recomandare:** creează un user IAM dedicat (nu chei root), cu
permisiunile din [ghidul oficial Remotion](https://www.remotion.dev/docs/lambda/permissions) —
nu acorda acces total la cont.

```
cd remotion
npx remotion lambda functions deploy
npx remotion lambda sites create src/index.ts --site-name=final-video
```

Prima comandă îți dă un `REMOTION_LAMBDA_FUNCTION_NAME`. A doua îți dă un
`REMOTION_SERVE_URL`. Notează-le — sunt cheile de care ai nevoie mai departe.

## 3. Testează o randare manual

```
export REMOTION_AWS_REGION=us-east-1
export REMOTION_LAMBDA_FUNCTION_NAME=<din pasul 2>
export REMOTION_SERVE_URL=<din pasul 2>
node trigger/render.mjs trigger/example-props.json
```

Dacă vezi `Done: https://...mp4` la final, deploy-ul funcționează.

## 4. Cum îl apelează n8n

Remotion Lambda **nu are un endpoint HTTP public simplu** — se invocă prin SDK-ul
oficial (semnat AWS), nu printr-un POST generic. Ca n8n să-l poată apela, `trigger/render.mjs`
trebuie găzduit undeva accesibil prin HTTP:

- **Cel mai simplu:** o funcție Lambda mică proprie (sau un micro-serviciu Node oriunde —
  Railway, Render, un VPS) care expune 2 rute HTTP și pe dinăuntru cheamă
  `triggerRender()` / `checkProgress()` din acest fișier.
- Rute necesare: `POST /render` (primește props, întoarce `{renderId, bucketName}`) și
  `GET /render/:id/status?bucket=...` (întoarce `{done, outputFile}`).
- n8n apelează aceste 2 rute cu noduri HTTP Request obișnuite (poll la fiecare ~10s,
  la fel ca pattern-ul deja folosit pentru fal/Flow în restul pipeline-ului).

Nu am provizionat eu acest micro-serviciu — necesită credențialele tale AWS. Spune-mi
când ai un cont pregătit (sau dă-mi acces la niște credențiale IAM scoped) și fac
deploy-ul + rutele împreună cu tine.

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
