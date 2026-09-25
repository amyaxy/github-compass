"""一次性生成应用图标：icon.png(256) / icon.ico / tray.png(32)，罗盘风格。"""
import struct, zlib, os
from pathlib import Path

def png(size, pixels, path):
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + pixels[y*size[0]*4:(y+1)*size[0]*4] for y in range(size[1]))
    data = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size[0], size[1], 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
    open(path, 'wb').write(data)

def compass(n):
    px = bytearray()
    cx = cy = (n - 1) / 2
    R = n * 0.47
    for y in range(n):
        for x in range(n):
            dx, dy = x - cx, y - cy
            d = (dx*dx + dy*dy) ** 0.5
            if d > R:
                px += bytes([13, 17, 23, 0 if d > R + 0.6 else 255])
            elif d > R * 0.80:
                px += bytes([48, 54, 61, 255])
            elif abs(dx) < n * 0.035 and dy < 0:
                px += bytes([218, 54, 51, 255])   # north red
            elif abs(dx) < n * 0.035 and dy >= 0:
                px += bytes([63, 185, 80, 255])   # south green
            elif abs(dy) < n * 0.035:
                px += bytes([88, 166, 255, 255])  # E-W blue
            else:
                px += bytes([31, 111, 235, 255])
    return bytes(px)

out = str(Path(__file__).resolve().parents[1] / 'packages' / 'client' / 'resources')
os.makedirs(out, exist_ok=True)
png((256, 256), compass(256), os.path.join(out, 'icon.png'))
png((32, 32), compass(32), os.path.join(out, 'tray.png'))
p256 = open(os.path.join(out, 'icon.png'), 'rb').read()
ico_head = struct.pack('<HHH', 0, 1, 1)
# ICONDIRENTRY: width/height 256 以 0 表示；planes=1 bitCount=32；bytesInRes/offset
ico_head += struct.pack('<BBBBHHII', 0, 0, 0, 0, 1, 32, len(p256), 22)
ico = ico_head + p256
open(os.path.join(out, 'icon.ico'), 'wb').write(ico)
print('icons written:', os.listdir(out))
