import { createFacebookPost, presignUploadStrict, verifyPostPublished } from "/home/john/dev/football-maxx-poster/src/zernio.js";

const caption = `🎨 HAND OF GOD — The Most Controversial Goal in World Cup History 🇦🇷🏴󠁧󠁢󠁥󠁮󠁧󠁿

📅 22 June 1986 | 🏟️ Estadio Azteca, Mexico City
🏆 FIFA World Cup 1986 — Quarter-Final
⚔️ ARGENTINA 🇦🇷 2-1 ENGLAND 🏴󠁧󠁢󠁥󠁮󠁧󠁿

⏱️ 51st minute — With the score locked at 0-0, Diego Maradona leaps alongside England goalkeeper Peter Shilton to contest a looping pass. Replays clearly show Maradona punches the ball with his left fist into the net. Tunisian referee Ali Bin Nasser awards the goal. England protests furiously, but the goal stands.

Maradona later described it as scored "a little with the head of Maradona, and a little with the hand of God" — hence the immortal name: LA MANO DE DIOS.

Just FOUR minutes later, Maradona scores the "Goal of the Century" — dribbling from his own half past FIVE England players to make it 2-0. Gary Lineker pulls one back (81'), but Argentina hold on 2-1.

➡️ Argentina go on to WIN the 1986 World Cup, beating West Germany 3-2 in the Final. This quarter-final remains one of football's most iconic, debated, and unforgettable moments.

🖼️ Artwork: Classical oil painting recreation of the Hand of God moment — history on canvas.

What do YOU think — should VAR have ruled it out? 👇

#WorldCup #WorldCup1986 #Maradona #HandOfGod #Argentina #England #FootballHistory #ManoDeDios #FIFAWorldCup #ClassicFootball #DiegoMaradona #FootballMaxx #VintageFootball`;

const videoPath = "/tmp/maradona_final.mp4";
console.log("Uploading", videoPath);
const url = await presignUploadStrict(videoPath);
console.log("Uploaded URL:", url);
const result = await createFacebookPost({ content: caption, mediaUrls: [url], publishNow: true });
console.log("Post result:", JSON.stringify(result).slice(0,1500));
import { extractPostId } from "/home/john/dev/football-maxx-poster/src/zernio.js";
const pid = extractPostId(result);
console.log("Post ID:", pid);
if (pid) {
  const v = await verifyPostPublished(pid);
  console.log("Verified:", v.verified, v.reason);
}
