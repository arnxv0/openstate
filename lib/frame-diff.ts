// Cheap, dependency-free frame comparison shared by the dashboard watcher
// (browser) and the perception cache (server). Everything works on small
// grayscale thumbnails so a comparison costs tens of microseconds.

export const THUMB_W = 32;
export const THUMB_H = 24;

const HASH_W = 9;
const HASH_H = 8;

/** Weighted luma from RGBA pixel data (any size) into one byte per pixel. */
export function toGray(data: Uint8ClampedArray | Uint8Array, length: number) {
  const gray = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    gray[i] = (data[i * 4] * 3 + data[i * 4 + 1] * 6 + data[i * 4 + 2]) / 10;
  }
  return gray;
}

/**
 * Difference hash: box-downsample to 9x8, then emit one bit per horizontally
 * adjacent pair (left brighter than right). 64 bits as 16 hex chars. Robust
 * to exposure drift, JPEG noise and sub-pixel jitter; near-identical scenes
 * land within a few bits of each other.
 */
export function dHash(gray: Uint8Array, width = THUMB_W, height = THUMB_H) {
  const cellW = width / HASH_W;
  const cellH = height / HASH_H;
  const cells = new Float32Array(HASH_W * HASH_H);
  for (let cy = 0; cy < HASH_H; cy++) {
    const y0 = Math.floor(cy * cellH);
    const y1 = Math.max(y0 + 1, Math.floor((cy + 1) * cellH));
    for (let cx = 0; cx < HASH_W; cx++) {
      const x0 = Math.floor(cx * cellW);
      const x1 = Math.max(x0 + 1, Math.floor((cx + 1) * cellW));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) sum += gray[y * width + x];
      }
      cells[cy * HASH_W + cx] = sum / ((y1 - y0) * (x1 - x0));
    }
  }

  // 8 rows x 8 comparisons = 64 bits, kept as two 32-bit words (ES2017 target).
  let hi = 0;
  let lo = 0;
  for (let cy = 0; cy < HASH_H; cy++) {
    for (let cx = 0; cx < HASH_W - 1; cx++) {
      const bit = cells[cy * HASH_W + cx] > cells[cy * HASH_W + cx + 1] ? 1 : 0;
      if (cy < 4) hi = ((hi << 1) | bit) >>> 0;
      else lo = ((lo << 1) | bit) >>> 0;
    }
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

function popcount(x: number) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Number of differing bits between two dHash hex strings (0..64). */
export function hamming(a: string, b: string) {
  const ahi = parseInt(a.slice(0, 8), 16);
  const alo = parseInt(a.slice(8, 16), 16);
  const bhi = parseInt(b.slice(0, 8), 16);
  const blo = parseInt(b.slice(8, 16), 16);
  return popcount((ahi ^ bhi) >>> 0) + popcount((alo ^ blo) >>> 0);
}

export const NEAR_DUPLICATE_BITS = 4;

export function nearDuplicate(a: string, b: string, maxBits = NEAR_DUPLICATE_BITS) {
  return hamming(a, b) <= maxBits;
}

/** True when every hash in `hashes` has a near-duplicate in `known`. */
export function allCovered(hashes: string[], known: string[], maxBits = NEAR_DUPLICATE_BITS) {
  return hashes.every((hash) => known.some((other) => nearDuplicate(hash, other, maxBits)));
}

export type Alignment = { delta: number; dx: number; dy: number };

/**
 * Mean absolute difference between two thumbnails after sliding `b` over `a`
 * by up to `maxShift` pixels in each direction and keeping the offset with
 * the smallest difference over the overlapping region. A handheld phone that
 * drifts a few pixels scores near zero; a door opening or an item moving
 * still scores high because no translation explains it.
 */
export function alignedDifference(
  a: Uint8Array,
  b: Uint8Array,
  width = THUMB_W,
  height = THUMB_H,
  maxShift = 2,
): Alignment {
  let best: Alignment = { delta: Infinity, dx: 0, dy: 0 };
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    const y0 = Math.max(0, dy);
    const y1 = Math.min(height, height + dy);
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      const x0 = Math.max(0, dx);
      const x1 = Math.min(width, width + dx);
      let total = 0;
      for (let y = y0; y < y1; y++) {
        const rowA = y * width;
        const rowB = (y - dy) * width - dx;
        for (let x = x0; x < x1; x++) total += Math.abs(a[rowA + x] - b[rowB + x]);
      }
      const delta = total / ((y1 - y0) * (x1 - x0));
      if (delta < best.delta) best = { delta, dx, dy };
    }
  }
  return best;
}

