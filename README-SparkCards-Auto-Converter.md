# SparkCards Auto-Converter

This adds a GitHub Action that can turn uploaded STAR Card PDFs into the PNG images and `cards.json` files used by the SparkCards site.

## What changed in this version

You no longer need to create a CSV every time.

The converter will first look for a matching CSV. If it finds one, it uses it. If it does not find one, it will try to read the card IDs directly from the PDF text, using labels like:

```text
0a)
1b)
3F)
```

It then creates the PNGs and updates `cards.json` automatically.

## Normal workflow

Upload a PDF into the correct `incoming` folder:

```text
incoming/grade6/math/unit0-en.pdf
incoming/grade6/math/unit0-es.pdf
incoming/grade7/math/unit0-3-en.pdf
```

Then GitHub Actions runs and creates/updates:

```text
cards/grade6/math/cards.json
cards/grade6/math/images/0A_Q_en.png
cards/grade6/math/images/0A_A_en.png
```

## Naming rule for language

Use `-en` for English and `-es` or `-spanish` for Spanish.

Examples:

```text
unit0-en.pdf
unit0-es.pdf
unit0-spanish.pdf
```

## When should you still use a CSV?

Use a CSV when:

- the PDF has duplicate card IDs,
- the PDF card labels are missing or wrong,
- you want special titles,
- you want to control read-aloud text exactly,
- you want to replace an entire subject with only the cards in that upload.

CSV format:

```csv
cardId,unit,title
0A,Unit 0,Addition and Subtraction
0B,Unit 0,Multiplication
0C,Unit 0,Division
```

Optional columns:

```csv
questionReadAloudEn,answerReadAloudEn,questionReadAloudEs,answerReadAloudEs,replaceSubject
```

## Important limitation

This does **not** use image OCR. It reads embedded text from the PDF. This works well for PDFs exported from Google Docs. It may not work on scanned PDFs or screenshots.

If auto-detection fails, add a CSV next to the PDF with the same filename.

## GitHub upload steps

1. Upload this package to the root of your `sparkcards` GitHub repo.
2. Go to the **Actions** tab.
3. Enable workflows if GitHub asks.
4. Upload a PDF to an `incoming/gradeX/subject/` folder.
5. Wait for the action to run.
6. Check the generated files in `cards/gradeX/subject/`.

## Example

Upload:

```text
incoming/grade6/math/unit0-es.pdf
```

Generated:

```text
cards/grade6/math/images/0A_Q_es.png
cards/grade6/math/images/0A_A_es.png
cards/grade6/math/images/0B_Q_es.png
cards/grade6/math/images/0B_A_es.png
cards/grade6/math/cards.json
```
