// PROBE ONLY — the eight sentences the five real probes of `DS Fill` proposed
// for the producer's Google Maps film (executions 16440, 16442, 16447, 16448,
// 16450, 2026-09-23), fed to `DS Fill Check` at once. Read as prose before any
// editor existed, they were: two keeps (5, 8), four repeats of the script
// (1, 2, 6, 7) and two minor or misplaced details (3, 4). An editor that
// agrees is calibrated; one that does not needs its prompt fixed first.
const lines = [
  'ADD: 1 | AFTER: The work that began in Sydney had become a public map service. | REF: E9 | SOURCE: Google Blog | URL:  | SENTENCE: It was not until mid-2005 that Google announced the Google Maps API.',
  'ADD: 1 | AFTER: On June 29, 2005, Google released the Google Maps API for external use. | REF: E8 | SOURCE: Google Maps Platform | URL:  | SENTENCE: Google Maps Platform said the API launched just a few months after the website rolled out in 2005.',
  'ADD: 1 | AFTER: On February 8, 2005, Google Maps launched for desktop as a new solution, Google said, to help people get from point A to point B. | REF: LIVE | SOURCE: News from Google | URL: https://googlepress.blogspot.com/2005/02/google-toolbar-30_16.html | SENTENCE: On February 16, 2005, Google released a beta Toolbar that turned web page addresses into online map links.',
  'ADD: 1 | AFTER: On June 29, 2005, Google released the Google Maps API for external use. | REF: LIVE | SOURCE: Google Developers Blog | URL: https://mapsplatform.googleblog.com/2008/05/introducing-our-geo-developers-blog.html | SENTENCE: In November 2005, Google created the Google Maps API Blog.',
  'ADD: 1 | AFTER: The work that began in Sydney had become a public map service. | REF: LIVE | SOURCE: Google | URL: https://googlepress.blogspot.com/2005/04/google-maps-and-keyhole-integration_03.html | SENTENCE: On April 3, 2005, Google added satellite and aerial imagery from Keyhole to Google Maps.',
  'ADD: 1 | AFTER: They built a map that replaced clicking arrows and waiting with dragging under a mouse, while it rendered smoothly and quickly. | REF: E5 | SOURCE: Google Blog | URL:  | SENTENCE: In 2004, Google said, two Aussies and two Danes in Sydney created the technology that underpinned Google Maps.',
  'ADD: 1 | AFTER: In October 2004, Google acquired Where 2 Technologies to create Google Maps. | REF: E15 | SOURCE: Australian National University Open Research Repository | URL:  | SENTENCE: An Australian National University research repository document states that Google acquired Where 2 Technologies in October 2004 and launched Google Maps in February 2005.',
  'ADD: 1 | AFTER: On June 29, 2005, Google released the Google Maps API for external use. | REF: LIVE | SOURCE: Google Developers Blog | URL: https://developers.googleblog.com/google-releases-maps-api-for-external-use/ | SENTENCE: Google said the API let people post interactive, draggable, zoomable maps with satellite imagery on personal websites.',
  // 9 — the one sentence the FIRST LIVE PRESS added (execution 16463). Sourced
  // (E11), and a statement of aim rather than a step in the story: expected
  // `minor` once the editor is told an aim or a focus is not a step.
  'ADD: 1 | AFTER: On February 8, 2005, Google Maps launched for desktop as a new solution, Google said, to help people get from point A to point B. | REF: E11 | SOURCE: Google Blog | URL:  | SENTENCE: When Google Maps first launched in 2005, the team was focused on “mapping the world.”',
];
return [{ json: { output: lines.join('\n') + '\nDONE: exhausted' } }];
