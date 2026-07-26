/**
 * Landing page: the wordmark, one input, and the demo. The URL is validated
 * with the same `parseThreadUrl` the fetcher uses, so anything the input
 * accepts is something the app can actually load.
 */

import { useEffect, useState } from "preact/hooks";
import { parseThreadUrl } from "@comic-threads/github-source";
import { characterIconUrl } from "../lib/assets.js";
import { loadRosterIndex, type RosterCharacter } from "../lib/roster.js";
import { navigate } from "../lib/router.js";

const EXAMPLES = [
  "https://github.com/facebook/react/issues/24304",
  "https://github.com/rust-lang/rust/pull/95474",
  "microsoft/TypeScript#38446",
];

export interface LandingProps {
  onOpenSettings: () => void;
}

export function Landing({ onOpenSettings }: LandingProps): preact.JSX.Element {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [roster, setRoster] = useState<RosterCharacter[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadRosterIndex().then(
      (idx) => {
        if (!cancelled) setRoster(idx.characters);
      },
      () => {
        /* the roster teaser is decorative; the demo path reports real errors */
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const ref = parseThreadUrl(value);
  const invalid = touched && value.trim().length > 0 && ref === null;

  const submit = (ev: Event): void => {
    ev.preventDefault();
    setTouched(true);
    if (!ref) return;
    navigate({
      view: "thread",
      ref: { ...ref, type: ref.type === "pull" ? "pull" : "issues" },
    });
  };

  return (
    <div class="landing">
      <div class="landing-inner">
        <h1 class="wordmark">
          <span class="wordmark-bubble">🗨</span>
          <span>
            Comic <em>Threads</em>
          </span>
        </h1>
        <p class="tagline">
          Paste a GitHub issue or pull request. Read it as a comic strip — composed by the actual
          Microsoft Comic Chat expert system from 1996, drawn with its actual cast.
        </p>

        <form class="url-form" onSubmit={submit}>
          <input
            class={`url-input${invalid ? " is-invalid" : ""}`}
            type="text"
            inputMode="url"
            spellcheck={false}
            autocomplete="off"
            placeholder="https://github.com/owner/repo/issues/123"
            aria-label="GitHub issue or pull request URL"
            aria-invalid={invalid}
            value={value}
            onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
            onBlur={() => setTouched(true)}
          />
          <button type="submit" class="primary-btn big" disabled={!ref}>
            Draw it
          </button>
        </form>

        {invalid ? (
          <p class="form-error" role="alert">
            That does not look like a GitHub issue or PR. Try{" "}
            <code>github.com/owner/repo/issues/123</code> or <code>owner/repo#123</code>.
          </p>
        ) : (
          <p class="form-help">
            Works with <code>/issues/</code> and <code>/pull/</code> URLs, or the{" "}
            <code>owner/repo#123</code> shorthand.
          </p>
        )}

        <div class="demo-cta">
          <button
            type="button"
            class="demo-btn"
            onClick={() => navigate({ view: "demo" })}
          >
            ▶ Try the demo
          </button>
          <span class="demo-note">
            A finished strip, rendered from a bundled fixture — nothing is fetched from GitHub.
          </span>
        </div>

        <ul class="examples">
          {EXAMPLES.map((ex) => (
            <li key={ex}>
              <button
                type="button"
                class="link-btn"
                onClick={() => {
                  setValue(ex);
                  setTouched(false);
                }}
              >
                {ex.replace(/^https:\/\/github\.com\//, "")}
              </button>
            </li>
          ))}
        </ul>

        {roster.length > 0 ? (
          <section class="roster-teaser">
            <h2>
              The cast — {roster.length} characters extracted from the original{" "}
              <code>.avb</code> art
            </h2>
            <div class="roster-row">
              {roster.map((c) => (
                <img
                  key={c.name}
                  src={characterIconUrl(c.name, c.iconImage)}
                  alt={c.name}
                  title={`${c.name} · ${c.type} · ${c.poseCount} poses`}
                  loading="lazy"
                />
              ))}
            </div>
            <p class="roster-note">
              Participants are cast deterministically by a stable hash of their login — the same
              person always gets the same face, and you can re-cast anyone from the comic view.
            </p>
          </section>
        ) : null}

        <footer class="landing-footer">
          <button type="button" class="link-btn" onClick={onOpenSettings}>
            Settings
          </button>
          <span> · </span>
          <span>
            No backend. An optional token stays in your browser and is sent only to{" "}
            <code>api.github.com</code>.
          </span>
        </footer>
      </div>
    </div>
  );
}
