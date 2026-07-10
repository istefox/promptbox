import { describe, expect, it } from "vitest";
import { fold, tokenizeWords } from "../src/domain/text";

describe("fold", () => {
	it("strips diacritics and lower-cases", () => {
		expect(fold("Café")).toBe("cafe");
		expect(fold("PÈRCHÉ")).toBe("perche");
	});

	it("leaves plain ascii untouched", () => {
		expect(fold("prompt box")).toBe("prompt box");
	});

	it("returns an empty string for empty input", () => {
		expect(fold("")).toBe("");
	});

	it("preserves separators and punctuation", () => {
		expect(fold("A_b-C++")).toBe("a_b-c++");
	});

	it("folds precomposed and decomposed forms to the same result", () => {
		const precomposed = String.fromCharCode(0xe9);
		const decomposed = "e" + String.fromCharCode(0x301);
		expect(precomposed).not.toBe(decomposed);
		expect(fold(precomposed)).toBe("e");
		expect(fold(decomposed)).toBe("e");
	});
});

describe("tokenizeWords", () => {
	it("splits on runs of non-alphanumerics", () => {
		expect(tokenizeWords("a  b---c")).toEqual(["a", "b", "c"]);
	});

	it("drops leading and trailing separators", () => {
		expect(tokenizeWords("--a-b--")).toEqual(["a", "b"]);
	});

	it("folds diacritics before splitting", () => {
		expect(tokenizeWords("Città Vecchia")).toEqual(["citta", "vecchia"]);
	});

	it("returns an empty array for empty input", () => {
		expect(tokenizeWords("")).toEqual([]);
	});

	it("returns an empty array when nothing survives the fold", () => {
		expect(tokenizeWords("日本語")).toEqual([]);
		expect(tokenizeWords("--")).toEqual([]);
	});

	it("keeps digits as token characters", () => {
		expect(tokenizeWords("gpt4 v1.1")).toEqual(["gpt4", "v1", "1"]);
	});
});
