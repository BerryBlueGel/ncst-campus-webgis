"""Derive web-size icons from the supplied artwork, preserving its alpha and framing."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = root / 'web/public/branding'
output.mkdir(parents=True, exist_ok=True)
with Image.open(args.source) as original:
    assert original.width == original.height, 'Do not crop or distort non-square artwork'
    source = original.convert('RGBA')
    for size in [32, 128, 180]:
        icon = source.resize((size, size), Image.Resampling.LANCZOS)
        target = output / f'berrybluegel-v1-{size}.png'
        icon.save(target, optimize=True)
        with Image.open(target) as check:
            assert check.size == (size, size) and check.mode == 'RGBA'
            assert check.getchannel('A').getextrema() == (0, 255)
    ico = output / 'berrybluegel-v1.ico'
    source.resize((256, 256), Image.Resampling.LANCZOS).save(
        ico, sizes=[(s, s) for s in [16, 32, 48, 64, 128, 256]])
    with Image.open(ico) as check:
        assert check.ico.sizes() == {(s, s) for s in [16, 32, 48, 64, 128, 256]}
    # Conventional fallback for clients that request /favicon.ico without reading HTML.
    (root / 'web/public/favicon.ico').write_bytes(ico.read_bytes())
manifest = {
    'sourceFile': args.source.name,
    'sourceSha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
    'treatment': 'resize only; original framing and transparent background retained',
    'pngSizes': [32, 128, 180],
    'icoSizes': [16, 32, 48, 64, 128, 256],
}
(output / 'source.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps(manifest))
