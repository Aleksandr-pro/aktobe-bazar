"""
Наглядный пример «до / после» для второй сети.

Собирает PNG: билинейный апскейл | апскейлер | апскейлер + дорисовка | эталон.
Нужен, чтобы эффект можно было посмотреть глазами, а не только по цифрам.

Запуск: python3 scripts/make_enhance_sample.py
Выход: public/enhance-sample.png
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_enhance import E_HID, load_sr_weights, sr_forward  # noqa: E402
from train_sr import C_IN, K, TAPS, downsample2, load_images  # noqa: E402
from check_enhance import pack_texels, read_values, shader_enhance  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JAVA = os.path.join(ROOT, "integrations", "android", "app", "src", "main",
                    "java", "kz", "bazar", "fx")


def to_u8(img):
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)


def main():
    from PIL import Image

    sr = load_sr_weights(os.path.join(JAVA, "SRWeights.java"))
    tex = pack_texels(read_values(os.path.join(JAVA, "EnhanceWeights.java")))

    imgs = load_images()
    # берём картинку, на которой сеть не переобучалась сильнее всего (первая)
    v = imgs[0]
    y0, x0, size = 96, 160, 128
    crop = v[y0:y0 + size, x0:x0 + size]

    low = downsample2(crop)
    sr_out = sr_forward(low[None], *sr)[0]
    ref = crop[:sr_out.shape[0], :sr_out.shape[1]]
    enh = shader_enhance(sr_out, tex, 1.0)

    bic = np.repeat(np.repeat(low, 2, axis=0), 2, axis=1)[:ref.shape[0], :ref.shape[1]]

    gap = 6
    tiles = [to_u8(bic), to_u8(sr_out), to_u8(enh), to_u8(ref)]
    h, w = tiles[0].shape[:2]
    canvas = np.full((h, (w + gap) * 4 - gap, 3), 12, np.uint8)
    for i, t in enumerate(tiles):
        canvas[:, i * (w + gap):i * (w + gap) + w] = t

    out = os.path.join(ROOT, "public", "enhance-sample.png")
    Image.fromarray(np.repeat(np.repeat(canvas, 2, axis=0), 2, axis=1)).save(out)
    print("записано:", out, f"({size}×{size} ×2) — билинейно | апскейлер | +дорисовка | эталон")


if __name__ == "__main__":
    main()
