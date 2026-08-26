import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { captureCaptchaCheckpoint } from "../../src/captcha/manualCaptchaGate.ts";

describe("captureCaptchaCheckpoint", () => {
	it("writes a checkpoint artifact even when tesseract is unavailable", async () => {
		const dir = await mkdtemp(join(tmpdir(), "autobooking-captcha-"));
		const outputPath = join(dir, "captcha.png");
		const page = createFakePage();

		const checkpoint = await captureCaptchaCheckpoint(page, {
			outputPath,
			tesseractExecutablePath: join(dir, "missing-tesseract.exe"),
		});

		const artifact = JSON.parse(await readFile(checkpoint.artifactPath, "utf8"));

		expect(checkpoint.imagePath).toBe(outputPath);
		expect(checkpoint.artifactPath.endsWith(".json")).toBe(true);
		expect(artifact.imagePath).toBe(outputPath);
		expect(typeof artifact.ocrError).toBe("string");
	});
});

function createFakePage() {
	const fakeImage = {
		first() {
			return this;
		},
		locator() {
			return this;
		},
		async waitFor() {
			return this;
		},
		async isVisible() {
			return true;
		},
		async screenshot({ path }) {
			const sharp = (await import("sharp")).default;
			await sharp({
				create: {
					width: 24,
					height: 12,
					channels: 3,
					background: { r: 255, g: 255, b: 255 },
				},
			})
				.png()
				.toFile(path);
		},
	};

	const fakeButton = {
		first() {
			return this;
		},
		async isVisible() {
			return true;
		},
	};

	return {
		locator() {
			return fakeImage;
		},
		getByAltText() {
			return fakeImage;
		},
		getByRole() {
			return fakeButton;
		},
	};
}