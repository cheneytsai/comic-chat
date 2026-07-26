import type { ThreadState } from "@comic-threads/core";

const LABEL: Record<ThreadState, string> = {
  open: "Open",
  closed: "Closed",
  merged: "Merged",
};

export function StateChip({ state }: { state: ThreadState }): preact.JSX.Element {
  return (
    <span class={`state-chip state-${state}`}>
      <span class="state-dot" aria-hidden="true" />
      {LABEL[state] ?? state}
    </span>
  );
}

export type LiveState = "idle" | "polling" | "rate-limited" | "stopped" | "error" | "offline";

const LIVE_LABEL: Record<LiveState, string> = {
  idle: "IDLE",
  polling: "LIVE",
  "rate-limited": "PAUSED",
  stopped: "OFF",
  error: "RETRYING",
  offline: "OFFLINE",
};

const LIVE_TITLE: Record<LiveState, string> = {
  idle: "Waiting to start polling.",
  polling: "Polling GitHub with conditional requests; new panels appear as they are posted.",
  "rate-limited": "Rate limited — polling is paused until the limit resets.",
  stopped: "Polling stopped.",
  error: "The last poll failed; retrying on the next tick.",
  offline: "Demo mode — nothing is fetched from GitHub.",
};

export function LiveChip({ state }: { state: LiveState }): preact.JSX.Element {
  return (
    <span class={`live-chip live-${state}`} title={LIVE_TITLE[state]}>
      <span class="live-dot" aria-hidden="true" />
      {LIVE_LABEL[state]}
    </span>
  );
}
