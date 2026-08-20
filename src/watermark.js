/**
 * Watermark overlay: covers original watermark by overlaying Football Maxx page profile pic
 * + tournament header banner (logo + texts). Dynamic version supports any tournament.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { tournamentLogoMap, getTournamentLogoPath } from "./config.js";

export const WATERMARK_POS = "top-right"; // default
export const WATERMARK_SIZE = 80;
export const ENHANCED_WATERMARK_SIZE = 140;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return logo path for a tournament/year combo.
 * e.g. getTournamentLogo("EURO", 2008) -> "/tmp/EURO_2008_logo.png"
 * Falls back to /tmp/generic_logo.png if not mapped.
 */
export function getTournamentLogo(tournament, year) {
  if (getTournamentLogoPath) {
    const mapped = getTournamentLogoPath(tournament, year);
    if (mapped) return mapped;
  }
  // fallback convention
  const safeT = (tournament || "generic").toString().trim().replace(/\s+/g, "_");
  const safeY = year ? `_${year}` : "";
  const candidate = `/tmp/${safeT}${safeY}_logo.png`;
  if (fs.existsSync(candidate)) return candidate;
  // also try tournamentLogoMap direct lookup
  const key = `${safeT.toUpperCase()}${safeY ? "_" + year : ""}`;
  if (tournamentLogoMap[key] && fs.existsSync(tournamentLogoMap[key])) return tournamentLogoMap[key];
  if (tournamentLogoMap[safeT.toUpperCase()] && fs.existsSync(tournamentLogoMap[safeT.toUpperCase()])) return tournamentLogoMap[safeT.toUpperCase()];
  return "/tmp/generic_logo.png";
}

/**
 * Detection stub: returns watermark bounding box / overlay coords.
 * Hardcoded for top-right for now; extend later with vision API.
 * @returns {{x:string, y:number|string, w:number, h:number}}
 */
export function detectOriginalWatermark(input, opts = {}) {
  const pos = opts.watermarkPos || WATERMARK_POS;
  const size = opts.watermarkSize || ENHANCED_WATERMARK_SIZE;
  // top-right: overlay at W-w-5:5, watermark 140 wide, ~50 tall bbox
  if (pos === "top-right") return { x: "W-w-5", y: 5, w: size, h: 50 };
  if (pos === "top-left") return { x: "5", y: 5, w: size, h: 50 };
  if (pos === "bottom-right") return { x: "W-w-5", y: `H-h-5`, w: size, h: 50 };
  if (pos === "bottom-left") return { x: "5", y: `H-h-5`, w: size, h: 50 };
  return { x: "W-w-5", y: 5, w: size, h: 50 };
}

