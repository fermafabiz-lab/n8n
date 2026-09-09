// In-memory stand-in for lib/data/stock — the library as a Map.
//
// Filing assigns ids, refreshes on conflict, keeps `status`; the text search
// is a word-overlap over the searchable text; the cache is a Map with no
// TTL. The check script reads and resets `library` between cases.
let seq = 0;
export const library = new Map();
export const cache = new Map();
export const used = new Set();

export function reset() {
  library.clear();
  cache.clear();
  used.clear();
  seq = 0;
}

const key = (a) => `${a.provider}:${a.providerAssetId}`;

export async function saveStockCandidates(assets) {
  const out = new Map();
  for (const a of assets) {
    const k = key(a);
    const prev = library.get(k);
    const row = {
      ...a,
      id: prev?.id ?? `rec${String(++seq).padStart(14, '0')}`,
      status: prev?.status ?? 'candidate',
      timesFound: (prev?.timesFound ?? 0) + 1,
      createdAt: prev?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mediaPath: a.mediaPath ?? prev?.mediaPath ?? null,
      contentHash: a.contentHash ?? prev?.contentHash ?? null,
      availabilityStatus: 'available',
      verifiedAt: prev?.verifiedAt ?? null,
      verifiedNote: null,
      notes: null,
      // A person's provenance survives a re-sighting, as in the real library.
      provenance: prev?.verifiedAt ? prev.provenance : (a.provenance ?? 'unknown'),
      provenanceConfidence: prev?.verifiedAt ? prev.provenanceConfidence : a.provenanceConfidence,
    };
    library.set(k, row);
    out.set(k, row);
  }
  return out;
}

export async function searchStockLibrary(q, opts) {
  const words = q.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w.length > 1);
  const providers = opts.providers?.length ? opts.providers : opts.provider ? [opts.provider] : null;
  return [...library.values()]
    .filter((r) => r.status !== 'rejected')
    .filter((r) => opts.mediaType === 'any' || r.mediaType === opts.mediaType)
    .filter((r) => !providers || providers.includes(r.provider))
    .filter((r) => words.some((w) => r.searchableText.includes(w)))
    .slice(0, opts.limit);
}

export async function getStockMedia(id) {
  return [...library.values()].find((r) => r.id === id) ?? null;
}
export async function setStockStatus(id, status) {
  const row = await getStockMedia(id);
  if (row) row.status = status;
}
export async function recentlyUsedProviderAssetKeys() {
  return new Set(used);
}
export async function readSearchCache() {
  return null;
}
export async function writeSearchCache(r, ids) {
  cache.set(JSON.stringify(r.keywords), ids);
}
export async function getSceneForFootage() {
  return null;
}
export async function updateStockMedia(id, patch) {
  const row = await getStockMedia(id);
  if (!row) return null;
  Object.assign(row, patch, { verifiedAt: new Date().toISOString() });
  return row;
}
export async function deleteStockMedia(id) {
  for (const [k, r] of library) if (r.id === id) return library.delete(k);
  return false;
}
export async function listStockMedia() {
  return { rows: [...library.values()], total: library.size };
}
export async function stockProviders() {
  return [];
}
export async function attachStockToScene() {}
export async function detachStockFromScene() {}
export async function saveUploadedFootage() {
  throw new Error('not in the mock');
}
export async function claimScenesForSuggestion() {
  return { project: null, scenes: [] };
}
export async function storeArchiveSuggestions() {
  return { scenes: 0, picks: 0 };
}
export async function resetArchiveSuggestions() {
  return 0;
}
export async function getSceneCanvas() {
  return null;
}
