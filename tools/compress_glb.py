"""
Shrinks a GLB's textures (the geometry and materials are kept exactly):

    python tools/compress_glb.py <in.glb> <out.glb> [max_size=2048] [jpeg_quality=85]

Every image is resized to at most max_size on its longest side and re-encoded: JPEG, or PNG when it has real
transparency. Materials using the old KHR_materials_pbrSpecularGlossiness extension (no longer supported by
three.js) are converted to metal/rough: the diffuse texture becomes the base colour.
"""
import io
import json
import struct
import sys

from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
MAX = int(sys.argv[3]) if len(sys.argv) > 3 else 2048
Q = int(sys.argv[4]) if len(sys.argv) > 4 else 85

data = open(src, 'rb').read()
magic, version, length = struct.unpack_from('<III', data, 0)
assert magic == 0x46546C67, 'not a GLB'
off = 12
doc = None
bin_chunk = b''
while off < length:
    clen, ctype = struct.unpack_from('<II', data, off)
    chunk = data[off + 8: off + 8 + clen]
    if ctype == 0x4E4F534A:
        doc = json.loads(chunk.decode('utf8'))
    elif ctype == 0x004E4942:
        bin_chunk = chunk
    off += 8 + clen

views = doc.get('bufferViews', [])
images = doc.get('images', [])
image_views = {im['bufferView']: i for i, im in enumerate(images) if 'bufferView' in im}

# which images are used as normal maps (keep more quality there)
normal_imgs = set()
for m in doc.get('materials', []):
    nt = m.get('normalTexture')
    if nt is not None:
        normal_imgs.add(doc['textures'][nt['index']].get('source'))


def encode(i, raw):
    im = Image.open(io.BytesIO(raw))
    im.load()
    w, h = im.size
    k = min(1.0, MAX / max(w, h))
    if k < 1:
        im = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    has_alpha = im.mode in ('RGBA', 'LA', 'P') and im.convert('RGBA').getextrema()[3][0] < 250
    out = io.BytesIO()
    if has_alpha:
        im.convert('RGBA').save(out, 'PNG', optimize=True)
        return out.getvalue(), 'image/png'
    im.convert('RGB').save(out, 'JPEG', quality=min(95, Q + 7) if i in normal_imgs else Q, optimize=True, progressive=False)
    return out.getvalue(), 'image/jpeg'


new_bin = bytearray()
before = after = 0
for vi, v in enumerate(views):
    start = v.get('byteOffset', 0)
    raw = bin_chunk[start: start + v['byteLength']]
    if vi in image_views:
        i = image_views[vi]
        before += len(raw)
        raw, mime = encode(i, raw)
        after += len(raw)
        images[i]['mimeType'] = mime
    while len(new_bin) % 4:
        new_bin.append(0)
    v['byteOffset'] = len(new_bin)
    v['byteLength'] = len(raw)
    new_bin += raw
while len(new_bin) % 4:
    new_bin.append(0)
doc['buffers'] = [{'byteLength': len(new_bin)}]

# spec/gloss -> metal/rough
SG = 'KHR_materials_pbrSpecularGlossiness'
for m in doc.get('materials', []):
    sg = m.get('extensions', {}).pop(SG, None)
    if sg is None:
        continue
    pbr = m.setdefault('pbrMetallicRoughness', {})
    if 'diffuseTexture' in sg:
        pbr['baseColorTexture'] = sg['diffuseTexture']
    if 'diffuseFactor' in sg:
        pbr['baseColorFactor'] = sg['diffuseFactor']
    pbr['metallicFactor'] = 0.55
    pbr['roughnessFactor'] = max(0.15, 1 - sg.get('glossinessFactor', 0.6))
    if not m['extensions']:
        del m['extensions']
for key in ('extensionsUsed', 'extensionsRequired'):
    if key in doc:
        doc[key] = [e for e in doc[key] if e != SG]
        if not doc[key]:
            del doc[key]

js = json.dumps(doc, separators=(',', ':')).encode('utf8')
js += b' ' * ((4 - len(js) % 4) % 4)
total = 12 + 8 + len(js) + 8 + len(new_bin)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(js), 0x4E4F534A))
    f.write(js)
    f.write(struct.pack('<II', len(new_bin), 0x004E4942))
    f.write(new_bin)
print(f'{src}: textures {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB; file {len(data) / 1e6:.1f} -> {total / 1e6:.1f} MB')
