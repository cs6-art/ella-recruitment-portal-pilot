from pathlib import Path
import os
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont


PROJECT = Path(__file__).resolve().parents[1]
V5 = PROJECT.parent / "v5"
V5_VIDEO = V5 / "renders" / "smile-recruitment-portal-v5-final.mp4"
V6_VIDEO = PROJECT / "renders" / "smile-recruitment-portal-v6-final.mp4"
OUTPUT_DIR = PROJECT / "snapshots" / "v5-v6-compare"
OVERVIEW = OUTPUT_DIR / "paired-overview.png"
CASES = [
    ("5.40s · Resume evidence begins", 5.40),
    ("6.14s · Evidence in transit", 6.14),
    ("6.90s · Linked criterion settles", 6.90),
    ("14.40s · Voice call winds down", 14.40),
    ("15.60s · Interview evidence handoff", 15.60),
    ("17.50s · HR reviews transcript + summary", 17.50),
    ("18.10s · Human decision controls", 18.10),
    ("20.50s · Available slots appear", 20.50),
    ("21.70s · Candidate choice, not booked", 21.70),
    ("24.80s · Stable CTA finish", 24.80),
]


def locate_ffmpeg() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        package_root = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
        candidates = list(package_root.glob("Gyan.FFmpeg*/ffmpeg*full_build/bin/ffmpeg.exe"))
        if candidates:
            return str(max(candidates, key=lambda item: item.stat().st_mtime))
    raise FileNotFoundError("FFmpeg was not found on PATH or in the WinGet Gyan.FFmpeg package.")


def load_font(size: int):
    font_path = PROJECT / "assets" / "fonts" / "Manrope.ttf"
    try:
        return ImageFont.truetype(str(font_path), size)
    except OSError:
        return ImageFont.load_default()


def capture(ffmpeg: str, source: Path, seconds: float, destination: Path) -> Image.Image:
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{seconds:.3f}",
            "-i",
            str(source),
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-vf",
            "scale=480:270:flags=lanczos",
            "-y",
            str(destination),
        ],
        check=True,
    )
    return Image.open(destination).convert("RGB")


def main() -> None:
    if not V5_VIDEO.exists() or not V6_VIDEO.exists():
        raise FileNotFoundError(f"Both encoded videos are required: {V5_VIDEO} and {V6_VIDEO}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ffmpeg = locate_ffmpeg()
    pair_width, image_height, header_height = 960, 270, 42
    pair_height = image_height + header_height
    pair_cards = []
    title_font = load_font(16)
    tag_font = load_font(15)

    for index, (label, seconds) in enumerate(CASES):
        v5_frame = capture(ffmpeg, V5_VIDEO, seconds, OUTPUT_DIR / f"v5-{seconds:.2f}s.png")
        v6_frame = capture(ffmpeg, V6_VIDEO, seconds, OUTPUT_DIR / f"v6-{seconds:.2f}s.png")
        pair = Image.new("RGB", (pair_width, pair_height), "#f5f3f0")
        draw = ImageDraw.Draw(pair)
        draw.rectangle((0, 0, pair_width, header_height), fill="#12243a")
        draw.text((16, 11), label, font=title_font, fill="#ffffff")
        pair.paste(v5_frame, (0, header_height))
        pair.paste(v6_frame, (480, header_height))
        overlay = Image.new("RGBA", (74, 27), "#12243aD9")
        overlay_draw = ImageDraw.Draw(overlay)
        overlay_draw.text((9, 5), "V5", font=tag_font, fill="#ffffff")
        pair.paste(overlay, (8, header_height + 8), overlay)
        overlay_v6 = Image.new("RGBA", (74, 27), "#12243aD9")
        overlay_draw = ImageDraw.Draw(overlay_v6)
        overlay_draw.text((9, 5), "V6", font=tag_font, fill="#ffffff")
        pair.paste(overlay_v6, (488, header_height + 8), overlay_v6)
        pair_path = OUTPUT_DIR / f"pair-{index:02d}-at-{seconds:.2f}s.png"
        pair.save(pair_path, optimize=True)
        pair_cards.append(pair)

    columns = 2
    rows = (len(pair_cards) + columns - 1) // columns
    sheet = Image.new("RGB", (pair_width * columns, pair_height * rows), "#f5f3f0")
    for index, card in enumerate(pair_cards):
        x = (index % columns) * pair_width
        y = (index // columns) * pair_height
        sheet.paste(card, (x, y))
    sheet.save(OVERVIEW, optimize=True)
    print(OVERVIEW)


if __name__ == "__main__":
    main()
