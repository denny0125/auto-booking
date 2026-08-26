export type BookingResultKind =
	| "success"
	| "captcha-invalid"
	| "target-unavailable"
	| "validation-error"
	| "site-error"
	| "unknown";

export type BookingResultClassification = {
	kind: BookingResultKind;
	message: string;
	shouldRetry: boolean;
	terminal: boolean;
};

const successPatterns = [/掛號成功/i, /appointment\s+successful/i, /預約成功/i];
const captchaPatterns = [/驗證碼/i, /verification code/i, /captcha/i];
const unavailablePatterns = [/額滿/i, /not available/i, /full/i, /停診/i, /clinic closed/i];
const validationPatterns = [/請輸入/i, /required/i, /格式/i, /invalid/i];
const siteErrorPatterns = [/system busy/i, /系統忙碌/i, /service unavailable/i, /發生錯誤/i];

export function classifyBookingResult(rawText: string): BookingResultClassification {
	const text = rawText.replace(/\s+/g, " ").trim();

	if (matchesAny(text, successPatterns)) {
		return { kind: "success", message: text, shouldRetry: false, terminal: true };
	}

	if (matchesAny(text, captchaPatterns)) {
		return { kind: "captcha-invalid", message: text, shouldRetry: true, terminal: false };
	}

	if (matchesAny(text, unavailablePatterns)) {
		return { kind: "target-unavailable", message: text, shouldRetry: true, terminal: false };
	}

	if (matchesAny(text, validationPatterns)) {
		return { kind: "validation-error", message: text, shouldRetry: false, terminal: false };
	}

	if (matchesAny(text, siteErrorPatterns)) {
		return { kind: "site-error", message: text, shouldRetry: true, terminal: false };
	}

	return { kind: "unknown", message: text, shouldRetry: false, terminal: false };
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(text));
}