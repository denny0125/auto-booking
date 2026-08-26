import { z } from "zod";

const patientIdTypeSchema = z.enum(["national-id", "passport", "resident-certificate"]);

const hhmmPattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
const boostWindowPattern = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

const positiveIntegerFromEnv = (fieldName: string) =>
  z.coerce
    .number()
    .int(`${fieldName} must be an integer`)
    .positive(`${fieldName} must be greater than 0`);

const smtpPortSchema = z.coerce
  .number()
  .int("SMTP_PORT must be an integer")
  .min(1, "SMTP_PORT must be between 1 and 65535")
  .max(65535, "SMTP_PORT must be between 1 and 65535");

const ocrThresholdSchema = z.coerce
  .number()
  .min(0, "OCR_THRESHOLD must be between 0 and 1")
  .max(1, "OCR_THRESHOLD must be between 0 and 1");

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const rawRuntimeConfigSchema = z.object({
  TARGET_SCHEDULE_URL: z.string().trim().url("TARGET_SCHEDULE_URL must be a valid URL"),
  TARGET_DOCTOR_NAME: z.string().trim().min(1, "TARGET_DOCTOR_NAME is required"),
  TARGET_DEPARTMENT: z.string().trim().optional().transform(emptyToUndefined),
  TARGET_CAMPUS: z.string().trim().optional().transform(emptyToUndefined),
  PATIENT_ID_TYPE: patientIdTypeSchema,
  PATIENT_ID_NUMBER: z.string().trim().min(1, "PATIENT_ID_NUMBER is required"),
  PATIENT_BIRTH_YEAR: positiveIntegerFromEnv("PATIENT_BIRTH_YEAR"),
  PATIENT_BIRTH_MONTH: z.coerce.number().int("PATIENT_BIRTH_MONTH must be an integer").min(1).max(12),
  PATIENT_BIRTH_DAY: z.coerce.number().int("PATIENT_BIRTH_DAY must be an integer").min(1).max(31),
  BASE_POLL_INTERVAL_MS: positiveIntegerFromEnv("BASE_POLL_INTERVAL_MS"),
  BOOST_POLL_INTERVAL_MS: positiveIntegerFromEnv("BOOST_POLL_INTERVAL_MS"),
  BOOST_WINDOWS: z.string().trim().optional().transform(emptyToUndefined),
  HEADLESS: booleanFromEnv.default(true),
  RUN_ONCE: booleanFromEnv.default(false),
  INTERACTIVE_CAPTCHA: booleanFromEnv.default(false),
  BROWSER_EXECUTABLE_PATH: z.string().trim().optional().transform(emptyToUndefined),
  CAPTCHA_OUTPUT_DIR: z.string().trim().optional().transform(emptyToUndefined),
  MANUAL_CAPTCHA_CODE: z.string().trim().optional().transform(emptyToUndefined),
  TESSERACT_PATH: z.string().trim().optional().transform(emptyToUndefined),
  TESSERACT_LANGUAGE: z.string().trim().optional().transform(emptyToUndefined),
  TESSERACT_PSM: z.coerce.number().int().min(0).max(13).optional(),
  TESSERACT_OEM: z.coerce.number().int().min(0).max(3).optional(),
  SMTP_HOST: z.string().trim().min(1, "SMTP_HOST is required"),
  SMTP_PORT: smtpPortSchema,
  SMTP_USER: z.string().trim().min(1, "SMTP_USER is required"),
  SMTP_PASS: z.string().min(1, "SMTP_PASS is required"),
  SMTP_FROM: z.string().email("SMTP_FROM must be a valid email address"),
  SMTP_TO: z.string().trim().email("SMTP_TO must be a valid email address"),
  OCR_THRESHOLD: ocrThresholdSchema,
  CAPTCHA_RETRIES: positiveIntegerFromEnv("CAPTCHA_RETRIES"),
  CAPTCHA_COOLDOWN_SECONDS: positiveIntegerFromEnv("CAPTCHA_COOLDOWN_SECONDS"),
});

export type PatientIdType = z.infer<typeof patientIdTypeSchema>;

export type BoostWindow = {
  startMinutes: number;
  endMinutes: number;
  label: string;
};

