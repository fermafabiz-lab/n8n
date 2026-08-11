/**
 * Languages a voice can be picked for, and how to recognise one.
 *
 * Three vocabularies have to meet here and none of them is ours:
 *
 * - The /new form's Language field is free text with a datalist of ENDONYMS
 *   ("Română", "Deutsch"), and the producer also writes Romanian names.
 * - ai33 relays each provider's own labels, so a voice's `language` may read
 *   "Romanian", "ro", "ro-RO" or "Romanian (Romania)", and the useful half is
 *   sometimes in `accent` instead.
 * - ElevenLabs itself thinks in ISO codes — `ro`, `it`, `en` — which is what
 *   the picker now selects by.
 *
 * So everything is keyed on the ISO code, and each entry carries every
 * spelling either side might use.
 */

/** Diacritics stripped and lowercased: "Română" and "romana" become one key. */
export function normLang(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export interface Language {
  /** ISO code as ElevenLabs uses it — the value the picker selects. */
  code: string;
  /** English name, also what ai33's own search is asked for. */
  name: string;
  /** The language's own name, shown next to it in the list. */
  endonym: string;
  /** Extra spellings: Romanian names, locales, common provider labels. */
  extra?: string[];
}

/**
 * The languages ElevenLabs' multilingual models speak (v2 / turbo v2.5).
 *
 * This is the MODEL's coverage, not a promise that the library holds a
 * natively-labelled voice for each: a multilingual voice reads any of these,
 * and what changes between them is the accent. The picker says as much when a
 * language turns up no natively-labelled voice.
 */
export const LANGUAGES: Language[] = [
  { code: "en", name: "English", endonym: "English", extra: ["engleza", "american", "british", "australian", "en-us", "en-gb", "en-au", "en-ca", "en-in"] },
  { code: "ro", name: "Romanian", endonym: "Română", extra: ["romana", "romaneste", "roumain", "ro-ro"] },
  { code: "es", name: "Spanish", endonym: "Español", extra: ["spaniola", "castellano", "espagnol", "es-es", "es-mx", "es-us", "es-ar", "latin american"] },
  { code: "fr", name: "French", endonym: "Français", extra: ["franceza", "francais", "fr-fr", "fr-ca"] },
  { code: "de", name: "German", endonym: "Deutsch", extra: ["germana", "allemand", "de-de", "de-at"] },
  { code: "it", name: "Italian", endonym: "Italiano", extra: ["italiana", "italien", "it-it"] },
  { code: "pt", name: "Portuguese", endonym: "Português", extra: ["portugheza", "portugues", "brazilian", "pt-br", "pt-pt"] },
  { code: "pl", name: "Polish", endonym: "Polski", extra: ["poloneza", "polonais", "pl-pl"] },
  { code: "nl", name: "Dutch", endonym: "Nederlands", extra: ["olandeza", "flemish", "neerlandais", "nl-nl", "nl-be"] },
  { code: "ru", name: "Russian", endonym: "Русский", extra: ["rusa", "russe", "ru-ru"] },
  { code: "uk", name: "Ukrainian", endonym: "Українська", extra: ["ucraineana", "uk-ua"] },
  { code: "hu", name: "Hungarian", endonym: "Magyar", extra: ["maghiara", "hu-hu"] },
  { code: "cs", name: "Czech", endonym: "Čeština", extra: ["ceha", "tcheque", "cs-cz"] },
  { code: "sk", name: "Slovak", endonym: "Slovenčina", extra: ["slovaca", "sk-sk"] },
  { code: "bg", name: "Bulgarian", endonym: "Български", extra: ["bulgara", "bg-bg"] },
  { code: "hr", name: "Croatian", endonym: "Hrvatski", extra: ["croata", "hr-hr"] },
  { code: "el", name: "Greek", endonym: "Ελληνικά", extra: ["greaca", "grec", "el-gr"] },
  { code: "tr", name: "Turkish", endonym: "Türkçe", extra: ["turca", "turkce", "tr-tr"] },
  { code: "sv", name: "Swedish", endonym: "Svenska", extra: ["suedeza", "suedois", "sv-se"] },
  { code: "da", name: "Danish", endonym: "Dansk", extra: ["daneza", "danois", "da-dk"] },
  { code: "no", name: "Norwegian", endonym: "Norsk", extra: ["norvegiana", "norvegien", "nb", "nb-no", "nn"] },
  { code: "fi", name: "Finnish", endonym: "Suomi", extra: ["finlandeza", "finnois", "fi-fi"] },
  { code: "ar", name: "Arabic", endonym: "العربية", extra: ["araba", "arabe", "ar-sa", "ar-eg"] },
  { code: "hi", name: "Hindi", endonym: "हिन्दी", extra: ["hi-in"] },
  { code: "ta", name: "Tamil", endonym: "தமிழ்", extra: ["ta-in"] },
  { code: "ja", name: "Japanese", endonym: "日本語", extra: ["japoneza", "nihongo", "ja-jp"] },
  { code: "ko", name: "Korean", endonym: "한국어", extra: ["coreeana", "ko-kr"] },
  { code: "zh", name: "Chinese", endonym: "中文", extra: ["chineza", "mandarin", "cmn", "zh-cn", "zh-tw"] },
  { code: "vi", name: "Vietnamese", endonym: "Tiếng Việt", extra: ["vietnameza", "vi-vn"] },
  { code: "id", name: "Indonesian", endonym: "Bahasa Indonesia", extra: ["indoneziana", "id-id"] },
  { code: "ms", name: "Malay", endonym: "Bahasa Melayu", extra: ["malaeziana", "ms-my"] },
  { code: "fil", name: "Filipino", endonym: "Filipino", extra: ["tagalog", "fil-ph", "tl"] },
];

/** Every normalised spelling that counts as this language. */
function aliasesOf(l: Language): string[] {
  return [l.code, normLang(l.name), normLang(l.endonym), ...(l.extra ?? []).map(normLang)];
}

export function languageByCode(code: string): Language | null {
  const c = normLang(code);
  return LANGUAGES.find((l) => l.code === c) ?? null;
}

/**
 * Turn whatever the producer typed into a language, if we can name it.
 *
 * Used to preselect the picker from the /new form's free-text Language field
 * and from a project's stored Language. Returns null when nothing matches —
 * the caller then simply shows every voice, which is the honest default for a
 * language we cannot map to a code.
 */
export function resolveLanguage(input: string): Language | null {
  const n = normLang(input);
  if (!n) return null;
  for (const l of LANGUAGES) {
    if (aliasesOf(l).includes(n)) return l;
  }
  return null;
}

/**
 * Does this voice's own metadata say it speaks the language?
 *
 * Both labels are consulted, because providers disagree about which one
 * carries the answer: some put "Romanian" in `language`, others leave that
 * generic and put the useful word in `accent`. A locale is tried without its
 * region so "ro-RO" matches on "ro".
 *
 * Matching is on WHOLE WORDS. A substring test made "ro" match *Roger* and
 * "Rock ballad voice" — the exact failure this whole feature exists to fix.
 */
export function voiceMatchesLanguage(
  voice: { language?: string | null; accent?: string | null },
  lang: Language,
): boolean {
  const want = new Set(aliasesOf(lang));
  for (const raw of [voice.language, voice.accent]) {
    if (!raw) continue;
    const n = normLang(String(raw));
    if (!n) continue;
    if (want.has(n)) return true;
    for (const part of n.split(/[-_,(/]/)) {
      const p = part.trim();
      if (p && want.has(p)) return true;
    }
    const words = n.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.some((w) => want.has(w))) return true;
  }
  return false;
}

/**
 * Does the voice mention the language anywhere a human would read?
 *
 * Weaker than the metadata test and used only to keep voices that ai33's OWN
 * search returned for this language — a name or description saying "Romanian"
 * is real evidence, and throwing those away is precisely why a filtered
 * search once showed two voices where the library held many.
 */
export function voiceMentionsLanguage(
  voice: { name?: unknown; description?: string | null },
  lang: Language,
): boolean {
  const hay = normLang(`${String(voice.name ?? "")} ${voice.description ?? ""}`);
  if (!hay) return false;
  const words = new Set(hay.split(/[^a-z0-9]+/).filter(Boolean));
  // Never the bare code here: two letters inside prose match everything.
  return (
    words.has(normLang(lang.name)) ||
    words.has(normLang(lang.endonym)) ||
    (lang.extra ?? []).some((e) => {
      const n = normLang(e);
      return n.length > 3 && words.has(n);
    })
  );
}
