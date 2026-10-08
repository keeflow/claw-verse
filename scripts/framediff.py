"""帧差闪动检测：对比两张截图，定位 z-fighting 闪动区域。

用法: python framediff.py A.png B.png [阈值]
"""
import sys
import numpy as np
from PIL import Image

a_img = Image.open(sys.argv[1]).convert('RGB')
b_img = Image.open(sys.argv[2]).convert('RGB')
if a_img.size != b_img.size:
    b_img = b_img.resize(a_img.size)
thr = int(sys.argv[3]) if len(sys.argv) > 3 else 45

a = np.asarray(a_img, dtype=np.int16)
b = np.asarray(b_img, dtype=np.int16)
d = np.abs(a - b).max(axis=2)
big = d > thr
total = big.sum()
print(f'size={a_img.size} threshold={thr} big_pixels={total}')

if total:
    ys, xs = np.nonzero(big)
    print(f'y [{ys.min()},{ys.max()}]  x [{xs.min()},{xs.max()}]')
    # 行带分布
    bands = {}
    for y, x in zip(ys.tolist(), xs.tolist()):
        key = y // 60
        bands.setdefault(key, []).append((x, y))
    for k in sorted(bands):
        pts = bands[k]
        bx = [p[0] for p in pts]
        by = [p[1] for p in pts]
        print(f'band y{k*60}-{k*60+59}: n={len(pts)} x[{min(bx)},{max(bx)}]')
