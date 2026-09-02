"use client";

/**
 * The page-load fill, bounded.
 *
 * ── Why the bound lives here and not in the cell ──────────────────────────
 * Every day cell wants its own insight, and a cell that fetches on mount fires
 * the moment it renders. Thirty cells mount together, so thirty requests leave
 * together, and the provider answers some of them with a 503 that costs the
 * same as a success.
 *
 * One queue for the page, three in flight, results arriving as they finish.
 * The number is the server's `MAX_CONCURRENT_GENERATIONS`, kept in step by
 * name rather than by comment.
 */

/** Matches `MAX_CONCURRENT_GENERATIONS` on the server. */
export const MAX_CONCURRENT_INSIGHT_FETCHES = 3;

type Job = () => Promise<void>;

const queue: Job[] = [];
let inFlight = 0;

function pump() {
  while (inFlight < MAX_CONCURRENT_INSIGHT_FETCHES && queue.length > 0) {
    const job = queue.shift()!;
    inFlight += 1;
    void job().finally(() => {
      inFlight -= 1;
      pump();
    });
  }
}

/**
 * Run `job` when a slot frees up.
 *
 * Never rejects: a cell that fails to fill stays as it was, and one failure
 * must not stop the queue behind it.
 */
export function enqueueInsightFetch(job: Job): void {
  queue.push(async () => {
    try {
      await job();
    } catch {
      /* The cell reports its own failure. Swallowed here so the queue drains. */
    }
  });
  pump();
}

/** Test seam: how many jobs are waiting or running. */
export const insightQueueDepth = () => queue.length + inFlight;
