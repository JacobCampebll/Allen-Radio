// log-cleanup.mjs — runs every hour and deletes crew-log messages older than 24 hours,
// so nothing lingers even when no one is on the radio.

import { purgeExpired } from "../lib/crew-log.js";

export default async () => {
  try {
    const removed = await purgeExpired();
    console.log("crew-log cleanup removed", removed);
  } catch (err) {
    console.error("crew-log cleanup failed", err?.name);
  }
};

// Top of every hour, UTC (time zone doesn't matter for an hourly job).
export const config = { schedule: "0 * * * *" };
