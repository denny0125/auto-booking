import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { preprocessCaptchaImage } from "../../src/captcha/ocrPreprocessor.ts";

describe("preprocessCaptchaImage", () => {
	it("creates a processed png file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "autobooking-ocr-"));
		const inputPath = join(dir, "captcha.png");
		const outputPath = join(dir, "captcha.processed.png");

		const imageBuffer = await sharp({
			create: {
				width: 24,
				height: 12,
				channels: 3,
				background: { r: 255, g: 255, b: 255 },
			},
		})
			.png()
			.toBuffer();

		await writeFile(inputPath, imageBuffer);

		const resultPath = await preprocessCaptchaImage(inputPath, { outputPath });
		const metadata = await sharp(resultPath).metadata();

		expect(resultPath).toBe(outputPath);
		expect(metadata.format).toBe("png");
		expect((metadata.width ?? 0) > 24).toBe(true);
	});
});