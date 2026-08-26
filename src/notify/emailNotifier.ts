import { createRequire } from "node:module";

import type { Logger } from "../core/logger.js";
import type { RuntimeConfig } from "../config/runtimeConfig.js";

type MailTransport = {
  sendMail: (message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }) => Promise<unknown>;
};

type NodemailerModule = {
  createTransport: (options: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  }) => MailTransport;
};

const require = createRequire(import.meta.url);
const nodemailer = require("nodemailer") as NodemailerModule;

export type SuccessNotificationInput = {
  doctor: string;
  department?: string;
  appointmentDate: string;
  appointmentTime: string;
  successTimestamp: string;
  executionId: string;
  nodeName?: string;
};

export type EmailNotifier = {
  sendSuccessNotification: (input: SuccessNotificationInput) => Promise<void>;
};

export function createEmailNotifier(config: RuntimeConfig, logger: Logger): EmailNotifier {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });

  return {
    async sendSuccessNotification(input): Promise<void> {
      await transport.sendMail({
        from: config.smtp.from,
        to: config.smtp.to,
        subject: `[AutoBooking] Booking success for ${input.doctor}`,
        text: buildSuccessBody(input),
      });

      logger.info("success notification email sent", {
        doctor: input.doctor,
        department: input.department,
        appointmentDate: input.appointmentDate,
        appointmentTime: input.appointmentTime,
        successTimestamp: input.successTimestamp,
        executionId: input.executionId,
        smtpTo: config.smtp.to,
      });
    },
  };
}

function buildSuccessBody(input: SuccessNotificationInput): string {
  return [
    "NTUH auto-booking success.",
    `Doctor: ${input.doctor}`,
    `Department: ${input.department ?? "n/a"}`,
    `Appointment date: ${input.appointmentDate}`,
    `Appointment time: ${input.appointmentTime}`,
    `Success timestamp: ${input.successTimestamp}`,
    `Node: ${input.nodeName ?? process.version}`,
    `Execution ID: ${input.executionId}`,
  ].join("\n");
}