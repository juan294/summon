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

CWEBP="$(command -v cwebp)" || {
  echo "ERROR: cwebp not found. Install with: brew install webp" >&2
  exit 1
}

# --- Setup output directory ---
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# Count source files dynamically
files=("$SRC_DIR"/*.png)
total=${#files[@]}

echo "=== Gallery Image Optimization ==="
echo "Source: $SRC_DIR ($total files)"
echo "Output: $OUT_DIR"
echo ""

# --- Process each source PNG (parallel) ---
count=0
for src in "${files[@]}"; do
  filename="$(basename "$src")"
  stripped="${filename#[0-9][0-9]-}"
  name="${stripped%.png}"
  count=$((count + 1))

  echo "[$count/$total] $filename → $stripped"

  (
    # Resize directly from source to output (no intermediate copy)
    sips --resampleHeightWidth "$RESIZE_H" "$RESIZE_W" "$src" --out "$OUT_DIR/$stripped" >/dev/null 2>&1
    # Convert resized PNG to WebP
    "$CWEBP" -q "$WEBP_QUALITY" -quiet "$OUT_DIR/$stripped" -o "$OUT_DIR/${name}.webp"
  ) &
done

wait

# --- OG image from fullstack-max ---
echo ""
echo "=== Generating OG Image (${OG_W}×${OG_H}) ==="

OG_SOURCE=$(find "$SRC_DIR" -name '*fullstack-max*.png' | head -1)
if [[ -z "$OG_SOURCE" ]]; then
  echo "ERROR: No fullstack-max source found for OG image" >&2
  exit 1
fi

sips --resampleHeightWidth "$OG_H" "$OG_W" "$OG_SOURCE" --out "$OUT_DIR/og-image.png" >/dev/null 2>&1
echo "Created og-image.png from $(basename "$OG_SOURCE")"

# --- Summary ---
echo ""
echo "=== Summary ==="
echo "Total files: $(find "$OUT_DIR" -type f | wc -l)"
echo ""
ls -lhS "$OUT_DIR" | tail -n +2
echo ""
echo "Total output size: $(du -sh "$OUT_DIR" | cut -f1)"
