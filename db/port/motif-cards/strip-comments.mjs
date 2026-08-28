/**
 * Strip comments from JS, for the copy that goes INSIDE an n8n Code node.
 *
 * The validator's comments are two thirds of its bytes, and they are the good
 * kind — they say why a rule exists. They belong in the file, which is the one
 * home and the thing anyone edits. What goes into the node is a build artifact:
 * it should carry a header pointing back at the source and nothing else, the
 * same bargain any generated file makes.
 *
 * Written as a scanner rather than a regex because a regex cannot tell a
 * comment from a slash inside a string, a template literal or a regex literal —
 * and this very file's `norm()` contains `/[^a-z0-9\s]/g`, which a naive
 * `//.*$` would happily eat half of. The result is verified by running the same
 * fixtures through both copies, so a scanner bug cannot ship silently.
 */
export function stripComments(src) {
	let out = '';
	let i = 0;
	// What can precede a REGEX literal rather than a division sign. After a
	// value (identifier, number, `)`, `]`) a slash is division; after an
	// operator, `(`, `,`, `=`, `:`, `[`, `!`, `&`, `|`, `?`, `{`, `}`, `;` or a
	// keyword, it opens a regex.
	const regexAllowedAfter = /[([{;,:=!&|?+\-*%~^<>]\s*$|\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)\s*$/;
	while (i < src.length) {
		const c = src[i];
		const next = src[i + 1];

		if (c === '/' && next === '/') {
			while (i < src.length && src[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && next === '*') {
			i += 2;
			while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
			i += 2;
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			const quote = c;
			out += c;
			i++;
			while (i < src.length) {
				if (src[i] === '\\') {
					out += src[i] + (src[i + 1] ?? '');
					i += 2;
					continue;
				}
				out += src[i];
				if (src[i] === quote) {
					i++;
					break;
				}
				i++;
			}
			continue;
		}
		if (c === '/' && regexAllowedAfter.test(out)) {
			out += c;
			i++;
			let inClass = false;
			while (i < src.length) {
				if (src[i] === '\\') {
					out += src[i] + (src[i + 1] ?? '');
					i += 2;
					continue;
				}
				if (src[i] === '[') inClass = true;
				else if (src[i] === ']') inClass = false;
				out += src[i];
				if (src[i] === '/' && !inClass) {
					i++;
					break;
				}
				i++;
			}
			continue;
		}
		out += c;
		i++;
	}
	// Collapse the blank lines the comments left behind.
	return out
		.split('\n')
		.map((l) => l.replace(/\s+$/, ''))
		.filter((l, idx, all) => l.trim() !== '' || (all[idx - 1] ?? '').trim() !== '')
		.join('\n')
		.trim();
}
