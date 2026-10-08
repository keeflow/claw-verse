"""帧差闪动检测：对比两张截图，定位 z-fighting 闪动区域。

用法: python framediff.py A.png B.png [阈值]

两张截图应是同一冻结场景仅微转相机（Δaz ≈ 0.004rad）拍的。
3x3 腐蚀用于区分「边缘 AA / 1px 视差线」与「面状翻转」：
只有 3x3 邻域全部超阈值的像素才判定为面状闪动。
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
total = int(big.sum())
print(f'size={a_img.size} threshold={thr} big_pixels={total}')

if not total:
    sys.exit(0)

ys, xs = np.nonzero(big)
print(f'y [{ys.min()},{ys.max()}]  x [{xs.min()},{xs.max()}]')

# 3x3 腐蚀：邻域全 big 才保留 → 排除细线（AA / 视差）
p = np.pad(big, 1, constant_values=False)
er = p[1:-1, 1:-1].copy()
for dy in (-1, 0, 1):
    for dx in (-1, 0, 1):
        if dy == 0 and dx == 0:
            continue
        er &= p[1 + dy: p.shape[0] - 1 + dy, 1 + dx: p.shape[1] - 1 + dx]
area = int(er.sum())
print(f'area_pixels(after 3x3 erode)={area}')

if area:
    ys, xs = np.nonzero(er)
    print(f'AREA y [{ys.min()},{ys.max()}]  x [{xs.min()},{xs.max()}]')
    bands = {}
    for y, x in zip(ys.tolist(), xs.tolist()):
        bands.setdefault(y // 60, []).append((x, y))
    for k in sorted(bands):
        pts = bands[k]
        bx = [q[0] for q in pts]
        print(f'AREA band y{k*60}-{k*60+59}: n={len(pts)} x[{min(bx)},{max(bx)}]')
