/**
 * Matching a project's language against a TTS voice's own labels.
 *
 * Two vocabularies have to meet here and neither is under our control:
 *
 * - The form's Language field is a free-text input with a datalist, and the
 *   datalist offers ENDONYMS — "Română", "Deutsch", "Español". A producer can
 *   also type "romana", "Romanian", "ro" or anything else.
 * - ai33 relays each provider's own labels, so a voice's `language` may read
 *   "Romanian", "ro", "ro-RO" or "Romanian (Romania)", and its `accent` may
 *   carry the useful half instead ("romanian", "american", "british").
 *
 * So both sides are normalised (diacritics stripped, lowercased) and looked up
 * in one alias table. A language the table doesn't know still filters — it
 * falls back to comparing the normalised strings directly — which matters
 * because the datalist is a suggestion, not a closed list.
 */

/** Diacritics stripped and lowercased: "Română" and "romana" become one key. */
export function normLang(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * One entry per language we can name in more than one way. `aliases` holds
 * every spelling either side might use: English name, endonym, Romanian name
 * (the producer writes in both languages), ISO code, and common locales.
 */
const FAMILIES: Array<{ key: string; label: string; aliases: string[] }> = [
  {
    key: "romanian",
    label: "Romanian",
    aliases: ["romanian", "romana", "romaneste", "roumain", "rumano", "ro", "ro-ro"],
  },
  {
    key: "english",
    label: "English",
    aliases: [
      "english", "engleza", "anglais", "ingles", "en", "en-us", "en-gb", "en-au",
      "en-ca", "en-in", "american", "british", "australian",
    ],
  },
  {
    key: "german",
    label: "German",
    aliases: ["german", "deutsch", "germana", "allemand", "aleman", "de", "de-de", "de-at"],
  },
  {
    key: "spanish",
    label: "Spanish",
    aliases: ["spanish", "espanol", "castellano", "spaniola", "espagnol", "es", "es-es", "es-mx", "es-us", "es-ar"],
  },
  {
    key: "french",
    label: "French",
    aliases: ["french", "francais", "franceza", "frances", "fr", "fr-fr", "fr-ca"],
  },
  {
    key: "italian",
    label: "Italian",
    aliases: ["italian", "italiano", "italiana", "italien", "it", "it-it"],
  },
  {
    key: "portuguese",
    label: "Portuguese",
    aliases: ["portuguese", "portugues", "portugheza", "portugais", "pt", "pt-br", "pt-pt", "brazilian"],
  },
  {
    key: "polish",
    label: "Polish",
    aliases: ["polish", "polski", "poloneza", "polonais", "pl", "pl-pl"],
  },
  {
    key: "dutch",
    label: "Dutch",
    aliases: ["dutch", "nederlands", "olandeza", "neerlandais", "nl", "nl-nl", "nl-be", "flemish"],
  },
  {
    key: "russian",
    label: "Russian",
    aliases: ["russian", "russkiy", "rusa", "russe", "ru", "ru-ru"],
  },
  {
    key: "ukrainian",
    label: "Ukrainian",
    aliases: ["ukrainian", "ukrainska", "ucraineana", "uk", "uk-ua"],
  },
  {
    key: "hungarian",
    label: "Hungarian",
    aliases: ["hungarian", "magyar", "maghiara", "hu", "hu-hu"],
  },
  {
    key: "turkish",
    label: "Turkish",
    aliases: ["turkish", "turkce", "turca", "tr", "tr-tr"],
  },
  {
    key: "arabic",
    label: "Arabic",
    aliases: ["arabic", "arabe", "araba", "ar", "ar-sa", "ar-eg"],
  },
  {
    key: "hindi",
    label: "Hindi",
    aliases: ["hindi", "hi", "hi-in"],
  },
  {
    key: "japanese",
    label: "Japanese",
    aliases: ["japanese", "nihongo", "japoneza", "ja", "ja-jp"],
  },
  {
    key: "korean",
    label: "Korean",
    aliases: ["korean", "hangugeo", "coreeana", "ko", "ko-kr"],
  },
  {
    key: "chinese",
    label: "Chinese",
    aliases: ["chinese", "mandarin", "zhongwen", "chineza", "zh", "zh-cn", "zh-tw", "cmn"],
  },
];

/** What a language input means, as a set of spellings to match against. */
export interface LanguageQuery {
  /** Human label for the UI ("Romanian"), or the producer's own words. */
  label: string;
  /** Every normalised spelling that counts as this language. */
  aliases: string[];
}

/**
 * Turn whatever the producer typed into something matchable.
 *
 * An unknown language is NOT rejected: it becomes a one-alias query, so
 * typing "Swahili" still filters on voices labelled "swahili". Returns null
 * only for an empty input, which means "do not filter".
 */
export function languageQuery(input: string): LanguageQuery | null {
  const n = normLang(input);
  if (!n) return null;
  for (const f of FAMILIES) {
    if (f.aliases.includes(n)) return { label: f.label, aliases: f.aliases };
  }
  // Not in the table — match on the words themselves. Keeping the raw input
  // as its own alias is what lets a language we never listed still work.
  return { label: input.trim(), aliases: [n] };
}

/**
 * Does this voice speak the wanted language?
 *
 * Both of a voice's labels are consulted, because providers disagree about
 * which one carries the answer: some put "Romanian" in `language`, others
 * leave that as "multilingual" and put the useful word in `accent`. A locale
 * is also tried without its region, so "ro-RO" matches on "ro".
 */
export function voiceMatchesLanguage(
  voice: { language?: string | null; accent?: string | null },
  query: LanguageQuery,
): boolean {
  const want = new Set(query.aliases);
  for (const raw of [voice.language, voice.accent]) {
    if (!raw) continue;
    const n = normLang(String(raw));
    if (!n) continue;
    if (want.has(n)) return true;
    // "ro-ro" -> "ro"; "english (us)" -> "english"; "spanish, latin" -> "spanish"
    for (const part of n.split(/[-_,(/]/)) {
      const p = part.trim();
      if (p && want.has(p)) return true;
    }
    // Whole-word containment, so "romanian (romania)" matches "romanian"
    // without "ro" accidentally matching "rock" or "roger".
    const words = n.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.some((w) => want.has(w))) return true;
  }
  return false;
}
