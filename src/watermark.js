/**
 * Watermark overlay: covers original watermark by overlaying Football Maxx page profile pic
 * Uses ffmpeg: scale profile pic to 80x80 and overlay at top-right (W-w-10:10)
 * Also handles Euro 2008 final highlight download via yt-dlp fallback
 * Enhanced version: bigger watermark (140) + tournament header banner
 */
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

export const WATERMARK_POS = "top-right"; // W-w-10:10
export const WATERMARK_SIZE = 80;
export const ENHANCED_WATERMARK_SIZE = 140;

export function applyWatermark(input, watermarkImg, output, opts = {}) {
  const size = opts.size || WATERMARK_SIZE;
  const crf = opts.crf || 23;
  const xExpr = "W-w-10";
  const yExpr = "10";
  const filter = `[1:v]scale=${size}:${size}:flags=lanczos:force_original_aspect_ratio=increase,crop=${size}:${size},format=rgba[wm];[0:v][wm]overlay=${xExpr}:${yExpr}:format=yuv420`;
  const cmd = `ffmpeg -y -i "${input}" -i "${watermarkImg}" -filter_complex "${filter}" -c:v libx264 -crf ${crf} -preset veryfast -c:a aac -b:a 96k -movflags +faststart "${output}"`;
  console.log(cmd);
  execSync(cmd, { stdio: "inherit" });
  return output;
}

/**
 * Apply ENHANCED watermark: bigger profile pic (140x140) covering FIFA TV watermark
 * + top tournament header banner with logo and text.
 * Logo keeps aspect ratio: scale=-1:70 (all tournaments same ratio logic)
 * @param {string} input - input video path
 * @param {string} watermarkImg - profile pic path (/tmp/page_profile.jpg)
 * @param {string} logoImg - tournament logo png path (/tmp/euro2008_logo.png)
 * @param {string} output - output path
 * @param {object} opts - { tournament, matchText, stage, crf, targetHeight }
 *   tournament e.g. "EURO 2008", matchText "Germany vs Spain", stage "Final"
 */
export function applyEnhancedWatermark(input, watermarkImg, logoImg, output, opts = {}) {
  const tournament = opts.tournament || "EURO 2008";
  const matchText = opts.matchText || "Germany vs Spain";
  const stage = opts.stage || "Final";
  const crf = opts.crf || 30;
  const targetHeight = opts.targetHeight || 0; // 0 = keep original, 540 = downscale
  const fontFile = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

  // If targetHeight set, scale input first via [0:v]scale
  // We use filter_complex: optionally scale base to 960:540-equivalent before drawbox
  // Safer: add scale as first filter on main stream if needed
  let baseFilter;
  let lastLabel = "base";
  if (targetHeight && targetHeight > 0) {
    baseFilter = `[0:v]scale=-2:${targetHeight}:flags=lanczos[scaled];[scaled]drawbox=x=0:y=0:w=iw:h=110:color=black@0.6:t=fill[base]`;
  } else {
    baseFilter = `[0:v]drawbox=x=0:y=0:w=iw:h=110:color=black@0.6:t=fill[base]`;
  }

  const filter = [
    `[1:v]scale=140:140:flags=lanczos:force_original_aspect_ratio=increase,crop=140:140,format=rgba,colorchannelmixer=aa=0.6[wm]`,
    `[2:v]scale=-1:100:flags=lanczos[logo]`,
    baseFilter,
    `[base][logo]overlay=10:10[withlogo]`,
    `[withlogo]drawtext=fontfile=${fontFile}:text='${tournament}':x=(w-text_w)/2:y=12:fontsize=28:fontcolor=white[txt1]`,
    `[txt1]drawtext=fontfile=${fontFile}:text='${matchText}':x=(w-text_w)/2:y=42:fontsize=22:fontcolor=white[txt2]`,
    `[txt2]drawtext=fontfile=${fontFile}:text='${stage}':x=(w-text_w)/2:y=68:fontsize=18:fontcolor=white[txt3]`,
    `[txt3][wm]overlay=W-w-5:5:format=auto`
  ].join(";");

  const cmd = `ffmpeg -y -i "${input}" -i "${watermarkImg}" -i "${logoImg}" -filter_complex "${filter}" -c:v libx264 -crf ${crf} -preset fast -c:a aac -b:a 96k -movflags +faststart "${output}"`;
  console.log(cmd);
  execSync(cmd, { stdio: "inherit" });
  return output;
}

export function downloadEuro2008(outPath = "/tmp/euro2008.mp4") {
  const queries = [
    "ytsearch1:Euro 2008 final Germany Spain 1-0 highlights",
    "ytsearch1:Spain Germany Euro 2008 final highlights Torres goal",
  ];
  for (const q of queries) {
    try {
      const cmd = `yt-dlp --no-playlist --max-downloads 1 -f "bv*[height<=720]+ba/b[height<=720]/best" --merge-output-format mp4 -o "${outPath}" "${q}"`;
      console.log(cmd);
      execSync(cmd, { stdio: "inherit", timeout: 120000 });
      if (fs.existsSync(outPath)) {
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
