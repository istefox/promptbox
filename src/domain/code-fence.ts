const FENCE_OPEN_RE = /^(`{3,}|~{3,})\S*$/;
const BACKTICK_RUN_RE = /^`{3,}$/;
const TILDE_RUN_RE = /^~{3,}$/;

/**
 * Strips a Markdown fence that wraps the whole trimmed body (issue #39). Any other body is
 * returned unchanged. Line breaks are split on `\r\n` or `\n` so CRLF-authored notes match the
 * same as LF ones, and the fence lines tolerate trailing whitespace; per CommonMark the closing
 * fence run must be at least as long as the opening one.
 */
export function stripWrappingCodeFence(body: string): string {
	const trimmed = body.trim();
	if (trimmed === "") return body;

	const lines = trimmed.split(/\r\n|\n/);
	if (lines.length < 2) return body;

	const first = lines[0]!.trimEnd();
	const last = lines[lines.length - 1]!.trimEnd();
	const openMatch = first.match(FENCE_OPEN_RE);
	if (!openMatch) return body;

	const fenceRun = openMatch[1]!;
	const fenceChar = fenceRun[0];
	const closeRe = fenceChar === "`" ? BACKTICK_RUN_RE : TILDE_RUN_RE;
	if (!closeRe.test(last) || last.length < fenceRun.length) return body;

	return lines.slice(1, -1).join("\n");
}
