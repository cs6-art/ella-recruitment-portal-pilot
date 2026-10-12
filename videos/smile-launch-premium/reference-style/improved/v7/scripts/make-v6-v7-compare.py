from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
V6_VIDEO = ROOT.parent / "v6" / "renders" / "smile-recruitment-portal-v6-final.mp4"
V7_VIDEO = ROOT / "renders" / "smile-recruitment-portal-v7-final.mp4"
SNAPSHOTS = ROOT / "snapshots"
REVIEW = ROOT / "review"

PAIRS = [
    ("01  Create role · published", 3.35, 3.25),
    ("02  Evidence linked", 6.90, 6.80),
    ("02  Invite sent after CV approval", 8.50, 8.80),
    ("03  Voice selected; Live Avatar alternative", 10.20, 10.80),
    ("03  Phone interview answer", 13.90, 13.80),
    ("04  HR evidence and decision", 18.30, 17.80),
    ("05  Selected · not booked", 21.75, 21.25),
    ("Try Smile now", 24.80, 24.80),
]

DETAIL_TIMES = [
    ("Role published", 3.25),
    ("Resume excerpt", 5.00),
    ("Evidence in transit", 5.90),
    ("Evidence matched", 6.75),
    ("HR approves CV", 7.70),
    ("HR sends invite", 8.20),
    ("Invite sent", 8.80),
    ("Voice selected", 10.80),
    ("Call answer", 13.80),
    ("Answer handoff", 15.20),
    ("AI summary", 16.90),
    ("HR approved", 18.90),
    ("Slot selected", 21.25),
    ("CTA settled", 22.85),
    ("CTA hold", 24.80),
]


def find_ffmpeg() -> str:
    found = shutil.which("ffmpeg")
    if found:
        return found
    local = Path(os.environ.get("LOCALAPPDATA", ""))
    candidates = sorted(
        (local / "Microsoft" / "WinGet" / "Packages").glob(
            "Gyan.FFmpeg*/*full_build/bin/ffmpeg.exe"
        ),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError("FFmpeg is required to extract encoded MP4 frames.")
    return str(candidates[0])


def extract(ffmpeg: str, video: Path, time: float, destination: Path) -> None:
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(video),
            "-ss",
            f"{time:.3f}",
            "-frames:v",
            "1",
            "-vf",
            "scale=720:405",
            "-y",
            str(destination),
        ],
        check=True,
    )


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def draw_compare_sheet(ffmpeg: str) -> Path:
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    label_width = 330
    frame_width, frame_height = 720, 405
    gutter = 20
    row_height = 444
    margin = 28
    width = margin * 2 + label_width + gutter + frame_width * 2 + gutter
    height = margin * 2 + 46 + len(PAIRS) * row_height
    sheet = Image.new("RGB", (width, height), "#f5f2ee")
    draw = ImageDraw.Draw(sheet)
    draw.text((margin, 18), "V6 → V7  |  Matched workflow moments", fill="#17243a", font=font(26, True))
    x6 = margin + label_width
    x7 = x6 + frame_width + gutter
    y0 = margin + 46
    draw.text((x6, margin + 14), "V6", fill="#596779", font=font(16, True))
    draw.text((x7, margin + 14), "V7", fill="#0069df", font=font(16, True))
    with tempfile.TemporaryDirectory(prefix="smile-v7-compare-") as temp:
        tempdir = Path(temp)
        for idx, (label, t6, t7) in enumerate(PAIRS):
            y = y0 + idx * row_height
            draw.text((margin, y + 16), label, fill="#17243a", font=font(17, True))
            draw.text((margin, y + 45), f"V6 {t6:.2f}s  →  V7 {t7:.2f}s", fill="#596779", font=font(14))
            img6_path = tempdir / f"v6-{idx}.png"
            img7_path = tempdir / f"v7-{idx}.png"
            extract(ffmpeg, V6_VIDEO, t6, img6_path)
            extract(ffmpeg, V7_VIDEO, t7, img7_path)
            with Image.open(img6_path) as im:
                sheet.paste(im.convert("RGB"), (x6, y))
            with Image.open(img7_path) as im:
                sheet.paste(im.convert("RGB"), (x7, y))
    output = SNAPSHOTS / "v6-v7-five-step-comparison.png"
    sheet.save(output, optimize=True)
    return output


def draw_v7_review_sheets(ffmpeg: str) -> tuple[Path, Path]:
    REVIEW.mkdir(parents=True, exist_ok=True)
    cell_w, cell_h = 384, 216
    caption_h = 32
    margin, gutter = 20, 12
    cols, rows = 5, 5
    one_second = Image.new(
        "RGB",
        (margin * 2 + cols * cell_w + (cols - 1) * gutter,
         margin * 2 + rows * (cell_h + caption_h) + (rows - 1) * gutter),
        "#f5f2ee",
    )
    inter_rows = (len(DETAIL_TIMES) + cols - 1) // cols
    interactions = Image.new(
        "RGB",
        (margin * 2 + cols * cell_w + (cols - 1) * gutter,
         margin * 2 + inter_rows * (cell_h + caption_h) + (inter_rows - 1) * gutter),
        "#f5f2ee",
    )
    draw_one = ImageDraw.Draw(one_second)
    draw_one.text((margin, 4), "V7 encoded review · one frame per second", fill="#17243a", font=font(20, True))
    draw_inter = ImageDraw.Draw(interactions)
    draw_inter.text((margin, 4), "V7 encoded review · key action moments", fill="#17243a", font=font(20, True))
    with tempfile.TemporaryDirectory(prefix="smile-v7-review-") as temp:
        tempdir = Path(temp)
        for t in range(25):
            sample_time = t + 0.5
            path = tempdir / f"second-{t:02d}.png"
            extract(ffmpeg, V7_VIDEO, sample_time, path)
            with Image.open(path) as im:
                thumb = im.convert("RGB").resize((cell_w, cell_h), Image.Resampling.LANCZOS)
            col, row = t % cols, t // cols
            x = margin + col * (cell_w + gutter)
            y = margin + 28 + row * (cell_h + caption_h + gutter)
            one_second.paste(thumb, (x, y))
            draw_one.text((x, y + cell_h + 4), f"{sample_time:.1f}s", fill="#46566d", font=font(14, True))
        for i, (label, sample_time) in enumerate(DETAIL_TIMES):
            path = tempdir / f"detail-{i:02d}.png"
            extract(ffmpeg, V7_VIDEO, sample_time, path)
            with Image.open(path) as im:
                thumb = im.convert("RGB").resize((cell_w, cell_h), Image.Resampling.LANCZOS)
            col, row = i % cols, i // cols
            x = margin + col * (cell_w + gutter)
            y = margin + 28 + row * (cell_h + caption_h + gutter)
            interactions.paste(thumb, (x, y))
            draw_inter.text((x, y + cell_h + 4), f"{sample_time:.2f}s · {label}", fill="#46566d", font=font(13, True))
    one_path = REVIEW / "v7-one-second-encoded-review.png"
    interaction_path = REVIEW / "v7-key-actions-encoded-review.png"
    one_second.save(one_path, optimize=True)
    interactions.save(interaction_path, optimize=True)
    return one_path, interaction_path


def main() -> None:
    for video in (V6_VIDEO, V7_VIDEO):
        if not video.exists():
            raise FileNotFoundError(video)
    ffmpeg = find_ffmpeg()
    print(f"Comparison: {draw_compare_sheet(ffmpeg)}")
    for output in draw_v7_review_sheets(ffmpeg):
        print(f"Review: {output}")


if __name__ == "__main__":
    main()
