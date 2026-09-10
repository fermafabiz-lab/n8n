// The Universal Footage Engine, checked with the internet and the database
// mocked at their edges and everything in between real.
//
// What is pinned here is every promise the engine makes to a documentary:
// that it asks the library before the world; that a dead provider costs its
// own results and nothing else; that a restricted licence is a filter and
// never a score; that ACTUAL FOOTAGE is a matter of metadata and threshold,
// never of appearance; that an upload is unknown until a person says; that a
// talking head loses to eight seconds of B-roll; that a retired provider is
// absent from every search and still readable in the library.
//
//   node --experimental-strip-types --import ./scripts/footage-loader.mjs scripts/check-footage.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const F = await import(join(root, 'lib', 'footage', 'index.ts'));
const archive = await import(join(root, 'lib', 'archive', 'index.ts'));
const mock = await import(join(root, 'scripts', 'mocks', 'stock.mjs'));
const { normalizeDvidsResult } = await import(join(root, 'lib', 'footage', 'providers', 'dvids.ts'));
const { normalizeNasaItem, pickRendition } = await import(join(root, 'lib', 'footage', 'providers', 'nasa.ts'));
const { normalizeEuAvItem, euAvItems } = await import(join(root, 'lib', 'footage', 'providers', 'euav.ts'));
const { normalizeIaDoc, pickIaFile, iaQuery, iaFileUrl } = await import(join(root, 'lib', 'footage', 'providers', 'internetArchive.ts'));
const { normalizeEuropeanaItem } = await import(join(root, 'lib', 'footage', 'providers', 'europeana.ts'));
const { normalizeWellcomeImage, iiifImage } = await import(join(root, 'lib', 'footage', 'providers', 'wellcome.ts'));
const { normalizeOpenverseResult, openverseLicenseCode, openverseMode, resetOpenverseState, OPENVERSE_ANON_PER_HOUR, OPENVERSE_ANON_PAGE_MAX } = await import(join(root, 'lib', 'footage', 'providers', 'openverse.ts'));
const { normalizeLocResult, locFiles } = await import(join(root, 'lib', 'footage', 'providers', 'loc.ts'));
const { normalizeFlickrPhoto } = await import(join(root, 'lib', 'footage', 'providers', 'flickr.ts'));
const { normalizePexelsVideo, normalizePexelsPhoto, pickPexelsFile } = await import(join(root, 'lib', 'footage', 'providers', 'pexels.ts'));
const { normalizePixabayVideo, normalizePixabayImage } = await import(join(root, 'lib', 'footage', 'providers', 'pixabay.ts'));
const { normalizeUnsplashPhoto } = await import(join(root, 'lib', 'footage', 'providers', 'unsplash.ts'));

// EU AV is opt-in (no public API — see the adapter); the engine cases below
// exercise it as if the Commission offered one at the site's own host.
process.env.EU_AV_API_BASE = 'https://audiovisual.ec.europa.eu/api';

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} -> ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
};
const truthy = (name, got) => check(name, Boolean(got), true);

// ---------------------------------------------------------------------------
// A fake internet. Each provider's API answered from a table keyed by host.
// ---------------------------------------------------------------------------
const calls = [];
const world = {};
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input.toString());
  calls.push(url.hostname);
  const handler = world[url.hostname];
  if (!handler) throw new Error(`no route to ${url.hostname}`);
  const out = await handler(url, init);
  if (out instanceof Error) throw out;
  const [status, body, type] = out;
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': type ?? 'application/json' },
  });
};

const commonsPage = (id, title, mediatype, extra = {}) => ({
  pageid: id,
  title: `File:${title}`,
  imageinfo: [
    {
      url: `https://upload.wikimedia.org/${id}.webm`,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}`,
      thumburl: `https://upload.wikimedia.org/t/${id}.jpg`,
      width: 1280,
      height: 720,
      duration: mediatype === 'VIDEO' ? 20 : undefined,
      mime: mediatype === 'VIDEO' ? 'video/webm' : 'image/jpeg',
      mediatype,
      extmetadata: {
        ObjectName: { value: title },
        ImageDescription: { value: extra.description ?? title },
        Artist: { value: extra.artist ?? 'Someone' },
        License: { value: extra.license ?? 'pd' },
        LicenseShortName: { value: extra.licenseName ?? 'Public domain' },
        DateTimeOriginal: { value: extra.date ?? '1969-07-16' },
        AttributionRequired: { value: extra.attr ?? 'false' },
      },
    },
  ],
  categories: [],
});

world['commons.wikimedia.org'] = async (url) => {
  const q = url.searchParams.get('gsrsearch') ?? '';
  if (/filetype:video/.test(q)) return [200, { query: { pages: [commonsPage(1, 'Ceuta border fence 2021.webm', 'VIDEO', { description: 'Migrants at the Ceuta border, Spain, May 2021', date: '2021-05-18' })] } }];
  if (/filetype:bitmap/.test(q)) return [200, { query: { pages: [commonsPage(2, 'Ceuta seen from Morocco.jpg', 'BITMAP', { description: 'The city of Ceuta, Spain, seen from the Moroccan side', license: 'cc-by-sa-4.0', licenseName: 'CC BY-SA 4.0', attr: 'true' })] } }];
  return [200, { query: { pages: [] } }];
};

world['audiovisual.ec.europa.eu'] = async (url) => [
  200,
  {
    items: [
      { ref: 'I-260001', title: 'Stockshots: Ceuta border crossing', description: 'B-roll of the Ceuta–Morocco border crossing during the migration crisis', type: 'video', genre: 'Stockshot', shootingDate: '2026-05-18', location: { city: 'Ceuta', country: 'Spain' }, copyright: '© European Union, 2026', duration: 180, files: [{ url: 'https://ec.example/ceuta.mp4', width: 1920, height: 1080 }] },
      { ref: 'I-260002', title: 'Press conference by Commissioner on migration', description: 'Statement to the press on the situation in Ceuta', type: 'video', genre: 'Press conference', shootingDate: '2026-05-19', location: { city: 'Brussels', country: 'Belgium' }, speakers: ['Ylva Johansson'], copyright: '© European Union, 2026', duration: 1450 },
      { ref: 'I-260003', title: 'Border footage courtesy of Reuters', description: 'Third-party material', type: 'video', genre: 'Broll', copyright: '© Reuters — third-party rights, editorial use only', duration: 40 },
    ],
  },
];

world['api.dvidshub.net'] = async (url) => {
  if (url.pathname === '/search') {
    return [
      200,
      {
        results: [
          { id: 'video:900001', type: 'video', title: 'B-Roll: USS Example humanitarian aid delivery', description: 'Sailors deliver aid after the earthquake', date: '2026-09-08', date_published: '2026-09-08', unit_name: 'U.S. Navy', branch: 'Navy', credit: 'Petty Officer Jane Doe', thumbnail: 'https://d.example/t.jpg', url: 'https://www.dvidshub.net/video/900001/b-roll', keywords: 'humanitarian,aid', city: 'Antakya', country: 'Turkey', duration: 95 },
          { id: 'video:900002', type: 'video', title: 'Third-party footage', description: 'Video courtesy of Getty Images', date: '2026-09-08', unit_name: 'Public Affairs', branch: 'Joint', credit: 'Courtesy of Getty Images', url: 'https://www.dvidshub.net/video/900002/x', duration: 30 },
        ],
      },
    ];
  }
  return [200, { results: { id: 'video:900001', type: 'video', title: 'B-Roll: USS Example', description: 'x', date: '2026-09-08', unit_name: 'U.S. Navy', branch: 'Navy', url: 'https://www.dvidshub.net/video/900001/b-roll', files: [{ url: 'https://d.example/900001.mp4', width: 1920, height: 1080 }] } }];
};

