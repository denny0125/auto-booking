import type { Locator, Page } from "playwright";

import { captureCaptchaCheckpoint, type CaptchaCheckpoint } from "../captcha/manualCaptchaGate.js";
import { classifyBookingResult, type BookingResultClassification } from "../core/resultClassifier.js";
import type { PatientIdType, RuntimeConfig } from "../config/runtimeConfig.js";

export type DoctorAvailability = "available" | "full" | "unavailable" | "closed" | "view-only" | "unknown";

export type DoctorCandidate = {
	doctorName: string;
	department?: string;
	availability: DoctorAvailability;
	appointmentDate?: string;
	appointmentTime?: string;
	rowText: string;
	rowLocator: Locator;
};

export type BookingFormInput = {
	patientIdType: PatientIdType;
	patientIdNumber: string;
	birthYear: number;
	birthMonth: number;
	birthDay: number;
};

export async function openSchedulePage(page: Page, url: string): Promise<void> {
	await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
	await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

export async function findDoctorCandidate(page: Page, doctorName: string): Promise<DoctorCandidate | null> {
	return findDoctorCandidateByCriteria(page, { doctorName });
}

export async function findDoctorCandidateByCriteria(
	page: Page,
	criteria: { doctorName: string; appointmentDate?: string },
): Promise<DoctorCandidate | null> {
	const doctorMatches = getDoctorMatches(page, criteria.doctorName);
	const matchCount = await doctorMatches.count();
	let fallbackCandidate: DoctorCandidate | null = null;

	for (let index = 0; index < matchCount; index += 1) {
		const doctorText = doctorMatches.nth(index);

		if (!(await doctorText.isVisible().catch(() => false))) {
			continue;
		}

		const rowLocator = await resolveDoctorCardLocator(doctorText);
		const rowText = normalizeText((await rowLocator.textContent().catch(() => "")) || (await doctorText.textContent()) || "");
		const contextText = await resolveCandidateContextText(rowLocator, rowText, criteria.doctorName, criteria.appointmentDate);
		const nearbyScheduleText = await resolveNearbyScheduleText(rowLocator);
		const rowHtml = normalizeText((await rowLocator.evaluate((element) => element.outerHTML).catch(() => "")) || "");
		const scheduleText = normalizeText([contextText, nearbyScheduleText, rowText].filter(Boolean).join(" "));
		const candidate: DoctorCandidate = {
			doctorName: criteria.doctorName,
			availability: inferAvailability(rowText, rowHtml),
			appointmentDate: extractDate(scheduleText),
			appointmentTime: extractSession(scheduleText),
			rowText: scheduleText,
			rowLocator,
		};

		if (criteria.appointmentDate && candidate.appointmentDate !== criteria.appointmentDate) {
			continue;
		}

		if (candidate.availability === "available") {
			return candidate;
		}

		fallbackCandidate ??= candidate;
	}

	return fallbackCandidate;
}

function getDoctorMatches(page: Page, doctorName: string): Locator {
	const doctorPattern = new RegExp(escapeForRegex(doctorName), "i");

	if (typeof page.locator === "function") {
		return page.locator("button.doctor-tag, a.doctor-tag, .doctor-tag").filter({ hasText: doctorPattern });
	}

	return page.getByText(doctorPattern);
}

async function resolveDoctorCardLocator(doctorText: Locator): Promise<Locator> {
	const candidates = [
		doctorText.locator("xpath=ancestor::button[contains(@class, 'doctor-tag')][1]").first(),
		doctorText.locator("xpath=ancestor::div[contains(@class, 'col-lg-3')][1]").first(),
		doctorText.locator("xpath=ancestor::*[self::tr or self::li or self::div][1]").first(),
	];

	for (const candidate of candidates) {
		if (await candidate.isVisible().catch(() => false)) {
			return candidate;
		}
	}

	return candidates[candidates.length - 1];
}

async function resolveCandidateContextText(
	rowLocator: Locator,
	fallbackText: string,
	doctorName: string,
	targetDate?: string,
): Promise<string> {
	const contextLocators = [
		rowLocator.locator("xpath=ancestor::div[1]").first(),
		rowLocator.locator("xpath=ancestor::div[2]").first(),
		rowLocator.locator("xpath=ancestor::div[3]").first(),
		rowLocator.locator("xpath=ancestor::section[1]").first(),
	];

	for (const contextLocator of contextLocators) {
		if (!(await contextLocator.isVisible().catch(() => false))) {
			continue;
		}

		const contextText = normalizeText((await contextLocator.textContent().catch(() => "")) || "");

		if (!contextText || !containsCollapsedText(contextText, doctorName)) {
			continue;
		}

		if (contextText.length > 300) {
			continue;
		}

		if (targetDate) {
			if (contextText.includes(targetDate)) {
				return contextText;
			}

			continue;
		}

		if (extractDate(contextText)) {
			return contextText;
		}
	}

	return fallbackText;
}

async function resolveNearbyScheduleText(rowLocator: Locator): Promise<string> {
	const nearbyText = await rowLocator.evaluate((element) => {
		const texts: string[] = [];
		const signalPattern = /\b\d{1,2}\/\d{1,2}\b|Morning|Afternoon|Evening|上午|下午|晚間/i;
		const datePattern = /\b\d{1,2}\/\d{1,2}\b/;
		let current: Element | null = element;

		for (let depth = 0; current && depth < 6; depth += 1) {
			const sibling = current.previousElementSibling;

			if (!sibling) {
				current = current.parentElement;
				continue;
			}

			const text = sibling.textContent?.replace(/\s+/g, " ").trim() ?? "";

			if (!text || text.length > 120 || !signalPattern.test(text)) {
				current = current.parentElement;
				continue;
			}

			texts.unshift(text);

			if (datePattern.test(text)) {
				break;
			}

			current = current.parentElement;
		}

		return texts.join(" ");
	}).catch(() => "");

	return normalizeText(nearbyText);
}

export async function openBookingForm(page: Page, candidate: DoctorCandidate): Promise<void> {
	const clickableCandidates = [
		candidate.rowLocator.getByRole("link", { name: /掛號|appointment|available/i }).first(),
		candidate.rowLocator.getByRole("button", { name: /掛號|appointment|available/i }).first(),
		candidate.rowLocator.locator("a").first(),
		candidate.rowLocator.locator("button").first(),
	];

	for (const locator of clickableCandidates) {
		if (await locator.isVisible().catch(() => false)) {
			await clickIntoBookingForm(page, locator);
			await waitForBookingForm(page);
			return;
		}
	}

	if (await candidate.rowLocator.isVisible().catch(() => false)) {
		await clickIntoBookingForm(page, candidate.rowLocator);
		await waitForBookingForm(page);
		return;
	}

	throw new Error(`Unable to locate clickable booking trigger for ${candidate.doctorName}`);
}

async function clickIntoBookingForm(page: Page, locator: Locator): Promise<void> {
	const previousUrl = page.url();

	await locator.click();
	await page.waitForURL((url) => url.toString() !== previousUrl && /RegForm/i.test(url.toString()), {
		timeout: 10000,
	}).catch(() => undefined);
	await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

export async function fillBookingForm(page: Page, input: BookingFormInput): Promise<void> {
	await selectPatientIdType(page, input.patientIdType);
	await fillFirstVisible(page, [
		"input[placeholder*='身分證']",
		"input[placeholder*='ID Number']",
		"input[placeholder*='證件號碼']",
		"input[name*='ID']",
	], input.patientIdNumber);
	await fillFirstVisible(page, [
		"input[placeholder*='民國年或西元年']",
		"input[placeholder*='69或1980']",
		"input[name*='Year']",
	], String(input.birthYear));
	await fillFirstVisible(page, [
		"input[placeholder*='月份']",
		"input[name*='Month']",
	], String(input.birthMonth));
	await fillFirstVisible(page, [
		"input[placeholder*='日期']",
		"input[name*='Day']",
	], String(input.birthDay));
	await page.keyboard.press("Tab").catch(() => undefined);
	await waitForBookingForm(page);
}

export async function captureBookingCaptcha(
	page: Page,
	config: Pick<RuntimeConfig, "captchaOutputDir" | "tesseract" | "captchaAuto">,
	persistToDisk = !config.captchaAuto,
): Promise<CaptchaCheckpoint> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return captureCaptchaCheckpoint(page, {
		outputPath: `${config.captchaOutputDir}/captcha-${timestamp}.png`,
		tesseractExecutablePath: config.tesseract.executablePath,
		tesseractLanguage: config.tesseract.language,
		tesseractPageSegmentationMode: config.tesseract.pageSegmentationMode,
		tesseractOcrEngineMode: config.tesseract.ocrEngineMode,
	}, persistToDisk);
}

const PATIENT_ID_SELECTORS = [
	"#txtInputID",
	"input[placeholder*='身分證']",
	"input[placeholder*='ID Number']",
	"input[placeholder*='證件號碼']",
	"input[name*='ID']",
	"input[id*='ID']",
	"input[placeholder*='身份證']",
];

const CAPTCHA_INPUT_SELECTORS = [
	"#validText",
	"input[placeholder*='驗證碼']",
	"input[placeholder*='驗證']",
	"input[placeholder*='verification code']",
	"input[placeholder*='captcha']",
	"input[aria-label*='驗證']",
	"input[aria-label*='captcha']",
	"input[name*='Valid']",
	"input[name*='valid']",
	"input[name*='Captcha']",
	"input[name*='captcha']",
	"input[id*='Valid']",
	"input[id*='valid']",
	"input[id*='Captcha']",
	"input[id*='captcha']",
	"input[id*='Code']",
	"input[name*='Code']",
	"input[maxlength='4']",
	"input[maxlength='5']",
	"input[type='text'][inputmode='numeric']",
	"input[type='tel']",
	"input[type='number']",
	"input[role='textbox']",
];

export async function submitBookingForm(page: Page, captchaCode: string): Promise<void> {
	await fillFirstVisible(page, CAPTCHA_INPUT_SELECTORS, captchaCode, 2_000);

	const submitCandidates = [
		page.getByRole("button", { name: /送出|submit/i }).first(),
		page.locator("input[type='submit']").first(),
		page.locator("button[type='submit']").first(),
	];

	for (const locator of submitCandidates) {
		if (await locator.isVisible().catch(() => false)) {
			await locator.click();
			await page.waitForLoadState("networkidle").catch(() => undefined);
			return;
		}
	}

	throw new Error("Submit button not found on booking form");
}

export async function readBookingResult(page: Page): Promise<BookingResultClassification> {
	const bodyLocator = page.locator("body");
	const visibleText = normalizeText(await bodyLocator.evaluate((element) => {
		if (!(element instanceof HTMLElement)) {
			return element?.textContent ?? "";
		}

		return element.innerText || element.textContent || "";
	}).catch(() => ""));
	const fallbackText = normalizeText((await bodyLocator.textContent().catch(() => "")) ?? "");
	const text = visibleText || fallbackText;
	const result = classifyBookingResult(text);

	if (result.kind === "success" && await isBookingFormStillVisible(page)) {
		return {
			kind: "unknown",
			message: text || "Booking form remained visible after submission.",
			shouldRetry: true,
			terminal: false,
		};
	}

	return result;
}

export function inferAvailability(rowText: string, rowHtml = ""): DoctorAvailability {
	if (/doctor-tag\s+avaliable|window\.location\.href=.*RegForm|href=.?RegForm|前往掛號/i.test(rowHtml)) {
		return "available";
	}

	if (/available for appointment|可掛號/i.test(rowText)) {
		return "available";
	}

	if (/full|額滿/i.test(rowText)) {
		return "full";
	}

	if (/not available/i.test(rowText)) {
		return "unavailable";
	}

	if (/clinic closed|停診|overdue/i.test(rowText)) {
		return "closed";
	}

	if (/only viewable|僅檢視/i.test(rowText)) {
		return "view-only";
	}

	return "unknown";
}

async function selectPatientIdType(page: Page, patientIdType: PatientIdType): Promise<void> {
	const label = patientIdType === "national-id"
		? /身分證字號|person id number/i
		: patientIdType === "passport"
			? /其他|other identification/i
			: /居留|resident/i;

	const options = [
		page.getByText(label).first(),
		page.getByRole("radio", { name: label }).first(),
	];

	for (const option of options) {
		if (await option.isVisible().catch(() => false)) {
			await option.click();
			return;
		}
	}

	throw new Error(`Unable to select patient id type: ${patientIdType}`);
}

async function fillFirstVisible(page: Page, selectors: string[], value: string, waitTimeoutMs = 0): Promise<void> {
	for (const selector of selectors) {
		const locator = page.locator(selector).first();

		if (await locator.isVisible().catch(() => false)) {
			await locator.fill(value);
			return;
		}
	}

	if (waitTimeoutMs > 0) {
		for (const selector of selectors) {
			const locator = page.locator(selector).first();

			if (await locator.waitFor({ state: "visible", timeout: waitTimeoutMs }).then(() => true).catch(() => false)) {
				await locator.fill(value);
				return;
			}
		}
	}

	// Heuristic fallback: find visible text nodes that mention captcha and search nearby for an input
	try {
		const captchaLabel = page.getByText(/驗證碼|驗證|verification code|captcha/i).first();

		if (await captchaLabel.isVisible().catch(() => false)) {
			// Search within the label's ancestor containers for an input
			const ancestorInput = captchaLabel.locator("xpath=ancestor::*[1]//input").first();

			if (await ancestorInput.isVisible().catch(() => false)) {
				await ancestorInput.fill(value);
				return;
			}

			// Try following nodes (label then input sibling)
			const siblingInput = captchaLabel.locator("xpath=following::input[1]").first();

			if (await siblingInput.isVisible().catch(() => false)) {
				await siblingInput.fill(value);
				return;
			}
		}
	} catch (e) {
		// ignore heuristic errors and fall through to throwing below
	}

	throw new Error(`Unable to find input for selectors: ${selectors.join(", ")}`);
}

function extractDate(rowText: string): string | undefined {
	const match = rowText.match(/\b\d{1,2}\/\d{1,2}\b/);
	return match?.[0];
}

function extractSession(rowText: string): string | undefined {
	const match = rowText.match(/Morning|Afternoon|Evening|上午|下午|晚間/i);
	return match?.[0];
}

function normalizeText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function containsCollapsedText(value: string, expected: string): boolean {
	return collapseTextForMatch(value).includes(collapseTextForMatch(expected));
}

function collapseTextForMatch(value: string): string {
	return value.replace(/\s+/g, "").trim().toLowerCase();
}

function escapeForRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForBookingForm(page: Page): Promise<void> {
	const patientIdReady = await waitForAnyVisible(page, PATIENT_ID_SELECTORS, 10_000);
	const captchaReady = await waitForAnyVisible(page, CAPTCHA_INPUT_SELECTORS, 10_000);
	const formUrlReady = /RegForm|regform|appointment/i.test(page.url());

	if (patientIdReady || captchaReady || formUrlReady) {
		return;
	}

	throw new Error(
		`Booking form did not become fully visible after selecting a target row. Expected patient or captcha inputs, but not found in ${page.url()}.`,
	);
}

async function waitForAnyVisible(page: Page, selectors: string[], timeoutMs: number): Promise<boolean> {
	for (const selector of selectors) {
		const locator = page.locator(selector).first();
		if (await locator.waitFor({ state: "visible", timeout: 300 }).then(() => true).catch(() => false)) {
			return true;
		}
	}

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const selector of selectors) {
			const locator = page.locator(selector).first();
			if (await locator.isVisible().catch(() => false)) {
				return true;
			}
		}
		await page.waitForTimeout(250).catch(() => undefined);
	}

	return false;
}

async function isBookingFormStillVisible(page: Page): Promise<boolean> {
	const signals = [
		page.locator("#txtInputID").first(),
		page.locator("input[placeholder*='身分證']").first(),
		page.locator("input[placeholder*='ID Number']").first(),
		...CAPTCHA_INPUT_SELECTORS.map((selector) => page.locator(selector).first()),
	];

	for (const signal of signals) {
		if (await signal.isVisible().catch(() => false)) {
			return true;
		}
	}

	return false;
}