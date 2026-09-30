"""
Converts a GLB's KHR_materials_pbrSpecularGlossiness materials to metal/rough *properly* (colour of metals lives
in the specular map in that workflow, not in the diffuse), writing a new GLB with PNG images; run
compress_glb.py on the result to shrink it.

    python tools/sg_to_mr.py <in.glb> <out.glb>
"""
import io
import json
import struct
import sys

from PIL import Image, ImageChops

src, dst = sys.argv[1], sys.argv[2]
data = open(src, 'rb').read()
off, doc, binc = 12, None, b''
while off < len(data):
    clen, ctype = struct.unpack_from('<II', data, off)
    chunk = data[off + 8: off + 8 + clen]
    if ctype == 0x4E4F534A:
        doc = json.loads(chunk)
    else:
        binc = chunk
    off += 8 + clen

views, images, textures = doc['bufferViews'], doc['images'], doc['textures']
blobs = []  # new binary layout: list of bytes, one per bufferView (in order)
for v in views:
    s = v.get('byteOffset', 0)
    blobs.append(binc[s: s + v['byteLength']])


def img(tex_index):
    return Image.open(io.BytesIO(blobs[images[textures[tex_index]['source']]['bufferView']]))


def add_image(im):
    out = io.BytesIO()
    im.save(out, 'PNG')
    blobs.append(out.getvalue())
    views.append({'buffer': 0, 'byteLength': len(blobs[-1])})
    images.append({'bufferView': len(views) - 1, 'mimeType': 'image/png'})
    textures.append({'sampler': textures[0].get('sampler', 0), 'source': len(images) - 1})
    return len(textures) - 1


SG = 'KHR_materials_pbrSpecularGlossiness'
for m in doc['materials']:
    sg = m.get('extensions', {}).pop(SG, None)
    if not sg:
        continue
    diff = img(sg['diffuseTexture']['index']).convert('RGB')
    spg = img(sg['specularGlossinessTexture']['index']).convert('RGBA')
    if spg.size != diff.size:
        spg = spg.resize(diff.size, Image.LANCZOS)
    spec = spg.convert('RGB')
    gloss = spg.getchannel('A')
    # base colour: dielectrics keep the diffuse, metals take their colour from the specular
    base = ImageChops.add(diff, spec)
    # metalness: how strong the specular is (dielectrics sit near 4%)
    lum = spec.convert('L').point(lambda v: max(0, min(255, int((v - 20) * 2.2))))
    gf = sg.get('glossinessFactor', 1)
    rough = gloss.point(lambda a: max(0, min(255, int(255 - a * gf))))
    zero = Image.new('L', diff.size, 255)
    mr = Image.merge('RGB', (zero, rough, lum))
    pbr = m.setdefault('pbrMetallicRoughness', {})
    pbr['baseColorTexture'] = {'index': add_image(base)}
    pbr['metallicRoughnessTexture'] = {'index': add_image(mr)}
    pbr['metallicFactor'] = 1.0
    pbr['roughnessFactor'] = 1.0
    if not m['extensions']:
        del m['extensions']

for key in ('extensionsUsed', 'extensionsRequired'):
    if key in doc:
        doc[key] = [e for e in doc[key] if e != SG]
        if not doc[key]:
            del doc[key]

# drop images no longer referenced (the old spec/gloss) by leaving them: compress_glb shrinks them anyway
new_bin = bytearray()
for v, b in zip(views, blobs):
    while len(new_bin) % 4:
        new_bin.append(0)
    v['byteOffset'] = len(new_bin)
    v['byteLength'] = len(b)
    new_bin += b
while len(new_bin) % 4:
    new_bin.append(0)
doc['buffers'] = [{'byteLength': len(new_bin)}]
js = json.dumps(doc, separators=(',', ':')).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(new_bin)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(new_bin), 0x004E4942)); f.write(new_bin)
print('ok', dst)
