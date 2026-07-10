/** Diacritic fold: NFD, strip combining marks, lower-case. Positions are NOT preserved. */
export function fold(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

/** Folded alphanumeric word tokens, empties dropped. */
export function tokenizeWords(text: string): string[] {
	return fold(text)
		.split(/[^a-z0-9]+/)
		.filter((t) => t !== "");
}
