import { describe, expect, it } from "vitest";

import {
  getEffectivePollIntervalMs,
  isNowInBoostWindow,
  parseBoostWindows,
  parseRuntimeConfig,
} from "../../src/config/runtimeConfig.ts";

describe("parseBoostWindows", () => {
  it("parses comma-separated boost windows", () => {
    const windows = parseBoostWindows("08:30-09:15, 14:00-14:30");

    expect(windows).toEqual([
      { startMinutes: 510, endMinutes: 555, label: "08:30-09:15" },
      { startMinutes: 840, endMinutes: 870, label: "14:00-14:30" },
    ]);
  });

  it("supports windows that cross midnight", () => {
    const windows = parseBoostWindows("23:00-01:00");

    expect(isNowInBoostWindow(windows, new Date("2026-08-25T23:30:00"))).toBe(true);
    expect(isNowInBoostWindow(windows, new Date("2026-08-25T00:30:00"))).toBe(true);
    expect(isNowInBoostWindow(windows, new Date("2026-08-25T02:00:00"))).toBe(false);
  });
});

describe("parseRuntimeConfig", () => {
  it("normalizes validated config and computes effective interval", () => {
    const config = parseRuntimeConfig({
      TARGET_SCHEDULE_URL: "https://reg.ntuh.gov.tw/WebReg/WebReg/RegDeptSchedule?vHospCode=C0&vDeptCode=ME04&showBlock=A",
      TARGET_DOCTOR_NAME: "Dr Wang",
      TARGET_APPOINTMENT_DATE: "2026-09-08",
      TARGET_DEPARTMENT: "Cardiology",
      TARGET_CAMPUS: "Main",
      PATIENT_ID_TYPE: "national-id",
      PATIENT_ID_NUMBER: "A123456789",
      PATIENT_BIRTH_YEAR: "1980",
      PATIENT_BIRTH_MONTH: "8",
      PATIENT_BIRTH_DAY: "25",
      BOOKING_START_AT: "2026-09-08T07:59:50+08:00",
      BASE_POLL_INTERVAL_MS: "15000",
      BOOST_POLL_INTERVAL_MS: "5000",
      BOOST_WINDOWS: "08:30-09:15,14:00-14:30",
      CAPTCHA_AUTO: "true",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "bot@example.com",
      SMTP_PASS: "secret",
      SMTP_FROM: "bot@example.com",
      SMTP_TO: "ops@example.com",
      OCR_THRESHOLD: "0.85",
      CAPTCHA_RETRIES: "3",
      CAPTCHA_COOLDOWN_SECONDS: "20",
    });

    expect(config.targetDoctorName).toBe("Dr Wang");
    expect(config.targetAppointmentDate).toBe("9/8");
    expect(config.bookingStartAt?.toISOString()).toBe("2026-09-07T23:59:50.000Z");
    expect(config.smtp.to).toBe("ops@example.com");
    expect(config.interactiveCaptcha).toBe(false);
    expect(config.captchaAuto).toBe(true);
    expect(config.browserExecutablePath).toBeUndefined();
    expect(getEffectivePollIntervalMs(config, new Date("2026-08-25T08:45:00"))).toBe(5000);
    expect(getEffectivePollIntervalMs(config, new Date("2026-08-25T10:00:00"))).toBe(15000);
  });

  it("rejects malformed target appointment date", () => {
    expect(() =>
      parseRuntimeConfig({
        TARGET_SCHEDULE_URL: "https://reg.ntuh.gov.tw/WebReg/WebReg/RegDeptSchedule?vHospCode=C0&vDeptCode=ME04&showBlock=A",
        TARGET_DOCTOR_NAME: "Dr Wang",
        TARGET_APPOINTMENT_DATE: "2026/09/08",
        PATIENT_ID_TYPE: "passport",
        PATIENT_ID_NUMBER: "P1234567",
        PATIENT_BIRTH_YEAR: "1980",
        PATIENT_BIRTH_MONTH: "8",
        PATIENT_BIRTH_DAY: "25",
        BASE_POLL_INTERVAL_MS: "15000",
        BOOST_POLL_INTERVAL_MS: "5000",
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "bot@example.com",
        SMTP_PASS: "secret",
        SMTP_FROM: "bot@example.com",
        SMTP_TO: "ops@example.com",
        OCR_THRESHOLD: "0.85",
        CAPTCHA_RETRIES: "3",
        CAPTCHA_COOLDOWN_SECONDS: "20",
      }),
    ).toThrow(/TARGET_APPOINTMENT_DATE/i);
  });

  it("rejects malformed boost windows", () => {
    expect(() =>
      parseRuntimeConfig({
        TARGET_SCHEDULE_URL: "https://reg.ntuh.gov.tw/WebReg/WebReg/RegDeptSchedule?vHospCode=C0&vDeptCode=ME04&showBlock=A",
        TARGET_DOCTOR_NAME: "Dr Wang",
        PATIENT_ID_TYPE: "passport",
        PATIENT_ID_NUMBER: "P1234567",
        PATIENT_BIRTH_YEAR: "1980",
        PATIENT_BIRTH_MONTH: "8",
        PATIENT_BIRTH_DAY: "25",
        BASE_POLL_INTERVAL_MS: "15000",
        BOOST_POLL_INTERVAL_MS: "5000",
        BOOST_WINDOWS: "bad-window",
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "bot@example.com",
        SMTP_PASS: "secret",
        SMTP_FROM: "bot@example.com",
        SMTP_TO: "ops@example.com",
        OCR_THRESHOLD: "0.85",
        CAPTCHA_RETRIES: "3",
        CAPTCHA_COOLDOWN_SECONDS: "20",
      }),
    ).toThrow(/boost window/i);
  });
});