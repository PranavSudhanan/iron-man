"""
Makes a web backdrop (an sRGB JPG) from a Radiance .hdr sky, at a chosen exposure, without any tone
curve: the site's renderer tone-maps the backdrop itself, so baking a curve in would apply it twice.
  python tools/hdr_backdrop.py <in.hdr> <out.jpg> [exposure=1.0] [width=4096]
"""
import sys
import numpy as np
from PIL import Image


def read_hdr(path):
    data = open(path, 'rb').read()
    # header: lines up to a blank line, then the resolution line "-Y h +X w"
    end = data.index(b'\n\n') + 2
    nl = data.index(b'\n', end)
    res = data[end:nl].split()
    h, w = int(res[1]), int(res[3])
    pos = nl + 1
    out = np.empty((h, w, 4), dtype=np.uint8)
    buf = memoryview(data)
    for y in range(h):
        if buf[pos] == 2 and buf[pos + 1] == 2 and (buf[pos + 2] << 8 | buf[pos + 3]) == w:
            pos += 4
            for c in range(4):
                x = 0
                row = out[y, :, c]
                while x < w:
                    n = buf[pos]; pos += 1
                    if n > 128:
                        n -= 128
                        row[x:x + n] = buf[pos]; pos += 1
                    else:
                        row[x:x + n] = np.frombuffer(buf[pos:pos + n], dtype=np.uint8); pos += n
                    x += n
        else:  # flat scanline
            out[y] = np.frombuffer(buf[pos:pos + w * 4], dtype=np.uint8).reshape(w, 4); pos += w * 4
    rgbe = out.astype(np.float32)
    scale = np.where(out[..., 3] > 0, np.ldexp(1.0, out[..., 3].astype(np.int32) - 136), 0.0).astype(np.float32)
    return rgbe[..., :3] * scale[..., None]


def to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    exposure = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
    width = int(sys.argv[4]) if len(sys.argv) > 4 else 4096
    img = read_hdr(src) * exposure
    im = Image.fromarray((to_srgb(img) * 255 + 0.5).astype(np.uint8))
    if im.width != width:
        im = im.resize((width, width // 2), Image.LANCZOS)
    im.save(dst, quality=88, optimize=True, progressive=True)
    lum = img.mean(axis=2)
    print(dst, im.size, 'median', float(np.median(lum)), 'p99', float(np.percentile(lum, 99)), 'max', float(lum.max()))
