from pathlib import Path
from PIL import Image
import shutil

root = Path(__file__).resolve().parents[1]
source = root / "public-logo.png"
out = root / "build"
out.mkdir(exist_ok=True)
if not source.exists():
    raise SystemExit("public-logo.png is missing; add the MusicLover app logo first")

image = Image.open(source).convert("RGBA")
side = max(image.width, image.height)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.alpha_composite(image, ((side - image.width) // 2, (side - image.height) // 2))

iconset = out / "icon.iconset"
if iconset.exists():
    shutil.rmtree(iconset)
iconset.mkdir()
for size in (16, 32, 128, 256, 512):
    canvas.resize((size, size), Image.Resampling.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
    canvas.resize((size * 2, size * 2), Image.Resampling.LANCZOS).save(iconset / f"icon_{size}x{size}@2x.png")

canvas.resize((256, 256), Image.Resampling.LANCZOS).save(out / "icon.ico", format="ICO", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
