/**
 * The Comic Chat "emotion wheel" (avatar.h). Eight wheel emotions live at
 * angles k·2π/8 with an intensity radius 0..1; `neutral` is the dead center
 * (angle 0, intensity 0). Gestures (wave, point-other, …) are discrete IDs
 * that live off the wheel entirely — in the original they were encoded as the
 * sentinel floats EM_WAVE=1001 etc. We keep them as named tags instead.
 *
 * Order matches avatario.cpp `emStrings`/`emFloats` (indices 0–17).
 */

export const WHEEL_EMOTIONS = [
  "happy",
  "coy",
  "bored",
  "scared",
  "sad",
  "angry",
  "shout",
  "laugh",
] as const;

export type WheelEmotion = (typeof WHEEL_EMOTIONS)[number];

export const GESTURES = [
  "wave",
  "pointother",
  "pointself",
  "doublepoint",
  "shrug",
] as const;

export type Gesture = (typeof GESTURES)[number];

export const WALKS = ["walk1", "walk2", "walk3"] as const;
export type Walk = (typeof WALKS)[number];

export type EmotionName = WheelEmotion | "neutral" | Gesture | Walk;

/** All emotion names in the fixed manifest order (avatario.cpp indices 0–17). */
export const EMOTION_NAMES: readonly EmotionName[] = [
  "happy",
  "coy",
  "bored",
  "scared",
  "sad",
  "angry",
  "shout",
  "laugh",
  "neutral",
  "wave",
  "pointother",
  "pointself",
  "doublepoint",
  "shrug",
  "walk1",
  "walk2",
  "walk3",
];

const GESTURE_SET = new Set<string>(GESTURES);
const WALK_SET = new Set<string>(WALKS);

export function isGesture(name: EmotionName): name is Gesture {
  return GESTURE_SET.has(name);
}

export function isWalk(name: EmotionName): name is Walk {
  return WALK_SET.has(name);
}

export function isWheelEmotion(name: EmotionName): name is WheelEmotion {
  return (WHEEL_EMOTIONS as readonly string[]).includes(name);
}

/**
 * Angle (radians) of a wheel emotion. `neutral`, gestures and walks have no
 * meaningful angle; callers should branch on `isWheelEmotion` first. We return
 * 0 for those so the value is always defined.
 */
export function angleOf(name: EmotionName): number {
  const idx = WHEEL_EMOTIONS.indexOf(name as WheelEmotion);
  if (idx < 0) return 0;
  return (idx * 2 * Math.PI) / 8;
}

/** Signed smallest difference between two angles, in (−π, π]. */
export function subtractAngles(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * A concrete point on the wheel (polar): the tuple the pose picker compares
 * against manifest poses. For gestures/walks `gesture` is set and the polar
 * fields are ignored.
 */
export interface WheelPoint {
  emotion: EmotionName;
  /** intensity radius 0..1 (0 for neutral/gestures). */
  intensity: number;
}

/** Convert a wheel point to Cartesian (r=intensity, θ=angle) for distance. */
export function toCartesian(p: WheelPoint): { x: number; y: number } {
  const a = angleOf(p.emotion);
  return { x: p.intensity * Math.cos(a), y: p.intensity * Math.sin(a) };
}
