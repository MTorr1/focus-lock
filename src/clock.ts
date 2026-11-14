/** A single observation this far ahead of the last one is not treated as normal elapsed time. */
export const SUSPICIOUS_JUMP_MS = 15 * 60 * 1000;

/** Small backward drift from timers and sleep is ignored. */
export const BACKWARD_SKEW_MS = 60 * 1000;

export type TimeSample = { wall: number };

export type LockRelease = {
  release: boolean;
  suspiciousJump: boolean;
  backwardJump: boolean;
};

export function decideLockRelease(input: {
  end: number;
  now: number;
  lastSeenWall: number | null;
  serverDate: number | null;
}): LockRelease {
  const backwardJump = input.lastSeenWall !== null && input.now < input.lastSeenWall - BACKWARD_SKEW_MS;
  const suspiciousJump =
    input.lastSeenWall !== null && !backwardJump && input.now - input.lastSeenWall > SUSPICIOUS_JUMP_MS;

  let release = false;
  if (input.now >= input.end) {
    release = suspiciousJump ? input.serverDate !== null && input.serverDate >= input.end : true;
  }

  return { release, suspiciousJump, backwardJump };
}

/**
 * Time used for sync and "is this end still in the future?"
 * A suspicious forward jump without a server date keeps the previous clock,
 * so a faked jump cannot expire a lock or overwrite it from the cloud.
 */
export function trustedNow(now: number, lastSeenWall: number | null, serverDate: number | null): number {
  if (serverDate !== null) return serverDate;
  if (lastSeenWall !== null && now > lastSeenWall + SUSPICIOUS_JUMP_MS) return lastSeenWall;
  if (lastSeenWall !== null && now < lastSeenWall - BACKWARD_SKEW_MS) return now;
  return now;
}

export async function fetchServerDate(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    const response = await fetchImpl("https://www.google.com/generate_204", { method: "GET", cache: "no-store" });
    const header = response.headers.get("date");
    if (!header) return null;
    const parsed = Date.parse(header);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}
