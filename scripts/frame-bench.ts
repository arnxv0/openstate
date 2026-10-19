// Compare two handheld videos of the same scene with the pixel methods in
// lib/frame-diff.ts. Requires ffmpeg on PATH.
//
//   node scripts/frame-bench.ts before.mov after.mov [outDir]
//
// Prints (1) how much consecutive 500 ms samples differ inside each clip under
// the old naive diff vs. the aligned diff and dHash, (2) the best-matching
// frame pairs across the two clips, and (3) a per-block residual map for the
// best pair, written next to a side-by-side composite JPEG for eyeballing.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  alignedDifference,
  blockResidualMap,
  dHash,
  hamming,
  THUMB_H,
  THUMB_W,
} from "../lib/frame-diff.ts";

const [, , videoA, videoB, outArg] = process.argv;
if (!videoA || !videoB) {
  console.error("usage: node scripts/frame-bench.ts <videoA> <videoB> [outDir]");
  process.exit(1);
}
const out = outArg ?? join(tmpdir(), "openstate-frame-bench");
mkdirSync(out, { recursive: true });

const STEP_MS = 500;
const HI_W = 160;
const HI_H = 120;

function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
}

function frames(video: string, width: number, height: number, fps?: number) {
  const file = join(out, `${width}x${height}-${Math.random().toString(36).slice(2)}.raw`);
  const vf = `${fps ? `fps=${fps},` : ""}scale=${width}:${height}:flags=area,format=gray`;
  ffmpeg(["-i", video, "-vf", vf, "-f", "rawvideo", file]);
  const buffer = readFileSync(file);
  const size = width * height;
  const list: Uint8Array[] = [];
  for (let i = 0; i + size <= buffer.length; i += size) {
    list.push(new Uint8Array(buffer.buffer, buffer.byteOffset + i, size));
  }
  return list;
}

const fpsOf = (video: string) => {
  const text = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", video]).toString().trim();
  const [n, d] = text.split("/").map(Number);
  return n / (d || 1);
};

const naive = (a: Uint8Array, b: Uint8Array) => {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
};
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return `mean ${mean.toFixed(1).padStart(5)}  p50 ${q(0.5).toFixed(1).padStart(5)}  p90 ${q(0.9).toFixed(1).padStart(5)}  max ${s[s.length - 1].toFixed(1).padStart(5)}`;
};

type Clip = { name: string; fps: number; g16: Uint8Array[]; g32: Uint8Array[]; g48: Uint8Array[] };
const load = (video: string): Clip => ({
  name: video.split("/").pop() ?? video,
  fps: fpsOf(video),
  g16: frames(video, 16, 12),
  g32: frames(video, THUMB_W, THUMB_H),
  g48: frames(video, 48, 36),
});
const [A, B] = [load(videoA), load(videoB)];

console.log(`== Within each clip: consecutive samples ${STEP_MS} ms apart ==`);
for (const clip of [A, B]) {
  const step = Math.max(1, Math.round((clip.fps * STEP_MS) / 1000));
  const rows: Record<string, number[]> = {};
  const push = (key: string, value: number) => (rows[key] ??= []).push(value);
  const hashes = clip.g32.map((g) => dHash(g));
  for (let i = step; i < clip.g32.length; i += step) {
    push("naive 16x12 (old watcher)", naive(clip.g16[i - step], clip.g16[i]));
    push("aligned 32x24 ±2 (watcher)", alignedDifference(clip.g32[i - step], clip.g32[i], THUMB_W, THUMB_H, 2).delta);
    push("aligned 32x24 ±4", alignedDifference(clip.g32[i - step], clip.g32[i], THUMB_W, THUMB_H, 4).delta);
    push("aligned 48x36 ±6", alignedDifference(clip.g48[i - step], clip.g48[i], 48, 36, 6).delta);
    push("dHash bits", hamming(hashes[i - step], hashes[i]));
  }
  console.log(`-- ${clip.name} (${clip.g32.length} frames @ ${clip.fps.toFixed(0)} fps)`);
  for (const [key, values] of Object.entries(rows)) console.log(`  ${key.padEnd(28)} ${stats(values)}`);
}

console.log("\n== Across clips: best-matching frame in A for every 5th frame of B (aligned 48x36 ±6) ==");
const pairs: { b: number; a: number; delta: number; bits: number }[] = [];
for (let b = 0; b < B.g48.length; b += 5) {
  let best = { a: 0, delta: Infinity };
  for (let a = 0; a < A.g48.length; a += 2) {
    const { delta } = alignedDifference(B.g48[b], A.g48[a], 48, 36, 6);
    if (delta < best.delta) best = { a, delta };
  }
  pairs.push({ b, ...best, bits: hamming(dHash(B.g32[b]), dHash(A.g32[best.a])) });
}
pairs.sort((x, y) => x.delta - y.delta);
console.log("  " + pairs.slice(0, 8).map((p) => `B${p.b}~A${p.a} (${p.delta.toFixed(1)}, ${p.bits} bits)`).join("  "));
const best = pairs[0];

console.log(`\n== Block residual map for B${best.b} vs A${best.a} (${HI_W}x${HI_H}, blur 2, global ±12, per-block ±8) ==`);
const frameAt = (video: string, index: number, fps: number, name: string) => {
  const jpeg = join(out, `${name}.jpg`);
  ffmpeg(["-ss", (index / fps).toFixed(3), "-i", video, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3", jpeg]);
  const raw = join(out, `${name}.raw`);
  ffmpeg(["-i", jpeg, "-vf", `scale=${HI_W}:${HI_H}:flags=area,format=gray`, "-f", "rawvideo", raw]);
  return { jpeg, gray: new Uint8Array(readFileSync(raw)) };
};
const fa = frameAt(videoA, best.a, A.fps, "pair-a");
const fb = frameAt(videoB, best.b, B.fps, "pair-b");
const map = blockResidualMap(fa.gray, fb.gray, HI_W, HI_H);
const peak = Math.max(...map.blocks.flat());
console.log(`  global align ${map.align.dx},${map.align.dy}; hottest block ${peak.toFixed(0)}`);
for (const row of map.blocks) console.log("  " + row.map((v) => String(Math.round(v)).padStart(4)).join(""));

const heat = new Uint8Array(HI_W * HI_H);
map.blocks.forEach((row, r) =>
  row.forEach((v, c) => {
    for (let y = r * map.block; y < (r + 1) * map.block; y++) {
      for (let x = c * map.block; x < (c + 1) * map.block; x++) heat[y * HI_W + x] = Math.round((255 * v) / peak);
    }
  }),
);
const pgm = join(out, "heat.pgm");
writeFileSync(pgm, Buffer.concat([Buffer.from(`P5\n${HI_W} ${HI_H}\n255\n`), Buffer.from(heat)]));
const composite = join(out, "composite.jpg");
ffmpeg([
  "-i", fa.jpeg, "-i", fb.jpeg, "-i", pgm,
  "-filter_complex",
  "[0:v]scale=480:360:force_original_aspect_ratio=decrease,pad=480:360[a];[1:v]scale=480:360:force_original_aspect_ratio=decrease,pad=480:360[b];[2:v]scale=480:360:flags=neighbor,format=rgb24[h];[a][b][h]hstack=3",
  "-q:v", "3", composite,
]);
console.log(`\nwrote ${composite} (A | B | residual map; bright = unexplained by camera motion)`);
