/**
 * The central rights validator — one answer to "may this be rendered", for
 * every provider.
 *
 * The library already stores a licence verdict per asset (`rightsStatus`,
 * `reviewStatus`, `attributionRequired`, from lib/archive/rights.ts, which is
 * the only code that reads a licence string). This layer turns that verdict
 * plus the provider's own rights text into the six-way `UsageClass` the
 * engine, the picker and the admin page reason in:
 *
 *   cleared              use freely, no credit owed
 *   attribution_required use freely, credit owed (drawn by the render whatever
 *                        the watermark switch says)
 *   editorial_only       the provider allows editorial use only — never
 *                        rendered without a person confirming the film is that
 *   manual_review        nobody can tell yet; a person decides
 *   restricted           the licence says no; never rendered, no override
 *   unknown              nothing stated at all — treated as manual_review
 *
 * Two hard rules the engine enforces from this: `restricted` never reaches a
 * render, and `manual_review` / `editorial_only` reach one only through a
 * human act — the producer's own "Use", or the admin page's Verify — which is
 * recorded as `status = 'approved'` on the library row.
 */

import type { NormalizedFootageAsset, RightsResult, UsageClass } from "./types";
import { providerLabel } from "@/lib/provenance";

const EDITORIAL = /\beditorial(?:\s+use)?\s+only\b|\bfor\s+editorial\s+(?:use|purposes)\b|\bnews\s+use\s+only\b/i;

/** Words that can only mean somebody else owns it. */
const THIRD_PARTY =
  /\bthird[- ]party\b|\bcourtesy\s+of\b|\bused\s+with\s+permission\b|\bgetty\b|\breuters\b|\bap\s+photo\b|\bafp\b|\bshutterstock\b/i;

/** A copyright claim — whose, the provider's own name decides. */
const COPYRIGHT = /©|\(c\)\s|\ball\s+rights\s+reserved\b|\bcopyright(?:ed)?\s+(?:by|material|©)/i;

/**
 * The provider's own organisation. "© European Union" on an EU AV item is
 * the provider asserting ITS copyright under the licence it publishes, not a
 * third party; the same claim naming anyone else is.
 */
const OWN_NAME: Partial<Record<string, RegExp>> = {
  eu_av: /\beuropean\s+(?:union|commission|parliament|council)\b|\beu\b/i,
  nasa: /\bnasa\b|\bjpl\b/i,
  dvids:
    /\bdvids\b|\bdepartment\s+of\s+defen[cs]e\b|\bdod\b|\bu\.?\s?s\.?\s+(?:army|navy|air\s+force|marines?|marine\s+corps|coast\s+guard|space\s+force|national\s+guard)\b/i,
};

/** Is somebody other than the provider named as the owner? */
function namesThirdParty(a: NormalizedFootageAsset, text: string): boolean {
  if (THIRD_PARTY.test(text)) return true;
  if (!COPYRIGHT.test(text)) return false;
  const own = OWN_NAME[a.provider];
  return !(own && own.test(text));
}

/** The obligation text, composed the way the render prints it. */
export function attributionLine(a: NormalizedFootageAsset): string | undefined {
  const who = String(a.creator ?? a.credit ?? "").trim().replace(/^Template:\s*/i, "");
  const parts = [who, providerLabel(a.provider), String(a.licenseOriginal ?? "").trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * Classify. Pure — reads the stored verdict and the text, touches nothing.
 *
 * The order matters. A licence that forbids is refused before anything else
 * is read; an editorial-only statement overrides an otherwise-free licence,
 * because the provider's own words are the stricter of the two; a third-party
 * credit on an otherwise-public asset means the provider is only hosting it,
 * which is the exact case DVIDS and NASA warn about.
 */
export function validateRights(a: NormalizedFootageAsset): RightsResult {
  const text = String(a.rightsText ?? "").trim();
  const licence = a.licenseOriginal ?? a.licenseCode ?? undefined;
  const base = {
    ...(licence ? { license: licence } : {}),
    ...(text ? { originalRightsText: text } : {}),
  };

  if (a.reviewStatus === "rejected") {
    return { status: "restricted", ...base, reason: a.reviewReason ?? "The licence forbids this use." };
  }

  const stated = `${text} ${a.licenseOriginal ?? ""}`;
  if (EDITORIAL.test(stated)) {
    return {
      status: "editorial_only",
      ...base,
      attribution: attributionLine(a),
      reason: "The provider allows editorial use only — confirm the film qualifies before rendering.",
    };
  }

  // A hosting provider crediting somebody else: DVIDS and NASA both carry
  // third-party material under their own banner, and their own guidance is
  // that the credit line decides. Only checked on an otherwise-free asset;
  // a Commons row already carries a licence the uploader chose.
  if (a.provider !== "wikimedia" && namesThirdParty(a, `${a.credit ?? ""} ${text} ${a.description ?? ""}`)) {
    return {
      status: "manual_review",
      ...base,
      attribution: attributionLine(a),
      reason: "The credit or rights text names a third party — the provider may only be hosting this.",
    };
  }

  if (a.reviewStatus === "manual_review") {
    return {
      status: a.rightsStatus === "unknown" && !text && !licence ? "unknown" : "manual_review",
      ...base,
      attribution: attributionLine(a),
      reason: a.reviewReason ?? "The licence could not be classified automatically.",
    };
  }

  if (a.attributionRequired) {
    return { status: "attribution_required", ...base, attribution: attributionLine(a) };
  }
  return { status: "cleared", ...base };
}

/** Whether the engine may hand this to a render with nobody looking. */
export const usableAutomatically = (r: RightsResult): boolean =>
  r.status === "cleared" || r.status === "attribution_required";

/** Whether a person may choose to use it at all. */
export const usableWithReview = (r: RightsResult): boolean => r.status !== "restricted";

/**
 * What the film may do with an asset given both the verdict and the human
 * decision stored on the row. `approved` and `used` are the two states a
 * person has already reached through; without one, review classes stay shut.
 */
export function renderable(r: RightsResult, libraryStatus: string | null | undefined): boolean {
  if (r.status === "restricted") return false;
  if (usableAutomatically(r)) return true;
  return libraryStatus === "approved" || libraryStatus === "used";
}

/** Short, for chips and filters. */
export const USAGE_LABELS: Record<UsageClass, string> = {
  cleared: "Cleared",
  attribution_required: "Credit required",
  editorial_only: "Editorial only",
  manual_review: "Manual review",
  restricted: "Restricted",
  unknown: "Rights unknown",
};

export const FootageRightsValidator = { validate: validateRights, usableAutomatically, usableWithReview, renderable };
