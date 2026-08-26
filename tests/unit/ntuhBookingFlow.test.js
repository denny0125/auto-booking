import { beforeEach, describe, expect, it, vi } from "vitest";

const launchMock = vi.fn();
const openSchedulePageMock = vi.fn();
const findDoctorCandidateMock = vi.fn();
const openBookingFormMock = vi.fn();
const fillBookingFormMock = vi.fn();
const captureBookingCaptchaMock = vi.fn();
const submitBookingFormMock = vi.fn();
const readBookingResultMock = vi.fn();

vi.mock("playwright", () => ({
	chromium: {
		launch: launchMock,
	},
}));

vi.mock("../../src/adapters/ntuhPageAdapter.ts", () => ({
	openSchedulePage: openSchedulePageMock,
	findDoctorCandidate: findDoctorCandidateMock,
	openBookingForm: openBookingFormMock,
	fillBookingForm: fillBookingFormMock,
	captureBookingCaptcha: captureBookingCaptchaMock,
	submitBookingForm: submitBookingFormMock,
	readBookingResult: readBookingResultMock,
}));

describe("runBookingAttempt", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();

		launchMock.mockResolvedValue({
			newPage: vi.fn().mockResolvedValue({}),
			close: vi.fn().mockResolvedValue(undefined),
		});

		openSchedulePageMock.mockResolvedValue(undefined);
		findDoctorCandidateMock.mockResolvedValue({
			doctorName: "林展毅",
			availability: "available",
			appointmentDate: "9/8",
			appointmentTime: "上午",
			rowText: "林 展毅 | 11 診 消化科 | 普通門診",
			rowLocator: {},
		});
		openBookingFormMock.mockResolvedValue(undefined);
		fillBookingFormMock.mockResolvedValue(undefined);
		submitBookingFormMock.mockResolvedValue(undefined);
		readBookingResultMock.mockResolvedValue({
			kind: "success",
			message: "掛號成功，請記下您的掛號資訊",
			shouldRetry: false,
			terminal: true,
		});
	});

	it("returns success even when success notification email fails", async () => {
		const { runBookingAttempt } = await import("../../src/workflows/ntuhBookingFlow.ts");
		const logger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};
		const emailNotifier = {
			sendSuccessNotification: vi.fn().mockRejectedValue(new Error("connect ETIMEDOUT 74.125.204.108:587")),
		};

		const result = await runBookingAttempt({
			config: {
				headless: true,
				browserExecutablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
				targetScheduleUrl: "https://example.test/schedule",
				targetDoctorName: "林展毅",
				targetDepartment: "Gastroenterology",
				patientIdType: "national-id",
				patientIdNumber: "A123456789",
				patientBirthYear: 1980,
				patientBirthMonth: 1,
				patientBirthDay: 1,
				captchaRetries: 1,
				captchaCooldownSeconds: 2,
				runOnce: true,
			},
			logger,
			emailNotifier,
			executionId: "test-execution-id",
			nodeName: "test-node",
			manualCaptchaCode: "H6666F",
		});

		expect(result).toEqual({
			status: "success",
			doctor: "林展毅",
			appointmentDate: "9/8",
			appointmentTime: "上午",
			message: "掛號成功，請記下您的掛號資訊",
		});
		expect(emailNotifier.sendSuccessNotification).toHaveBeenCalledTimes(1);
		expect(logger.warn).toHaveBeenCalledWith(
			"success notification email failed",
			expect.objectContaining({
				error: "connect ETIMEDOUT 74.125.204.108:587",
				doctor: "林展毅",
			}),
		);
		expect(logger.info).toHaveBeenCalledWith(
			"booking completed",
			expect.objectContaining({
				doctor: "林展毅",
				appointmentDate: "9/8",
				appointmentTime: "上午",
			}),
		);
	});
});