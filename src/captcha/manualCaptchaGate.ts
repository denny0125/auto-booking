import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Locator, Page } from "playwright";

import { preprocessCaptchaImage } from "./ocrPreprocessor.js";
import { runTesseractCli } from "./tesseractCli.js";

export type CaptchaCheckpoint = {
	imagePath: string;
	processedImagePath?: string;
	artifactPath: string;
	ocrSuggestedText?: string;
	ocrCommand?: string;
	ocrError?: string;
	refreshAvailable: boolean;
	message: string;
};

export type CaptchaCheckpointOptions = {
	outputPath: string;
	tesseractExecutablePath?: string;
	tesseractLanguage?: string;
	tesseractPageSegmentationMode?: number;
	tesseractOcrEngineMode?: number;
};

export async function captureCaptchaCheckpoint(
	page: Page,
	options: CaptchaCheckpointOptions,
): Promise<CaptchaCheckpoint> {
	const captchaImage = await locateCaptchaImage(page);
	const absolutePath = resolve(options.outputPath);
	const artifactPath = absolutePath.replace(/(\.[^.]+)?$/, ".json");

	await mkdir(dirname(absolutePath), { recursive: true });
	await captchaImage.screenshot({ path: absolutePath });

	const refreshAvailable = await page.getByRole("button", { name: /換圖|refresh/i }).first().isVisible().catch(() => false);
	let processedImagePath: string | undefined;
	let ocrSuggestedText: string | undefined;
	let ocrCommand: string | undefined;
	let ocrError: string | undefined;

	try {
		processedImagePath = await preprocessCaptchaImage(absolutePath);

		const ocrResult = await runTesseractCli(processedImagePath, {
			executablePath: options.tesseractExecutablePath,
			language: options.tesseractLanguage,
			pageSegmentationMode: options.tesseractPageSegmentationMode,
			ocrEngineMode: options.tesseractOcrEngineMode,
			characterWhitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
		});

		ocrSuggestedText = ocrResult.text;
		ocrCommand = ocrResult.command;
	} catch (error) {
		ocrError = error instanceof Error ? error.message : String(error);
	}

	const checkpoint: CaptchaCheckpoint = {
		imagePath: absolutePath,
		processedImagePath,
		artifactPath,
		ocrSuggestedText,
		ocrCommand,
		ocrError,
		refreshAvailable,
		message: "Manual captcha input required. Review the saved image and enter the current code in the terminal prompt.",
	};

	await writeFile(artifactPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");

	return checkpoint;
}

async function locateCaptchaImage(page: Page): Promise<Locator> {
	await page.locator("#validText").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);

	const candidates = [
		page.getByAltText(/驗證碼|文數字/i).first(),
		page.locator("img[src*='ValidNumerImage']").first(),
		page.locator("#reBtn").locator("xpath=ancestor::*[contains(@class, 'input_block')][1]//img").first(),
		page.getByRole("img").first(),
		page.locator("img").first(),
	];

	for (const candidate of candidates) {
		if (await candidate.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false)) {
			return candidate;
		}
	}

	throw new Error("Captcha image not found on booking form");
}