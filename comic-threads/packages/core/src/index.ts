/**
 * @comic-threads/core — the platform-agnostic Comic Chat engine: emotion
 * inference, character casting/pose selection, panel composition, and SVG
 * rendering. No DOM, no fetch; runs in Node and the browser alike.
 */

// Model
export * from "./model.js";

// RNG
export { hashString, makeRng, rngFromString, type Rng } from "./rng.js";

// Emotion
export * from "./emotion/wheel.js";
export {
  ORIGINAL_RULES,
  MODERN_RULES,
  ALL_RULES,
  type Rule,
  type RuleKind,
} from "./emotion/rules.js";
export {
  inferEmotion,
  inferOriginal,
  stripMarkup,
  checkForUppers,
  checkWord,
  getNextSentenceStart,
  NEUTRAL,
  type InferredEmotion,
  type InferOptions,
} from "./emotion/engine.js";

// Characters
export {
  castParticipants,
  makeRoster,
  pickPose,
  type CharacterManifest,
  type PoseRecord,
  type PoseSelection,
  type RenderImage,
  type Roster,
  type CastingOptions,
} from "./characters.js";

// Compose
export * from "./compose/types.js";
export { composeThread, type ComposeOptions } from "./compose/composer.js";
export {
  measureText,
  wrapText,
  splitSentences,
  splitForContinuation,
  type WrappedText,
} from "./compose/text.js";

// Render
export {
  renderPanelSVG,
  renderComicSVG,
  escapeXml,
  FONT_STACK,
  MONO_STACK,
  type PanelRenderOptions,
} from "./render/svg.js";
