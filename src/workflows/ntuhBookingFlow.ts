import { hostname } from "node:os";

import { chromium } from "playwright";

import type { RuntimeConfig } from "../config/runtimeConfig.js";
import type { Logger } from "../core/logger.js";
import { getPollingScheduleSnapshot } from "../core/pollingScheduler.js";
import type { EmailNotifier } from "../notify/emailNotifier.js";
import {
	captureBookingCaptcha,
	fillBookingForm,
	findDoctorCandidate,
	findDoctorCandidateByCriteria,
	openBookingForm,
	openSchedulePage,
	readBookingResult,
	submitBookingForm,
} from "../adapters/ntuhPageAdapter.js";

export type RunBookingAttemptInput = {
	config: RuntimeConfig;
	logger: Logger;
	emailNotifier: EmailNotifier;
	executionId: string;
	nodeName?: string;
	promptForCaptcha?: (checkpoint: InteractiveCaptchaPrompt) => Promise<string | undefined>;
};

export type InteractiveCaptchaPrompt = {
	attempt: number;
	maxAttempts: number;
	message: string;
	ocrSuggestedText?: string;
	ocrError?: string;
	refreshAvailable: boolean;
	captchaImagePath: string;
	processedImagePath?: string;
	captchaArtifactPath: string;
};

export type BookingAttemptResult =
	| {
		status: "success";
		doctor: string;
		appointmentDate?: string;
		appointmentTime?: string;
		message: string;
	  }
	| {
		status: "doctor-not-found" | "clinic-full";
		message: string;
	  }
	| {
		status: "not-available";
		message: string;
	  }
	| {
		status: "waiting-for-start";
		message: string;
	  }
	| {
		status: "manual-captcha-required";
		message: string;
		captchaImagePath: string;
		captchaArtifactPath: string;
		processedImagePath?: string;
		ocrSuggestedText?: string;
		ocrError?: string;
		refreshAvailable: boolean;
	  }
	| {
		status: "failed";
		message: string;
		shouldRetry: boolean;
	  };

export async function runBookingAttempt(input: RunBookingAttemptInput): Promise<BookingAttemptResult> {
	return runSingleBookingAttempt(input);
}

export async function monitorBookingUntilTerminal(
	input: RunBookingAttemptInput,
): Promise<BookingAttemptResult> {
	for (;;) {
		const startGateResult = waitForBookingStartIfNeeded(input);

		if (startGateResult) {
			if (input.config.runOnce) {
				return startGateResult;
			}

			const delayMs = getRetryDelayMs(input.config, false);
			input.logger.info("booking monitor will wait for configured start time", {
				message: startGateResult.message,
				delayMs,
			});
			await sleep(delayMs);
			continue;
		}

		const result = await runSingleBookingAttempt(input);

		if (
			result.status === "success"
			|| result.status === "manual-captcha-required"
			|| result.status === "doctor-not-found"
			|| result.status === "clinic-full"
		) {
			return result;
		}

		if (input.config.runOnce) {
			return result;
		}

		const delayMs = getRetryDelayMs(input.config, result.status === "failed" ? result.shouldRetry : true);
		input.logger.info("booking monitor will retry", {
			status: result.status,
			message: result.message,
			delayMs,
		});
		await sleep(delayMs);
	}
}

