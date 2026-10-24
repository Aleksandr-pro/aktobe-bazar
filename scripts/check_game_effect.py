"""
Проверка эффекта на реальном кадре из игры (а не на фотографии).

Скриншот игры → дорисовка на полном кадре → сравнение «до/после» по цифрам
и картинкой. Нужен, чтобы не обещать эффект, которого не видно.
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_enhance import JAVA, pack_texels, read_values  # noqa: E402
from train_enhance import conv_edge_fwd, E_HID  # noqa: E402
from train_sr import C_IN, K, TAPS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_weights():
    src = read_values(os.path.join(JAVA, "EnhanceWeights.java"))
    cHid = E_HID
    w1 = np.zeros((C_IN * TAPS, cHid), np.float32)
    for t in range(TAPS):
        for c in range(C_IN):
            w1[c * TAPS + t] = src[(t * C_IN + c) * cHid:(t * C_IN + c) * cHid + cHid]
    b1 = src[TAPS * C_IN * cHid:TAPS * C_IN * cHid + cHid]
    off = TAPS * C_IN * cHid + cHid
    w2 = np.zeros((cHid * TAPS, 3), np.float32)
    for t in range(TAPS):
        for c in range(cHid):
            w2[c * TAPS + t] = src[off + (t * cHid + c) * 3:off + (t * cHid + c) * 3 + 3]
    b2 = src[off + TAPS * cHid * 3:off + TAPS * cHid * 3 + 3]
    return w1, b1, w2, b2


def enhance(img, w1, b1, w2, b2, strength=1.0):
    h, w = img.shape[:2]
    hid = np.maximum(conv_edge_fwd(img[None], w1, b1, K)[0], 0).reshape(1, h, w, E_HID)
    res = conv_edge_fwd(hid, w2, b2, K)[0].reshape(1, h, w, 3)
    return np.clip(img + res[0] * strength, 0, 1)


def grade(img, amount):
    """Повтор FRAG_GRADE: контраст S-кривой + vibrance."""
    c = np.clip(img, 0, 1).astype(np.float32)
    k = amount * 0.55
    # smoothstep(0.02, 0.98, c)
    t = np.clip((c - 0.02) / 0.96, 0, 1)
    smooth = t * t * (3 - 2 * t)
    s = c * (1 - k) + smooth * k
    l = (s * np.array([0.299, 0.587, 0.114], np.float32)).sum(axis=2, keepdims=True)
    sat = s.max(axis=2, keepdims=True) - s.min(axis=2, keepdims=True)
    vib = 1.0 + amount * 0.45 * (1.0 - np.clip(sat * 2.0, 0, 1))
    return np.clip(l + (s - l) * vib, 0, 1)


def detail(img):
    return float(np.abs(np.diff(img, axis=0)).mean() + np.abs(np.diff(img, axis=1)).mean())


def main():
    from PIL import Image

    w1, b1, w2, b2 = load_weights()
    src = '/tmp/arena-coding-uploads/Screenshot_20261024_011612_CounterFlame.jpg'
    if not os.path.exists(src):
        print("нет скриншота:", src)
        return
    img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255.0
    # центральный фрагмент 1:1, без масштабирования
    h, w = img.shape[:2]
    crop = img[h // 2 - 270:h // 2 + 270, w // 2 - 480:w // 2 + 480]

    enh = enhance(crop, w1, b1, w2, b2, 1.0)
    enh2 = enhance(crop, w1, b1, w2, b2, 2.0)
    final = grade(enh2, 0.5)

    print(f"кадр {crop.shape[1]}x{crop.shape[0]}")
    print(f"детализация (средн. градиент): исходник {detail(crop):.4f} → "
          f"дорисовка ×1 {detail(enh):.4f} → ×2 {detail(enh2):.4f} → с тоном {detail(final):.4f}")
    print(f"средняя яркость: {crop.mean():.4f} → {final.mean():.4f}")
    sat = lambda a: float((a.max(axis=2) - a.min(axis=2)).mean())
    print(f"насыщенность: {sat(crop):.4f} → {sat(final):.4f}")
    print(f"макс. отличие в пикселе: {np.abs(enh2 - crop).max():.4f}, "
          f"среднее: {np.abs(enh2 - crop).mean():.4f}")

    out_dir = os.path.join(ROOT, "public")
    # кропы 1:1 для честного сравнения
    # берём участок с деталями (персонаж, оружие, текстуры стен), а не дым
    cw, ch = 460, 300
    y0, x0 = 8, 400
    def cut(a):
        return (np.clip(a[y0:y0 + ch, x0:x0 + cw], 0, 1) * 255).astype(np.uint8)
    gap = 8
    tiles = [cut(crop), cut(enh2), cut(final)]
    canvas = np.full((ch, (cw + gap) * len(tiles) - gap, 3), 10, np.uint8)
    for i, t in enumerate(tiles):
        canvas[:, i * (cw + gap):i * (cw + gap) + cw] = t
    path = os.path.join(out_dir, "game-enhance-sample.png")
    Image.fromarray(canvas).save(path)
    print("записано:", path, "— исходник | дорисовка ×2 | +тон")


if __name__ == "__main__":
    main()
