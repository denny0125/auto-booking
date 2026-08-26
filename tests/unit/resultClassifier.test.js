import { describe, expect, it } from "vitest";

import { classifyBookingResult } from "../../src/core/resultClassifier.ts";

describe("classifyBookingResult", () => {
	it("detects booking success text", () => {
		const result = classifyBookingResult("掛號成功，請記下您的掛號資訊");

		expect(result.kind).toBe("success");
		expect(result.terminal).toBe(true);
	});

	it("detects captcha failures as retryable", () => {
		const result = classifyBookingResult("請輸入正確驗證碼");

		expect(result.kind).toBe("captcha-invalid");
		expect(result.shouldRetry).toBe(true);
	});

	it("detects unavailable target states", () => {
		const result = classifyBookingResult("Appt. Not Available");

		expect(result.kind).toBe("target-unavailable");
	});
});