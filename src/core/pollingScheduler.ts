import {
  getEffectivePollIntervalMs,
  getPollingMode,
  isNowInBoostWindow,
  type RuntimeConfig,
} from "../config/runtimeConfig.js";

export type PollingScheduleSnapshot = {
  effectiveIntervalMs: number;
  mode: "boost" | "base";
  inBoostWindow: boolean;
};

export function getPollingScheduleSnapshot(
  config: RuntimeConfig,
  now: Date = new Date(),
): PollingScheduleSnapshot {
  return {
    effectiveIntervalMs: getEffectivePollIntervalMs(config, now),
    mode: getPollingMode(config, now),
    inBoostWindow: isNowInBoostWindow(config.boostWindows, now),
  };
}