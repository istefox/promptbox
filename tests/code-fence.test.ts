import { describe, expect, it } from "vitest";
import { stripWrappingCodeFence } from "../src/domain/code-fence";

describe("stripWrappingCodeFence (issue #39)", () => {
	it("strips a plain backtick fence with no language tag", () => {
		const body = "```\nline1\nline2\n```";
		expect(stripWrappingCodeFence(body)).toBe("line1\nline2");
	});

	it("strips a backtick fence with a language tag", () => {
		const body = "```markdown\nYou are a helpful assistant.\n```";
		expect(stripWrappingCodeFence(body)).toBe("You are a helpful assistant.");
	});

	it("strips a tilde fence", () => {
		const body = "~~~\nline1\nline2\n~~~";
		expect(stripWrappingCodeFence(body)).toBe("line1\nline2");
	});

	it("leaves a body untouched when the fence only wraps part of the content", () => {
		const body = "Some intro.\n```\ncode\n```\nSome outro.";
		expect(stripWrappingCodeFence(body)).toBe(body);
	});

	it("leaves a body with no fence at all untouched", () => {
		const body = "Just a plain prompt with {{name}}.";
		expect(stripWrappingCodeFence(body)).toBe(body);
	});

	it("returns an empty body unchanged", () => {
		expect(stripWrappingCodeFence("")).toBe("");
		expect(stripWrappingCodeFence("   ")).toBe("   ");
	});

	it("preserves an inner fence, stripping only the outer wrapping lines", () => {
		const body = "```\nWrite a code sample:\n```python\nprint('hi')\n```\n```";
		expect(stripWrappingCodeFence(body)).toBe("Write a code sample:\n```python\nprint('hi')\n```");
	});

	it("strips a fence written with CRLF line endings, normalizing the result to LF", () => {
		const body = "```\r\nline1\r\nline2\r\n```";
		expect(stripWrappingCodeFence(body)).toBe("line1\nline2");
	});

	it("strips a fence with trailing whitespace on the fence lines", () => {
		const body = "```markdown   \nline1\nline2\n```  ";
		expect(stripWrappingCodeFence(body)).toBe("line1\nline2");
	});

	it("leaves a body untouched when the fence characters don't match (open backtick, close tilde)", () => {
		const body = "```\nline1\n~~~";
		expect(stripWrappingCodeFence(body)).toBe(body);
	});

	it("leaves a body untouched when the closing fence is shorter than the opening fence", () => {
		const body = "````\nline1\n```";
		expect(stripWrappingCodeFence(body)).toBe(body);
	});

	it("strips when the closing fence is longer than the opening fence", () => {
		const body = "```\nline1\n````";
		expect(stripWrappingCodeFence(body)).toBe("line1");
	});

	it("strips to an empty string when the body is just an opening and closing fence", () => {
		expect(stripWrappingCodeFence("```\n```")).toBe("");
	});
});
