import { matchPlaceholders } from "./placeholders";

export interface Wikilink {
	raw: string;
	target: string;
	alias: string | null;
	isEmbed: boolean;
	hasSubReference: boolean;
}

// Innermost [[...]] / ![[...]] with no nested brackets, mirroring PLACEHOLDER_RE's
// style (FR-12.1, FR-12.2): target excludes [ ] | # ^ so nesting behaves exactly
// like {{a{{b}}}} already does, only the innermost well-formed construct matches.
// An optional #heading/^block sub-reference and an optional |alias follow.
const WIKILINK_RE = /(!?)\[\[([^[\]|#^]*)([#^][^[\]|]*)?(?:\|([^[\]]*))?\]\]/g;

function buildWikilink(match: RegExpMatchArray): Wikilink | null {
	const target = (match[2] ?? "").trim();
	if (target === "") return null;
	return {
		raw: match[0],
		target,
		alias: match[4] !== undefined ? match[4] : null,
		isEmbed: match[1] === "!",
		hasSubReference: match[3] !== undefined,
	};
}

/**
 * One entry per occurrence, not deduplicated by target (an accurate total-size
 * warning needs the true insertion count); callers dedupe by `target` themselves.
 * A `#heading`/`^block` sub-reference is never resolved here, resolution is
 * entirely the UI layer's job (FR-12.2, out of scope §5).
 */
export function detectWikilinks(body: string): Wikilink[] {
	const links: Wikilink[] = [];
	for (const match of body.matchAll(WIKILINK_RE)) {
		const link = buildWikilink(match);
		if (link) links.push(link);
	}
	return links;
}

interface Span {
	start: number;
	end: number;
	replacement: string;
}

/**
 * Computes wikilink spans (own internal scan of `body`) and placeholder spans
 * (via `matchPlaceholders`) over the same untouched `body`, merges both by
 * start offset, and does one linear slice-and-join pass. Neither substituted
 * kind is ever re-scanned by the other, in either direction (FR-12.6):
 * inserted link content and placeholder values are spliced in literally.
 * Overlapping spans (nested `[[link]]`/`{{placeholder}}` constructs) resolve
 * by "whichever span starts first wins and consumes the nested one".
 */
export function assembleBody(
	body: string,
	linkContents: Map<string, string>,
	variableValues: Record<string, string>,
): string {
	const spans: Span[] = [];

	for (const match of body.matchAll(WIKILINK_RE)) {
		const link = buildWikilink(match);
		if (!link) continue;
		const start = match.index ?? 0;
		spans.push({
			start,
			end: start + match[0].length,
			replacement: linkContents.get(link.target) ?? match[0],
		});
	}

	for (const pm of matchPlaceholders(body)) {
		const replacement =
			pm.variable && Object.prototype.hasOwnProperty.call(variableValues, pm.variable.name)
				? variableValues[pm.variable.name]!
				: pm.raw;
		spans.push({ start: pm.start, end: pm.end, replacement });
	}

	spans.sort((a, b) => a.start - b.start);

	let result = "";
	let cursor = 0;
	for (const span of spans) {
		if (span.start < cursor) continue; // nested inside an already-consumed outer span
		result += body.slice(cursor, span.start) + span.replacement;
		cursor = span.end;
	}
	result += body.slice(cursor);
	return result;
}
