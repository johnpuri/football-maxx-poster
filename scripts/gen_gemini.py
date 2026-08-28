import os, requests, base64, pathlib
from dotenv import load_dotenv
load_dotenv("/home/john/Desktop/dev/repos/InstaAutomation/.env")
key=os.getenv("GEMINI_API_KEY")
print("key", key[:10] if key else "none")
# Try gemini image generation via generateContent with image output
import json

# Use gemini-2.0-flash-preview-image-generation or gemini-2.0-flash-exp
models = ["gemini-2.0-flash-preview-image-generation", "gemini-2.0-flash-exp", "gemini-2.0-flash"]
prompt = "Oil painting masterpiece of Diego Maradona 'Hand of God' goal, 1986 FIFA World Cup quarter-final, Argentina vs England, Estadio Azteca Mexico City, 22 June 1986, 51st minute, Maradona punching the ball past Peter Shilton, dramatic stadium lighting, vintage 1980s football atmosphere, crowd in background, highly detailed brushstrokes, epic historical sports moment, 4:5 portrait aspect ratio, cinematic oil on canvas"

for model in models:
    print(f"\nTrying model {model}...")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}
    }
    try:
        r=requests.post(url, json=payload, timeout=60)
        print("status", r.status_code)
        print(r.text[:2000])
        if r.ok:
            j=r.json()
            # look for inlineData
            candidates=j.get("candidates",[])
            for c in candidates:
                for p in c.get("content",{}).get("parts",[]):
                    if "inlineData" in p:
                        data=p["inlineData"]["data"]
                        mime=p["inlineData"].get("mimeType","image/png")
                        ext="png" if "png" in mime else "jpg"
                        out=f"/tmp/maradona_hand_of_god.{ext}"
                        open(out,"wb").write(base64.b64decode(data))
                        print(f"Saved {out} {len(data)}")
                        break
            break
    except Exception as e:
        print(e)
