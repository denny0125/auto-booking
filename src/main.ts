import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { config as loadDotEnv } from "dotenv";

import { parseRuntimeConfig } from "./config/runtimeConfig.js";
import { createLogger } from "./core/logger.js";
import { getPollingScheduleSnapshot } from "./core/pollingScheduler.js";
import { createEmailNotifier } from "./notify/emailNotifier.js";
import { monitorBookingUntilTerminal } from "./workflows/ntuhBookingFlow.js";

loadDotEnv();

async function main(): Promise<void> {
	const executionId = randomUUID();
	const logger = createLogger({ executionId, service: "autobooking" });
	const config = parseRuntimeConfig(process.env);
	const emailNotifier = createEmailNotifier(config, logger);
	const schedule = getPollingScheduleSnapshot(config);

	logger.info("AutoBooking bootstrap ready", {
		targetScheduleUrl: config.targetScheduleUrl,
		doctor: config.targetDoctorName,
		department: config.targetDepartment,
		campus: config.targetCampus,
		patientIdType: config.patientIdType,
		headless: config.headless,
		runOnce: config.runOnce,
		interactiveCaptcha: config.interactiveCaptcha,
		captchaAuto: config.captchaAuto,
		browserExecutablePath: config.browserExecutablePath,
		pollingMode: schedule.mode,
		effectivePollIntervalMs: schedule.effectiveIntervalMs,
		inBoostWindow: schedule.inBoostWindow,
		boostWindows: config.boostWindows.map((window) => window.label),
		smtpHost: config.smtp.host,
		smtpPort: config.smtp.port,
		smtpUser: config.smtp.user,
		smtpFrom: config.smtp.from,
		smtpTo: config.smtp.to,
		ocrThreshold: config.ocrThreshold,
		captchaRetries: config.captchaRetries,
		captchaCooldownSeconds: config.captchaCooldownSeconds,
		nodeName: hostname(),
	});

	const result = await monitorBookingUntilTerminal({
		config,
		emailNotifier,
		logger,
		executionId,
		nodeName: hostname(),
		promptForCaptcha: config.interactiveCaptcha
			? (checkpoint) => promptForCaptchaInTerminal(checkpoint, { captchaAuto: config.captchaAuto })
			: undefined,
	});

	logger.info("AutoBooking attempt finished", result);
}

async function promptForCaptchaInTerminal(checkpoint: {
	attempt: number;
	maxAttempts: number;
	message: string;
	ocrSuggestedText?: string;
	ocrError?: string;
	refreshAvailable: boolean;
	captchaImagePath: string;
	processedImagePath?: string;
	captchaArtifactPath: string;
}, options: {
	captchaAuto: boolean;
}): Promise<string | undefined> {
	console.log(`Captcha attempt ${checkpoint.attempt}/${checkpoint.maxAttempts}`);
	console.log(`OCR Result: ${checkpoint.ocrSuggestedText ?? "(no OCR text)"}`);
	if (checkpoint.ocrError) {
		console.log(`OCR Error: ${checkpoint.ocrError}`);
	}
	console.log(`Captcha image: ${checkpoint.captchaImagePath}`);
	if (checkpoint.processedImagePath) {
		console.log(`Processed image: ${checkpoint.processedImagePath}`);
	}
	console.log(`Captcha artifact: ${checkpoint.captchaArtifactPath}`);
	console.log(`Refresh available: ${checkpoint.refreshAvailable ? "yes" : "no"}`);
	console.log(checkpoint.message);

	const readline = createInterface({ input, output });
	const defaultCaptcha = options.captchaAuto ? checkpoint.ocrSuggestedText?.trim() : undefined;
	/*
    const prompt = defaultCaptcha && defaultCaptcha.length > 0
		? `Enter captcha code to continue (press Enter to accept OCR: ${defaultCaptcha}; blank to stop): `
		: "Enter captcha code to continue (blank to stop): ";
    */
	try {
		//const answer = await readline.question(prompt);
		//const normalized = answer.trim();

		//if (normalized.length === 0 && defaultCaptcha && defaultCaptcha.length > 0) {
        if (defaultCaptcha && defaultCaptcha.length > 0) {
			console.log(`Using OCR suggestion: ${defaultCaptcha}`);
			return defaultCaptcha;
		}
        //return normalized.length > 0 ? normalized : undefined;
		return undefined;
	} finally {
		readline.close();
	}
}
void main();