function escapeText(s) {
  // escape single quotes and colons for drawtext
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

function watermarkOverlayExpr(pos, size) {
  switch (pos) {
    case "top-right": return `W-w-5:5`;
    case "top-left": return `5:5`;
    case "bottom-right": return `W-w-5:H-h-5`;
    case "bottom-left": return `5:H-h-5`;
    default: return `W-w-5:5`;
  }
}

// ---------------------------------------------------------------------------
// Legacy simple watermark
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Dynamic watermark (new)
// ---------------------------------------------------------------------------
/**
 * Dynamic watermark with tournament header.
 * @param {string} input - input video path
 * @param {object} opts - {
 *   tournament:"EURO", year:2008, teamA:"Germany", teamB:"Spain", stage:"Final",
 *   logoPath:"/tmp/euro2008_logo.png", watermarkPath:"/tmp/page_profile.jpg",
 *   watermarkPos:"top-right", watermarkSize:140, watermarkAlpha:0.6,
 *   headerHeight:110, logoScaleH:100, logoPos:"left",
 *   crf:30, targetHeight:0, autoDetect:false, output:"/tmp/out.mp4"
 * }
 * Alternative legacy signature: applyDynamicWatermark(input, {output, ...})
 * Returns output path.
 */
export function applyDynamicWatermark(input, opts = {}) {
  const tournament = opts.tournament || "EURO";
  const year = opts.year || 2008;
  const teamA = opts.teamA || "Germany";
  const teamB = opts.teamB || "Spain";
  const stage = opts.stage || "Final";
  const logoPath = opts.logoPath || getTournamentLogo(tournament, year);
  const watermarkPath = opts.watermarkPath || opts.watermarkImg || "/tmp/page_profile.jpg";
  const output = opts.output || "/tmp/out_dynamic.mp4";

  const watermarkPos = opts.watermarkPos || "top-right";
  const watermarkSize = opts.watermarkSize || opts.size || ENHANCED_WATERMARK_SIZE;
  const watermarkAlpha = opts.watermarkAlpha ?? opts.alpha ?? 0.6;
  const headerHeight = opts.headerHeight || 110;
  const logoScaleH = opts.logoScaleH || 100;
  const logoPos = opts.logoPos || "left"; // left or right
  const crf = opts.crf || 30;
  const targetHeight = opts.targetHeight || 0;
  const fontFile = opts.fontFile || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

  // Dynamic texts
  const tournamentText = escapeText(`${tournament} ${year}`);
  const matchText = escapeText(`${teamA} vs ${teamB}`);
  const stageText = escapeText(stage);

  // Watermark position: if autoDetect, use detection stub coords
  let wmX, wmY;
  if (opts.autoDetect) {
    const det = detectOriginalWatermark(input, { watermarkPos, watermarkSize });
    wmX = det.x;
    wmY = det.y;
  } else {
    const expr = watermarkOverlayExpr(watermarkPos, watermarkSize);
    [wmX, wmY] = expr.split(":");
  }
  const overlayWm = `${wmX}:${wmY}`;

  // Logo overlay position
  const logoOverlay = logoPos === "right" ? `W-w-10:10` : `10:10`;

  let baseFilter;
  if (targetHeight && targetHeight > 0) {
    baseFilter = `[0:v]scale=-2:${targetHeight}:flags=lanczos[scaled];[scaled]drawbox=x=0:y=0:w=iw:h=${headerHeight}:color=black@0.6:t=fill[base]`;
  } else {
    baseFilter = `[0:v]drawbox=x=0:y=0:w=iw:h=${headerHeight}:color=black@0.6:t=fill[base]`;
  }

  const filter = [
    `[1:v]scale=${watermarkSize}:${watermarkSize}:flags=lanczos:force_original_aspect_ratio=increase,crop=${watermarkSize}:${watermarkSize},format=rgba,colorchannelmixer=aa=${watermarkAlpha}[wm]`,
    `[2:v]scale=-1:${logoScaleH}:flags=lanczos[logo]`,
    baseFilter,
    `[base][logo]overlay=${logoOverlay}[withlogo]`,
    `[withlogo]drawtext=fontfile=${fontFile}:text='${tournamentText}':x=(w-text_w)/2:y=12:fontsize=28:fontcolor=white[txt1]`,
    `[txt1]drawtext=fontfile=${fontFile}:text='${matchText}':x=(w-text_w)/2:y=42:fontsize=22:fontcolor=white[txt2]`,
    `[txt2]drawtext=fontfile=${fontFile}:text='${stageText}':x=(w-text_w)/2:y=68:fontsize=18:fontcolor=white[txt3]`,
    `[txt3][wm]overlay=${overlayWm}:format=auto`,
  ].join(";");

  const cmd = `ffmpeg -y -i "${input}" -i "${watermarkPath}" -i "${logoPath}" -filter_complex "${filter}" -c:v libx264 -crf ${crf} -preset fast -c:a aac -b:a 96k -movflags +faststart "${output}"`;

  if (opts.dryRun) {
    console.log("[dryRun] " + cmd);
    return { cmd, filter, output, opts: { tournament, year, teamA, teamB, stage, watermarkPos, watermarkSize, watermarkAlpha, headerHeight, logoScaleH } };
  }

  console.log(cmd);
  execSync(cmd, { stdio: "inherit" });
  return output;
}

// ---------------------------------------------------------------------------
// Legacy enhanced (backward compat) — delegates to dynamic
// ---------------------------------------------------------------------------
/**
 * Apply ENHANCED watermark: bigger profile pic (140x140) covering FIFA TV watermark
 * + top tournament header banner with logo and text.
 * Kept for backward compat; now delegates to applyDynamicWatermark.
 */
export function applyEnhancedWatermark(input, watermarkImg, logoImg, output, opts = {}) {
  // Parse legacy opts.tournament like "EURO 2008" -> tournament="EURO", year=2008
  let tournament = "EURO";
  let year = 2008;
  if (opts.tournament) {
    const m = String(opts.tournament).match(/^(.+?)\s+(\d{4})$/);
    if (m) { tournament = m[1].trim(); year = parseInt(m[2], 10); }
    else tournament = opts.tournament;
  }
  let teamA = "Germany", teamB = "Spain";
  if (opts.matchText && opts.matchText.includes("vs")) {
    const parts = opts.matchText.split("vs").map(s => s.trim());
    teamA = parts[0] || teamA; teamB = parts[1] || teamB;
  }
  // Support explicit teamA/teamB in opts as well
  if (opts.teamA) teamA = opts.teamA;
  if (opts.teamB) teamB = opts.teamB;
  if (opts.year) year = opts.year;

  return applyDynamicWatermark(input, {
    tournament, year, teamA, teamB,
    stage: opts.stage || "Final",
    logoPath: logoImg,
    watermarkPath: watermarkImg,
    output,
    crf: opts.crf,
    targetHeight: opts.targetHeight || 0,
    watermarkPos: opts.watermarkPos || "top-right",
    watermarkSize: opts.watermarkSize || 140,
    watermarkAlpha: opts.watermarkAlpha ?? 0.6,
    headerHeight: opts.headerHeight || 110,
    logoScaleH: opts.logoScaleH || 100,
    logoPos: opts.logoPos || "left",
    autoDetect: opts.autoDetect || false,
    dryRun: opts.dryRun || false,
  });
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
