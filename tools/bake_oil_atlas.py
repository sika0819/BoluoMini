"""Pack CustomSRP albedo crops into public/oil/atlas.png (512, 4x4 cells).

Row 0 (top): sand, grass, rock, bark
Row 1: leaf, wood/planks, roof/wall-oil, flower
Row 2: masonry, (spare), (spare), (spare)
Sand is the rock tile's brush, retinted to the shoreline color — CustomSRP has no sand albedo.
"""
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2] / 'BoluoProjectNew' / 'CustomSRP' / 'Assets' / 'GameMain' / 'Environment' / 'Textures'
OUT = Path(__file__).resolve().parents[1] / 'public' / 'oil' / 'atlas.png'
CELL = 128

def crop(path: Path, mode: str) -> Image.Image:
    im = Image.open(path).convert(mode)
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return im.crop((left, top, left + side, top + side)).resize((CELL, CELL), Image.Resampling.LANCZOS)

def sand_from_rock(rock: Image.Image) -> Image.Image:
    gray = ImageOps.grayscale(rock)
    r = gray.point(lambda p: min(255, int(p * 1.18 + 18)))
    g = gray.point(lambda p: min(255, int(p * 0.98 + 8)))
    b = gray.point(lambda p: min(255, int(p * 0.62)))
    return Image.merge('RGBA', (r, g, b, Image.new('L', gray.size, 255)))

def main() -> None:
    rock = crop(ROOT / 'ShiTou_OilTile.png', 'RGB')
    tiles = {
        (0, 0): sand_from_rock(rock),
        (1, 0): crop(ROOT / 'T_Mountain_MossOilTile.png', 'RGB').convert('RGBA'),
        (2, 0): rock.convert('RGBA'),
        (3, 0): crop(ROOT / 'BarkOil' / 'PalmTrunk_Oil.png', 'RGB').convert('RGBA'),
        (0, 1): crop(ROOT / 'T_OakTree_Leaf_01_A.png', 'RGBA'),
        # Planks carry thicker brush ridges than Wood_1; Wall oil stands in for roof tiles.
        (1, 1): crop(ROOT / 'SuntailOilPaint' / 'Planks_Albedo_OilPaint.png', 'RGB').convert('RGBA'),
        (2, 1): crop(ROOT / 'SuntailOilPaint' / 'Wall_Albedo_OilPaint.png', 'RGB').convert('RGBA'),
        (3, 1): crop(ROOT / 'SuntailOilPaint' / 'Flower_OilPaint.png', 'RGBA'),
        (0, 2): crop(ROOT / 'SuntailOilPaint' / 'Masonry_1_Albedo_OilPaint.png', 'RGB').convert('RGBA'),
    }
    atlas = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
    for (col, row), tile in tiles.items():
        if tile.mode != 'RGBA':
            tile = tile.convert('RGBA')
        atlas.paste(tile, (col * CELL, row * CELL))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # 96-color octree keeps the leaf alpha and stays inside the main-package budget.
    atlas.quantize(colors=96, method=Image.Quantize.FASTOCTREE).save(OUT, optimize=True)
    leaf = tiles[(0, 1)].getchannel('A')
    hist = leaf.histogram()
    opaque = sum(hist[128:]) / (CELL * CELL)
    print(f'{OUT} {OUT.stat().st_size} bytes, leaf opaque {opaque:.2f}')

if __name__ == '__main__':
    main()
