# Project Vishwakarmaa — GitHub Mobile Import

## Why this package exists

Android file pickers often open a folder instead of selecting it recursively. GitHub's browser uploader also has a 100-file limit. This project therefore includes a single-file importer for mobile workflows.

## Recommended method for a new empty repository

1. Upload only `VISHWAKARMAA_IMPORT.sh` to the empty repository.
2. Open a GitHub Codespace for that repository.
3. In the Codespace terminal run:

```bash
bash VISHWAKARMAA_IMPORT.sh
```

4. Verify the restored tree, then commit and push:

```bash
git add -A
git commit -m "Import Project Vishwakarmaa V64"
git push origin main
```

The importer reconstructs the full directory hierarchy from one uploaded file and removes itself after extraction.
