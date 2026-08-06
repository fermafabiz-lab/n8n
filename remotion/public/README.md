# public/ — footage de test pentru Studio

Pune aici un mp4 ca să vezi grafica și montajul peste **footage real**, nu
peste fundalul sintetic.

## Ce fișier — singura regulă care contează

Trebuie un video **fără grafică arsă în el**: montajul brut, adică ce iese din
`/assemble` (`{RENDER_SERVER_URL}/output/<jobId>.mp4`). Merge la fel de bine și
un singur clip de scenă brut (`Scene Final URL`, de pe fal/Drive) — pentru
reglat tipografia contează doar să ai imagine sub grafică.

```
cp ~/Downloads/<montajul>.mp4 remotion/public/test.mp4
npm run studio
```

> **Nu pune „Link Video Final" al unui proiect terminat.** Instrucțiunea asta a
> fost aici și e greșită. Câmpul își schimbă înțelesul pe parcursul pipeline-ului:
> înainte de pasul Remotion ține montajul, iar după randare este **suprascris**
> cu filmul finit. Pe un proiect gata, ce descarci de acolo are deja subtitrări
> și carduri de capitol arse în imagine — iar `FinalVideo` desenează al doilea
> rând peste ele. Se vede ca două seturi de subtitrări și un card de capitol de
> la alt proiect, și nu e un bug de cod.

Ca să verifici un fișier de care nu ești sigur: stinge `showCaptions` și
`showChapterCards` în panoul de props. Dacă tot vezi text pe imagine, e ars în
fișier — deci e fișierul greșit.

**Atât.** `scripts/studio.mjs` găsește singur fișierul (`test.mp4` prin
convenție, altfel cel mai recent) și îl scrie în props. Nu edita niciun JSON.
Banner-ul de la pornire îți spune ce footage a găsit — dacă zice
`footage: none`, fișierul nu e aici.

Fișierele media de aici sunt gitignorate (`public/*.mp4` și restul), deci nu
ajung niciodată în repo. Fișierul ăsta există doar ca folderul să vină cu un
`git pull` — git nu poate urmări un director gol, așa că înainte calea din
instrucțiuni pur și simplu nu exista.

## De ce nu merge un `/fisier.mp4` scris de mână

Remotion **nu** servește `public/` de la rădăcina site-ului. O cale ca
`/test.mp4` pusă direct în props dă `"/test.mp4" was requested but not found`
și randarea moare — trebuie trecută prin `staticFile()`. Documentația noastră
susținea ani buni contrariul („un URL relativ se resolvă ca staticFile"), ceea
ce era pur și simplu fals.

Acum `SourceVideo` face conversia singur: orice cale care nu e `http(s):`,
`blob:` sau `data:` trece prin `staticFile()`. Deci scrierea evidentă
funcționează, iar URL-urile de producție (serverul de randare, Drive, CDN) trec
neatinse.
