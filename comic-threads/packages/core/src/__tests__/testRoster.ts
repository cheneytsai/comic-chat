import type { CharacterManifest, PoseRecord } from "../characters.js";
import { makeRoster, type Roster } from "../characters.js";
import { EMOTION_NAMES, isWheelEmotion } from "../emotion/wheel.js";

/** Build a synthetic simple manifest covering every emotion (for tests). */
function makeManifest(name: string): CharacterManifest {
  const bodies: PoseRecord[] = EMOTION_NAMES.filter(
    (e) => e !== "walk1" && e !== "walk2" && e !== "walk3",
  ).map((emotion) => ({
    image: `${emotion}.svg`,
    w: 160,
    h: 220,
    emotion,
    intensity: isWheelEmotion(emotion) ? 0.8 : 0,
    faceX: 80,
    faceY: 34,
  }));
  return { name, source: "test", type: "simple", iconImage: "icon.svg", bodies, basePath: `/characters/${name}` };
}

export function testRoster(): Roster {
  return makeRoster(["ada", "grace", "linus", "margaret", "alan"].map(makeManifest));
}
