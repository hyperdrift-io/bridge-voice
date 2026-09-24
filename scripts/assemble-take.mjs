#!/usr/bin/env node
// Assemble a take recorded by `mic-test.mjs --take <dir>` into a master: the 2x screencast frames at their own
// timestamps, the officer's replies placed where their audio began (cut where a barge-in stopped them) and the
// captain's utterances where they were spoken. ffmpeg only; no fonts needed (captions were rendered in the page).
//   node scripts/assemble-take.mjs <take-dir> <out.mp4> [--tail 1.5] [--head 0.3]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error("usage: assemble-take.mjs <take-dir> <out.mp4>"); process.exit(2); }
const flag = (n, d) => (process.argv.includes(n) ? Number(process.argv[process.argv.indexOf(n) + 1]) : d);
const take = JSON.parse(readFileSync(join(dir, "take.json"), "utf8"));
const frames = take.frames.filter((f) => existsSync(f.file));
if (frames.length < 2) { console.error("no frames"); process.exit(1); }
const t0 = Math.min(frames[0].t, ...take.replies.map((r) => r.at)) - flag("--head", 0.3);
const end = frames[frames.length - 1].t + flag("--tail", 1.5);

// Video: hold each frame until the next one arrived (Chrome paints on change, not on a clock), then CFR 30.
const list = frames.map((f, i) => `file '${resolve(f.file)}'\nduration ${(i + 1 < frames.length ? Math.max(frames[i + 1].t - f.t, 1 / 60) : end - f.t).toFixed(4)}`).join("\n") + `\nfile '${resolve(frames[frames.length - 1].file)}'`;
writeFileSync(join(dir, "frames.txt"), list);
const lead = Math.max(0, frames[0].t - t0); // silence and a still before the first frame is never needed: t0 is at or before the first frame

// Audio: every officer reply is 24 kHz mono PCM16, placed at its arrival time; every captain utterance a WAV at its scheduled time.
const inputs = [], delays = [];
take.replies.forEach((r, i) => {
  const secs = r.cut && r.interrupted ? Math.max(0.2, r.cut - r.at) : null; // a barge-in stopped playback there
  inputs.push("-f", "s16le", "-ar", "24000", "-ac", "1", ...(secs ? ["-t", secs.toFixed(3)] : []), "-i", join(dir, r.file));
  delays.push(Math.round((r.at - t0) * 1000));
});
const officers = take.replies.length;
take.captain.forEach((c) => { inputs.push(...(c.pcm ? ["-f", "s16le", "-ar", "24000", "-ac", "1"] : []), "-i", join(dir, c.file)); delays.push(Math.round((c.at - t0) * 1000)); });
const n = inputs.filter((a) => a === "-i").length;
// The officer's TTS already peaks near full scale (measured −3.4 dBFS raw); the captain's track sits a few dB lower.
const filter = [...Array(n)].map((_, i) => `[${i + 1}:a]aresample=48000,aformat=channel_layouts=mono,volume=${i < officers ? 1 : 1.3},adelay=${delays[i]}|${delays[i]}[a${i}]`).join(";") +
  `;${[...Array(n)].map((_, i) => `[a${i}]`).join("")}amix=inputs=${n}:normalize=0:duration=longest,apad,atrim=0:${(end - t0).toFixed(3)}[aout]`;
const video = ["-f", "concat", "-safe", "0", "-i", join(dir, "frames.txt")];
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...video, ...inputs, "-filter_complex", `[0:v]setpts=PTS-STARTPTS+${lead.toFixed(3)}/TB,scale=2560:1440:force_original_aspect_ratio=decrease,pad=2560:1440:(ow-iw)/2:(oh-ih)/2:color=#0b0f18,fps=30,format=yuv420p[v];${filter}`,
  "-map", "[v]", "-map", "[aout]", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", out], { stdio: "inherit" });
const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString().trim();
console.log(`→ ${out} (${Number(dur).toFixed(1)} s, ${frames.length} frames, ${take.replies.length} officer replies, ${take.captain.length} captain lines)`);
