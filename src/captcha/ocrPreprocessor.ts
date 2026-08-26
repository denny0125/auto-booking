import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import sharp from "sharp";

export type PreprocessCaptchaOptions = {
	grayscale?: boolean;
	threshold?: number;
	resizeMultiplier?: number;
	outputPath?: string;
};

export async function preprocessCaptchaImage(
	inputPath: string,
	options: PreprocessCaptchaOptions = {},
): Promise<string> {
	const outputPath = resolve(options.outputPath ?? buildDerivedPath(inputPath));
	const resizeMultiplier = options.resizeMultiplier ?? 3;
	const threshold = options.threshold ?? 150;

	await mkdir(dirname(outputPath), { recursive: true });

	const image = sharp(inputPath);
	const metadata = await image.metadata();
	const width = Math.max(1, Math.round((metadata.width ?? 1) * resizeMultiplier));
	const height = Math.max(1, Math.round((metadata.height ?? 1) * resizeMultiplier));

	let pipeline = image.resize({ width, height, kernel: sharp.kernel.nearest });

	if (options.grayscale ?? true) {
		pipeline = pipeline.grayscale();
	}

	pipeline = pipeline.normalize().sharpen().threshold(threshold);

	await pipeline.png().toFile(outputPath);
	return outputPath;
}

function buildDerivedPath(inputPath: string): string {
	return inputPath.replace(/(\.[^.]+)?$/, ".processed.png");
}