async function runSingleBookingAttempt(input: RunBookingAttemptInput): Promise<BookingAttemptResult> {
	const browser = await chromium.launch({
		headless: input.config.headless,
		executablePath: input.config.browserExecutablePath,
	});

	try {
		const page = await browser.newPage();

		await openSchedulePage(page, input.config.targetScheduleUrl);
		const candidate = await findDoctorCandidateByCriteria(page, {
			doctorName: input.config.targetDoctorName,
			appointmentDate: input.config.targetAppointmentDate,
		});

		if (!candidate) {
			if (input.config.targetAppointmentDate) {
				return {
					status: "not-available",
					message: `Target doctor/date combination is not visible yet: ${input.config.targetDoctorName} on ${input.config.targetAppointmentDate}.`,
				};
			}

			return {
				status: "doctor-not-found",
				message: `Target doctor not found: ${input.config.targetDoctorName}`,
			};
		}

		if (candidate.availability !== "available") {
			if (candidate.availability === "full") {
				return {
					status: "clinic-full",
					message: `Target clinic is full${candidate.appointmentDate ? ` on ${candidate.appointmentDate}` : ""} for ${candidate.doctorName}.`,
				};
			}

			return {
				status: "not-available",
				message: `Target doctor is not currently available for booking (${candidate.availability})${candidate.appointmentDate ? ` on ${candidate.appointmentDate}` : ""}.`,
			};
		}

		await openBookingForm(page, candidate);
		await fillBookingForm(page, {
			patientIdType: input.config.patientIdType,
			patientIdNumber: input.config.patientIdNumber,
			birthYear: input.config.patientBirthYear,
			birthMonth: input.config.patientBirthMonth,
			birthDay: input.config.patientBirthDay,
		});

		if (input.promptForCaptcha) {
			return await runInteractiveCaptchaFlow(page, candidate, input);
		}

		const checkpoint = await captureAndLogCaptchaCheckpoint(page, input);

		return {
			status: "manual-captcha-required",
			message: checkpoint.message,
			captchaImagePath: checkpoint.imagePath,
			captchaArtifactPath: checkpoint.artifactPath,
			processedImagePath: checkpoint.processedImagePath,
			ocrSuggestedText: checkpoint.ocrSuggestedText,
			ocrError: checkpoint.ocrError,
			refreshAvailable: checkpoint.refreshAvailable,
		};
	} finally {
		await browser.close();
	}
}

async function runInteractiveCaptchaFlow(
	page: Awaited<ReturnType<typeof chromium.launch>> extends infer _T ? import("playwright").Page : never,
	candidate: Awaited<ReturnType<typeof findDoctorCandidate>> extends infer _U ? Exclude<_U, null> : never,
	input: RunBookingAttemptInput,
): Promise<BookingAttemptResult> {
	for (let attempt = 1; attempt <= input.config.captchaRetries; attempt += 1) {
		const checkpoint = await captureAndLogCaptchaCheckpoint(page, input);
		const captchaCode = await input.promptForCaptcha?.({
			attempt,
			maxAttempts: input.config.captchaRetries,
			message: checkpoint.message,
			ocrSuggestedText: checkpoint.ocrSuggestedText,
			ocrError: checkpoint.ocrError,
			refreshAvailable: checkpoint.refreshAvailable,
			captchaImagePath: checkpoint.imagePath,
			processedImagePath: checkpoint.processedImagePath,
			captchaArtifactPath: checkpoint.artifactPath,
		});

		if (!captchaCode) {
			return {
				status: "manual-captcha-required",
				message: `${checkpoint.message} Interactive captcha entry cancelled.`,
				captchaImagePath: checkpoint.imagePath,
				captchaArtifactPath: checkpoint.artifactPath,
				processedImagePath: checkpoint.processedImagePath,
				ocrSuggestedText: checkpoint.ocrSuggestedText,
				ocrError: checkpoint.ocrError,
				refreshAvailable: checkpoint.refreshAvailable,
			};
		}

		await submitBookingForm(page, captchaCode);
		const result = await finalizeBookingSubmission(page, candidate, input);

		if (result.status === "failed" && result.shouldRetry && attempt < input.config.captchaRetries) {
			input.logger.warn("interactive captcha retry requested", {
				attempt,
				maxAttempts: input.config.captchaRetries,
				message: result.message,
			});
			continue;
		}

		return result;
	}

	return {
		status: "failed",
		message: `Interactive captcha retries exhausted after ${input.config.captchaRetries} attempts.`,
		shouldRetry: true,
	};
}