export type RuntimeConfig = {
  targetScheduleUrl: string;
  targetDoctorName: string;
  targetDepartment?: string;
  targetCampus?: string;
  patientIdType: PatientIdType;
  patientIdNumber: string;
  patientBirthYear: number;
  patientBirthMonth: number;
  patientBirthDay: number;
  basePollIntervalMs: number;
  boostPollIntervalMs: number;
  boostWindows: BoostWindow[];
  headless: boolean;
  runOnce: boolean;
  interactiveCaptcha: boolean;
  browserExecutablePath?: string;
  captchaOutputDir: string;
  manualCaptchaCode?: string;
  tesseract: {
    executablePath?: string;
    language: string;
    pageSegmentationMode: number;
    ocrEngineMode: number;
  };
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    to: string;
  };
  ocrThreshold: number;
  captchaRetries: number;
  captchaCooldownSeconds: number;
};

export function parseBoostWindows(value?: string): BoostWindow[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const match = boostWindowPattern.exec(segment);

      if (!match) {
        throw new Error(`Invalid boost window format: ${segment}. Expected HH:mm-HH:mm.`);
      }

      const start = toMinutes(`${match[1]}:${match[2]}`);
      const end = toMinutes(`${match[3]}:${match[4]}`);

      if (start === end) {
        throw new Error(`Invalid boost window range: ${segment}. Start and end cannot match.`);
      }

      return {
        startMinutes: start,
        endMinutes: end,
        label: segment,
      } satisfies BoostWindow;
    });
}

export function isNowInBoostWindow(windows: BoostWindow[], now: Date = new Date()): boolean {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return windows.some((window) => {
    if (window.startMinutes < window.endMinutes) {
      return currentMinutes >= window.startMinutes && currentMinutes < window.endMinutes;
    }

    return currentMinutes >= window.startMinutes || currentMinutes < window.endMinutes;
  });
}

export function getEffectivePollIntervalMs(config: RuntimeConfig, now: Date = new Date()): number {
  return isNowInBoostWindow(config.boostWindows, now)
    ? config.boostPollIntervalMs
    : config.basePollIntervalMs;
}

export function getPollingMode(config: RuntimeConfig, now: Date = new Date()): "boost" | "base" {
  return isNowInBoostWindow(config.boostWindows, now) ? "boost" : "base";
}

export function parseRuntimeConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): RuntimeConfig {
  const parsed = rawRuntimeConfigSchema.parse(env);
  const boostWindows = parseBoostWindows(parsed.BOOST_WINDOWS);

  return {
    targetScheduleUrl: parsed.TARGET_SCHEDULE_URL,
    targetDoctorName: parsed.TARGET_DOCTOR_NAME,
    targetDepartment: parsed.TARGET_DEPARTMENT,
    targetCampus: parsed.TARGET_CAMPUS,
    patientIdType: parsed.PATIENT_ID_TYPE,
    patientIdNumber: parsed.PATIENT_ID_NUMBER,
    patientBirthYear: parsed.PATIENT_BIRTH_YEAR,
    patientBirthMonth: parsed.PATIENT_BIRTH_MONTH,
    patientBirthDay: parsed.PATIENT_BIRTH_DAY,
    basePollIntervalMs: parsed.BASE_POLL_INTERVAL_MS,
    boostPollIntervalMs: parsed.BOOST_POLL_INTERVAL_MS,
    boostWindows,
    headless: parsed.HEADLESS,
    runOnce: parsed.RUN_ONCE,
    interactiveCaptcha: parsed.INTERACTIVE_CAPTCHA,
    browserExecutablePath: parsed.BROWSER_EXECUTABLE_PATH,
    captchaOutputDir: parsed.CAPTCHA_OUTPUT_DIR ?? "artifacts/captcha",
    manualCaptchaCode: parsed.MANUAL_CAPTCHA_CODE,
    tesseract: {
      executablePath: parsed.TESSERACT_PATH,
      language: parsed.TESSERACT_LANGUAGE ?? "eng",
      pageSegmentationMode: parsed.TESSERACT_PSM ?? 7,
      ocrEngineMode: parsed.TESSERACT_OEM ?? 1,
    },
    smtp: {
      host: parsed.SMTP_HOST,
      port: parsed.SMTP_PORT,
      user: parsed.SMTP_USER,
      pass: parsed.SMTP_PASS,
      from: parsed.SMTP_FROM,
      to: parsed.SMTP_TO,
    },
    ocrThreshold: parsed.OCR_THRESHOLD,
    captchaRetries: parsed.CAPTCHA_RETRIES,
    captchaCooldownSeconds: parsed.CAPTCHA_COOLDOWN_SECONDS,
  };
}

function emptyToUndefined(value?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.length === 0 ? undefined : value;
}

function toMinutes(hhmm: string): number {
  const match = hhmmPattern.exec(hhmm);

  if (!match) {
    throw new Error(`Invalid HH:mm value: ${hhmm}`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
}