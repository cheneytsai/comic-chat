/**
 * Deterministic, seedable PRNG used everywhere randomness is needed in the
 * engine (emotion tie-breaks, neutral-pose variety, balloon jitter, panel
 * seeds). Keeping all randomness here means a given Thread always composes to
 * the exact same comic, which is what the golden/determinism tests rely on.
 *
 * Implementation is mulberry32 seeded from a 32-bit string hash (a variant of
 * the classic djb2/xfnv mix). Fast, tiny, good enough for cosmetic jitter.
 */

/** Hash an arbitrary string to a 32-bit unsigned integer (deterministic). */
export function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Pick an element from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Float in [min, max). */
  range(min: number, max: number): number;
}

/** Create a PRNG from a numeric seed. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error("pick from empty array");
      return items[Math.floor(next() * items.length)] as T;
    },
    range: (min: number, max: number) => min + next() * (max - min),
  };
}

/** Create a PRNG seeded from a string (thread id + item index, etc.). */
export function rngFromString(...parts: (string | number)[]): Rng {
  return makeRng(hashString(parts.join("")));
}
