// Windows DIB (BMP) decoder for Comic Chat .avb embedded bitmaps.
// Each pose bitmap is a complete BM file (BITMAPFILEHEADER + BITMAPINFOHEADER +
// palette + pixel data) stored at an absolute offset inside the .avb container.
// Mirrors v1.0/client/dib.cpp CDIB::Load / Convert8ToNonRLE / Convert4ToNonRLE.
//
// Supports 1/4/8 bpp palettized DIBs, BI_RGB / BI_RLE8 / BI_RLE4 compression,
// bottom-up (and top-down) rows with 4-byte row padding.

const BI_RGB = 0;
const BI_RLE8 = 1;
const BI_RLE4 = 2;

/**
 * @typedef {Object} DecodedDIB
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} rgb   top-down, row-major, length width*height*3
 */

/**
 * Decode a DIB stored at `off` inside `buf`.
 * @param {Buffer} buf
 * @param {number} off  absolute byte offset of the 'BM' file header
 * @returns {DecodedDIB}
 */
export function decodeDIB(buf, off) {
  if (off <= 0 || off + 14 + 40 > buf.length) {
    throw new Error(`DIB offset out of range: ${off}`);
  }
  const bfType = buf.readUInt16LE(off);
  if (bfType !== 0x4d42) {
    throw new Error(`bad DIB magic 0x${bfType.toString(16)} at ${off}`);
  }
  const bfSize = buf.readUInt32LE(off + 2);
  const bfOffBits = buf.readUInt32LE(off + 10);

  const ih = off + 14;
  const biSize = buf.readUInt32LE(ih);
  if (biSize !== 40) {
    throw new Error(`unsupported BITMAPINFOHEADER size ${biSize} at ${off}`);
  }
  const biWidth = buf.readInt32LE(ih + 4);
  const biHeightRaw = buf.readInt32LE(ih + 8);
  const biBitCount = buf.readUInt16LE(ih + 14);
  const biCompression = buf.readUInt32LE(ih + 16);
  let biClrUsed = buf.readUInt32LE(ih + 32);

  const width = biWidth;
  const topDown = biHeightRaw < 0;
  const height = Math.abs(biHeightRaw);
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) {
    throw new Error(`implausible DIB dimensions ${width}x${biHeightRaw} at ${off}`);
  }

  // Palette: entries between the info header and the pixel data.
  const palOff = ih + biSize;
  let palCount = Math.floor((bfOffBits - 14 - biSize) / 4);
  if (palCount <= 0 || palCount > 256) {
    palCount = biClrUsed > 0 ? biClrUsed : (biBitCount <= 8 ? (1 << biBitCount) : 0);
  }
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < palCount; i++) {
    const o = palOff + i * 4;
    // RGBQUAD: blue, green, red, reserved
    palette[i * 3] = buf[o + 2];
    palette[i * 3 + 1] = buf[o + 1];
    palette[i * 3 + 2] = buf[o];
  }

  const pixOff = off + bfOffBits;
  const pixEnd = off + (bfSize > bfOffBits ? bfSize : buf.length - off);

  // Decode to a native (bottom-up as stored) index grid, then flip if needed.
  const indices = new Uint8Array(width * height); // row 0 = top after normalization

  const putRow = (nativeRow) => topDown ? nativeRow : (height - 1 - nativeRow);

  if (biCompression === BI_RGB) {
    const bitsPerRow = width * biBitCount;
    const stride = ((bitsPerRow + 31) >> 5) << 2; // 4-byte aligned
    for (let ny = 0; ny < height; ny++) {
      const ty = putRow(ny);
      const rowStart = pixOff + ny * stride;
      for (let x = 0; x < width; x++) {
        let idx;
        if (biBitCount === 8) {
          idx = buf[rowStart + x];
        } else if (biBitCount === 4) {
          const b = buf[rowStart + (x >> 1)];
          idx = (x & 1) ? (b & 0x0f) : (b >> 4);
        } else if (biBitCount === 1) {
          const b = buf[rowStart + (x >> 3)];
          idx = (b >> (7 - (x & 7))) & 1;
        } else {
          throw new Error(`unsupported bit count ${biBitCount} at ${off}`);
        }
        indices[ty * width + x] = idx;
      }
    }
  } else if (biCompression === BI_RLE8) {
    decodeRLE8(buf, pixOff, pixEnd, width, height, indices, putRow);
  } else if (biCompression === BI_RLE4) {
    decodeRLE4(buf, pixOff, pixEnd, width, height, indices, putRow);
  } else {
    throw new Error(`unsupported compression ${biCompression} at ${off}`);
  }

  // Expand palette indices to RGB.
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const idx = indices[i];
    rgb[i * 3] = palette[idx * 3];
    rgb[i * 3 + 1] = palette[idx * 3 + 1];
    rgb[i * 3 + 2] = palette[idx * 3 + 2];
  }

  return { width, height, rgb };
}

function decodeRLE8(buf, start, end, width, height, indices, putRow) {
  let i = start;
  let x = 0, ny = 0;
  const put = (val) => {
    if (x < width && ny < height) indices[putRow(ny) * width + x] = val;
    x++;
  };
  while (i < end - 1 && ny < height) {
    const cnt = buf[i++];
    const val = buf[i++];
    if (cnt > 0) {
      for (let k = 0; k < cnt; k++) put(val);
    } else if (val === 0) {         // end of line
      x = 0; ny++;
    } else if (val === 1) {         // end of bitmap
      break;
    } else if (val === 2) {         // delta
      x += buf[i++];
      ny += buf[i++];
    } else {                        // absolute run
      for (let k = 0; k < val; k++) put(buf[i++]);
      if (val & 1) i++;             // pad to word boundary
    }
  }
}

function decodeRLE4(buf, start, end, width, height, indices, putRow) {
  let i = start;
  let x = 0, ny = 0;
  const put = (val) => {
    if (x < width && ny < height) indices[putRow(ny) * width + x] = val;
    x++;
  };
  while (i < end - 1 && ny < height) {
    const cnt = buf[i++];
    const val = buf[i++];
    if (cnt > 0) {
      for (let k = 0; k < cnt; k++) put((k & 1) ? (val & 0x0f) : (val >> 4));
    } else if (val === 0) {         // end of line
      x = 0; ny++;
    } else if (val === 1) {         // end of bitmap
      break;
    } else if (val === 2) {         // delta
      x += buf[i++];
      ny += buf[i++];
    } else {                        // absolute run of nibbles
      let read = 0;
      for (let k = 0; k < val; k++) {
        const b = buf[i + (k >> 1)];
        put((k & 1) ? (b & 0x0f) : (b >> 4));
        read++;
      }
      i += (read + 1) >> 1;
      // pad to word boundary (runs are padded to even number of bytes)
      const bytes = (val + 1) >> 1;
      if (bytes & 1) i++;
    }
  }
}
