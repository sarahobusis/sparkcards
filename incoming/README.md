# Incoming STAR Card PDFs

Put PDFs here using this pattern:

```text
incoming/grade6/math/unit0-en.pdf
incoming/grade6/math/unit0-es.pdf
incoming/grade7/math/unit0-3-en.pdf
```

The converter can usually read card IDs like `0a)` directly from Google Docs PDFs.

Add a matching CSV only when you need to control the card list manually:

```text
incoming/grade6/math/unit0-en.csv
```

CSV format:

```csv
cardId,unit,title
0A,Unit 0,Addition and Subtraction
0B,Unit 0,Multiplication
```
