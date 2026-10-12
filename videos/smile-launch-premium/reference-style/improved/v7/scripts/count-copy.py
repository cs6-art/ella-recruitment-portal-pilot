from __future__ import annotations

import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path


WORDS = re.compile(r"\b[\w]+(?:[’'-][\w]+)*\b", re.UNICODE)
SKIP = {"script", "style", "svg", "audio"}


class VisibleCopyParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in SKIP:
            self.skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in SKIP and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        text = " ".join(data.split())
        if text:
            self.parts.append(text)


def count(path: Path) -> tuple[int, int]:
    parser = VisibleCopyParser()
    parser.feed(path.read_text(encoding="utf-8"))
    return sum(len(WORDS.findall(part)) for part in parser.parts), len(parser.parts)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="Count text nodes in rendered HTML, excluding script/style/SVG/audio."
    )
    parser.add_argument(
        "files",
        nargs="*",
        type=Path,
        default=[Path("../v6/index.html"), Path("index.html")],
    )
    args = parser.parse_args()
    results = [(path, *count(path)) for path in args.files]
    for path, words, nodes in results:
        print(f"{path}: {words} words across {nodes} text nodes")
    if len(results) >= 2:
        baseline = results[0][1]
        final = results[-1][1]
        reduction = (baseline - final) / baseline * 100 if baseline else 0
        print(f"Reduction: {baseline} to {final} words ({reduction:.1f}%)")


if __name__ == "__main__":
    main()
