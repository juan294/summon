#!/usr/bin/env bash
# optimize-gallery-images.sh
#
# Resizes gallery screenshots to 1600×900, converts to WebP + PNG fallback,
# and generates an OG image (1200×630) from fullstack-max.
#
# Dependencies: sips (macOS native), cwebp (libwebp)
# Usage: ./scripts/optimize-gallery-images.sh

set -euo pipefail

# --- Configuration ---
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$REPO_ROOT/content/workspace-layouts"
OUT_DIR="$REPO_ROOT/.gallery-build/images"
CWEBP="/usr/local/bin/cwebp"

RESIZE_W=1600
RESIZE_H=900
OG_W=1200
OG_H=630
WEBP_QUALITY=82

# --- Preflight checks ---
if [[ ! -d "$SRC_DIR" ]]; then
  echo "ERROR: Source directory not found: $SRC_DIR" >&2
  exit 1
fi

if [[ ! -x "$CWEBP" ]]; then
  echo "ERROR: cwebp not found at $CWEBP" >&2
  exit 1
fi

# --- Setup output directory ---
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "=== Gallery Image Optimization ==="
echo "Source: $SRC_DIR"
echo "Output: $OUT_DIR"
echo ""

# --- Process each source PNG ---
count=0
for src in "$SRC_DIR"/*.png; do
  filename="$(basename "$src")"
  # Strip leading number prefix: "01-fullstack-min.png" -> "fullstack-min.png"
  stripped="${filename#[0-9][0-9]-}"

  name="${stripped%.png}"

  echo "[$((count + 1))/20] Processing $filename -> $stripped"

  # 1. Copy source to temp for resizing (sips modifies in-place)
  tmp_png="$OUT_DIR/$stripped"
  cp "$src" "$tmp_png"

  # 2. Resize to 1600×900 using sips
  sips --resampleHeightWidth "$RESIZE_H" "$RESIZE_W" "$tmp_png" >/dev/null 2>&1

  # 3. Convert resized PNG to WebP
  "$CWEBP" -q "$WEBP_QUALITY" -quiet "$tmp_png" -o "$OUT_DIR/${name}.webp"

  count=$((count + 1))
done

echo ""
echo "=== Generating OG Image (${OG_W}×${OG_H}) ==="

# --- OG image from fullstack-max ---
OG_SOURCE="$SRC_DIR/02-fullstack-max.png"
OG_OUTPUT="$OUT_DIR/og-image.png"

if [[ ! -f "$OG_SOURCE" ]]; then
  echo "ERROR: OG source not found: $OG_SOURCE" >&2
  exit 1
fi

cp "$OG_SOURCE" "$OG_OUTPUT"
sips --resampleHeightWidth "$OG_H" "$OG_W" "$OG_OUTPUT" >/dev/null 2>&1

echo "Created og-image.png from fullstack-max"

# --- Summary ---
echo ""
echo "=== Summary ==="
total_files=$(find "$OUT_DIR" -type f | wc -l | tr -d ' ')
echo "Total files: $total_files"
echo ""

# Show file listing with sizes
ls -lhS "$OUT_DIR" | tail -n +2

echo ""
total_size=$(du -sh "$OUT_DIR" | cut -f1)
echo "Total output size: $total_size"
