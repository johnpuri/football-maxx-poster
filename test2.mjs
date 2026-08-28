const t = "Greece 1–0 Portugal 🏆 | UEFA Euro 2004 Final | Highlights & Goals | Road to Glory";
const scoreRegex = /([\p{L}0-9 .'\-]+?)\s+\d+\s*[-–—:]\s*\d+\s+([\p{L}0-9 .'\-]+?)(?:\s*[|\-–—:\(]|$)/u;
console.log(t.match(scoreRegex));
console.log([...t].map(c=>c.charCodeAt(0)));