world['images-api.nasa.gov'] = async (url) => {
  if (url.pathname === '/search') {
    return [
      200,
      {
        collection: {
          items: [
            { href: 'x', data: [{ nasa_id: 'KSC-20260908-1', title: 'Artemis III launch', description: 'Artemis III lifts off from Kennedy Space Center', date_created: '2026-09-08T12:00:00Z', keywords: ['Artemis', 'launch'], center: 'KSC', media_type: 'video', location: 'Kennedy Space Center, FL' }], links: [{ href: 'https://images-assets.nasa.gov/x~thumb.jpg', rel: 'preview' }] },
            { href: 'y', data: [{ nasa_id: 'ESA-1', title: 'ESA image', description: 'Image courtesy of ESA/Hubble, © ESA', date_created: '2020-01-01T00:00:00Z', center: 'GSFC', media_type: 'image', secondary_creator: 'ESA/Hubble' }], links: [] },
          ],
        },
      },
    ];
  }
  return [200, { collection: { items: [{ href: 'https://images-assets.nasa.gov/video/KSC-20260908-1/KSC-20260908-1~orig.mp4' }, { href: 'https://images-assets.nasa.gov/video/KSC-20260908-1/KSC-20260908-1~medium.mp4' }] } }];
};

// The new archives, answering with what they really answered on 2026-09-10
// (executions 11839–11842), trimmed.
const IA_BRANDENBURG = { identifier: 'LC-44552', title: 'Brandenburg Gate Border Action, Berlin, Germany, 08/14/1961', description: 'LS, crowds of civilians on western side of the border at the Brandenburg Gate.', date: '1961-08-14T00:00:00Z', year: 1961, creator: 'United States. Army', collection: ['opensource_movies', 'community', 'fav-basilbob'], licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/', mediatype: 'movies', downloads: 3597, publicdate: '2011-02-01T00:00:00Z' };
const IA_CONCERT = { identifier: 'dua-lipa-99-luftballons', title: 'Dua Lipa - 99 Luftballons (Hamburg, May 19, 2025)', date: '2025-05-19T00:00:00Z', licenseurl: 'https://creativecommons.org/licenses/by-nc-nd/4.0/', collection: ['opensource_movies'], mediatype: 'movies' };
const IA_FILES = [
  { name: 'LC-44552.gif', format: 'Animated GIF', size: '99456', source: 'derivative' },
  { name: 'LC-44552.mp4', format: 'h.264', size: '45463077', width: '640', height: '360', length: '437.95', source: 'derivative' },
  { name: 'LC-44552.ogv', format: 'Ogg Video', size: '31568459', width: '532', height: '300', length: '437.94', source: 'derivative' },
  { name: 'LC-44552.thumbs/LC-44552_000001.jpg', format: 'Thumbnail', size: '1941', source: 'derivative' },
];
world['archive.org'] = async (url) => {
  if (url.pathname === '/advancedsearch.php') return [200, { response: { numFound: 2, docs: [IA_BRANDENBURG, IA_CONCERT] } }];
  if (url.pathname.startsWith('/metadata/')) return [200, { metadata: IA_BRANDENBURG, files: IA_FILES, server: 'ia', dir: '/0/items/LC-44552' }];
  return [404, 'no', 'text/plain'];
};
const EUROPEANA_MESSTER = { id: '/08626/1037479000000222039', title: ['Knife Week No. 4', 'Messter-Woche Nr. 4', 'Messter Newsreel No. 4'], dcTitleLangAware: { en: ['Messter Newsreel No. 4'] }, type: 'VIDEO', year: ['1914'], rights: ['http://creativecommons.org/publicdomain/mark/1.0/'], edmIsShownBy: ['https://www.filmportal.de/sites/default/files/video/BArch_K_26356_Messter_Woche_Nr_4.mp4'], edmIsShownAt: ['https://www.filmportal.de/node/1225577'], edmPreview: ['https://api.europeana.eu/thumbnail/v2/url.json?uri=x&type=VIDEO'], dataProvider: ['Federal Archives of Germany'], edmTimespanLabel: [{ def: '1914' }, { def: '20. Jahrhundert' }], edmPlaceLabel: [{ def: 'Western Europe' }], country: ['Germany'], dcDescription: ['Credits: Messter Weekly No. 4. Intertitle: Next to a blown-up railway bridge over the Meuse our forces have constructed a provisional bridge.'], dcCreator: null, guid: 'https://www.europeana.eu/item/08626/1037479000000222039?utm_source=api' };
world['api.europeana.eu'] = async () => [200, { success: true, totalResults: 1, items: [EUROPEANA_MESSTER] }];
const WELLCOME_CHOLERA = { id: 'r9qn9a58', type: 'Image', aspectRatio: 1.5625, source: { id: 'd5vcm8mc', title: 'A London Board of Health hunting after cases like a cholera.', contributors: [{ agent: { label: 'Cruikshank, George' } }] }, thumbnail: { url: 'https://iiif.wellcomecollection.org/image/L0006896/info.json', credit: 'Wellcome Collection', license: { id: 'cc-by', label: 'Attribution 4.0 International (CC BY 4.0)', url: 'http://creativecommons.org/licenses/by/4.0/' } }, locations: [{ url: 'https://iiif.wellcomecollection.org/image/L0006896/info.json', credit: 'Wellcome Collection', license: { id: 'cc-by', label: 'Attribution 4.0 International (CC BY 4.0)', url: 'http://creativecommons.org/licenses/by/4.0/' } }] };
world['api.wellcomecollection.org'] = async () => [200, { totalResults: 1, results: [WELLCOME_CHOLERA] }];

const CEUTA_SCENE = {
  id: 'recSCENE000000001',
  narration: 'The migrant crisis in Ceuta intensified as people attempted to reach Spain from Morocco in May 2026.',
  visual: 'Crowds at the Ceuta border fence, Spain',
};

// ---------------------------------------------------------------------------
// The request builder and the query generator
// ---------------------------------------------------------------------------
console.log('\n--- request ---');
const req = F.buildFootageRequest({ ...CEUTA_SCENE, event: 'Ceuta migration crisis', location: 'Ceuta, Spain', country: 'Spain', topic: 'migration' });
check('the narration is kept whole', req.narration.startsWith('The migrant crisis in Ceuta'), true);
check('the year comes from the script', [req.dateFrom, req.dateTo], ['2026', '2026']);
truthy('proper nouns become keywords', req.keywords.includes('ceuta') && req.keywords.includes('spain'));
check('pictures, not a speaker, when nobody is quoted', req.preferredFootageType, 'broll');
check('a quoted statement wants a speaker', F.buildFootageRequest({ id: 's', narration: 'The Commissioner said the border would stay open.' }).preferredFootageType, 'speech');
check('no date is invented when the script names none', F.buildFootageRequest({ id: 's', narration: 'A quiet border town.' }).dateFrom, undefined);
const qs = F.generateSearchQueries(req);
truthy('three to six queries', qs.length >= 3 && qs.length <= 6);
check('the event leads', qs[0], 'Ceuta migration crisis');
truthy('no query is a sentence', qs.every((q) => q.split(' ').length <= 8));
truthy('authored queries go first', F.generateSearchQueries({ ...req, queries: ['Ceuta fence'] })[0] === 'Ceuta fence');

// ---------------------------------------------------------------------------
// Registry and router
// ---------------------------------------------------------------------------
console.log('\n--- registry & router ---');
const ids = F.allProviders().map((p) => p.id);
check('the fifteen providers, in registry order', ids, ['eu_av', 'dvids', 'nasa', 'internet_archive', 'europeana', 'loc', 'wikimedia', 'wellcome', 'flickr', 'openverse', 'pexels', 'pixabay', 'unsplash', 'url_import', 'user_upload']);
check('ARCHIVE_PROVIDERS is the same list', [...archive.ARCHIVE_PROVIDERS], ids);
truthy('every entry is a real adapter, none a placeholder', F.allProviders().every((p) => typeof p.search === 'function' && typeof p.checkRights === 'function' && p.tier));
check('an id the registry does not know is not a provider', F.providerById('legacy_archive'), null);
check('the keyless archives are on', ['internet_archive', 'europeana', 'wellcome', 'wikimedia', 'nasa'].map((id) => F.providerById(id).enabled), [true, true, true, true, true]);
check('the keyed ones are off without their keys', ['dvids', 'flickr', 'pexels', 'pixabay', 'unsplash'].map((id) => F.providerById(id).enabled), [false, false, false, false, false]);
truthy('and each says which key', ['dvids', 'flickr', 'pexels', 'pixabay', 'unsplash'].every((id) => /_KEY/.test(F.providerById(id).disabledReason)));
// Openverse is the exception: the official client answers anonymous requests,
// so a missing client means the low anonymous quota, never "off".
check('Openverse is on without a client — anonymously, with a notice', [F.providerById('openverse').enabled, F.providerById('openverse').disabledReason, /anonymous/.test(F.providerById('openverse').notice)], [true, null, true]);
truthy('and the picker options carry the notice', F.providerFilterOptions().some((p) => p.id === 'openverse' && p.enabled && /anonymous/.test(p.notice)));
check('Library of Congress is off until asked for (Cloudflare)', [F.providerById('loc').enabled, /Cloudflare/.test(F.providerById('loc').disabledReason)], [false, true]);
check('EU AV is on only with a base URL', (() => { const b = process.env.EU_AV_API_BASE; delete process.env.EU_AV_API_BASE; const off = F.providerById('eu_av').enabled; process.env.EU_AV_API_BASE = b; return [off, F.providerById('eu_av').enabled]; })(), [false, true]);
process.env.DVIDS_API_KEY = 'test-key';
check('DVIDS is on with its key', F.providerById('dvids').enabled, true);

const route = (r) => F.routeProviders(r).map((x) => x.provider.id);
check('European migration → EU AV first', route(req)[0], 'eu_av');
truthy('and Wikimedia along', route(req).includes('wikimedia'));
const military = F.buildFootageRequest({ id: 's', narration: 'Navy sailors delivered humanitarian aid after the earthquake in Turkey.', topic: 'military humanitarian operation', country: 'Turkey' });
check('military conflict → DVIDS first', route(military)[0], 'dvids');
const space = F.buildFootageRequest({ id: 's', narration: 'Artemis III lifted off from Kennedy Space Center.', topic: 'space mission', event: 'Artemis III launch' });
check('a NASA mission → NASA first, over the general archives', route(space)[0], 'nasa');
truthy('and an archive along', route(space).some((id) => id === 'internet_archive' || id === 'wikimedia'));
const meeting = F.buildFootageRequest({ id: 's', narration: 'The European Council met in Brussels to discuss the budget.', organizations: ['European Council'], location: 'Brussels' });
check('a European political meeting → EU AV', route(meeting)[0], 'eu_av');
const history = F.buildFootageRequest({ id: 's', narration: 'In 1944 the Allied armies landed in Normandy.', event: 'Normandy landings' });
check('a 1944 request skips the newsrooms', route(history).includes('dvids') || route(history).includes('eu_av'), false);
truthy('and goes to the archives', route(history).includes('wikimedia') && route(history).includes('internet_archive') && route(history).includes('europeana'));
const plague = F.buildFootageRequest({ id: 's', narration: 'In 1854 cholera swept through Soho and the doctors argued about the pump.', event: 'Broad Street cholera outbreak' });
truthy('a medical history scene reaches Wellcome', route(plague).includes('wellcome'));
truthy('never every provider for every scene', [req, military, space, meeting, history, plague].every((r) => route(r).length <= 4));
check('an explicit filter is honoured', F.routeProviders(req, { only: ['nasa'] }).map((x) => x.provider.id), ['nasa']);
// A provider the caller is holding back gives its slot to the next candidate
// rather than occupying one of the four with a refusal.
const skipped = F.routeProviders(req, { skip: (p) => p.id === 'eu_av' }).map((x) => x.provider.id);
check('a skipped provider is not routed and its slot is filled', [skipped.includes('eu_av'), skipped.length], [false, Math.min(4, route(req).length)]);
check('but an explicit filter is never thinned', F.routeProviders(req, { only: ['eu_av'], skip: () => true }).map((x) => x.provider.id), ['eu_av']);
// Stock is for scenes that name no event, and only then — and even there it
// comes AFTER the archives, whose `general` coverage is real dated material.
// Note the fixture names no subject either: "a quiet BORDER town" matches the
// geopolitics and migration categories, and on a subject the official and
// archive sources fill all four slots, which is the right order for a
// documentary and pushes stock off the cap.
process.env.PEXELS_API_KEY = 'test-key';
const generic = F.buildFootageRequest({ id: 's', narration: 'A quiet street at dawn, shutters still closed, a cat on the steps.' });
truthy('a scene with no event may get stock B-roll', route(generic).includes('pexels'));
check('but behind the archives', route(generic).indexOf('pexels'), route(generic).length - 1);
const subject = F.buildFootageRequest({ id: 's', narration: 'A quiet border town at dawn, the crossing still closed.' });
check('a generic scene on a real subject goes to the sources that cover it', route(subject).includes('eu_av'), true);
check('a scene that names an event never gets stock', route(req).includes('pexels'), false);
check('nor one that demands the exact event', route({ ...generic, requireExactEvent: true }).includes('pexels'), false);
delete process.env.PEXELS_API_KEY;

// ---------------------------------------------------------------------------
// Normalizers — one shape from four dialects
// ---------------------------------------------------------------------------
console.log('\n--- normalization ---');
const dv = normalizeDvidsResult({ id: 'video:1', type: 'video', title: 'T', description: 'D', date: '2026-09-08', unit_name: 'U.S. Navy', branch: 'Navy', credit: 'PO Doe', url: 'https://www.dvidshub.net/video/1/t', city: 'Antakya', country: 'Turkey', duration: 95, files: [{ url: 'https://d/1.mp4', width: 1920, height: 1080 }] });
check('DVIDS: provider, id, origin', [dv.provider, dv.providerAssetId, dv.origin], ['dvids', 'video:1', 'official_media']);
check('DVIDS: filming date and place are kept', [dv.filmingDate, dv.location, dv.country], ['2026-09-08', 'Antakya, Turkey', 'Turkey']);
check('DVIDS: the unit is an organisation, the credit the creator', [dv.organizations, dv.creator], [['U.S. Navy', 'Navy'], 'PO Doe']);
check('DVIDS: DoD work is public domain with credit', [dv.rightsStatus, dv.reviewStatus], ['public_domain', 'auto_approved']);
const dvRestricted = normalizeDvidsResult({ id: 'video:2', type: 'video', title: 'T', restrictions: 'Not releasable to the public', url: 'x' });
check('DVIDS: a stated restriction is restricted', dvRestricted.reviewStatus, 'rejected');
const dvThird = normalizeDvidsResult({ id: 'video:3', type: 'video', title: 'T', credit: 'Courtesy of Getty Images', branch: 'Joint', url: 'x' });
check('DVIDS: a third-party credit goes to manual review', F.validateRights(dvThird).status, 'manual_review');

const na = normalizeNasaItem({ data: [{ nasa_id: 'N1', title: 'T', description: 'D', date_created: '2026-09-08T00:00:00Z', center: 'KSC', media_type: 'video', keywords: ['a'] }], links: [{ href: 'https://t.jpg', rel: 'preview' }] });
check('NASA: provider, id, credit', [na.provider, na.providerAssetId, na.credit], ['nasa', 'N1', 'NASA/KSC']);
check('NASA: public domain with credit', [na.rightsStatus, na.attributionRequired, na.reviewStatus], ['public_domain', true, 'auto_approved']);
const naThird = normalizeNasaItem({ data: [{ nasa_id: 'N2', title: 'T', description: 'Image courtesy of ESA, © ESA', media_type: 'image', secondary_creator: 'ESA' }], links: [] });
check('NASA: third-party copyright is manual review', F.validateRights(naThird).status, 'manual_review');
check('NASA: the largest mp4 rendition is picked', pickRendition(['a~medium.mp4', 'a~orig.mp4', 'a~thumb.jpg'], 'video'), 'a~orig.mp4');

const eu = normalizeEuAvItem({ ref: 'I-1', title: 'Stockshots: border', description: 'D', type: 'video', genre: 'Stockshot', shootingDate: '2026-05-18', publicationDate: '2026-05-20', location: { city: 'Ceuta', country: 'Spain' }, speakers: ['A B'], copyright: '© European Union, 2026', duration: 120 });
check('EU AV: provider, id, format', [eu.provider, eu.providerAssetId, eu.footageFormat], ['eu_av', 'I-1', 'stockshots']);
check('EU AV: filming and publication dates are distinct', [eu.filmingDate, eu.publicationDate], ['2026-05-18', '2026-05-20']);
check('EU AV: location, country, speakers', [eu.location, eu.country, eu.people], ['Ceuta, Spain', 'Spain', ['A B']]);
check('EU AV: © European Union is credit-required', F.validateRights(eu).status, 'attribution_required');
const euEd = normalizeEuAvItem({ ref: 'I-2', title: 'T', type: 'video', copyright: '© Reuters — editorial use only' });
check('EU AV: editorial-only is editorial-only', F.validateRights(euEd).status, 'editorial_only');
check('EU AV: the envelope is found under any of its names', euAvItems({ data: { results: [{ ref: 'x' }] } }).length, 1);
check('EU AV: a speech is classified as one', normalizeEuAvItem({ ref: 'I-3', title: 'Statement by the President', type: 'video', genre: 'Speech' }).footageFormat, 'speech');

// Internet Archive — the 1961 US Army film that the licensed query really answered.
const ia = normalizeIaDoc(IA_BRANDENBURG);
check('IA: provider, id, media', [ia.provider, ia.providerAssetId, ia.mediaType], ['internet_archive', 'LC-44552', 'video']);
check('IA: a public-domain mark is public domain, credit not owed', [ia.rightsStatus, ia.reviewStatus, ia.attributionRequired], ['public_domain', 'auto_approved', false]);
check('IA: the date is the film\'s, and it is historical', [ia.filmingDate, ia.origin, ia.yearsMentioned.includes(1961)], ['1961-08-14', 'historical', true]);
check('IA: the item page and the thumbnail service', [ia.sourceUrl, ia.thumbnailUrl], ['https://archive.org/details/LC-44552', 'https://archive.org/services/img/LC-44552']);
check('IA: a BY-NC-ND upload is refused by the classifier', normalizeIaDoc(IA_CONCERT).reviewStatus, 'rejected');
check('IA: an uploader\'s own PDM outside the curated collections is manual review', normalizeIaDoc({ identifier: 'img-0667', title: 'Screenshots Of Evil Nun Roblox', creator: 'Jacob Winters', collection: ['opensource_image'], licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/', mediatype: 'image' }).reviewStatus, 'manual_review');
check('IA: a Prelinger film with no licence is public domain by collection', normalizeIaDoc({ identifier: 'p1', title: 'Duck and Cover', collection: ['prelinger'], mediatype: 'movies', date: '1951-01-01T00:00:00Z' }).rightsStatus, 'public_domain');
check('IA: a flagged collection is never an asset', normalizeIaDoc({ identifier: 'x', title: 'x', collection: ['fringe'], mediatype: 'movies' }), null);
check('IA: the old CC public-domain URL reads as public domain', normalizeIaDoc({ identifier: 'g', title: 'Berlin Documentary', creator: 'United States. Army', collection: ['FedFlix'], licenseurl: 'http://creativecommons.org/licenses/publicdomain/', mediatype: 'movies' }).rightsStatus, 'public_domain');
check('IA: h.264 beats Ogg, and the URL is the download path', [pickIaFile(IA_FILES, 'video').name, iaFileUrl('LC-44552', 'LC-44552.mp4')], ['LC-44552.mp4', 'https://archive.org/download/LC-44552/LC-44552.mp4']);
truthy('IA: the query excludes the flagged collections and YouTube mirrors', /NOT collection:\(altcensored OR fringe OR deemphasize\)/.test(iaQuery('moon landing', 'video')) && /NOT identifier:youtube\*/.test(iaQuery('moon landing', 'video')));
check('IA: stills come only from the curated collections', /licenseurl/.test(iaQuery('berlin wall', 'image')), false);
truthy('IA: Solr syntax in a query is words, not operators', !/[:"()]/.test(iaQuery('a:b "c" (d)', 'video').split(') AND')[0].slice(1)));

// Europeana — the 1914 Messter newsreel the mp4 query really answered.
const eur = normalizeEuropeanaItem(EUROPEANA_MESSTER);
check('Europeana: provider, id, media, the English title', [eur.provider, eur.providerAssetId, eur.mediaType, eur.title], ['europeana', '/08626/1037479000000222039', 'video', 'Messter Newsreel No. 4']);
check('Europeana: the file is the mp4, the page is the provider\'s', [eur.downloadUrl.endsWith('.mp4'), eur.sourceUrl], [true, 'https://www.filmportal.de/node/1225577']);
check('Europeana: PDM, the archive as credit, 1914, Germany, historical', [eur.rightsStatus, eur.credit, eur.filmingDate, eur.country, eur.origin], ['public_domain', 'Federal Archives of Germany', '1914', 'Germany', 'historical']);
check('Europeana: a newsreel is a news package', eur.footageFormat, 'news_package');
check('Europeana: no file, no asset', normalizeEuropeanaItem({ ...EUROPEANA_MESSTER, edmIsShownBy: [] }), null);

// Wellcome — the cholera print the image query really answered.
const wc = normalizeWellcomeImage(WELLCOME_CHOLERA);
check('Wellcome: provider, id, CC BY with credit', [wc.provider, wc.providerAssetId, wc.rightsStatus, wc.attributionRequired], ['wellcome', 'r9qn9a58', 'cc_by', true]);
check('Wellcome: IIIF info.json becomes a picture', [wc.downloadUrl, wc.thumbnailUrl], ['https://iiif.wellcomecollection.org/image/L0006896/full/2000,/0/default.jpg', 'https://iiif.wellcomecollection.org/image/L0006896/full/400,/0/default.jpg']);
check('Wellcome: the artist and the work page', [wc.creator, wc.sourceUrl], ['Cruikshank, George', 'https://wellcomecollection.org/works/d5vcm8mc/images?id=r9qn9a58']);
check('Wellcome: an NC licence is refused', normalizeWellcomeImage({ ...WELLCOME_CHOLERA, locations: [{ url: 'https://iiif.wellcomecollection.org/image/X/info.json', license: { id: 'cc-by-nc', label: 'CC BY-NC 4.0' } }] }).reviewStatus, 'rejected');
check('iiifImage', iiifImage('https://iiif.example/image/A/info.json', 800), 'https://iiif.example/image/A/full/800,/0/default.jpg');

// Openverse — documented shape.
const ov = normalizeOpenverseResult({ id: 'ov-1', title: 'Berlin Wall 1989', foreign_landing_url: 'https://www.flickr.com/photos/x/1', url: 'https://live.staticflickr.com/1.jpg', creator: 'Someone', license: 'by', license_version: '2.0', license_url: 'https://creativecommons.org/licenses/by/2.0/', provider: 'flickr', source: 'flickr', tags: [{ name: 'berlin' }, { name: 'wall' }], attribution: '"Berlin Wall 1989" by Someone is licensed under CC BY 2.0.', width: 1024, height: 768, thumbnail: 'https://api.openverse.org/v1/images/ov-1/thumb/' });
check('Openverse: codes map to the classifier\'s', [openverseLicenseCode('by'), openverseLicenseCode('pdm'), openverseLicenseCode('cc0')], ['cc-by', 'public domain mark', 'cc0']);
check('Openverse: CC BY with credit, the attribution kept', [ov.rightsStatus, ov.attributionRequired, ov.credit], ['cc_by', true, '"Berlin Wall 1989" by Someone is licensed under CC BY 2.0.']);
check('Openverse: PDM is public domain', normalizeOpenverseResult({ id: 'x', url: 'https://x/1.jpg', license: 'pdm' }).rightsStatus, 'public_domain');

// Openverse — two modes, never off. Anonymous spends one request per search
// inside the API's own throttle; a client turns on the bearer path.
{
  const ovCalls = [];
  world['api.openverse.org'] = async (url, init) => {
    ovCalls.push({ path: url.pathname, page: Number(url.searchParams.get('page_size')), auth: (init && init.headers && init.headers.Authorization) || null });
    if (url.pathname.endsWith('/auth_tokens/token/')) return [200, { access_token: 'tok', expires_in: 3600 }];
    return [200, { results: [{ id: 'ov-1', title: 'Berlin Wall 1989', url: 'https://live.staticflickr.com/1.jpg', license: 'by', license_version: '2.0' }] }];
  };
  const ovReq = F.buildFootageRequest({ id: 's', narration: 'The Berlin Wall fell in November 1989.', event: 'Fall of the Berlin Wall', location: 'Berlin' });
  delete process.env.OPENVERSE_CLIENT_ID;
  delete process.env.OPENVERSE_CLIENT_SECRET;
  resetOpenverseState();
  const ovp = F.providerById('openverse');
  check('Openverse anonymous: the mode reads from the environment', openverseMode(), 'anonymous');
  let ovHits = await ovp.search(ovReq, { limit: 12 });
  check('Openverse anonymous: ONE request, no bearer, page_size inside the anonymous cap', [ovCalls.length, ovCalls[0].auth, ovCalls[0].page <= OPENVERSE_ANON_PAGE_MAX, ovHits.length], [1, null, true, 1]);
  for (let i = 1; i < OPENVERSE_ANON_PER_HOUR; i++) await ovp.search(ovReq, { limit: 12 });
  let ovErr = null;
  try { await ovp.search(ovReq, { limit: 12 }); } catch (e) { ovErr = e; }
  check('Openverse anonymous: the hourly budget is refused locally, as a rate limit, before the API is asked', [ovCalls.length, /rate limit/.test(ovErr && ovErr.message)], [OPENVERSE_ANON_PER_HOUR, true]);
  process.env.OPENVERSE_CLIENT_ID = 'id';
  process.env.OPENVERSE_CLIENT_SECRET = 'secret';
  resetOpenverseState();
  ovCalls.length = 0;
  check('Openverse authenticated: with a client, no notice', [openverseMode(), ovp.notice], ['authenticated', null]);
  ovHits = await ovp.search(ovReq, { limit: 12 });
  check('Openverse authenticated: a token first, then bearer searches, more than one query', [ovCalls[0].path.endsWith('/auth_tokens/token/'), ovCalls.slice(1).every((c) => c.auth === 'Bearer tok'), ovCalls.length > 2, ovHits.length], [true, true, true, 1]);
  delete process.env.OPENVERSE_CLIENT_ID;
  delete process.env.OPENVERSE_CLIENT_SECRET;
  resetOpenverseState();
  delete world['api.openverse.org'];
}

// Library of Congress — documented shape, unverified live (Cloudflare).
const loc = normalizeLocResult({ id: 'https://www.loc.gov/item/2021667/', title: 'Apollo 11 launch', date: '1969', original_format: ['film, video'], image_url: ['https://tile.loc.gov/t.jpg'], contributor: ['NASA'], item: { rights: 'No known restrictions on publication.', location: ['Florida'] }, resources: [{ files: [[{ url: 'https://tile.loc.gov/a.mp4', mimetype: 'video/mp4', width: 640, height: 480, duration: 120 }]] }] });
check('LoC: no known restrictions is public domain', [loc.provider, loc.mediaType, loc.rightsStatus, loc.reviewStatus], ['loc', 'video', 'public_domain', 'auto_approved']);
check('LoC: the nested file list is read, the id is the path', [loc.downloadUrl, loc.durationSeconds, loc.providerAssetId], ['https://tile.loc.gov/a.mp4', 120, 'item/2021667']);
check('LoC: any other rights sentence is manual review, kept verbatim', normalizeLocResult({ id: 'https://www.loc.gov/item/1/', title: 'T', original_format: ['photo, print, drawing'], item: { rights: 'Rights status not evaluated.' } }).reviewReason.includes('Rights status not evaluated'), true);
check('locFiles flattens', locFiles([{ files: [[{ url: 'a' }], [{ url: 'b' }]] }, { video: 'c' }]).map((f) => f.url), ['a', 'b', 'c']);

// Flickr — documented shape.
const fl = normalizeFlickrPhoto({ id: '51', owner: '12@N01', pathalias: 'someone', title: 'Protest in Ceuta', license: '4', description: { _content: 'May 2026' }, datetaken: '2026-05-18 10:00:00', ownername: 'Someone', tags: 'ceuta protest', url_l: 'https://live.staticflickr.com/l.jpg', width_l: 1024, height_l: 768, url_o: 'https://live.staticflickr.com/o.jpg', width_o: 4000, height_o: 3000 });
check('Flickr: CC BY with credit, the original file, the day taken', [fl.rightsStatus, fl.attributionRequired, fl.downloadUrl, fl.filmingDate, fl.width], ['cc_by', true, 'https://live.staticflickr.com/o.jpg', '2026-05-18', 4000]);
check('Flickr: a photo of the day is recent news; a Commons one is historical', [fl.origin, normalizeFlickrPhoto({ id: '1', license: '7', url_l: 'https://x/l.jpg' }).origin], ['recent_news', 'historical']);
check('Flickr: no known copyright restrictions is public domain, credit not owed', normalizeFlickrPhoto({ id: '1', license: '7', url_l: 'https://x/l.jpg' }).rightsStatus, 'public_domain');
check('Flickr: a licence the query never asks for is not an asset', normalizeFlickrPhoto({ id: '1', license: '2', url_l: 'https://x/l.jpg' }), null);

// Stock — documented shapes, and one rule: cleared under the library's blanket licence.
const px = normalizePexelsVideo({ id: 7, width: 3840, height: 2160, duration: 12, url: 'https://www.pexels.com/video/7/', image: 'https://i/7.jpg', user: { name: 'Ana' }, video_files: [{ quality: 'uhd', file_type: 'video/mp4', width: 3840, height: 2160, link: 'https://v/uhd.mp4' }, { quality: 'hd', file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://v/hd.mp4' }, { quality: 'sd', file_type: 'video/mp4', width: 960, height: 540, link: 'https://v/sd.mp4' }] });
check('Pexels: the HD file, not the 4K one', [px.downloadUrl, px.width], ['https://v/hd.mp4', 1920]);
check('Pexels: cleared, no credit owed, real stock', [F.validateRights(px).status, px.provenance, px.footageFormat, px.tier], ['cleared', 'real_stock', 'stockshots', undefined]);
check('Pexels: a photo', normalizePexelsPhoto({ id: 9, width: 4000, height: 3000, url: 'https://www.pexels.com/photo/9/', photographer: 'Ana', alt: 'A quiet town', src: { large2x: 'https://i/9-2x.jpg', medium: 'https://i/9-m.jpg' } }).title, 'A quiet town');
check('pickPexelsFile with only 4K takes it', pickPexelsFile([{ file_type: 'video/mp4', width: 3840, height: 2160, link: 'u' }]).link, 'u');
const pb = normalizePixabayVideo({ id: 3, pageURL: 'https://pixabay.com/videos/id-3/', tags: 'town, dawn', duration: 20, user: 'Ion', videos: { large: { url: 'https://p/l.mp4', width: 1920, height: 1080, size: 100, thumbnail: 'https://p/l.jpg' }, medium: { url: 'https://p/m.mp4', width: 1280, height: 720 } } });
check('Pixabay: large at 1920, cleared, tagged', [pb.downloadUrl, F.validateRights(pb).status, pb.categories], ['https://p/l.mp4', 'cleared', ['town', 'dawn']]);
check('Pixabay: a photo', normalizePixabayImage({ id: 4, largeImageURL: 'https://p/4.jpg', tags: 'sea', imageWidth: 1920, imageHeight: 1280, user: 'Ion' }).title, 'Stock photo: sea');
const us = normalizeUnsplashPhoto({ id: 'abcdefghijk', alt_description: 'a harbour at dusk', width: 6000, height: 4000, urls: { full: 'https://u/full.jpg', small: 'https://u/s.jpg' }, links: { html: 'https://unsplash.com/photos/abcdefghijk', download_location: 'https://api.unsplash.com/photos/abcdefghijk/download' }, user: { name: 'Maria' }, location: { city: 'Constanța', country: 'Romania' } });
check('Unsplash: credit is OWED (the API guideline), and reads as it must', [F.validateRights(us).status, us.credit, us.location], ['attribution_required', 'Photo by Maria on Unsplash', 'Constanța, Romania']);

// ---------------------------------------------------------------------------
// Rights — the central validator
// ---------------------------------------------------------------------------
console.log('\n--- rights ---');
const base = { ...dv };
check('cleared when nothing is owed', F.validateRights({ ...base, attributionRequired: false }).status, 'cleared');
check('credit required when it is', F.validateRights({ ...base, attributionRequired: true }).status, 'attribution_required');
check('rejected is restricted', F.validateRights({ ...base, reviewStatus: 'rejected' }).status, 'restricted');
check('manual review stays manual review', F.validateRights({ ...base, reviewStatus: 'manual_review', rightsStatus: 'other_free' }).status, 'manual_review');
check('nothing stated at all is unknown', F.validateRights({ ...base, reviewStatus: 'manual_review', rightsStatus: 'unknown', licenseOriginal: null, licenseCode: null, rightsText: null }).status, 'unknown');
check('editorial-only overrides a free licence', F.validateRights({ ...base, rightsText: 'For editorial use only' }).status, 'editorial_only');
check('restricted never renders', F.renderable({ status: 'restricted' }, 'approved'), false);
check('manual review renders only after a person', [F.renderable({ status: 'manual_review' }, 'candidate'), F.renderable({ status: 'manual_review' }, 'approved')], [false, true]);
check('cleared renders on its own', F.usableAutomatically({ status: 'cleared' }), true);
check('a Commons row is not second-guessed for third parties', F.validateRights({ ...base, provider: 'wikimedia', credit: 'Courtesy of X', attributionRequired: true }).status, 'attribution_required');

// ---------------------------------------------------------------------------
// Provenance — actual vs illustrative, from metadata
// ---------------------------------------------------------------------------
console.log('\n--- provenance ---');
const ceutaReq = F.buildFootageRequest({ ...CEUTA_SCENE, event: 'Ceuta migration crisis', location: 'Ceuta', country: 'Spain', dateFrom: '2026-05-18', dateTo: '2026-05-20', people: [], organizations: [] });
const exact = { ...eu, eventName: 'Ceuta migration crisis', filmingDate: '2026-05-18', location: 'Ceuta, Spain', country: 'Spain', title: 'Ceuta migration crisis border stockshots', description: 'Migrants at the Ceuta border with Spain, May 2026' };
const ax = F.assessProvenance(ceutaReq, exact);
check('event + date + place from the provider → ACTUAL FOOTAGE', ax.provenance, 'actual_footage');
truthy('and at or past the threshold', ax.confidence >= 90);
const wrongPlace = { ...exact, location: 'Melilla, Spain', title: 'Melilla border', description: 'Melilla', eventName: 'Melilla border incident' };
check('a different event → illustrative', F.assessProvenance(ceutaReq, wrongPlace).provenance, 'illustrative_footage');
const noDate = { ...exact, filmingDate: null, publicationDate: null, yearsMentioned: [] };
check('no date stated → not actual, whatever else matches', F.assessProvenance(ceutaReq, noDate).provenance, 'illustrative_footage');
check('no request → the asset on its own (archival)', F.assessProvenance(null, exact).provenance, 'archival_footage');
check('a still on its own is an archival photo', F.assessProvenance(null, { ...exact, mediaType: 'image' }).provenance, 'archival_photo');
const upload = { ...exact, provider: 'user_upload', provenance: 'unknown' };
check('an upload is unknown however well it matches', F.assessProvenance(ceutaReq, upload).provenance, 'unknown');
check('and so is a URL import', F.assessProvenance(ceutaReq, { ...exact, provider: 'url_import', provenance: 'unknown' }).provenance, 'unknown');
check('the weights sum to 100', Object.values(F.PROVENANCE_WEIGHTS).reduce((a, b) => a + b, 0), 100);
check('a matching-looking title alone is not the event', F.matchSignals(ceutaReq, { ...exact, eventName: null, title: 'Ceuta', description: '' }).event, 'unknown');

// ---------------------------------------------------------------------------
// Ranking — and the B-roll ladder
// ---------------------------------------------------------------------------
console.log('\n--- ranking ---');
check('the weights sum to 100', Object.values(F.RANK_WEIGHTS).reduce((a, b) => a + b, 0), 100);
// Both name the event and the place in their text — the comparison is about
// the KIND of shot, not about one of them having been catalogued better.
const broll = { ...eu, footageFormat: 'broll', durationSeconds: 40, title: 'Stockshots: Ceuta border', description: 'Migrants at the Ceuta border with Spain during the Ceuta migration crisis' };
const presser = { ...eu, providerAssetId: 'I-9', footageFormat: 'press_conference', durationSeconds: 1450, title: 'Press conference on Ceuta', description: 'Statement on the Ceuta migration crisis, Spain' };
const rb = F.rankOne(ceutaReq, broll);
const rp = F.rankOne(ceutaReq, presser);
truthy('B-roll beats a 24-minute press conference for narration', rb.score > rp.score);
truthy('and the presser is told why', rp.reasons.some((r) => /talking head/.test(r)));
const speechReq = { ...ceutaReq, preferredFootageType: 'speech' };
truthy('but when the scene quotes a statement, the presser wins', F.rankOne(speechReq, presser).score > F.rankOne(speechReq, broll).score);
truthy('a wrong country is penalised', F.rankOne(ceutaReq, { ...broll, country: 'Morocco', location: 'Tangier, Morocco', title: 'Tangier port', description: 'Tangier' }).score < rb.score - 20);
truthy('a wrong date is penalised', F.rankOne(ceutaReq, { ...broll, filmingDate: '2015-03-01', title: 'Ceuta old', description: 'Ceuta 2015' }).score < rb.score - 15);
truthy('reuse is penalised', F.rankOne(ceutaReq, broll, { reused: true }).score < rb.score);
check('an absent date is not a wrong date', F.rankOne(ceutaReq, { ...broll, filmingDate: null, publicationDate: null, yearsMentioned: [] }).reasons.some((r) => /outside/.test(r)), false);
const ordered = F.orderByScore([{ score: 50, asset: presser }, { score: 50, asset: broll }, { score: 50, asset: { ...broll, mediaType: 'image', providerAssetId: 'img' } }], ceutaReq);
check('ties break pictures > speech, video > still', ordered.map((x) => x.asset.footageFormat === 'press_conference' ? 'presser' : x.asset.mediaType), ['video', 'image', 'presser']);
truthy('an image is a fallback, not a match, when video was wanted', F.visualUsefulness({ ...broll, mediaType: 'image' }, 'broll', 'video') < F.visualUsefulness(broll, 'broll', 'video'));

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------
console.log('\n--- dedupe ---');
check('the same page through two doors is one asset', F.dedupeAssets([{ ...eu, provider: 'url_import', providerAssetId: 'h1', sourceUrl: 'https://x/a?utm_source=y' }, { ...eu, provider: 'url_import', providerAssetId: 'h2', sourceUrl: 'https://x/a#top' }]).length, 1);
check('the same hash is one asset', F.dedupeAssets([{ ...eu, providerAssetId: 'a', sourceUrl: 'https://x/1', downloadUrl: 'https://x/1.mp4', contentHash: 'abc' }, { ...eu, providerAssetId: 'b', sourceUrl: 'https://x/2', downloadUrl: 'https://x/2.mp4', contentHash: 'abc' }]).length, 1);
check('different assets stay two', F.dedupeAssets([{ ...eu, providerAssetId: 'a', sourceUrl: 'https://x/1', downloadUrl: 'https://x/1.mp4' }, { ...eu, providerAssetId: 'b', sourceUrl: 'https://x/2', downloadUrl: 'https://x/2.mp4' }]).length, 2);
check('canonical URL drops tracking and mobile hosts', F.canonicalUrl('https://commons.m.wikimedia.org/wiki/File:A.jpg?utm_source=x#y'), 'https://commons.wikimedia.org/wiki/File:A.jpg');

// ---------------------------------------------------------------------------
// The engine end to end: local first, routing, isolation, filtering
// ---------------------------------------------------------------------------
console.log('\n--- engine ---');
mock.reset();
calls.length = 0;
let r = await F.searchFootage(ceutaReq, { limit: 6, top: 12 });
truthy('external providers were asked on an empty library', calls.length > 0);
const routed = r.providers.filter((p) => p.routed).map((p) => p.provider);
truthy('EU AV and Wikimedia were routed, at most four in all', routed.includes('eu_av') && routed.includes('wikimedia') && routed.length <= 4);
truthy('the library providers are never in the report as routed', !routed.includes('url_import') && !routed.includes('user_upload'));
truthy('best match is EU AV B-roll of the event', r.candidates[0].asset.provider === 'eu_av' && r.candidates[0].asset.footageFormat === 'stockshots');
check('the restricted third-party asset was filtered out, not merely ranked low', r.candidates.some((c) => c.asset.providerAssetId === 'I-260003' && c.rights.status === 'restricted'), false);
truthy('every candidate is filed with an id', r.candidates.every((c) => c.asset.id));
truthy('every candidate carries a usage class', r.candidates.every((c) => c.rights.status));
truthy('every candidate carries a provenance', r.candidates.every((c) => c.provenance));
check('the presser ranks below the stockshots', r.candidates.findIndex((c) => c.asset.providerAssetId === 'I-260002') > 0, true);

calls.length = 0;
r = await F.searchFootage(ceutaReq, { limit: 6, top: 12 });
check('the second identical search asked nobody — the library answered', calls.length, 0);
check('and its source says so', r.source, 'library');

// Provider failure isolation.
mock.reset();
calls.length = 0;
const okEu = world['audiovisual.ec.europa.eu'];
world['audiovisual.ec.europa.eu'] = async () => new Error('connection reset');
r = await F.searchFootage(ceutaReq, { limit: 6, top: 12 });
truthy('a dead provider costs its own results only', r.candidates.length > 0 && r.candidates.every((c) => c.asset.provider !== 'eu_av'));
check('and is reported by name', r.providers.find((p) => p.provider === 'eu_av').reason, 'connection reset');
world['audiovisual.ec.europa.eu'] = async () => [200, { items: [] }];
r = await F.searchFootage(ceutaReq, { limit: 6, top: 12, forceProviders: true });
r = await F.searchFootage(ceutaReq, { limit: 6, top: 12, forceProviders: true });
world['audiovisual.ec.europa.eu'] = async () => new Error('boom');
await F.searchFootage(ceutaReq, { limit: 6, top: 12, forceProviders: true });
await F.searchFootage(ceutaReq, { limit: 6, top: 12, forceProviders: true });
await F.searchFootage(ceutaReq, { limit: 6, top: 12, forceProviders: true });
truthy('three failures in a row hold a provider back', F.heldBack('eu_av'));
world['audiovisual.ec.europa.eu'] = okEu;

// A rate limit holds it back longer, and the film goes on.
mock.reset();
world['api.dvidshub.net'] = async () => [429, 'slow down', 'text/plain'];
r = await F.searchFootage(military, { limit: 6, top: 12 });
truthy('a rate-limited provider is reported, not fatal', r.providers.find((p) => p.provider === 'dvids').reason?.includes('rate limit'));
truthy('and the others still answered', r.candidates.length > 0);

// The fallback ladder.
console.log('\n--- fallback ---');
mock.reset();
world['api.dvidshub.net'] = async () => [200, { results: [] }];
r = await F.searchFootage(space, { limit: 6, top: 12 });
check('NASA video first when it exists', F.fallbackPlan(r).use, 'video');
const imgOnly = { ...r, candidates: r.candidates.filter((c) => c.asset.mediaType === 'image') };
check('a real image before AI', F.fallbackPlan({ ...r, candidates: [{ ...r.candidates[0], asset: { ...r.candidates[0].asset, mediaType: 'image' } }] }).use, 'image');
check('nothing relevant → AI, not an unrelated clip', F.fallbackPlan({ ...r, candidates: r.candidates.map((c) => ({ ...c, score: 10 })) }).use, 'ai');
void imgOnly;

// ---------------------------------------------------------------------------
// The URL reader
// ---------------------------------------------------------------------------
console.log('\n--- url import ---');
const page = (extra) => `<html><head><title>Fallback title</title>
<meta property="og:title" content="Border crossing at Ceuta">
<meta property="og:description" content="Migrants cross into Ceuta, Spain">
<meta property="og:image" content="/thumb.jpg">
<meta property="og:video:secure_url" content="https://media.example.gov/ceuta.mp4">
<meta property="og:video:width" content="1920"><meta property="og:video:height" content="1080">
${extra ?? ''}
<script type="application/ld+json">{"@type":"VideoObject","name":"Border crossing at Ceuta","uploadDate":"2026-05-19","dateCreated":"2026-05-18","duration":"PT1M30S","author":{"name":"Ministry of Interior"},"contentLocation":{"name":"Ceuta","address":{"addressCountry":"ES"}},"license":"https://creativecommons.org/licenses/by/4.0/"}</script>
</head><body></body></html>`;
let imp = F.readPage('https://media.example.gov/videos/123', page());
check('title from OpenGraph', imp.asset.title, 'Border crossing at Ceuta');
check('the media file from og:video', imp.asset.downloadUrl, 'https://media.example.gov/ceuta.mp4');
check('the thumbnail resolves relative to the page', imp.asset.thumbnailUrl, 'https://media.example.gov/thumb.jpg');
check('dates: shot vs published, from JSON-LD', [imp.asset.filmingDate, imp.asset.publicationDate], ['2026-05-18', '2026-05-19']);
check('duration from ISO 8601', imp.asset.durationSeconds, 90);
check('creator and place', [imp.asset.creator, imp.asset.location, imp.asset.country], ['Ministry of Interior', 'Ceuta, ES', 'ES']);
check('a CC BY licence is read', [imp.asset.rightsStatus, F.validateRights(imp.asset).status], ['cc_by', 'attribution_required']);
check('an import is never authentic', imp.asset.provenance, 'unknown');
check('provider is url_import', imp.asset.provider, 'url_import');
imp = F.readPage('https://news.example.com/story', page().replace(/<script[\s\S]*<\/script>/, ''));
check('no licence → manual review, with the reason on the list', [F.validateRights(imp.asset).status, imp.warnings.some((w) => /MANUAL REVIEW/.test(w))], ['manual_review', true]);
imp = F.readPage('https://www.youtube.com/watch?v=abc', page());
check('a platform stream is not ripped: no media URL', imp.asset.downloadUrl === imp.asset.sourceUrl, true);
check('and it is manual review by the platform\'s terms', F.validateRights(imp.asset).status, 'manual_review');
imp = F.readPage('https://ec.europa.eu/some/video', page().replace(/<script[\s\S]*<\/script>/, ''));
check('a europa.eu page without a licence takes the EU policy — as manual review', [imp.asset.rightsStatus, imp.asset.reviewStatus], ['cc_by', 'manual_review']);
imp = F.readPage('https://x.example/live', page().replace('https://media.example.gov/ceuta.mp4', 'https://x.example/live.m3u8'));
check('an HLS manifest is never a media file', imp.asset.downloadUrl === imp.asset.sourceUrl, true);
let refused = null;
try { await F.importFootageFromUrl('http://postgres:5432/x'); } catch (e) { refused = e; }
truthy('an address inside the box is refused', refused instanceof F.ImportRefused);
refused = null;
try { await F.importFootageFromUrl('ftp://a.b/c'); } catch (e) { refused = e; }
truthy('a non-http scheme is refused', refused instanceof F.ImportRefused);
world['locked.example'] = async () => [403, 'no', 'text/html'];
refused = null;
try { await F.importFootageFromUrl('https://locked.example/video'); } catch (e) { refused = e; }
truthy('a page behind an access control is refused, not fetched around', refused instanceof F.ImportRefused && /login|not public/.test(refused.message));
world['commons.wikimedia.org.pages'] = null;
const commonsOrig = world['commons.wikimedia.org'];
world['commons.wikimedia.org'] = async (url) => url.searchParams.get('titles') ? [200, { query: { pages: [commonsPage(77, 'A.webm', 'VIDEO')] } }] : url.searchParams.get('pageids') ? [200, { query: { pages: [commonsPage(77, 'A.webm', 'VIDEO')] } }] : commonsOrig(url);
imp = await F.importFootageFromUrl('https://commons.wikimedia.org/wiki/File:A.webm');
check('a Commons page goes through the Commons adapter', [imp.via, imp.asset.provider, imp.asset.providerAssetId], ['provider', 'wikimedia', '77']);
world['commons.wikimedia.org'] = commonsOrig;
// A keyed provider that is OFF cannot answer from its catalogue; its page is
// read like any other instead of the import dying on the missing key.
delete process.env.PEXELS_API_KEY;
world['www.pexels.com'] = async () => [200, page(''), 'text/html'];
imp = await F.importFootageFromUrl('https://www.pexels.com/video/a-city-at-night-12345/');
check('a page from a provider that is off goes through the generic reader', [imp.via === 'provider', imp.asset.provider], [false, 'url_import']);

// ---------------------------------------------------------------------------
// The legacy door, and the retired providers
// ---------------------------------------------------------------------------
console.log('\n--- legacy & deprecation ---');
mock.reset();
const legacy = await archive.searchArchives('Ceuta border', { mediaType: 'any', limit: 6 });
truthy('searchArchives still answers, through the engine', legacy.results.length > 0);
// A retired provider: absent from the registry, null from the door, and the
// rows it once filed still readable and rankable in the library.
check('ARCHIVE_PROVIDERS names only registry ids', archive.ARCHIVE_PROVIDERS.filter((p) => !F.providerById(p)), []);
check('adapterFor(a retired id) is null — no search reaches it', archive.adapterFor('legacy_archive'), null);
mock.reset();
await mock.saveStockCandidates([{ ...eu, provider: 'legacy_archive', providerAssetId: 'old-1', title: 'Ceuta 1936 newsreel', description: 'Spain', searchableText: 'ceuta 1936 newsreel spain' }]);
r = await F.searchFootage(ceutaReq, { limit: 6, top: 12, localOnly: true });
check('an old row under a retired provider is still found in the library', r.candidates.some((c) => c.asset.provider === 'legacy_archive'), true);
check('and no provider by that name was asked', r.providers.some((p) => p.provider === 'legacy_archive'), false);
check('the router can never pick it', F.searchableProviders().map((p) => p.id).includes('legacy_archive'), false);

// ---------------------------------------------------------------------------
// The watermark contract: what the scene would print for a chosen asset
// ---------------------------------------------------------------------------
console.log('\n--- source watermark ---');
const P = await import(join(root, 'lib', 'provenance.ts'));
const chosen = F.judge(ceutaReq, { ...exact, id: 'rec1' }, false);
check('an actual-footage match prints ACTUAL FOOTAGE with its source', P.formatSourceWatermark({ visualOrigin: chosen.provenance, provider: 'eu_av', originalLocation: exact.location, originalDate: exact.filmingDate }), { label: 'ACTUAL FOOTAGE', source: 'Source: EU Audiovisual Service · Ceuta, Spain · 2026-05-18' });
const ill = F.judge(ceutaReq, { ...wrongPlace, id: 'rec2' }, false);
check('an illustrative match prints ILLUSTRATIVE FOOTAGE', P.getSourceLabel({ visualOrigin: ill.provenance }), 'ILLUSTRATIVE FOOTAGE');
check('DVIDS prints its own name', P.providerLabel('dvids'), 'DVIDS');
check('so do the new archives', ['internet_archive', 'europeana', 'wellcome', 'loc'].map((id) => P.providerLabel(id)), ['Internet Archive', 'Europeana', 'Wellcome Collection', 'Library of Congress']);
check('and a retired provider still prints something readable', P.providerLabel('legacy_archive'), 'Legacy Archive');

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
