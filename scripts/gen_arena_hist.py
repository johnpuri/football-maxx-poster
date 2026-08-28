from pathlib import Path
import sys
sys.path.insert(0, "/home/john/Desktop/dev/repos/InstaAutomation")
from src.clients.arena_image_client import ArenaImageGenerator

prompt = (
    "Epic oil painting masterpiece of Diego Maradona Hand of God goal, "
    "1986 FIFA World Cup quarter-final Argentina vs England, Estadio Azteca Mexico City, "
    "22 June 1986, Maradona jumping to punch the ball past English goalkeeper Peter Shilton, "
    "dramatic stadium atmosphere, crowd roaring, vintage 1980s football kits, "
    "highly detailed classical oil on canvas brushstrokes, dramatic lighting, cinematic composition, "
    "historical sports moment, museum quality painting"
)
gen = ArenaImageGenerator()
paths = gen.generate_and_save(prompt)
print("RESULT", paths)
