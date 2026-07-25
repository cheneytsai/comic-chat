/**
 * Composed comic data model — the output of the composer and the input to the
 * renderer. Everything is in "unit space": each panel is a UNIT_WIDTH ×
 * UNIT_HEIGHT box (4:3-ish, matching Comic Chat's unitWidth/unitHeight). Y
 * grows downward; bodies sit at the bottom, balloons in the top half.
 */

import type { EmotionName } from "../emotion/wheel.js";

export const UNIT_WIDTH = 1000;
export const UNIT_HEIGHT = 760;
/** Balloons live in the top half of the panel (LayoutBalloons GetBalloonRect). */
export const BALLOON_ZONE_HEIGHT = UNIT_HEIGHT / 2;
/** Tallest body ≤ unitHeight/1.9 (LayoutAvatars). */
export const MAX_BODY_HEIGHT = UNIT_HEIGHT / 1.9;
export const BALLOON_FONT_SIZE = 30;
export const CAPTION_FONT_SIZE = 28;
export const TERMINAL_FONT_SIZE = 22;
/** Max characters in one balloon before we split to a continuation panel. */
export const MAX_BALLOON_CHARS = 200;
/** Max panels a single comment may occupy before truncation. */
export const MAX_CONTINUATION_PANELS = 3;
export const MAX_BALLOONS_PER_PANEL = 5;
export const MAX_BODIES_PER_PANEL = 4;

export type BalloonKind = "speech" | "thought" | "shout" | "whisper" | "caption";

export interface PlacedImage {
  href: string;
  /** bbox within the panel (unit space). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** true → mirror horizontally (facing left). */
  flip: boolean;
}

export interface PlacedBody {
  login: string;
  character: string;
  emotion: EmotionName;
  /** bounding box in unit space. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** stacked images (1 for simple, 2 for complex), already positioned. */
  images: PlacedImage[];
  /** true → the whole body faces left (mirrored). */
  flip: boolean;
  /** balloon tail anchor in unit space (mouth/head). */
  anchorX: number;
  anchorY: number;
  /** true when drawn only as a silent listener (no balloon this panel). */
  silent: boolean;
}

export interface ReactionStack {
  emoji: string;
  count: number;
}

export interface PlacedBalloon {
  kind: BalloonKind;
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  /** tail target (speaker anchor); undefined for captions. */
  tailX?: number;
  tailY?: number;
  speakerLogin?: string;
  reactions?: ReactionStack[];
  /** true → ends with a continuation ellipsis. */
  continued?: boolean;
}

export interface TerminalCard {
  lang: string;
  lines: string[];
  truncated: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PanelKind = "normal" | "caption" | "celebration";

export interface Panel {
  kind: PanelKind;
  bodies: PlacedBody[];
  balloons: PlacedBalloon[];
  terminal?: TerminalCard;
  /** caption text for caption strips / narration panels. */
  caption?: string;
  captionFlavor?: string;
  /** decorative flourishes (e.g. "stars" on merge celebration). */
  decorations: string[];
  /** deterministic seed for this panel (for jitter, if any). */
  seed: number;
  /** source item indices that contributed to this panel (debug/telemetry). */
  itemIndices: number[];
}

export interface ComicPage {
  panels: Panel[];
}

export interface Comic {
  id: string;
  title: string;
  url: string;
  state: string;
  pages: ComicPage[];
  /** flat convenience view of every panel across pages. */
  panels: Panel[];
}
