"""
Downloads the CC0 (public domain) HDRIs and PBR textures from Poly Haven that the site uses, and prepares
them for the web:
  public/env/<id>.hdr        1k HDR, for image-based lighting (reflections and ambient light)
  public/env/<id>_bg.jpg     4096x2048 tonemapped sky, for the visible backdrop (only where a sky is seen)
  public/tex/<id>/{diff,nor,arm}.jpg   1k colour, OpenGL normal, and AO/roughness/metalness maps
Run: python tools/fetch_polyhaven.py
"""
import io, json, os, urllib.request
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public')
HDRIS = ['studio_small_08', 'machine_shop_02', 'industrial_workshop_foundry', 'venice_sunset', 'the_sky_is_on_fire', 'qwantani_moonrise_puresky']
# the night flight's backdrop is baked from the 4k HDR at a night exposure instead (Poly Haven's JPGs are brightened):
#   python tools/hdr_backdrop.py qwantani_moonrise_puresky_4k.hdr public/env/qwantani_moonrise_puresky_bg.jpg 0.16
BACKDROPS = ['venice_sunset', 'the_sky_is_on_fire']
TEXTURES = ['concrete_floor_worn_001', 'rock_wall_08', 'coast_sand_01', 'metal_plate', 'cliff_side', 'old_planks_02']


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'ironman-fan-site-asset-fetch'})
    with urllib.request.urlopen(req) as r:
        return r.read()


def info(asset):
    return json.loads(get(f'https://api.polyhaven.com/files/{asset}'))


os.makedirs(os.path.join(ROOT, 'env'), exist_ok=True)
for asset in HDRIS:
    d = info(asset)
    out = os.path.join(ROOT, 'env', f'{asset}.hdr')
    if not os.path.exists(out):
        open(out, 'wb').write(get(d['hdri']['1k']['hdr']['url']))
    print('hdr', asset, os.path.getsize(out))
    if asset in BACKDROPS:
        out = os.path.join(ROOT, 'env', f'{asset}_bg.jpg')
        if not os.path.exists(out):
            im = Image.open(io.BytesIO(get(d['tonemapped']['url']))).convert('RGB')
            im = im.resize((4096, 2048), Image.LANCZOS)
            im.save(out, quality=86, optimize=True, progressive=True)
        print('bg', asset, os.path.getsize(out))

for asset in TEXTURES:
    d = info(asset)
    folder = os.path.join(ROOT, 'tex', asset)
    os.makedirs(folder, exist_ok=True)
    for key, name in (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('arm', 'arm')):
        out = os.path.join(folder, f'{name}.jpg')
        if not os.path.exists(out):
            open(out, 'wb').write(get(d[key]['1k']['jpg']['url']))
        print('tex', asset, name, os.path.getsize(out))
