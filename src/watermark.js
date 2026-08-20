/**
 * Watermark overlay: covers original watermark by overlaying Football Maxx page profile pic
 * Uses ffmpeg: scale profile pic to 80x80 and overlay at top-right (W-w-10:10)
 * Also handles Euro 2008 final highlight download via yt-dlp fallback
 */
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

export const WATERMARK_POS = "top-right"; // W-w-10:10
export const WATERMARK_SIZE = 80;

/**
 * Apply Football Maxx profile pic as watermark to cover original watermark
 * @param {string} input - input video path
 * @param {string} watermarkImg - profile pic jpg/png path (/tmp/page_profile.jpg)
 * @param {string} output - output path
 * @param {object} opts - { size, x, y, crf, scale }
 */
export function applyWatermark(input, watermarkImg, output, opts = {}) {
  const size = opts.size || WATERMARK_SIZE;
  const crf = opts.crf || 23;
  const xExpr = "W-w-10";
  const yExpr = "10";
  // make watermark circular with rounded corners via scale + overlay; keep square for simplicity
  const filter = `[1:v]scale=${size}:${size}:flags=lanczos:force_original_aspect_ratio=increase,crop=${size}:${size},format=rgba[wm];[0:v][wm]overlay=${xExpr}:${yExpr}:format=yuv420`;
  const cmd = `ffmpeg -y -i "${input}" -i "${watermarkImg}" -filter_complex "${filter}" -c:v libx264 -crf ${crf} -preset veryfast -c:a aac -b:a 96k -movflags +faststart "${output}"`;
  console.log(cmd);
  execSync(cmd, { stdio: "inherit" });
  return output;
}

/**
 * Download Euro 2008 final highlight via yt-dlp search
 * @param {string} outPath - /tmp/euro2008.mp4
 * @returns {string} downloaded path
 */
export function downloadEuro2008(outPath = "/tmp/euro2008.mp4") {
  const queries = [
    "ytsearch1:Euro 2008 final Germany Spain 1-0 highlights",
    "ytsearch1:Spain Germany Euro 2008 final highlights Torres goal",
  ];
  for (const q of queries) {
    try {
      // --match-filter duration <180 if supported; fallback manual check
      const cmd = `yt-dlp --no-playlist --max-downloads 1 -f "bv*[height<=720]+ba/b[height<=720]/best" --merge-output-format mp4 -o "${outPath}" "${q}"`;
      console.log(cmd);
      execSync(cmd, { stdio: "inherit", timeout: 120000 });
      if (fs.existsSync(outPath)) {
        // verify duration
        const probe = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outPath}"`, { encoding: "utf8" }).trim();
        const dur = parseFloat(probe);
        console.log(`duration ${dur}s`);
        if (dur > 0 && dur <= 240) return outPath;
        console.warn(`duration ${dur}s >240, trying next`);
      }
    } catch (e) {
      console.warn("download failed for", q, e.message);
    }
  }
  throw new Error("Failed to download Euro 2008 highlight via yt-dlp");
}

export function reencodeForUpload(input, output, targetHeight = 540) {
  const cmd = `ffmpeg -y -i "${input}" -vf "scale=-2:${targetHeight}:flags=lanczos" -c:v libx264 -crf 30 -preset veryfast -c:a aac -b:a 96k -movflags +faststart "${output}"`;
  execSync(cmd, { stdio: "inherit" });
  return output;
}
