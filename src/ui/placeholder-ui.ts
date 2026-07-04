import type { Editor, EditorRange } from "obsidian";
import { caretRangeAfterInsert, type PaletteEntry } from "../domain/placeholder-palette";

/**
 * Splices `entry` into the editor at `range` and sets the caret per FR-24.7.
 * CodeMirror's `ch` is already a line offset and `insertText` never contains
 * a newline, so the caret math needs zero coordinate conversion.
 */
export function applyEntryToEditor(editor: Editor, range: EditorRange, entry: PaletteEntry): void {
	editor.replaceRange(entry.insertText, range.from, range.to);
	const caret = caretRangeAfterInsert(entry, range.from.ch);
	const line = range.from.line;
	editor.setSelection({ line, ch: caret.start }, { line, ch: caret.end });
}

/**
 * Splices `entry` into a plain `<textarea>` at `range` (flat value offsets)
 * and sets the caret per FR-24.7. Does not dispatch any synthetic event
 * (ADR-0016 reentrancy rationale): callers sync their own state afterward.
 */
export function applyEntryToTextarea(
	textarea: HTMLTextAreaElement,
	range: { start: number; end: number },
	entry: PaletteEntry,
): void {
	const value = textarea.value;
	textarea.value = value.slice(0, range.start) + entry.insertText + value.slice(range.end);
	const caret = caretRangeAfterInsert(entry, range.start);
	textarea.focus();
	textarea.setSelectionRange(caret.start, caret.end);
}

/** Label + a muted kind suffix, shared by every catalog list rendering. */
export function renderPaletteEntry(entry: PaletteEntry, el: HTMLElement): void {
	el.createSpan({ text: entry.label });
	el.createSpan({ text: entry.kind, cls: "promptbox-filters__label" });
}
