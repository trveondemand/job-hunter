import type { CareerAdapter } from "../types";

export function nextCompanyFailureState(
  previousFailures: number,
  pauseEligible: boolean,
  previousWasPauseEligible: boolean,
): { consecutiveFailures: number; enabled: boolean } {
  const consecutiveFailures = pauseEligible && !previousWasPauseEligible ? 1 : previousFailures + 1;
  return {
    consecutiveFailures,
    enabled: !(pauseEligible && consecutiveFailures >= 3),
  };
}

export function shouldCloseMissingCompanyJob(
  adapter: CareerAdapter,
  fallbackStillActive?: boolean,
): boolean {
  return adapter !== "generic" || fallbackStillActive === false;
}
