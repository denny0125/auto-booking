import { describe, expect, it } from "vitest";

import { normalizeOcrOutput } from "../../src/captcha/tesseractCli.ts";

describe("normalizeOcrOutput", () => {
	it("removes whitespace and line breaks from OCR output", () => {
		expect(normalizeOcrOutput(" D42 2D8 \n")).toBe("D422D8");
	});
});