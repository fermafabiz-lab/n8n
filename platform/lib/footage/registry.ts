/**
 * The provider registry and the router that reads it.
 *
 * A request is a description of what a scene NEEDS; the registry knows what
 * each provider is GOOD FOR, on two axes. The subject categories say WHAT a
 * provider holds (military, space, medicine, Europe…); the tier says what
 * KIND of source it is — an official body publishing its own footage, an
 * archive of dated historical material, a community of openly licensed
 * photographs, or a stock library of generic B-roll. The router scores every
 * enabled provider on both, asks the best four, and never the whole list:
 * a stock library has nothing to say about a named event, an official
 * newsroom nothing about 1944, and a request that matches nothing still
 * reaches the general archives so no scene is met with silence.
 *
 * Adding a provider is one entry here and one file in ./providers. Nothing in
 * the scene-matching path names a provider.
 */

import type { ArchiveProvider } from "@/lib/archive/types";
import type { FootageProvider, FootageSearchRequest, ProviderTier } from "./types";
import { wikimediaProvider } from "./providers/wikimedia";
import { euAvProvider } from "./providers/euav";
import { dvidsProvider } from "./providers/dvids";
import { nasaProvider } from "./providers/nasa";
import { internetArchiveProvider } from "./providers/internetArchive";
import { europeanaProvider } from "./providers/europeana";
import { locProvider } from "./providers/loc";
import { wellcomeProvider } from "./providers/wellcome";
import { flickrProvider } from "./providers/flickr";
import { openverseProvider } from "./providers/openverse";
import { pexelsProvider } from "./providers/pexels";
import { pixabayProvider } from "./providers/pixabay";
import { unsplashProvider } from "./providers/unsplash";
import { urlImportProvider } from "./providers/urlImport";
import { userUploadProvider } from "./providers/upload";

/**
 * The active providers, in priority order within each tier. Every one is a
 * file under ./providers; a provider the producer has retired is simply not
 * here — never a disabled placeholder (docs/footage-sources.md).
 */
const PROVIDERS: readonly FootageProvider[] = [
  // official — a body's own footage of its own events
  euAvProvider,
  dvidsProvider,
  nasaProvider,
  // archive — dated historical material with a rights statement per item
  internetArchiveProvider,
  europeanaProvider,
  locProvider,
  wikimediaProvider,
  wellcomeProvider,
  // community — photographs people licensed openly
  flickrProvider,
  openverseProvider,
  // stock — generic B-roll under a blanket licence
  pexelsProvider,
  pixabayProvider,
  unsplashProvider,
  // library — our own rows; never routed
  urlImportProvider,
  userUploadProvider,
];

export function allProviders(): readonly FootageProvider[] {
  return PROVIDERS;
}

export function providerById(id: string): FootageProvider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/**
 * Providers the router may ASK. The local ones (uploads, URL imports)
 * answer from the library, which the engine reads first anyway — routing them
 * would search the same rows twice and report a "provider" that never left
 * the box. The picker's explicit filter still reaches them through the
 * library pass (`EngineOptions.providers`).
 */
