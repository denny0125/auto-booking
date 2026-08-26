import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { parseRuntimeConfig } from "./config/runtimeConfig.js";
import { createLogger } from "./core/logger.js";
import { getPollingScheduleSnapshot } from "./core/pollingScheduler.js";
import { createEmailNotifier } from "./notify/emailNotifier.js";
import { monitorBookingUntilTerminal } from "./workflows/ntuhBookingFlow.js";

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
		manualCaptchaCode: config.manualCaptchaCode,
		promptForCaptcha: config.interactiveCaptcha ? promptForCaptchaInTerminal : undefined,
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

	try {
		const answer = await readline.question("Enter captcha code to continue (blank to stop): ");
		const normalized = answer.trim();
		return normalized.length > 0 ? normalized : undefined;
	} finally {
		readline.close();
	}
}

void main();