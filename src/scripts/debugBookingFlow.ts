import { chromium } from "playwright";
import { config as loadDotEnv } from "dotenv";

import { openBookingForm, openSchedulePage, findDoctorCandidate, fillBookingForm, captureBookingCaptcha } from "../adapters/ntuhPageAdapter.js";
import { parseRuntimeConfig } from "../config/runtimeConfig.js";

loadDotEnv();

async function snapshot(page: import("playwright").Page, label: string) {
	const data = await page.evaluate(() => ({
		url: location.href,
		readyState: document.readyState,
		validTextExists: !!document.querySelector("#validText"),
		patientIdExists: !!document.querySelector("#txtInputID")
			|| !!document.querySelector("input[placeholder*='身分證']")
			|| !!document.querySelector("input[placeholder*='ID Number']"),
		captchaInputExists: !!document.querySelector("#validText")
			|| !!document.querySelector("input[placeholder*='驗證碼']"),
		imageCount: document.querySelectorAll("img").length,
		visibleImages: Array.from(document.querySelectorAll("img")).filter((img) => !!(img.offsetWidth || img.offsetHeight || img.getClientRects().length)).length,
		inputBlockHtml: document.querySelector(".input_block")?.outerHTML?.slice(0, 400) ?? null,
	}));

	console.log(JSON.stringify({ label, ...data }));
}

async function main() {
	const config = parseRuntimeConfig(process.env);
	const browser = await chromium.launch({
		headless: config.headless,
		executablePath: config.browserExecutablePath,
	});

	try {
		const page = await browser.newPage();
		await openSchedulePage(page, config.targetScheduleUrl);
		const candidate = await findDoctorCandidate(page, config.targetDoctorName);

		if (!candidate) {
			throw new Error(`Target doctor not found: ${config.targetDoctorName}`);
		}

		console.log(JSON.stringify({
			label: "candidate",
			doctor: candidate.doctorName,
			availability: candidate.availability,
			appointmentDate: candidate.appointmentDate,
			appointmentTime: candidate.appointmentTime,
			rowText: candidate.rowText,
		}));

		await openBookingForm(page, candidate);
		await snapshot(page, "after-openBookingForm");

		await fillBookingForm(page, {
			patientIdType: config.patientIdType,
			patientIdNumber: config.patientIdNumber,
			birthYear: config.patientBirthYear,
			birthMonth: config.patientBirthMonth,
			birthDay: config.patientBirthDay,
		});
		await snapshot(page, "after-fillBookingForm");

		try {
			const checkpoint = await captureBookingCaptcha(page, config);
			console.log(JSON.stringify({
				label: "capture-success",
				checkpoint,
			}));
		} catch (error) {
			await snapshot(page, "after-capture-failure");
			console.log(JSON.stringify({
				label: "capture-error",
				error: error instanceof Error ? error.message : String(error),
			}));
		}
	} finally {
		await browser.close();
	}
}

await main();
