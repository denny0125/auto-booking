import { basename, resolve } from "node:path";

import { config as loadDotEnv } from "dotenv";

import { parseRuntimeConfig } from "../config/runtimeConfig.js";
import { createLogger } from "../core/logger.js";
import { preprocessCaptchaImage } from "../captcha/ocrPreprocessor.js";
import { runTesseractCli } from "../captcha/tesseractCli.js";

loadDotEnv();

async function main(): Promise<void> {
	const imagePath = process.argv[2];

	if (!imagePath) {
		throw new Error("Usage: npm run ocr:probe -- <captcha-image-path>");
	}

	const config = parseRuntimeConfig(process.env);
	const logger = createLogger({ service: "autobooking-ocr-probe" });
	const absoluteImagePath = resolve(imagePath);
	const processedPath = await preprocessCaptchaImage(absoluteImagePath);
	const result = await runTesseractCli(processedPath, {
		executablePath: config.tesseract.executablePath,
		language: config.tesseract.language,
		pageSegmentationMode: config.tesseract.pageSegmentationMode,
		ocrEngineMode: config.tesseract.ocrEngineMode,
	});

	logger.info("OCR probe completed", {
		image: basename(absoluteImagePath),
		processedPath,
		ocrText: result.text,
		command: result.command,
	});
}

void main();