# public/ — footage de test pentru Studio

Pune aici un mp4 ca să vezi grafica și montajul peste **footage real**, nu
peste fundalul sintetic.

```
# descarcă „Link Video Final" al unui proiect deja făcut, apoi:
cp ~/Downloads/<fisierul>.mp4 remotion/public/test.mp4
```

Apoi în `trigger/studio-props.local.json` (copiază fixture-ul dacă nu-l ai):

```json
"finalVideoUrl": "/test.mp4"
```

Un URL care începe cu `/` se resolvă față de serverul Studio, exact ca
`staticFile()`. Orice video merge — nu trebuie să fie al proiectului din
fixture.

Fișierele media de aici sunt gitignorate (`public/*.mp4` și restul), deci nu
ajung niciodată în repo. Fișierul ăsta există doar ca folderul să vină cu un
`git pull` — git nu poate urmări un director gol, așa că înainte calea din
instrucțiuni pur și simplu nu exista.
