# SparkCards Folder Setup — No Hidden Files Version

Upload the contents of this ZIP to the root of your `sparkcards` GitHub repo.

This version uses `placeholder.txt` instead of `.gitkeep`, because GitHub's web uploader may block hidden dotfiles.

It creates incoming folders for PDFs:

```text
incoming/grade5/math/
incoming/grade5/science/
incoming/grade5/history/
...
incoming/grade8/history/
```

It also creates matching card output folders:

```text
cards/grade5/math/images/
cards/grade5/science/images/
...
cards/grade8/history/images/
```

The `placeholder.txt` files are only there because GitHub does not save empty folders. You can delete each placeholder after that folder has real PDFs, images, or cards.json files.

When uploading new PDFs for the auto-converter, use names like:

```text
unit0-en.pdf
unit1-en.pdf
unit2-es.pdf
unit0-3-en.pdf
```

Good example:

```text
incoming/grade8/math/unit1-en.pdf
```
