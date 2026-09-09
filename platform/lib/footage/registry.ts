/**
 * The provider registry and the router that reads it.
 *
 * A request is a description of what a scene NEEDS; the registry knows what
 * each provider is GOOD FOR. The router puts the two together: it reads the
 * request's topic, event, place, country, dates, people and organisations,
 * turns them into a handful of category tags, and asks the providers whose
 * categories intersect — most matches first, priority breaking ties — with
 * the general providers always in the list so an unusual subject is never
 * met with silence.
 *
 * Adding a provider is one entry here and one file in ./providers. Nothing in
 * the scene-matching path names a provider.
 */

import type { ArchiveProvider } from "@/lib/archive/types";
import type { FootageProvider, FootageSearchRequest } from "./types";
import { wikimediaProvider } from "./providers/wikimedia";
import { euAvProvider } from "./providers/euav";
import { dvidsProvider } from "./providers/dvids";
import { nasaProvider } from "./providers/nasa";
import { urlImportProvider } from "./providers/urlImport";
import { userUploadProvider } from "./providers/upload";

/**
 * The active providers, in priority order. NARA and Smithsonian are NOT here
 * and must not come back as "disabled" placeholders — see
 * docs/nara-smithsonian-deprecation.md; the library still reads their rows.
 */
const PROVIDERS: readonly FootageProvider[] = [
  euAvProvider,
  dvidsProvider,
  nasaProvider,
  wikimediaProvider,
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
 * Providers the router may ASK. The two local ones (uploads, URL imports)
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
}

/**
 * Which providers to ask, in order. Every enabled searchable provider that
 * shares a category with the request, most matches first, then priority;
 * providers that only claim "general" ride along at the end. A request that
 * names an explicit provider list is honoured as given. `max` bounds the
 * fan-out — four at a time is plenty, and the spec is explicit about not
 * searching everything for everything.
 */
export function routeProviders(
  r: FootageSearchRequest,
  opts: { only?: ArchiveProvider[]; max?: number; historical?: boolean } = {},
): RoutedProvider[] {
  const wanted = searchableProviders().filter((p) => !opts.only || opts.only.includes(p.id));
  if (opts.only?.length) return wanted.map((provider) => ({ provider, matches: 1 }));

  const cats = requestCategories(r);
  const historical = opts.historical ?? cats.includes("history");
  const scored = wanted.map((provider) => {
    let matches = provider.categories.filter((c) => c !== "general" && cats.includes(c)).length;
    // Historical requests belong to the archive, not to the newsrooms; a
    // provider that cannot search the past loses its topical matches.
    if (historical && !provider.searchCapabilities.historical) matches = 0;
    return { provider, matches };
  });
  const general = (p: FootageProvider) => p.categories.includes("general");
  const chosen = scored
    .filter(({ provider, matches }) => matches > 0 || general(provider))
    .sort((a, b) => b.matches - a.matches || b.provider.priority - a.provider.priority);
  return chosen.slice(0, Math.max(1, opts.max ?? 4));
}

/** What the picker's provider filter offers. */
export function providerFilterOptions(): Array<{ id: ArchiveProvider; label: string; enabled: boolean; reason: string | null }> {
  return PROVIDERS.map((p) => ({ id: p.id, label: p.displayName, enabled: p.enabled, reason: p.disabledReason }));
}

export const FootageProviderRegistry = { all: allProviders, get: providerById, searchable: searchableProviders, route: routeProviders };
