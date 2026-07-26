/**
 * Settings (F11). The token never leaves this browser except as an
 * `Authorization: Bearer` header on requests to https://api.github.com, which
 * `@comic-threads/github-source` is the only code path that issues.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { MAX_POLL_MS, MIN_POLL_MS, type Settings } from "../lib/settings.js";

export interface SettingsPopoverProps {
  settings: Settings;
  onSave: (next: Settings) => void;
  onClose: () => void;
}

export function SettingsPopover({
  settings,
  onSave,
  onClose,
}: SettingsPopoverProps): preact.JSX.Element {
  const [token, setToken] = useState(settings.token);
  const [seconds, setSeconds] = useState(Math.round(settings.pollIntervalMs / 1000));
  const [reveal, setReveal] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commit = (): void => {
    onSave({ ...settings, token, pollIntervalMs: seconds * 1000 });
    onClose();
  };

  return (
    <div class="popover settings-popover" role="dialog" aria-label="Settings" ref={ref}>
      <label class="field">
        <span class="field-label">GitHub personal access token (optional)</span>
        <span class="field-row">
          <input
            type={reveal ? "text" : "password"}
            value={token}
            spellcheck={false}
            autocomplete="off"
            placeholder="ghp_… — raises 60 req/h to 5,000"
            onInput={(e) => setToken((e.currentTarget as HTMLInputElement).value)}
          />
          <button type="button" class="ghost-btn" onClick={() => setReveal(!reveal)}>
            {reveal ? "hide" : "show"}
          </button>
        </span>
        <span class="field-help">
          Stored in this browser's localStorage and sent only to <code>api.github.com</code>. There
          is no server behind this app.
        </span>
      </label>

      <label class="field">
        <span class="field-label">Poll every {seconds}s</span>
        <input
          type="range"
          min={MIN_POLL_MS / 1000}
          max={MAX_POLL_MS / 1000}
          step={5}
          value={seconds}
          onInput={(e) => setSeconds(Number((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="field-help">
          Conditional requests (ETag) return 304 and cost no rate limit, so a short cadence is
          cheap.
        </span>
      </label>

      <div class="popover-actions">
        <button
          type="button"
          class="ghost-btn"
          onClick={() => {
            setToken("");
          }}
        >
          Clear token
        </button>
        <button type="button" class="primary-btn" onClick={commit}>
          Save
        </button>
      </div>
    </div>
  );
}
