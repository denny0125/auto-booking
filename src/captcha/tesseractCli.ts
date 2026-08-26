import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";

export type TesseractCliOptions = {
	executablePath?: string;
	language?: string;
	pageSegmentationMode?: number;
	ocrEngineMode?: number;
	characterWhitelist?: string;
	timeoutMs?: number;
};

export type TesseractCliResult = {
	text: string;
	command: string;
};

export async function runTesseractCli(
	imagePath: string,
	options: TesseractCliOptions = {},
): Promise<TesseractCliResult> {
	const executable = options.executablePath ?? "tesseract";
	await assertTesseractAvailable(executable);

	const args = [
		imagePath,
		"stdout",
		"-l",
		options.language ?? "eng",
		"--oem",
		String(options.ocrEngineMode ?? 1),
		"--psm",
		String(options.pageSegmentationMode ?? 7),
	];

	if (options.characterWhitelist) {
		args.push("-c", `tessedit_char_whitelist=${options.characterWhitelist}`);
	}

	const text = await spawnAndCollect(executable, args, options.timeoutMs ?? 15_000);

	return {
		text: normalizeOcrOutput(text),
		command: [executable, ...args].join(" "),
	};
}

export function normalizeOcrOutput(raw: string): string {
	return raw.replace(/\s+/g, "").trim();
}

export async function assertTesseractAvailable(executablePath: string): Promise<void> {
	if (isExplicitPath(executablePath)) {
		await access(executablePath, constants.F_OK);
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const child = spawn(executablePath, ["--version"], { stdio: ["ignore", "ignore", "ignore"] });
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`Unable to execute ${executablePath}`));
		});
	});
}

function spawnAndCollect(command: string, args: string[], timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`Tesseract command timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("exit", (code) => {
			clearTimeout(timer);

			if (code === 0) {
				resolve(Buffer.concat(stdout).toString("utf8"));
				return;
			}

			reject(new Error(`Tesseract exited with code ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
		});
	});
}

function isExplicitPath(value: string): boolean {
	return value.includes("/") || value.includes("\\") || /^[A-Za-z]:/.test(value);
}