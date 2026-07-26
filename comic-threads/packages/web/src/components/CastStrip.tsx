/**
 * The cast strip: every participant with the character they were cast as.
 * Clicking one opens a picker over the whole roster; the choice is stored per
 * repo in localStorage (F2) so the same login keeps that face everywhere.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import type { Participant } from "@comic-threads/core";
import { characterIconUrl } from "../lib/assets.js";
import type { RosterCharacter } from "../lib/roster.js";

const ROLE_LABEL: Record<Participant["role"], string> = {
  author: "author",
  maintainer: "maintainer",
  contributor: "contributor",
  bot: "bot",
};

export interface CastStripProps {
  participants: Participant[];
  casting: Map<string, string>;
  roster: RosterCharacter[];
  overrides: Record<string, string>;
  onRecast: (login: string, character: string | null) => void;
}

export function CastStrip({
  participants,
  casting,
  roster,
  overrides,
  onRecast,
}: CastStripProps): preact.JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (ev: MouseEvent): void => {
      if (stripRef.current && !stripRef.current.contains(ev.target as Node)) setOpen(null);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div class="cast" ref={stripRef}>
      {participants.map((p) => {
        const character = casting.get(p.login);
        const isOpen = open === p.login;
        return (
          <div class="cast-slot" key={p.login}>
            <button
              type="button"
              class={`cast-chip${isOpen ? " is-open" : ""}`}
              aria-expanded={isOpen}
              aria-haspopup="dialog"
              title={`${p.login} — cast as ${character ?? "nobody"}. Click to re-cast.`}
              onClick={() => setOpen(isOpen ? null : p.login)}
            >
              <span class="cast-portrait">
                {character ? (
                  <img src={characterIconUrl(character)} alt="" width={40} height={40} />
                ) : (
                  <span class="cast-portrait-empty" />
                )}
              </span>
              <span class="cast-meta">
                <span class="cast-login">{p.displayName || p.login}</span>
                <span class="cast-role">
                  {ROLE_LABEL[p.role]}
                  {character ? ` · ${character}` : ""}
                  {overrides[p.login] ? " · pinned" : ""}
                </span>
              </span>
            </button>

            {isOpen ? (
              <div class="picker" role="dialog" aria-label={`Re-cast ${p.login}`}>
                <div class="picker-head">
                  <strong>Re-cast {p.login}</strong>
                  <button
                    type="button"
                    class="link-btn"
                    onClick={() => {
                      onRecast(p.login, null);
                      setOpen(null);
                    }}
                  >
                    reset to auto
                  </button>
                </div>
                <div class="picker-grid">
                  {roster.map((c) => (
                    <button
                      type="button"
                      key={c.name}
                      class={`picker-item${c.name === character ? " is-current" : ""}`}
                      title={`${c.name} — ${c.type}, ${c.poseCount} poses`}
                      onClick={() => {
                        onRecast(p.login, c.name);
                        setOpen(null);
                      }}
                    >
                      <img src={characterIconUrl(c.name, c.iconImage)} alt="" loading="lazy" />
                      <span>{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
