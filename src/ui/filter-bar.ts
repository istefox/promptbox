import { emptyQuery, type LibraryQuery, type SortKey, isQueryActive } from "../domain/query";
import type { Visibility } from "../domain/prompt";

export interface FilterOptions {
	types: string[];
	categories: string[];
	tags: string[];
}

export interface FilterBarHandle {
	/** Refreshes chip option lists when new values appear in the index. */
	setOptions(options: FilterOptions): void;
	/** Re-syncs control states (e.g. after clear-all). */
	sync(): void;
}

const SORT_LABELS: Record<SortKey, string> = {
	"updated-desc": "Updated (newest)",
	"created-desc": "Created (newest)",
	"title-asc": "Title (A-Z)",
	"quality-desc": "Quality (highest)",
	"recently-used-desc": "Recently used",
};

/**
 * Renders the read-only library controls (FR-2.2, FR-2.4, FR-2.5) into `root`.
 * State lives in the caller's `query` object; every change calls `onChange`
 * so the view keeps a single render path (ADR-0002).
 */
export function renderFilterBar(
	root: HTMLElement,
	query: LibraryQuery,
	options: FilterOptions,
	onChange: () => void,
): FilterBarHandle {
	let current = options;
	root.empty();
	root.addClass("promptbox-filters");

	// Row 1 — search + sort + clear-all
	const row1 = root.createDiv({ cls: "promptbox-filters__row" });
	const search = row1.createEl("input", {
		type: "search",
		placeholder: "Search title, use case, body...",
		cls: "promptbox-filters__search",
	});
	let debounce: number | undefined;
	search.addEventListener("input", () => {
		window.clearTimeout(debounce);
		debounce = window.setTimeout(() => {
			query.text = search.value;
			onChange();
		}, 150);
	});

	const sortSelect = row1.createEl("select", { cls: "dropdown" });
	for (const [value, label] of Object.entries(SORT_LABELS)) {
		sortSelect.createEl("option", { value, text: label });
	}
	sortSelect.addEventListener("change", () => {
		query.sort = sortSelect.value as SortKey;
		onChange();
	});

	const favoritesFirstLabel = row1.createEl("label", { cls: "promptbox-filters__favorites-first" });
	const favoritesFirstCheckbox = favoritesFirstLabel.createEl("input", { type: "checkbox" });
	favoritesFirstLabel.createSpan({ text: "Favorites first" });
	favoritesFirstCheckbox.addEventListener("change", () => {
		query.favoritesFirst = favoritesFirstCheckbox.checked;
		onChange();
	});

	const clearBtn = row1.createEl("button", { text: "Clear filters", cls: "promptbox-filters__clear" });
	clearBtn.addEventListener("click", () => {
		Object.assign(query, emptyQuery());
		onChange();
	});

	// Row 2 — taxonomy chips
	const chipsRow = root.createDiv({ cls: "promptbox-filters__row promptbox-filters__chips-row" });
	const favoritesChip = chipsRow.createEl("button", { text: "★ Favorites", cls: "promptbox-chip" });
	favoritesChip.addEventListener("click", () => {
		query.favoritesOnly = !query.favoritesOnly;
		onChange();
	});
	const typeChips = chipsRow.createDiv({ cls: "promptbox-filters__group" });
	const categoryChips = chipsRow.createDiv({ cls: "promptbox-filters__group" });
	const tagChips = chipsRow.createDiv({ cls: "promptbox-filters__group" });

	// Row 3 — quality, visibility, date range
	const row3 = root.createDiv({ cls: "promptbox-filters__row" });
	const qualitySelect = row3.createEl("select", { cls: "dropdown" });
	qualitySelect.createEl("option", { value: "", text: "Any quality" });
	for (let n = 1; n <= 5; n++) qualitySelect.createEl("option", { value: String(n), text: `Quality ≥ ${n}` });
	qualitySelect.addEventListener("change", () => {
		query.minQuality = qualitySelect.value === "" ? null : Number(qualitySelect.value);
		onChange();
	});

	const visibilitySelect = row3.createEl("select", { cls: "dropdown" });
	visibilitySelect.createEl("option", { value: "", text: "Any visibility" });
	visibilitySelect.createEl("option", { value: "private", text: "Private" });
	visibilitySelect.createEl("option", { value: "public", text: "Public" });
	visibilitySelect.addEventListener("change", () => {
		query.visibility = visibilitySelect.value === "" ? null : (visibilitySelect.value as Visibility);
		onChange();
	});

	row3.createSpan({ text: "Updated", cls: "promptbox-filters__label" });
	const fromInput = row3.createEl("input", { type: "date", cls: "promptbox-filters__date" });
	fromInput.setAttribute("aria-label", "Updated from");
	const toInput = row3.createEl("input", { type: "date", cls: "promptbox-filters__date" });
	toInput.setAttribute("aria-label", "Updated to");
	const onDateChange = () => {
		const from = fromInput.value || null;
		const to = toInput.value || null;
		query.updatedRange = from === null && to === null ? null : { from, to };
		onChange();
	};
	fromInput.addEventListener("change", onDateChange);
	toInput.addEventListener("change", onDateChange);

	function renderChips(container: HTMLElement, label: string, values: string[], selected: string[]): void {
		container.empty();
		if (values.length === 0) return;
		container.createSpan({ text: label, cls: "promptbox-filters__label" });
		for (const value of values) {
			const chip = container.createEl("button", {
				text: value,
				cls: "promptbox-chip" + (selected.includes(value) ? " is-active" : ""),
			});
			chip.addEventListener("click", () => {
				const i = selected.indexOf(value);
				if (i >= 0) selected.splice(i, 1);
				else selected.push(value);
				onChange();
			});
		}
	}

	function sync(): void {
		if (search.value !== query.text) search.value = query.text;
		sortSelect.value = query.sort;
		favoritesFirstCheckbox.checked = query.favoritesFirst;
		qualitySelect.value = query.minQuality === null ? "" : String(query.minQuality);
		visibilitySelect.value = query.visibility ?? "";
		fromInput.value = query.updatedRange?.from ?? "";
		toInput.value = query.updatedRange?.to ?? "";
		clearBtn.toggleClass("is-hidden", !isQueryActive(query));
		favoritesChip.toggleClass("is-active", query.favoritesOnly);
		renderChips(typeChips, "Type", current.types, query.types);
		renderChips(categoryChips, "Category", current.categories, query.categories);
		renderChips(tagChips, "Tags", current.tags, query.tags);
	}

	sync();
	return {
		setOptions(next: FilterOptions) {
			current = next;
			sync();
		},
		sync,
	};
}
