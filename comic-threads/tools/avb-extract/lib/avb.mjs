// Comic Chat .avb container parser.
// Mirrors v1.0/client/avatario.cpp (LoadAvatarInfo / LoadFaceRecs /
// LoadTorsoRecs / LoadBodyRecs) and v1.0/client/avatario.h key constants.
// All integers are little-endian.

export const AF_MAGICNUM = 0x81;

// Keys (avatario.h)
const AK_NAME = 1;
const AK_FLAGS = 2;
const AK_ICON = 3;
const AK_NFACES = 4;
const AK_NTORSOS = 5;
const AK_STARTDATA = 6;
const AK_ENDDATA = 7;
const AK_STYLE = 8;
const AK_NBODIES = 9;

const AT_SIMPLE = 1;
const AT_COMPLEX = 2;

// Emotion index (0-17) -> manifest name.
// From avatario.cpp emStrings / emFloats: names lowercased without EM_ prefix.
// The three walk gestures (3QRWALK/SIDEWALK/3QFWALK) map to walk1/walk2/walk3
// per DESIGN.md §4.3. Index 0 (NULL slot) falls back to neutral.
export const EMOTION_NAMES = [
  'neutral',      // 0 (NULL / 0.0) -> neutral fallback
  'happy',        // 1
  'coy',          // 2
  'bored',        // 3
  'scared',       // 4
  'sad',          // 5
  'angry',        // 6
  'shout',        // 7
  'laugh',        // 8
  'neutral',      // 9
  'wave',         // 10
  'pointother',   // 11
  'pointself',    // 12
  'doublepoint',  // 13
  'shrug',        // 14
  'walk1',        // 15 (3QRWALK)
  'walk2',        // 16 (SIDEWALK)
  'walk3',        // 17 (3QFWALK)
];

function emotionName(index) {
  return EMOTION_NAMES[index] ?? 'neutral';
}

class Reader {
  constructor(buf) { this.buf = buf; this.p = 0; }
  u16() { const v = this.buf.readUInt16LE(this.p); this.p += 2; return v; }
  s16() { const v = this.buf.readInt16LE(this.p); this.p += 2; return v; }
  s32() { const v = this.buf.readInt32LE(this.p); this.p += 4; return v; }
  u8() { return this.buf[this.p++]; }
  cstr() {
    let s = '';
    while (this.p < this.buf.length) {
      const c = this.buf[this.p++];
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  skip(n) { this.p += n; }
}

/**
 * Parse a .avb buffer into a structured descriptor. No bitmap decoding here.
 * @param {Buffer} buf
 * @returns {{name:string, style:number, flags:number, type:'simple'|'complex',
 *   iconOffset:number, faces:Array, torsos:Array, bodies:Array}}
 */
export function parseAVB(buf) {
  const r = new Reader(buf);
  const magic = r.u16();
  if (magic !== AF_MAGICNUM) throw new Error(`bad magic 0x${magic.toString(16)}`);
  const avType = r.u16();
  r.u16(); // version

  const out = {
    name: null,
    style: 0,
    flags: 0,
    type: avType === AT_COMPLEX ? 'complex' : 'simple',
    iconOffset: 0,
    faces: [],
    torsos: [],
    bodies: [],
  };

  const loadBasics = (key) => {
    switch (key) {
      case AK_NAME: out.name = r.cstr(); return true;
      case AK_STYLE: out.style = r.u16() & 0xff; return true;
      case AK_FLAGS: out.flags = r.u16() & 0xff; return true;
      case AK_ICON: out.iconOffset = r.s32() >>> 0; return true;
    }
    return false;
  };

  // Reads the three offsets + ditto handling shared by all record kinds.
  let lastOffset = 0;
  const readPose = () => {
    const fgndOffset = r.s32() >>> 0;
    const transOffset = r.s32() >>> 0;
    const auraOffset = r.s32() >>> 0;
    const ditto = fgndOffset === lastOffset;
    if (!ditto) lastOffset = fgndOffset;
    return { fgndOffset, transOffset, auraOffset, ditto };
  };

  let guard = 0;
  while (guard++ < 10000) {
    if (r.p >= buf.length) throw new Error('unexpected EOF before AK_STARTDATA');
    const key = r.u16();
    if (loadBasics(key)) continue;

    if (key === AK_NFACES) {
      const n = r.s16();
      lastOffset = 0;
      for (let i = 0; i < n; i++) {
        const pose = readPose();
        const emotion = emotionName(r.s16());
        const intensity = r.u8() / 255;
        const xCX = r.s16();
        const yCX = r.s16();
        const dxCX = r.s16();
        const dyCX = r.s16();
        const faceX = r.s16() & 0xff;
        const faceY = r.s16() & 0xff;
        r.skip(16); // padding
        out.faces.push({ pose, emotion, intensity, xCX, yCX, dxCX, dyCX, faceX, faceY });
      }
    } else if (key === AK_NTORSOS) {
      const n = r.s16();
      lastOffset = 0;
      for (let i = 0; i < n; i++) {
        const pose = readPose();
        const emotion = emotionName(r.s16());
        const intensity = r.u8() / 255;
        const xCX = r.s16();
        const yCX = r.s16();
        r.skip(16);
        out.torsos.push({ pose, emotion, intensity, xCX, yCX });
      }
    } else if (key === AK_NBODIES) {
      const n = r.s16();
      lastOffset = 0;
      for (let i = 0; i < n; i++) {
        const pose = readPose();
        const emotion = emotionName(r.s16());
        const intensity = r.u8() / 255;
        const faceX = r.s16() & 0xff;
        const faceY = r.s16() & 0xff;
        r.skip(16);
        out.bodies.push({ pose, emotion, intensity, faceX, faceY });
      }
    } else if (key === AK_STARTDATA || key === AK_ENDDATA) {
      break;
    } else {
      throw new Error(`unknown key ${key} at offset ${r.p - 2}`);
    }
  }

  return out;
}