/**
 * Fraction of 8x8 blocks whose aligned mean difference exceeds `blockThreshold`.
 * Complements `alignedDifference`: a global exposure change moves every block a
 * little (low fraction), a hand or an item moves a few blocks a lot.
 */
export function changedBlockFraction(
  a: Uint8Array,
  b: Uint8Array,
  { dx, dy }: Pick<Alignment, "dx" | "dy">,
  width = THUMB_W,
  height = THUMB_H,
  block = 8,
  blockThreshold = 24,
) {
  let blocks = 0;
  let changed = 0;
  for (let by = Math.max(0, dy); by + block <= Math.min(height, height + dy); by += block) {
    for (let bx = Math.max(0, dx); bx + block <= Math.min(width, width + dx); bx += block) {
      let total = 0;
      for (let y = by; y < by + block; y++) {
        for (let x = bx; x < bx + block; x++) {
          total += Math.abs(a[y * width + x] - b[(y - dy) * width + (x - dx)]);
        }
      }
      blocks++;
      if (total / (block * block) > blockThreshold) changed++;
    }
  }
  return blocks ? changed / blocks : 0;
}

/** Box blur; suppresses misaligned edges before comparing two different viewpoints. */
export function boxBlur(src: Uint8Array | Float32Array, width: number, height: number, radius: number) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let total = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) total += src[yy * width + xx];
      }
      out[y * width + x] = total / ((y1 - y0 + 1) * (x1 - x0 + 1));
    }
  }
  return out;
}

export type ResidualMap = { blocks: number[][]; block: number; align: Alignment };

/**
 * Localise what changed between two views of the same scene taken from
 * slightly different camera positions (two handheld fridge scans, say).
 *
 * 1. Blur both frames so edges that merely moved a pixel do not dominate.
 * 2. Find one global translation (±`search.global` px) for the whole frame.
 * 3. For every `block`x`block` tile of `a`, search a further ±`search.local`
 *    px around that offset in `b` and keep the best-matching residual.
 *
 * Tiles that can be explained by parallax find a match and score low; a tile
 * where an object appeared or vanished has no match anywhere and stays hot.
 * On the test fridge scans this made the removed cans the single hottest
 * tile, where a global-translation diff ranked them 7th behind door parallax.
 * Intended for 160x120 inputs; cost is roughly blocks x search² x block².
 */
export function blockResidualMap(
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
  { block = 16, blur = 2, search = { global: 12, local: 8 } } = {},
): ResidualMap {
  const fa = boxBlur(a, width, height, blur);
  const fb = boxBlur(b, width, height, blur);

  const residual = (bx: number, by: number, dx: number, dy: number) => {
    let total = 0;
    let count = 0;
    for (let y = by; y < by + block; y++) {
      const sy = y + dy;
      if (sy < 0 || sy >= height) continue;
      for (let x = bx; x < bx + block; x++) {
        const sx = x + dx;
        if (sx < 0 || sx >= width) continue;
        total += Math.abs(fa[y * width + x] - fb[sy * width + sx]);
        count++;
      }
    }
    return count > (block * block) / 2 ? total / count : Infinity;
  };

  let align: Alignment = { delta: Infinity, dx: 0, dy: 0 };
  for (let dy = -search.global; dy <= search.global; dy += 2) {
    for (let dx = -search.global; dx <= search.global; dx += 2) {
      let total = 0;
      let count = 0;
      for (let y = 0; y < height; y += 2) {
        const sy = y + dy;
        if (sy < 0 || sy >= height) continue;
        for (let x = 0; x < width; x += 2) {
          const sx = x + dx;
          if (sx < 0 || sx >= width) continue;
          total += Math.abs(fa[y * width + x] - fb[sy * width + sx]);
          count++;
        }
      }
      const delta = total / count;
      if (delta < align.delta) align = { delta, dx, dy };
    }
  }

  const blocks: number[][] = [];
  for (let by = 0; by + block <= height; by += block) {
    const row: number[] = [];
    for (let bx = 0; bx + block <= width; bx += block) {
      let best = Infinity;
      for (let oy = -search.local; oy <= search.local; oy += 2) {
        for (let ox = -search.local; ox <= search.local; ox += 2) {
          best = Math.min(best, residual(bx, by, align.dx + ox, align.dy + oy));
        }
      }
      row.push(best === Infinity ? 0 : best);
    }
    blocks.push(row);
  }
  return { blocks, block, align };
}
