/**
 * What a licence permits — decided by CODE, from an allowlist.
 *
 * Every archive hands its licence back as text ("CC BY-SA 4.0", "Public
 * domain", "FAL") and sometimes a machine code ("cc-by-sa-4.0", "pd"). This is
 * the one place either is read. A film is a DERIVATIVE made for a channel
 * that earns money, so two questions decide everything: may the asset be used
 * commercially, and may it be modified. NC forbids the first, ND the second,
 * and both are REJECTED outright — no human review can change what the
 * licence says, so offering one would only invite the wrong answer.
 *
 * The auto-approval allowlist is configurable (`ARCHIVE_AUTO_LICENSES`, a
 * comma list of rights classes) and defaults to the four the brief named:
 * public domain, CC0, CC BY, CC BY-SA. Share-alike is admitted because the
 * obligation it carries — credit, and licensing the film's reuse of the clip
 * alike — is one the producer can actually meet; but it is stated on the
 * asset (`modifications: share_alike`) rather than hidden, and the picker
 * shows it. Everything else that is free but unproven (FAL, GFDL, "free" with
 * no code at all) goes to manual review, and so does anything unrecognised —
 * an unknown licence is never a yes.
 */

import type { ReviewStatus, RightsStatus, UseStatus } from "./types";

export interface RightsVerdict {
  rightsStatus: RightsStatus;
  commercialUse: UseStatus;
  modifications: UseStatus;
  attributionRequired: boolean;
  reviewStatus: ReviewStatus;
  reviewReason: string | null;
}

const DEFAULT_AUTO: readonly RightsStatus[] = ["public_domain", "cc0", "cc_by", "cc_by_sa"];

/** The allowlist, read once per call so a redeploy with a new env takes effect. */
export function autoApprovedClasses(): Set<RightsStatus> {
  const raw = process.env.ARCHIVE_AUTO_LICENSES;
  if (!raw) return new Set(DEFAULT_AUTO);
  const known = new Set<string>([
    "public_domain",
    "cc0",
    "cc_by",
    "cc_by_sa",
    "other_free",
  ]);
  const picked = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => known.has(s)) as RightsStatus[];
  // An env var that names nothing recognisable must not open the gate wide
  // or shut it — fall back to the default rather than to "none" or "all".
  return new Set(picked.length ? picked : DEFAULT_AUTO);
}

/**
 * Classify one licence.
 *
 * `code` is the provider's machine string, `text` its human one; either may
 * be missing. `attributionHint` is the provider's own answer to "must this be
 * credited" when it gives one (Commons does, as the string "true"/"false") —
 * it wins over the class default, because a public-domain template on Commons
 * can still ask for credit and the template knows.
 */
export function classifyLicense(
  code: string | null | undefined,
  text: string | null | undefined,
  attributionHint?: boolean | null,
): RightsVerdict {
  const s = `${code ?? ""} ${text ?? ""}`.toLowerCase().trim();
  const cls = rightsClassOf(s);

  // NC / ND: the licence itself says no. Not reviewable.
  if (cls === "nc") {
    return verdict("restricted", "forbidden", "unknown", true, "rejected",
      "Non-commercial licence — the film is commercial.");
  }
  if (cls === "nd") {
    return verdict("restricted", "allowed", "forbidden", true, "rejected",
      "No-derivatives licence — a film that cuts and retimes the asset is a derivative.");
  }

  const auto = autoApprovedClasses();
  const status: RightsStatus =
    cls === "pd" ? "public_domain"
    : cls === "cc0" ? "cc0"
    : cls === "by" ? "cc_by"
    : cls === "by_sa" ? "cc_by_sa"
    : cls === "fal" || cls === "gfdl" ? "other_free"
    : "unknown";

  const commercial: UseStatus =
    status === "unknown" ? "unknown"
    : status === "other_free" ? "share_alike"
    : "allowed";
  const modifications: UseStatus =
    status === "unknown" ? "unknown"
    : status === "cc_by_sa" || status === "other_free" ? "share_alike"
    : "allowed";
  const attribution =
    typeof attributionHint === "boolean"
      ? attributionHint
      : !(status === "public_domain" || status === "cc0");

  if (status === "unknown") {
    return verdict(status, commercial, modifications, attribution, "manual_review",
      s ? `Licence not recognised: "${(text ?? code ?? "").trim()}".` : "No licence stated.");
  }
  if (!auto.has(status)) {
    return verdict(status, commercial, modifications, attribution, "manual_review",
      status === "other_free"
        ? `Copyleft licence (${(text ?? code ?? "").trim()}) — check the share-alike terms before use.`
        : `${(text ?? code ?? "").trim()} is outside the auto-approval allowlist.`);
  }
  return verdict(status, commercial, modifications, attribution, "auto_approved", null);
}

type RightsClass = "pd" | "cc0" | "by" | "by_sa" | "nc" | "nd" | "fal" | "gfdl" | "unknown";

/**
 * A licence given as its creativecommons.org URL — how a web page's
 * `rel="license"` link or JSON-LD `license` states it — carries the class in
 * the path (`/licenses/by-nc-sa/4.0/`, `/publicdomain/zero/1.0/`), where the
 * word tests below cannot see it. Spell the path out as the code it names;
 * the NC/ND ordering then applies exactly as for a typed code.
 */
function expandLicenseUrls(s: string): string {
  return s
    .replace(/creativecommons\.org\/publicdomain\/zero\/[^\s]*/g, " cc0 ")
    .replace(/creativecommons\.org\/publicdomain\/mark\/[^\s]*/g, " public domain ")
    // The retired CC "Public Domain Dedication and Certification" URL, still
    // the licence string on thousands of Internet Archive items.
    .replace(/creativecommons\.org\/licenses\/publicdomain\/?[^\s]*/g, " public domain ")
    .replace(/creativecommons\.org\/licenses\/([a-z-]+)\/[^\s]*/g, (_, code: string) => ` cc-${code} `);
}

/**
 * Whole-word, order-sensitive matching. The NC/ND tests come FIRST because
 * "cc-by-nc-sa-4.0" also contains "cc-by" and "sa", and a licence that forbids
 * commercial use must never be read as the one that merely wants credit.
 */
function rightsClassOf(raw: string): RightsClass {
  const s = expandLicenseUrls(raw);
  if (!s) return "unknown";
  if (/\bnc\b|non-?commercial/.test(s)) return "nc";
  if (/\bnd\b|no-?deriv/.test(s)) return "nd";
  if (/\bcc0\b|cc-zero|creative commons zero|\bzero\b/.test(s)) return "cc0";
  if (/\bpd\b|\bpd-|public domain|no known copyright restrictions/.test(s)) return "pd";
  if (/cc[- ]by[- ]sa\b|attribution[- ]share ?alike/.test(s)) return "by_sa";
  if (/cc[- ]by\b|\battribution\b/.test(s)) return "by";
  if (/\bfal\b|free art licen[cs]e|licence art libre/.test(s)) return "fal";
  if (/\bgfdl\b|gnu free documentation/.test(s)) return "gfdl";
  return "unknown";
}

function verdict(
  rightsStatus: RightsStatus,
  commercialUse: UseStatus,
  modifications: UseStatus,
  attributionRequired: boolean,
  reviewStatus: ReviewStatus,
  reviewReason: string | null,
): RightsVerdict {
  return { rightsStatus, commercialUse, modifications, attributionRequired, reviewStatus, reviewReason };
}