export function searchableProviders(): FootageProvider[] {
  return PROVIDERS.filter(
    (p) => p.enabled && !p.searchCapabilities.localOnly && (p.searchCapabilities.video || p.searchCapabilities.image),
  );
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * Category vocabulary. A provider declares the ones it is strong in; the
 * router derives the request's from its words. Plain English only — the
 * narration is Romanian as often as not, so the model's structured fields
 * (topic, event, organisations) carry most of the signal, and the keyword
 * table below is for what those fields say.
 */
const CATEGORY_TERMS: Record<string, RegExp> = {
  military:
    /\b(militar\w*|military|army|navy|air ?force|marines?|soldier\w*|troops?|battalion|brigade|regiment|nato|pentagon|defen[cs]e|warship|fighter jets?|drone strike|artillery|infantry|armat\w*|razboi|war\b|warfare|combat|deployment|exercise[sd]?\b|manoeuvre|maneuver)/i,
  war: /\b(war\b|warfare|invasion|offensive|front ?line|ceasefire|bombard\w*|siege|razboi|invazi\w*|ofensiv\w*)/i,
  aviation: /\b(aircraft|airplane|aviation|helicopter|jets?\b|airbase|air ?force|pilot\w*|avion\w*|aeronav\w*)/i,
  humanitarian: /\b(humanitarian|refugee\w*|aid\b|relief|evacuat\w*|rescue\w*|red cross|unhcr|unicef|umanitar\w*|refugia\w*|evacua\w*)/i,
  disaster: /\b(earthquake|flood\w*|hurricane|typhoon|wildfire\w*|tsunami|eruption|disaster|cutremur|inundat\w*|incendi\w*|dezastr\w*)/i,
  geopolitics: /\b(geopolit\w*|sanctions?|summit|treaty|alliance|border\w*|diplomat\w*|embassy|ceasefire|coalition)/i,
  europe:
    /\b(europe\w*|european|eu\b|e\.u\.|brussels|strasbourg|commission|parliament|council of the eu|eurozone|schengen|frontex|europ\w*|bruxelles|comisia|parlamentul european)/i,
  politics:
    /\b(politic\w*|election\w*|minister\w*|president\w*|parliament\w*|government\w*|policy|legislation|referendum|vote\w*|alegeri|guvern\w*|ministr\w*|presedint\w*)/i,
  migration:
    /\b(migra\w*|migrant\w*|refugee\w*|asylum|border\w*|crossing|deportation|smuggl\w*|frontex|ceuta|melilla|lampedusa|imigra\w*|azil|granit\w*|frontier\w*)/i,
  government: /\b(government\w*|ministry|ministries|official\w*|agency|agencies|federal|state department|guvern\w*|minister\w*|oficial\w*)/i,
  eu: /\b(eu\b|european union|european commission|european parliament|eurogroup|ecb\b|uniunea europeana|comisia europeana)/i,
  space:
    /\b(space\w*|nasa|orbit\w*|astronaut\w*|cosmonaut\w*|rocket\w*|launch\w*|satellite\w*|iss\b|space station|apollo|artemis|mars|moon|lunar|shuttle|spatiu|spatial\w*|racheta|astronaut\w*|lansar\w*)/i,
  science: /\b(scien\w*|research\w*|laborator\w*|experiment\w*|physics|biology|chemistry|telescope|stiint\w*|cercet\w*)/i,
  medicine:
    /\b(medic\w*|health|disease\w*|epidemic\w*|pandemic\w*|hospital\w*|doctor\w*|nurse\w*|vaccin\w*|cholera|plague|surgery|surgeon\w*|anatomy|virus\w*|sanatate|boal\w*|spital\w*|epidemi\w*|pandemi\w*)/i,
  technology: /\b(technolog\w*|engineer\w*|prototype|robot\w*|computer\w*|software|tehnolog\w*|ingine\w*)/i,
  earth: /\b(earth observation|climate|atmosphere|glacier\w*|ocean\w*|hurricane|weather|satellite imagery|clima\w*|ghetar\w*)/i,
  missions: /\b(mission\w*|launch\w*|landing|docking|spacewalk|misiun\w*)/i,
  history:
    /\b(histor\w*|archiv\w*|centur\w*|medieval|ancient|world war|ww[12]|cold war|revolution\w*|empire|kingdom|1[6-9]\d\d\b|istori\w*|secol\w*|razboiul mondial|revolut\w*)/i,
  places: /\b(city|cities|town|village|capital|river|mountain\w*|island\w*|coast\w*|harbour|harbor|port\b|oras\w*|sat\b|insul\w*)/i,
  people: /\b(portrait|biograph\w*|born|died|childhood|family|biografi\w*|nascut|copilari\w*)/i,
  events: /\b(event\w*|ceremony|festival|protest\w*|demonstration\w*|march\b|rally|parade|celebration|protest\w*|ceremoni\w*)/i,
  general: /./,
};

/** The categories a request names, most specific first. */
export function requestCategories(r: FootageSearchRequest): string[] {
  const text = [
    r.topic ?? "",
    r.event ?? "",
    r.location ?? "",
    r.country ?? "",
    (r.people ?? []).join(" "),
    (r.organizations ?? []).join(" "),
    r.keywords.join(" "),
    // The narration last and only for the strong signals — it is long and
    // matches "general" on its own.
    r.narration.slice(0, 600),
  ].join(" \n ");
  const out: string[] = [];
  for (const [cat, re] of Object.entries(CATEGORY_TERMS)) {
    if (cat === "general") continue;
    if (re.test(text)) out.push(cat);
  }
  // A dated request before the era of the official media providers is a
  // history request whatever else it says.
  const y = /(1[6-9]\d\d|20\d\d)/.exec(r.dateFrom ?? "");
  if (y && Number(y[1]) < 1995 && !out.includes("history")) out.push("history");
  return out;
}

export interface RoutedProvider {
  provider: FootageProvider;
  /** How many of the request's categories it claims. */
  matches: number;
  /** The router's score — why it is in the list, for the report. */
  score: number;
}

/** How far a tier fits what the request is: its era and whether it names an event. */
function tierFit(tier: ProviderTier, p: FootageProvider, r: FootageSearchRequest, historical: boolean): number {
  const hasEvent = Boolean(r.event);
  const hasPlace = Boolean(r.location || r.country);
  const wantsPictures = r.preferredFootageType !== "speech" && r.preferredFootageType !== "interview";
  switch (tier) {
    case "official":
      // A newsroom cannot search the past; on its own subjects it LEADS —
      // a body's footage of its own events outranks an archive's general
      // coverage, which is what the +3 buys against the archive's `general`.
      if (historical && !p.searchCapabilities.historical) return -Infinity;
      return p.categories.some((c) => c !== "general" && requestCategories(r).includes(c)) ? 3 : 0;
    case "archive":
      // Dated material: the whole answer for history, a strong second on any
      // named event, and — through `general` — the fallback for everything.
      return (historical ? 2 : hasEvent ? 1 : 0) + (p.categories.includes("general") ? 2 : 0);
    case "community":
      // Photographs of the day: recent events and places, after the official
      // sources; the Commons side (historical capability) rides along on history.
      return historical ? (p.searchCapabilities.historical ? 0.5 : -Infinity) : hasEvent || hasPlace ? 1 : 0;
    case "stock":
      // Generic B-roll is an answer only when the scene names NO event: a
      // real clip of the wrong thing is not real footage of anything.
      return hasEvent || r.requireExactEvent || !wantsPictures ? -Infinity : 1;
    case "library":
      return -Infinity;
  }
}

/**
 * Which providers to ask, in order. Every enabled searchable provider is
 * scored — two points per subject category it shares with the request,
 * plus its tier's fit for the request's era and shape — and the best `max`
 * with a positive score are asked, priority breaking ties. A request that
 * names an explicit provider list is honoured as given. Four at a time is
 * plenty, and the spec is explicit about not searching everything for
 * everything.
 */
export function routeProviders(
  r: FootageSearchRequest,
  opts: { only?: ArchiveProvider[]; max?: number; historical?: boolean; skip?: (p: FootageProvider) => boolean } = {},
): RoutedProvider[] {
  const wanted = searchableProviders().filter((p) => !opts.only || opts.only.includes(p.id));
  if (opts.only?.length) return wanted.map((provider) => ({ provider, matches: 1, score: 1 }));
  // A provider the caller knows cannot answer right now (held back after
  // failures, rate-limited) gives its slot to the next candidate instead of
  // occupying one of the four with a refusal. An explicit `only` list is the
  // producer's own choice and is never thinned.
  const candidates = opts.skip ? wanted.filter((p) => !opts.skip!(p)) : wanted;

  const cats = requestCategories(r);
  const historical = opts.historical ?? cats.includes("history");
  const scored = candidates.map((provider) => {
    const matches = provider.categories.filter((c) => c !== "general" && cats.includes(c)).length;
    const fit = tierFit(provider.tier, provider, r, historical);
    const score = fit === -Infinity ? 0 : matches * 2 + fit;
    return { provider, matches, score };
  });
  const chosen = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.provider.priority - a.provider.priority);
  return chosen.slice(0, Math.max(1, opts.max ?? 4));
}

/** What the picker's provider filter offers. */
export function providerFilterOptions(): Array<{ id: ArchiveProvider; label: string; enabled: boolean; reason: string | null; notice: string | null; tier: ProviderTier }> {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.displayName, enabled: p.enabled, reason: p.disabledReason, notice: p.notice ?? null, tier: p.tier }));
}

export const FootageProviderRegistry = { all: allProviders, get: providerById, searchable: searchableProviders, route: routeProviders };
