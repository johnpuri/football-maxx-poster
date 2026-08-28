import { parseHighlightFromTitle } from "./src/ytParser.js";
const tests = [
 "UEFA EURO 2004 final: Greece 1-0 Portugal highlights",
 "Greece 1–0 Portugal 🏆 | UEFA Euro 2004 Final | Highlights & Goals | Road to Glory",
 "Greece 1 x 0 Portugal (Figo, Rui Costa) ●UEFA Euro 2004 Final Extended Goals & Highlights HD"
];
for(const t of tests){ console.log(t, "=>", parseHighlightFromTitle(t, {fallbackYear:2004, fallbackTournament:"Euro"}));}
// also test score with x: "1 x 0" should handle?
