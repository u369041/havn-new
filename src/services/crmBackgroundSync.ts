import { runCrmBackgroundSyncCycle } from "../routes/agencyContacts";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;
const DEFAULT_STARTUP_DELAY_MS = 20 * 1000;

function enabled(): boolean {
  return String(process.env.CRM_BACKGROUND_SYNC_ENABLED || "")
    .trim()
    .toLowerCase() === "true";
}

function intervalMs(): number {
  const configured = Number(process.env.CRM_BACKGROUND_SYNC_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(configured)) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.floor(configured));
}

function startupDelayMs(): number {
  const configured = Number(process.env.CRM_BACKGROUND_SYNC_STARTUP_DELAY_MS || DEFAULT_STARTUP_DELAY_MS);
  if (!Number.isFinite(configured) || configured < 0) return DEFAULT_STARTUP_DELAY_MS;
  return Math.floor(configured);
}

export function startCrmBackgroundSync() {
  if (!enabled()) {
    console.log("CRM background sync disabled");
    return () => undefined;
  }

  const cadence = intervalMs();
  let running = false;
  let stopped = false;

  const run = async () => {
    if (stopped || running) return;
    running = true;
    const startedAt = Date.now();

    try {
      const summary = await runCrmBackgroundSyncCycle();
      console.info("CRM background sync cycle completed", {
        ...summary,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      console.error("CRM background sync cycle failed", {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
    } finally {
      running = false;
    }
  };

  const startupTimer = setTimeout(() => {
    void run();
  }, startupDelayMs());
  startupTimer.unref?.();

  const intervalTimer = setInterval(() => {
    void run();
  }, cadence);
  intervalTimer.unref?.();

  console.log(`CRM background sync enabled every ${cadence}ms`);

  return () => {
    stopped = true;
    clearTimeout(startupTimer);
    clearInterval(intervalTimer);
  };
}
