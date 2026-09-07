#!/usr/bin/env python3
"""
SparkCards PDF converter

Expected upload layout:
  incoming/grade6/math/unit0-en.pdf
  incoming/grade6/math/unit0-en.csv   # optional

CSV columns, when you want to control names/order/text exactly:
  cardId,unit
  0A,Unit 0
  0B,Unit 0

Optional CSV columns:
  title
  questionReadAloudEn
  answerReadAloudEn
  questionReadAloudEs
  answerReadAloudEs
  replaceSubject   # put TRUE on any row to replace cards.json with only this CSV's cards

NEW: If there is no matching CSV, the converter will try to make the card list by
reading the card IDs printed in the question boxes, such as 0a), 1b), 3F), etc.
This works best for Google Docs PDFs because their text is embedded in the PDF.
It does not rely on image OCR.

The converter:
  - renders each PDF page
  - detects black table borders
  - crops question and answer boxes
  - reads card IDs from the top-left of question boxes when no CSV is provided
  - saves images into cards/gradeX/subject/images/
  - creates or updates cards/gradeX/subject/cards.json
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
class CropPair:
    q_image: Image.Image
    a_image: Image.Image
    q_text: str = ""
    a_text: str = ""


@dataclass
class CropBox:
    page_index: int
    q_box_img: Tuple[int, int, int, int]
    a_box_img: Tuple[int, int, int, int]
    q_box_pdf: fitz.Rect
    a_box_pdf: fitz.Rect
  
RENDER_SCALE = 2.5

PAD_LEFT = 20
PAD_RIGHT = 20
PAD_TOP = 40
PAD_BOTTOM = 24

MIN_HLINE_DARK_FRACTION = 0.40
MIN_VLINE_DARK_FRACTION = 0.40

def normalize_card_id(value: str) -> str:
    value = str(value or "").strip().replace(")", "")
    value = re.sub(r"\s+", "", value)
    return value.upper()


def subject_folder_name(value: str) -> str:
    return str(value).strip().lower().replace(" ", "-")


def infer_language(pdf_path: Path, rows: Optional[List[CardRow]] = None) -> str:
    name = pdf_path.stem.lower()
    if re.search(r"(^|[-_])(es|spanish|spanol|espanol)([-_]|$)", name):
        return "es"
    if rows and any(r.question_read_es or r.answer_read_es for r in rows):
        return "es"
    return "en"


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
                    replace_subject=(raw.get("replaceSubject") or "").strip().lower() in {"true", "yes", "1", "y"},
                )
            )
    if not rows:
        raise ValueError(f"{csv_path} did not contain any card rows.")
    return rows


def render_pdf_pages(pdf_path: Path, zoom: float = 2.0) -> List[Image.Image]:
    doc = fitz.open(str(pdf_path))
    pages: List[Image.Image] = []
    matrix = fitz.Matrix(zoom, zoom)
    for page in doc:
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        pages.append(img)
    doc.close()
    return pages


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


def detect_full_lines(img: Image.Image) -> Tuple[List[int], List[int]]:
    """Detect strong horizontal and vertical table-border lines."""
    gray = np.asarray(img.convert("L"))
    dark = gray < 115

    row_prop = dark.mean(axis=1)
    col_prop = dark.mean(axis=0)

    horizontal = group_centers(contiguous_groups(np.where(row_prop > 0.34)[0]))
    vertical = group_centers(contiguous_groups(np.where(col_prop > 0.30)[0]))

    h, w = gray.shape
    horizontal = [y for y in horizontal if 20 < y < h - 20]
    vertical = [x for x in vertical if 20 < x < w - 20]
    return horizontal, vertical


def choose_three_verticals(verticals: List[int], width: int) -> Optional[Tuple[int, int, int]]:
    if len(verticals) < 3:
        return None
    verticals = sorted(verticals)
    best = None
    best_score = -1.0
    for i in range(len(verticals)):
        for j in range(i + 1, len(verticals)):
            for k in range(j + 1, len(verticals)):
                left, mid, right = verticals[i], verticals[j], verticals[k]
                if right - left < width * 0.45:
                    continue
                center_score = -abs(mid - (left + right) / 2)
                width_score = right - left
                score = width_score + center_score * 0.2
                if score > best_score:
                    best_score = score
                    best = (left, mid, right)
    return best


def table_crop_intervals(horizontal: List[int]) -> List[Tuple[int, int]]:
    """
    Convert detected horizontal table lines into card row intervals.
    Recognizes each table by a short header row: top line -> header bottom.
    Then crops all row intervals below the header until the next table starts.
    """
    lines = sorted(horizontal)
    intervals: List[Tuple[int, int]] = []
    i = 0
    header_max_height = 90
    min_card_height = 80

    while i < len(lines) - 1:
        gap = lines[i + 1] - lines[i]
        if gap <= header_max_height:
            header_bottom = lines[i + 1]
            j = i + 2
            while j < len(lines):
                if j + 1 < len(lines) and (lines[j + 1] - lines[j]) <= header_max_height:
                    break
                top = header_bottom if j == i + 2 else lines[j - 1]
                bottom = lines[j]
                if bottom - top >= min_card_height:
                    intervals.append((top, bottom))
                j += 1
            i = max(j, i + 2)
        else:
            i += 1
    return intervals


def pad_box(box: Tuple[int, int, int, int], pad: int, width: int, height: int) -> Tuple[int, int, int, int]:
    left, top, right, bottom = box
    return (
        max(0, left - pad),
        max(0, top - pad),
        min(width, right + pad),
        min(height, bottom + pad),
    )


def img_box_to_pdf_rect(box: Tuple[int, int, int, int], zoom: float) -> fitz.Rect:
    left, top, right, bottom = box
    return fitz.Rect(left / zoom, top / zoom, right / zoom, bottom / zoom)


def extract_text_in_rect(page: fitz.Page, rect: fitz.Rect) -> str:
    # Sort tends to preserve top-to-bottom reading order inside each card box.
    text = page.get_text("text", clip=rect, sort=True) or ""
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def extract_card_id_from_question_text(text: str) -> str:
    # Prefer the first line, because the printed card label is usually the first text.
    # Accept: 0a), 0A), 4A), 5A2) etc.
    for line in text.splitlines()[:4]:
        m = re.search(r"\b(\d+[A-Za-z]+\d*)\s*\)", line)
        if m:
            return normalize_card_id(m.group(1))
    m = re.search(r"\b(\d+[A-Za-z]+\d*)\s*\)", text)
    if m:
        return normalize_card_id(m.group(1))
    return ""


def remove_leading_card_label(text: str, card_id: str) -> str:
    # Remove a leading card ID like "0a)" from read-aloud text.
    if not text:
        return ""
    pattern = re.compile(r"^\s*" + re.escape(card_id[:-0] if False else card_id) + r"\s*\)?\s*", re.I)
    # Also handle lower-case original IDs.
    text = re.sub(r"^\s*\d+[A-Za-z]+\d*\s*\)?\s*", "", text).strip()
    return text


def find_crop_boxes(pdf_path: Path, zoom: float = 2.0) -> Tuple[List[CropBox], List[Image.Image]]:
    pages = render_pdf_pages(pdf_path, zoom=zoom)
    boxes: List[CropBox] = []
    for page_index, img in enumerate(pages):
        w, h = img.size
        horizontal, vertical = detect_full_lines(img)
        triple = choose_three_verticals(vertical, w)
        intervals = table_crop_intervals(horizontal)

        if not triple or not intervals:
            print(f"WARNING: No table crops found on page {page_index + 1} of {pdf_path.name}.")
            continue

        left, mid, right = triple
        for top, bottom in intervals:
            q_box = pad_box((left, top, mid, bottom), 4, w, h)
            a_box = pad_box((mid, top, right, bottom), 4, w, h)
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

        # Avoid duplicate filenames. Most duplicates are accidents, but this keeps the action from overwriting.
        if card_id in seen:
            seen[card_id] += 1
            new_id = f"{card_id}_{seen[card_id]}"
            warnings.append(f"Duplicate card ID {card_id} found; named the later copy {new_id}.")
            card_id = new_id
        else:
            seen[card_id] = 1

        unit_match = re.match(r"^(\d+)", card_id)
        unit = f"Unit {unit_match.group(1)}" if unit_match else "Unit"

        q_read = remove_leading_card_label(q_text, card_id)
        a_read = remove_leading_card_label(a_text, card_id)

        if language == "es":
            rows.append(CardRow(card_id=card_id, unit=unit, question_read_es=q_read, answer_read_es=a_read))
        else:
            rows.append(CardRow(card_id=card_id, unit=unit, question_read_en=q_read, answer_read_en=a_read))

    doc.close()
    return rows, warnings


def crop_pdf_cards(pdf_path: Path) -> List[CropPair]:
    boxes, pages = find_crop_boxes(pdf_path)
    doc = fitz.open(str(pdf_path))
    crops: List[CropPair] = []
    for box in boxes:
        img = pages[box.page_index]
        q_text = extract_text_in_rect(doc[box.page_index], box.q_box_pdf)
        a_text = extract_text_in_rect(doc[box.page_index], box.a_box_pdf)
        crops.append(CropPair(q_image=img.crop(box.q_box_img), a_image=img.crop(box.a_box_img), q_text=q_text, a_text=a_text))
    doc.close()
    return crops


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
    by_id: Dict[str, Dict] = {normalize_card_id(c.get("id", "")): c for c in existing if c.get("id")}

    for row in rows:
        cid = row.card_id
        card = by_id.get(cid, {"id": cid})
        card.setdefault("unit", row.unit)
        if row.unit:
            card["unit"] = row.unit
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


def process_pdf(pdf_path: Path, cards_root: Path, require_csv: bool = False) -> None:
    rel_parts = pdf_path.parts
    try:
        incoming_idx = rel_parts.index("incoming")
        grade_part = rel_parts[incoming_idx + 1]
        subject_part = rel_parts[incoming_idx + 2]
    except Exception as exc:
        raise ValueError(f"{pdf_path} must be inside incoming/gradeX/subject/") from exc

    grade_match = re.search(r"(\d+)", grade_part)
    if not grade_match:
        raise ValueError(f"Could not infer grade from folder name: {grade_part}")
    grade = grade_match.group(1)
    subject = subject_folder_name(subject_part)

    csv_path = pdf_path.with_suffix(".csv")
    language = infer_language(pdf_path)
    crop_boxes, pages = find_crop_boxes(pdf_path)

    if not crop_boxes:
        raise ValueError(f"No card boxes detected in {pdf_path}.")

    if csv_path.exists():
        rows = read_card_csv(csv_path)
        language = infer_language(pdf_path, rows)
        if len(crop_boxes) != len(rows):
            raise ValueError(
                f"Card count mismatch for {pdf_path.name}: detected {len(crop_boxes)} card boxes, "
                f"but {csv_path.name} lists {len(rows)} cards. Check the CSV order/count or the PDF table borders."
            )
        print(f"Using CSV card list: {csv_path}")
    else:
        if require_csv:
            print(f"Skipping {pdf_path}: no matching CSV found at {csv_path}")
            return
        rows, warnings = make_rows_from_pdf(pdf_path, crop_boxes, language)
        print(f"Auto-created card list from PDF text for {pdf_path.name}: {[r.card_id for r in rows]}")
        for warning in warnings:
            print("WARNING:", warning)
        # Save a generated CSV so you can review/edit it in GitHub if needed.
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with csv_path.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["cardId", "unit", "title"])
            writer.writeheader()
            for row in rows:
                writer.writerow({"cardId": row.card_id, "unit": row.unit, "title": row.title})

    subject_dir = cards_root / f"grade{grade}" / subject
    images_dir = subject_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    for row, box in zip(rows, crop_boxes):
        img = pages[box.page_index]
        suffix = "es" if language == "es" else "en"
        img.crop(box.q_box_img).save(images_dir / f"{row.card_id}_Q_{suffix}.png")
        img.crop(box.a_box_img).save(images_dir / f"{row.card_id}_A_{suffix}.png")

    update_cards_json(subject_dir / "cards.json", rows, language)
    print(f"Converted {len(rows)} cards from {pdf_path} into {subject_dir}")


def find_pdfs(incoming: Path) -> List[Path]:
    return sorted(incoming.rglob("*.pdf"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--incoming", default="incoming", type=Path)
    parser.add_argument("--cards-root", default="cards", type=Path)
    parser.add_argument("--require-csv", action="store_true", help="Skip PDFs that do not have a matching CSV.")
    args = parser.parse_args()

    pdfs = find_pdfs(args.incoming)
    if not pdfs:
        print("No incoming PDFs found.")
        return

    for pdf_path in pdfs:
        process_pdf(pdf_path, args.cards_root, require_csv=args.require_csv)


if __name__ == "__main__":
    main()
