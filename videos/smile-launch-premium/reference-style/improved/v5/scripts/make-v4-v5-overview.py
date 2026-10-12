from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


PROJECT = Path(__file__).resolve().parents[1]
COMPARE = PROJECT / "snapshots" / "v4-v5-compare"
OUTPUT = COMPARE / "paired-overview.png"
CASES = [
    ("Application handoff · 5.4s", "pair-00-at-5.4s.jpg"),
    ("Resume evidence match · 6.14s", "pair-01-at-6.14s.jpg"),
    ("Voice interview · 13.9s", "pair-02-at-13.9s.jpg"),
    ("HR evidence review · 17.5s", "pair-03-at-17.5s.jpg"),
    ("Candidate slot choice · 22.2s", "pair-06-at-22.2s.jpg"),
    ("Try Smile now · 24.8s", "pair-08-at-24.8s.jpg"),
]

pair_width = 960
pair_height = 270
header_height = 42
columns = 2
rows = (len(CASES) + columns - 1) // columns
sheet = Image.new("RGB", (pair_width * columns, (pair_height + header_height) * rows), "#f5f3f0")
draw = ImageDraw.Draw(sheet)
font_path = PROJECT / "assets" / "fonts" / "Manrope.ttf"
font = ImageFont.truetype(str(font_path), 21)

for index, (label, filename) in enumerate(CASES):
    pair = Image.open(COMPARE / filename).convert("RGB")
    pair = pair.resize((pair_width, pair_height), Image.Resampling.LANCZOS)
    column = index % columns
    row = index // columns
    x = column * pair_width
    y = row * (pair_height + header_height)
    draw.rectangle((x, y, x + pair_width, y + header_height), fill="#12243a")
    draw.text((x + 20, y + 9), label, font=font, fill="#ffffff")
    sheet.paste(pair, (x, y + header_height))

sheet.save(OUTPUT, optimize=True)
print(OUTPUT)