async function captureAndLogCaptchaCheckpoint(
	page: import("playwright").Page,
	input: RunBookingAttemptInput,
) {
	let checkpoint;

	try {
		checkpoint = await captureBookingCaptcha(page, input.config);
	} catch (error) {
		input.logger.warn("captcha checkpoint initial attempt failed; waiting for page to settle", {
			error: error instanceof Error ? error.message : String(error),
			url: page.url(),
		});

		await page.waitForLoadState("domcontentloaded").catch(() => undefined);
		await page.waitForLoadState("networkidle").catch(() => undefined);

		try {
			checkpoint = await captureBookingCaptcha(page, input.config);
		} catch (retryError) {
		const diagnostics = await page.evaluate(() => ({
			url: location.href,
			validTextExists: !!document.querySelector("#validText"),
			visibleImages: Array.from(document.querySelectorAll("img")).map((img) => ({
				src: img.getAttribute("src"),
				alt: img.getAttribute("alt"),
				visible: !!(img.offsetWidth || img.offsetHeight || img.getClientRects().length),
				width: img.clientWidth,
				height: img.clientHeight,
			})),
			inputBlockHtml: document.querySelector(".input_block")?.outerHTML ?? null,
		})).catch(() => ({
			url: page.url(),
			validTextExists: false,
			visibleImages: [],
			inputBlockHtml: null,
		}));

		input.logger.error("captcha checkpoint failed", {
			error: retryError instanceof Error ? retryError.message : String(retryError),
			...diagnostics,
		});

		throw retryError;
		}
	}

	input.logger.info("OCR Result", {
		captchaImagePath: checkpoint.imagePath,
		captchaArtifactPath: checkpoint.artifactPath,
		processedImagePath: checkpoint.processedImagePath,
		ocrSuggestedText: checkpoint.ocrSuggestedText,
		ocrError: checkpoint.ocrError,
		refreshAvailable: checkpoint.refreshAvailable,
	});

	return checkpoint;
}

async function finalizeBookingSubmission(
	page: import("playwright").Page,
	candidate: Exclude<Awaited<ReturnType<typeof findDoctorCandidate>>, null>,
	input: RunBookingAttemptInput,
): Promise<BookingAttemptResult> {
	const result = await readBookingResult(page);

	if (result.kind === "success") {
		const successTimestamp = new Date().toISOString();
		try {
			await input.emailNotifier.sendSuccessNotification({
				doctor: candidate.doctorName,
				department: input.config.targetDepartment,
				appointmentDate: candidate.appointmentDate ?? "unknown",
				appointmentTime: candidate.appointmentTime ?? "unknown",
				successTimestamp,
				executionId: input.executionId,
				nodeName: input.nodeName ?? hostname(),
			});
		} catch (error) {
			input.logger.warn("success notification email failed", {
				error: error instanceof Error ? error.message : String(error),
				doctor: candidate.doctorName,
				appointmentDate: candidate.appointmentDate,
				appointmentTime: candidate.appointmentTime,
				successTimestamp,
			});
		}

		input.logger.info("booking completed", {
			doctor: candidate.doctorName,
			appointmentDate: candidate.appointmentDate,
			appointmentTime: candidate.appointmentTime,
			successTimestamp,
		});

		return {
			status: "success",
			doctor: candidate.doctorName,
			appointmentDate: candidate.appointmentDate,
			appointmentTime: candidate.appointmentTime,
			message: result.message,
		};
	}

	return {
		status: "failed",
		message: result.message,
		shouldRetry: result.shouldRetry,
	};
}

function getRetryDelayMs(config: RuntimeConfig, retryableFailure: boolean): number {
	if (retryableFailure) {
		return config.captchaCooldownSeconds * 1000;
	}

	return getPollingScheduleSnapshot(config).effectiveIntervalMs;
}

function sleep(delayMs: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, delayMs);
	});
}

function waitForBookingStartIfNeeded(input: RunBookingAttemptInput): Extract<BookingAttemptResult, { status: "waiting-for-start" }> | null {
	if (!input.config.bookingStartAt) {
		return null;
	}

	const now = new Date();

	if (now >= input.config.bookingStartAt) {
		return null;
	}

	return {
		status: "waiting-for-start",
		message: `Booking attempts are gated until ${input.config.bookingStartAt.toISOString()}. Current time: ${now.toISOString()}.`,
	};
}