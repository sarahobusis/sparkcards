#!/usr/bin/env python3
"""
SparkCards PDF converter

Expected upload layout:
  incoming/grade8/math/unit3-en.pdf
  incoming/grade8/math/unit3-en.csv   # optional

CSV columns, when you want to control names/order/text exactly:
  cardId,unit
  3A,Unit 3
  3B,Unit 3

Optional CSV columns:
  title
  questionReadAloudEn
  answerReadAloudEn
  questionReadAloudEs
  answerReadAloudEs
  replaceSubject   # put TRUE on any row to replace cards.json with only this CSV's cards

If there is no matching CSV, the converter tries to read card IDs directly
from the PDF labels, such as 0a), 1b), 3F), etc. This works best for
Google Docs PDFs because their text is embedded in the PDF. It does not
use image OCR.

The converter:
  - renders each PDF page at high resolution
  - detects long black table borders, not short fraction bars/underlines
  - crops question and answer boxes with safety padding
  - saves images into cards/gradeX/subject/images/
  - creates or updates cards/gradeX/subject/cards.json

This version is intentionally forgiving:
  - PDFs placed in the wrong incoming location are skipped with a warning
  - pages with no table are skipped with a warning
  - one bad PDF should not stop all other PDFs from converting
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import fitz  # PyMuPDF
import numpy as np
from PIL import Image


# ---------------------------------------------------------------------------
# TUNING CONSTANTS
# ---------------------------------------------------------------------------

# Higher render scale helps the converter distinguish real table borders from
# text, fraction bars, and underlines. If images are too large, lower to 2.25.
RENDER_ZOOM = 2.5

# Threshold for black/dark pixels.
DARK_PIXEL_THRESHOLD = 125

# A horizontal table border should be dark across most of the table width.
# This is the most important fix for the sliced-card problem.
MIN_HLINE_DARK_FRACTION_WITHIN_TABLE = 0.72

# A vertical border should be dark across a meaningful part of the page.
MIN_VLINE_DARK_FRACTION_FULL_PAGE = 0.22

# Table header row is usually QUESTION/ANSWER. At 2.5 zoom, this is usually
# about 55-80 px tall. This range catches it without confusing card rows.
HEADER_MAX_HEIGHT_PX = 130
HEADER_MIN_HEIGHT_PX = 25

# Ignore tiny accidental intervals.
MIN_CARD_HEIGHT_PX = 140
MIN_CARD_WIDTH_PX = 250

# Safety padding. These values are deliberately modest so we do not include
# neighboring cards, but enough to avoid chopping off text.
PAD_LEFT = 10
PAD_RIGHT = 10
PAD_TOP = 14
PAD_BOTTOM = 14

# Some pages may have a line right above the first card. Avoid pulling the
# QUESTION/ANSWER header into the crop by limiting top padding at header edges.
FIRST_CARD_TOP_PAD = 4

VALID_SUBJECTS = {"math", "science", "history"}


@dataclass
class CardRow:
    card_id: str
    unit: str
    title: str = ""
    question_read_en: str = ""
    answer_read_en: str = ""
    question_read_es: str = ""
    answer_read_es: str = ""
    replace_subject: bool = False


@dataclass
class CropBox:
    page_index: int
    q_box_img: Tuple[int, int, int, int]
    a_box_img: Tuple[int, int, int, int]
    q_box_pdf: fitz.Rect
    a_box_pdf: fitz.Rect


# ---------------------------------------------------------------------------
# BASIC HELPERS
# ---------------------------------------------------------------------------

def normalize_card_id(value: str) -> str:
    value = str(value or "").strip().replace(")", "")
    value = re.sub(r"\s+", "", value)
    return value.upper()


def subject_folder_name(value: str) -> str:
    text = str(value or "").strip().lower().replace(" ", "-")
    if text == "mathematics":
        return "math"
    if text in {"sci"}:
        return "science"
    if text in {"social-studies", "socialstudies", "ss"}:
        return "history"
    return text


def infer_language(pdf_path: Path, rows: Optional[List[CardRow]] = None) -> str:
    name = pdf_path.stem.lower()
    if re.search(r"(^|[-_])(es|spanish|espanol|español)([-_]|$)", name):
        return "es"
    if rows and any(r.question_read_es or r.answer_read_es for r in rows):
        return "es"
    return "en"


def contiguous_groups(indices: np.ndarray) -> List[Tuple[int, int]]:
    if len(indices) == 0:
        return []

    groups: List[Tuple[int, int]] = []
    start = int(indices[0])
    prev = int(indices[0])

    for x in indices[1:]:
        x = int(x)
        if x == prev + 1:
            prev = x
        else:
            groups.append((start, prev))
            start = prev = x

    groups.append((start, prev))
    return groups


def group_centers(groups: Iterable[Tuple[int, int]]) -> List[int]:
    return [round((a + b) / 2) for a, b in groups]


def img_box_to_pdf_rect(box: Tuple[int, int, int, int], zoom: float) -> fitz.Rect:
    left, top, right, bottom = box
    return fitz.Rect(left / zoom, top / zoom, right / zoom, bottom / zoom)


def extract_text_in_rect(page: fitz.Page, rect: fitz.Rect) -> str:
    text = page.get_text("text", clip=rect, sort=True) or ""
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def extract_card_id_from_question_text(text: str) -> str:
    # Prefer the first few lines. The card label is usually the first visible text.
    for line in text.splitlines()[:6]:
        m = re.search(r"\b(\d+[A-Za-z]+\d*)\s*\)", line)
        if m:
            return normalize_card_id(m.group(1))

    m = re.search(r"\b(\d+[A-Za-z]+\d*)\s*\)", text)
    if m:
        return normalize_card_id(m.group(1))

    return ""


def remove_leading_card_label(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"^\s*\d+[A-Za-z]+\d*\s*\)?\s*", "", text).strip()
    return text


# ---------------------------------------------------------------------------
# CSV SUPPORT
# ---------------------------------------------------------------------------

def read_card_csv(csv_path: Path) -> List[CardRow]:
    rows: List[CardRow] = []

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        required = {"cardId", "unit"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{csv_path} is missing required columns: {sorted(missing)}")

        for raw in reader:
            card_id = normalize_card_id(raw.get("cardId", ""))
            if not card_id:
                continue

            rows.append(
                CardRow(
                    card_id=card_id,
                    unit=(raw.get("unit") or "").strip(),
                    title=(raw.get("title") or "").strip(),
                    question_read_en=(raw.get("questionReadAloudEn") or "").strip(),
                    answer_read_en=(raw.get("answerReadAloudEn") or "").strip(),
                    question_read_es=(raw.get("questionReadAloudEs") or "").strip(),
                    answer_read_es=(raw.get("answerReadAloudEs") or "").strip(),
                    replace_subject=(raw.get("replaceSubject") or "").strip().lower()
                    in {"true", "yes", "1", "y"},
                )
            )

    if not rows:
        raise ValueError(f"{csv_path} did not contain any card rows.")

    return rows


# ---------------------------------------------------------------------------
# PDF RENDERING + LINE DETECTION
# ---------------------------------------------------------------------------

def render_pdf_pages(pdf_path: Path, zoom: float = RENDER_ZOOM) -> List[Image.Image]:
    doc = fitz.open(str(pdf_path))
    pages: List[Image.Image] = []
    matrix = fitz.Matrix(zoom, zoom)

    for page in doc:
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        pages.append(img)

    doc.close()
    return pages


def detect_vertical_lines(img: Image.Image) -> List[int]:
    gray = np.asarray(img.convert("L"))
    dark = gray < DARK_PIXEL_THRESHOLD
    col_prop = dark.mean(axis=0)

    vertical = group_centers(
        contiguous_groups(np.where(col_prop > MIN_VLINE_DARK_FRACTION_FULL_PAGE)[0])
    )

    h, w = gray.shape
    return [x for x in vertical if 20 < x < w - 20]


def choose_three_verticals(verticals: List[int], width: int) -> Optional[Tuple[int, int, int]]:
    """Choose left border, middle divider, right border."""
    if len(verticals) < 3:
        return None

    verticals = sorted(verticals)
    best: Optional[Tuple[int, int, int]] = None
    best_score = -1e18

    for i in range(len(verticals)):
        for j in range(i + 1, len(verticals)):
            for k in range(j + 1, len(verticals)):
                left, mid, right = verticals[i], verticals[j], verticals[k]
                table_width = right - left

                if table_width < width * 0.45:
                    continue

                # Middle divider should be near the center of the table.
                center_penalty = abs(mid - (left + right) / 2)

                # Prefer a wide table and a centered divider.
                score = table_width - 0.35 * center_penalty

                if score > best_score:
                    best_score = score
                    best = (left, mid, right)

    return best


def detect_horizontal_table_lines(img: Image.Image, left: int, right: int) -> List[int]:
    """
    Detect rows that are dark across most of the actual table width.

    This is stricter than checking the whole page. It prevents short internal
    marks, underlines, fraction bars, number lines, or graph axes from being
    mistaken for table borders.
    """
    gray = np.asarray(img.convert("L"))
    dark = gray < DARK_PIXEL_THRESHOLD

    x0 = max(0, left + 6)
    x1 = min(gray.shape[1], right - 6)

    if x1 <= x0:
        return []

    row_prop = dark[:, x0:x1].mean(axis=1)
    horizontal = group_centers(
        contiguous_groups(np.where(row_prop > MIN_HLINE_DARK_FRACTION_WITHIN_TABLE)[0])
    )

    h = gray.shape[0]
    return [y for y in horizontal if 20 < y < h - 20]


def table_crop_intervals(horizontal: List[int]) -> List[Tuple[int, int, bool]]:
    """
    Convert detected horizontal table lines into card row intervals.

    Returns: (top, bottom, is_first_card_after_header)

    Each table usually starts:
      top border
      header bottom line
      card row 1 bottom line
      card row 2 bottom line
      ...
    """
    lines = sorted(horizontal)
    intervals: List[Tuple[int, int, bool]] = []

    i = 0
    while i < len(lines) - 1:
        gap = lines[i + 1] - lines[i]

        # Detect a QUESTION/ANSWER header row.
        if HEADER_MIN_HEIGHT_PX <= gap <= HEADER_MAX_HEIGHT_PX:
            header_bottom = lines[i + 1]
            j = i + 2
            is_first = True

            while j < len(lines):
                # If the next pair is another short header, a new table begins.
                if j + 1 < len(lines):
                    next_gap = lines[j + 1] - lines[j]
                    if HEADER_MIN_HEIGHT_PX <= next_gap <= HEADER_MAX_HEIGHT_PX:
                        break

                top = header_bottom if is_first else lines[j - 1]
                bottom = lines[j]

                if bottom - top >= MIN_CARD_HEIGHT_PX:
                    intervals.append((top, bottom, is_first))

                is_first = False
                j += 1

            i = max(j, i + 2)
        else:
            i += 1

    if not intervals:
        # No header row was found anywhere on this page. This happens when a
        # table continues onto a later page without redrawing the QUESTION/
        # ANSWER header strip, so there is no short header gap to anchor on.
        # Fall back to treating each pair of consecutive lines directly as a
        # card row border.
        for i in range(len(lines) - 1):
            top, bottom = lines[i], lines[i + 1]
            if bottom - top >= MIN_CARD_HEIGHT_PX:
                intervals.append((top, bottom, False))

    return intervals


def pad_crop_box(
    box: Tuple[int, int, int, int],
    width: int,
    height: int,
    *,
    first_card_after_header: bool = False,
) -> Tuple[int, int, int, int]:
    left, top, right, bottom = box

    top_pad = FIRST_CARD_TOP_PAD if first_card_after_header else PAD_TOP

    padded = (
        max(0, left - PAD_LEFT),
        max(0, top - top_pad),
        min(width, right + PAD_RIGHT),
        min(height, bottom + PAD_BOTTOM),
    )

    return padded


def find_crop_boxes(pdf_path: Path, zoom: float = RENDER_ZOOM) -> Tuple[List[CropBox], List[Image.Image]]:
    pages = render_pdf_pages(pdf_path, zoom=zoom)
    boxes: List[CropBox] = []

    for page_index, img in enumerate(pages):
        w, h = img.size

        vertical = detect_vertical_lines(img)
        triple = choose_three_verticals(vertical, w)

        if not triple:
            print(f"WARNING: No vertical table borders found on page {page_index + 1} of {pdf_path.name}.")
            continue

        left, mid, right = triple
        horizontal = detect_horizontal_table_lines(img, left, right)
        intervals = table_crop_intervals(horizontal)

        if not intervals:
            print(f"WARNING: No table crops found on page {page_index + 1} of {pdf_path.name}.")
            continue

        for top, bottom, is_first in intervals:
            q_raw = (left, top, mid, bottom)
            a_raw = (mid, top, right, bottom)

            q_box = pad_crop_box(q_raw, w, h, first_card_after_header=is_first)
            a_box = pad_crop_box(a_raw, w, h, first_card_after_header=is_first)

            if q_box[2] - q_box[0] < MIN_CARD_WIDTH_PX or q_box[3] - q_box[1] < MIN_CARD_HEIGHT_PX:
                print(
                    f"WARNING: Suspiciously small question crop on page {page_index + 1}: {q_box}. Skipping."
                )
                continue

            if a_box[2] - a_box[0] < MIN_CARD_WIDTH_PX or a_box[3] - a_box[1] < MIN_CARD_HEIGHT_PX:
                print(
                    f"WARNING: Suspiciously small answer crop on page {page_index + 1}: {a_box}. Skipping."
                )
                continue

            boxes.append(
                CropBox(
                    page_index=page_index,
                    q_box_img=q_box,
                    a_box_img=a_box,
                    q_box_pdf=img_box_to_pdf_rect(q_box, zoom),
                    a_box_pdf=img_box_to_pdf_rect(a_box, zoom),
                )
            )

    return boxes, pages


# ---------------------------------------------------------------------------
# AUTO CARD LIST FROM PDF TEXT
# ---------------------------------------------------------------------------

def make_rows_from_pdf(pdf_path: Path, crop_boxes: List[CropBox], language: str) -> Tuple[List[CardRow], List[str]]:
    doc = fitz.open(str(pdf_path))
    rows: List[CardRow] = []
    warnings: List[str] = []
    seen: Dict[str, int] = {}

    for idx, box in enumerate(crop_boxes, start=1):
        page = doc[box.page_index]
        q_text = extract_text_in_rect(page, box.q_box_pdf)
        a_text = extract_text_in_rect(page, box.a_box_pdf)
        card_id = extract_card_id_from_question_text(q_text)

        if not card_id:
            card_id = f"CARD{idx}"
            warnings.append(f"Could not read a card ID for crop #{idx}; named it {card_id}.")

        # Avoid duplicate filenames. Most duplicates are accidents, but this keeps
        # the action from overwriting. Example: 7D then 7D_2.
        if card_id in seen:
            seen[card_id] += 1
            new_id = f"{card_id}_{seen[card_id]}"
            warnings.append(f"Duplicate card ID {card_id} found; named the later copy {new_id}.")
            card_id = new_id
        else:
            seen[card_id] = 1

        unit_match = re.match(r"^(\d+)", card_id)
        unit = f"Unit {unit_match.group(1)}" if unit_match else "Unit"

        q_read = remove_leading_card_label(q_text)
        a_read = remove_leading_card_label(a_text)

        if language == "es":
            rows.append(
                CardRow(
                    card_id=card_id,
                    unit=unit,
                    question_read_es=q_read,
                    answer_read_es=a_read,
                )
            )
        else:
            rows.append(
                CardRow(
                    card_id=card_id,
                    unit=unit,
                    question_read_en=q_read,
                    answer_read_en=a_read,
                )
            )

    doc.close()
    return rows, warnings


# ---------------------------------------------------------------------------
# CARDS.JSON UPDATE
# ---------------------------------------------------------------------------

def load_existing_cards(cards_json: Path) -> List[Dict]:
    if not cards_json.exists():
        return []

    with cards_json.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        raise ValueError(f"{cards_json} must contain a JSON list.")

    return data


def card_sort_key(card: Dict) -> Tuple[int, str]:
    cid = normalize_card_id(card.get("id", ""))
    m = re.match(r"^(\d+)(.*)$", cid)
    if not m:
        return (999, cid)
    return (int(m.group(1)), m.group(2))


def update_cards_json(cards_json: Path, rows: List[CardRow], language: str) -> None:
    existing = [] if any(r.replace_subject for r in rows) else load_existing_cards(cards_json)
    by_id: Dict[str, Dict] = {
        normalize_card_id(c.get("id", "")): c for c in existing if c.get("id")
    }

    for row in rows:
        cid = row.card_id
        card = by_id.get(cid, {"id": cid})

        if row.unit:
            card["unit"] = row.unit
        else:
            card.setdefault("unit", "")

        if row.title:
            card["title"] = row.title
        else:
            card.setdefault("title", "")

        if language == "es":
            card["questionImageEs"] = f"images/{cid}_Q_es.png"
            card["answerImageEs"] = f"images/{cid}_A_es.png"
            card.setdefault("questionImageEn", "")
            card.setdefault("answerImageEn", "")
        else:
            card["questionImageEn"] = f"images/{cid}_Q_en.png"
            card["answerImageEn"] = f"images/{cid}_A_en.png"
            card.setdefault("questionImageEs", "")
            card.setdefault("answerImageEs", "")

        card.setdefault("acceptedAnswers", [])

        # Keep existing read-aloud if the new row does not provide one.
        card["questionReadAloudEn"] = row.question_read_en or card.get("questionReadAloudEn", "")
        card["answerReadAloudEn"] = row.answer_read_en or card.get("answerReadAloudEn", "")
        card["questionReadAloudEs"] = row.question_read_es or card.get("questionReadAloudEs", "")
        card["answerReadAloudEs"] = row.answer_read_es or card.get("answerReadAloudEs", "")

        by_id[cid] = card

    updated = sorted(by_id.values(), key=card_sort_key)
    cards_json.parent.mkdir(parents=True, exist_ok=True)

    with cards_json.open("w", encoding="utf-8") as f:
        json.dump(updated, f, indent=2, ensure_ascii=False)
        f.write("\n")


# ---------------------------------------------------------------------------
# MAIN PDF PROCESSING
# ---------------------------------------------------------------------------

def parse_incoming_path(pdf_path: Path) -> Optional[Tuple[str, str, str]]:
    """
    Return (grade_number, subject, relative_display_path), or None if the PDF is
    not inside incoming/gradeX/subject/.
    """
    parts = pdf_path.parts

    try:
        incoming_idx = parts.index("incoming")
        grade_part = parts[incoming_idx + 1]
        subject_part = parts[incoming_idx + 2]
    except Exception:
        return None

    grade_match = re.search(r"(\d+)", grade_part)
    if not grade_match:
        return None

    subject = subject_folder_name(subject_part)
    if subject not in VALID_SUBJECTS:
        return None

    return grade_match.group(1), subject, str(pdf_path)


def process_pdf(pdf_path: Path, cards_root: Path, require_csv: bool = False) -> bool:
    parsed = parse_incoming_path(pdf_path)

    if not parsed:
        print(
            f"WARNING: Skipping {pdf_path}. PDFs must be inside incoming/gradeX/subject/, "
            f"for example incoming/grade8/math/unit3-en.pdf."
        )
        return False

    grade, subject, _ = parsed
    csv_path = pdf_path.with_suffix(".csv")
    language = infer_language(pdf_path)

    crop_boxes, pages = find_crop_boxes(pdf_path)

    if not crop_boxes:
        print(f"WARNING: No card boxes detected in {pdf_path}. Skipping this PDF.")
        return False

    if csv_path.exists():
        rows = read_card_csv(csv_path)
        language = infer_language(pdf_path, rows)

        if len(crop_boxes) != len(rows):
            print(
                f"WARNING: Card count mismatch for {pdf_path.name}: detected {len(crop_boxes)} card boxes, "
                f"but {csv_path.name} lists {len(rows)} cards. Skipping this PDF so it does not misname cards."
            )
            return False

        print(f"Using CSV card list: {csv_path}")
    else:
        if require_csv:
            print(f"Skipping {pdf_path}: no matching CSV found at {csv_path}")
            return False

        rows, warnings = make_rows_from_pdf(pdf_path, crop_boxes, language)
        print(f"Auto-created card list from PDF text for {pdf_path}: {[r.card_id for r in rows]}")

        for warning in warnings:
            print("WARNING:", warning)

        # Helpful local/generated record. The current workflow may not commit this,
        # but it is useful in logs and if you ever choose to commit incoming CSVs.
        try:
            with csv_path.open("w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=["cardId", "unit", "title"])
                writer.writeheader()
                for row in rows:
                    writer.writerow({"cardId": row.card_id, "unit": row.unit, "title": row.title})
        except Exception as exc:
            print(f"WARNING: Could not write generated CSV {csv_path}: {exc}")

    if len(rows) != len(crop_boxes):
        print(
            f"WARNING: Internal mismatch for {pdf_path.name}: {len(rows)} rows but {len(crop_boxes)} crops. "
            f"Skipping this PDF."
        )
        return False

    subject_dir = cards_root / f"grade{grade}" / subject
    images_dir = subject_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    suffix = "es" if language == "es" else "en"

    for row, box in zip(rows, crop_boxes):
        img = pages[box.page_index]
        q_crop = img.crop(box.q_box_img)
        a_crop = img.crop(box.a_box_img)

        q_path = images_dir / f"{row.card_id}_Q_{suffix}.png"
        a_path = images_dir / f"{row.card_id}_A_{suffix}.png"

        q_crop.save(q_path, optimize=True)
        a_crop.save(a_path, optimize=True)

    update_cards_json(subject_dir / "cards.json", rows, language)
    print(f"Converted {len(rows)} cards from {pdf_path} into {subject_dir}")
    return True


def find_pdfs(incoming: Path) -> List[Path]:
    if not incoming.exists():
        return []
    return sorted(incoming.rglob("*.pdf"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--incoming", default="incoming", type=Path)
    parser.add_argument("--cards-root", default="cards", type=Path)
    parser.add_argument(
        "--require-csv",
        action="store_true",
        help="Skip PDFs that do not have a matching CSV.",
    )
    args = parser.parse_args()

    pdfs = find_pdfs(args.incoming)
    if not pdfs:
        print("No incoming PDFs found.")
        return

    converted = 0
    skipped = 0

    for pdf_path in pdfs:
        try:
            if process_pdf(pdf_path, args.cards_root, require_csv=args.require_csv):
                converted += 1
            else:
                skipped += 1
        except Exception as exc:
            # Do not allow one bad PDF to stop all other PDFs from converting.
            skipped += 1
            print(f"ERROR: Failed to process {pdf_path}: {exc}")

    print(f"Done. Converted {converted} PDF(s). Skipped {skipped} PDF(s).")

    # Exit successfully if at least one PDF converted. This helps avoid losing good
    # conversions because one old/misplaced PDF was still in incoming/.
    if converted == 0 and skipped > 0:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
