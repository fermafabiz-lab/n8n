/**
 * The Universal Footage Engine, behind one import.
 *
 * See docs/universal-footage-engine.md for the map. The pieces:
 *
 *   types.ts      the contracts — FootageSearchRequest, FootageProvider, RightsResult
 *   request.ts    scene → request, request → 3–6 queries
 *   registry.ts   the providers, and the router that picks among them
 *   providers/    one adapter per source
 *   rights.ts     the central validator (six-way usage class)
 *   match.ts      the shared match signals
 *   provenance.ts actual vs illustrative, from metadata
 *   rank.ts       the 0–100 relevance score, penalties, B-roll ladder
 *   dedupe.ts     one asset, however many doors it came through
 *   health.ts     per-provider statistics and hold-backs
 *   urlImport.ts  a pasted URL → a library row
 *   engine.ts     the whole thing
 */

export * from "./types";
export { buildFootageRequest, generateSearchQueries } from "./request";
export { allProviders, providerById, providerFilterOptions, requestCategories, routeProviders, searchableProviders, FootageProviderRegistry } from "./registry";
export { validateRights, usableAutomatically, usableWithReview, renderable, attributionLine, USAGE_LABELS, FootageRightsValidator } from "./rights";
export { matchSignals } from "./match";
export { assessProvenance, baseProvenance, PROVENANCE_WEIGHTS } from "./provenance";
export { rankOne, orderByScore, visualUsefulness, RANK_WEIGHTS, RANK_PENALTIES, PROVIDER_RELIABILITY } from "./rank";
export { dedupeAssets, canonicalUrl, identityKeys } from "./dedupe";
export { heldBack, providerStats, recordSearch, recordSelection, recordFailure } from "./health";
export { importFootageFromUrl, readPage, ImportRefused } from "./urlImport";
export { searchFootage, judge, fallbackPlan, UniversalFootageEngine } from "./engine";
