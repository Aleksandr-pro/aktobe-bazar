"""
Обучение нейросети-апскейлера BazarFX-Neural (ESPCN-подобная, 2×).

Модель намеренно крошечная: её нужно исполнить на телефоне во фрагментных
шейдерах GLES 3.0, где каждый лишний канал — это лишние выборки текстуры.

  conv1: 3 → 8, 3×3, ReLU
  conv2: 8 → 12, 3×3   (12 = 4 подпикселя × 3 канала)
  pixelshuffle ×2      (как в ESPCN, Real-ESRGAN и т.п.)

Обучение на numpy (torch в песочнице недоступен): im2col-свёртки,
ручной backward, Adam. Данные — натуральные фотографии из scikit-image:
их достаточно, чтобы сеть выучила восстановление краёв и текстур, а не
конкретные картинки (плюс аугментация: флипы, повороты, гамма).

Запуск: python3 scripts/train_sr.py [--steps 3000]
Выход: integrations/android/.../SRWeights.java (массив float) + отчёт PSNR.
"""

import argparse
import numpy as np
from skimage import data as skdata

C_IN, C_HID, C_OUT_SP = 3, 8, 12   # 12 = 4 подпикселя × 3 канала
K = 3                               # ядро 3×3
SCALE = 2
TAPS = K * K


# ----------------------------------------------------------------- данные
def load_images():
    imgs = []
    for name in ["astronaut", "coffee", "chelsea", "rocket", "cat", "grass",
                 "gravel", "brick", "eagle", "horse", "hubble_deep_field", "retina"]:
        try:
            im = getattr(skdata, name)()
        except Exception:
            continue
        im = np.asarray(im)
        if im.ndim == 2:
            im = np.stack([im] * 3, axis=-1)
        if im.shape[-1] == 4:
            im = im[..., :3]
        if im.dtype != np.float32:
            im = im.astype(np.float32) / (255.0 if im.max() > 1.5 else 1.0)
        # приводим к разумному размеру
        if min(im.shape[:2]) < 96:
            continue
        imgs.append(np.clip(im, 0, 1))
    return imgs


def downsample2(img):
    """Билинейное уменьшение в 2 раза (как будто игра рендерит в низком разрешении)."""
    h, w, c = img.shape
    h2, w2 = h // 2, w // 2
    img = img[:h2 * 2, :w2 * 2]
    return img.reshape(h2, 2, w2, 2, c).mean(axis=(1, 3))


def augment(img, rng):
    if rng.random() < 0.5:
        img = img[:, ::-1]
    if rng.random() < 0.5:
        img = img[::-1]
    if rng.random() < 0.5:
        img = np.transpose(img, (1, 0, 2))
    # мягкая гамма: имитирует разные условия освещения в играх
    g = 1.0 + (rng.random() - 0.5) * 0.5
    img = np.clip(img, 1e-4, 1) ** g
    return np.ascontiguousarray(img)


def make_batch(imgs, rng, batch=8, hr=96):
    xs, ys = [], []
    for _ in range(batch):
        im = augment(imgs[rng.integers(len(imgs))], rng)
        h, w = im.shape[:2]
        y0 = rng.integers(0, h - hr)
        x0 = rng.integers(0, w - hr)
        crop = im[y0:y0 + hr, x0:x0 + hr]
        xs.append(downsample2(crop))       # низкое разрешение
        ys.append(crop)                    # эталон
    return np.stack(xs), np.stack(ys)


# ------------------------------------------------------------- свёртки
def im2col(x, k):
    """(B,H,W,C) → (B*H*W, C*k*k) с zero-padding."""
    b, h, w, c = x.shape
    p = k // 2
    xp = np.pad(x, ((0, 0), (p, p), (p, p), (0, 0)))
    cols = np.empty((b, h, w, c, k, k), dtype=np.float32)
    for i in range(k):
        for j in range(k):
            cols[:, :, :, :, i, j] = xp[:, i:i + h, j:j + w, :]
    return cols.reshape(b * h * w, c * k * k), (b, h, w, c)


def col2im(dcols, shape, k):
    b, h, w, c = shape
    p = k // 2
    d = dcols.reshape(b, h, w, c, k, k)
    dxp = np.zeros((b, h + 2 * p, w + 2 * p, c), dtype=np.float32)
    for i in range(k):
        for j in range(k):
            dxp[:, i:i + h, j:j + w, :] += d[:, :, :, :, i, j]
    return dxp[:, p:p + h, p:p + w, :]


def pixelshuffle(y):
    """(B,H,W,4*3) → (B,2H,2W,3)"""
    b, h, w, c = y.shape
    y = y.reshape(b, h, w, 2, 2, 3)
    out = np.empty((b, h * 2, w * 2, 3), dtype=np.float32)
    for dy in range(2):
        for dx in range(2):
            out[:, dy::2, dx::2, :] = y[:, :, :, dy, dx, :]
    return out


class Adam:
    def __init__(self, shape, lr=2e-3):
        self.m = np.zeros(shape, np.float32)
        self.v = np.zeros(shape, np.float32)
        self.lr = lr
        self.t = 0

    def step(self, w, g):
        self.t += 1
        self.m = 0.9 * self.m + 0.1 * g
        self.v = 0.999 * self.v + 0.001 * (g * g)
        mh = self.m / (1 - 0.9 ** self.t)
        vh = self.v / (1 - 0.999 ** self.t)
        return w - self.lr * mh / (np.sqrt(vh) + 1e-8)


def psnr(a, b):
    mse = float(np.mean((a - b) ** 2))
    return 99.0 if mse <= 1e-12 else 10 * np.log10(1.0 / mse)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--lr", type=float, default=2e-3)
    args = ap.parse_args()

    rng = np.random.default_rng(0)
    imgs = load_images()
    print(f"изображений для обучения: {len(imgs)}", flush=True)

    w1 = (rng.standard_normal((C_IN * TAPS, C_HID)) * np.sqrt(2.0 / (C_IN * TAPS))).astype(np.float32)
    b1 = np.zeros(C_HID, np.float32)
    w2 = (rng.standard_normal((C_HID * TAPS, C_OUT_SP)) * np.sqrt(2.0 / (C_HID * TAPS))).astype(np.float32)
    b2 = np.zeros(C_OUT_SP, np.float32)

    o1, o2 = Adam(w1.shape, args.lr), Adam((C_HID * TAPS, C_OUT_SP), args.lr)
    ob1, ob2 = Adam(b1.shape, args.lr), Adam(b2.shape, args.lr)

    for step in range(1, args.steps + 1):
        x, y = make_batch(imgs, rng)
        b, h, w, _ = x.shape

        # forward
        cols1, s1 = im2col(x, K)
        y1 = cols1 @ w1 + b1
        y1 = y1.reshape(b, h, w, C_HID)
        y1r = np.maximum(y1, 0)
        cols2, s2 = im2col(y1r, K)
        y2 = cols2 @ w2 + b2
        y2 = y2.reshape(b, h, w, C_OUT_SP)
        pred = np.clip(pixelshuffle(y2), 0, 1)

        loss = np.mean(np.abs(pred - y))
        d = np.sign(pred - y) / pred.size      # dL1
        # через pixelshuffle
        dy2 = np.empty((b, h, w, 2, 2, 3), np.float32)
        for p in range(2):
            for q in range(2):
                dy2[:, :, :, p, q, :] = d[:, p::2, q::2, :]
        dy2 = dy2.reshape(b * h * w, C_OUT_SP)

        gw2 = cols2.T @ dy2
        gb2 = dy2.sum(axis=0)
        dcols2 = dy2 @ w2.T
        dy1r = col2im(dcols2, s2, K)
        dy1 = dy1r * (y1 > 0)
        dy1f = dy1.reshape(b * h * w, C_HID)
        gw1 = cols1.T @ dy1f
        gb1 = dy1f.sum(axis=0)

        w1 = o1.step(w1, gw1)
        b1 = ob1.step(b1, gb1)
        w2 = o2.step(w2, gw2)
        b2 = ob2.step(b2, gb2)

        if step % 250 == 0:
            # валидация на фотографии (не на тёмной текстуре)
            vim = imgs[0]
            hv, wv = (vim.shape[0] // 32) * 32, (vim.shape[1] // 32) * 32
            v = vim[:hv, :wv]
            vx = downsample2(v)[None]
            c1, _ = im2col(vx, K)
            h1 = np.maximum(c1 @ w1 + b1, 0).reshape(1, vx.shape[1], vx.shape[2], C_HID)
            c2, _ = im2col(h1, K)
            out = np.clip(pixelshuffle((c2 @ w2 + b2).reshape(1, vx.shape[1], vx.shape[2], C_OUT_SP)), 0, 1)[0]
            ref = v[:out.shape[0], :out.shape[1]]
            bic = np.repeat(np.repeat(vx[0], 2, axis=0), 2, axis=1)[:out.shape[0], :out.shape[1]]
            print(f"step {step:5d}  L1={loss:.4f}  PSNR сеть={psnr(out, ref):.2f} дБ  "
                  f"билинейно={psnr(bic, ref):.2f} дБ", flush=True)

    export(w1, b1, w2, b2)


def export(w1, b1, w2, b2):
    """Веса пакуются в один плоский массив: его загрузим в RGBA32F-текстуру."""
    flat = []
    # im2col укладывает строки как (канал * TAPS + tap), поэтому переставляем
    # явно: массив для шейдера идёт в порядке [tap][канал][выход].
    for t in range(TAPS):
        for c in range(C_IN):
            for o in range(C_HID):
                flat.append(float(w1[c * TAPS + t, o]))
    for o in range(C_HID):
        flat.append(float(b1[o]))
    for t in range(TAPS):
        for c in range(C_HID):
            for s in range(C_OUT_SP):
                flat.append(float(w2[c * TAPS + t, s]))
    for s in range(C_OUT_SP):
        flat.append(float(b2[s]))

    # сохраняем и в npz: переобучать не придётся, если поменяется упаковка
    import numpy as _np
    _np.savez("/tmp/sr_weights.npz", w1=w1, b1=b1, w2=w2, b2=b2)

    print(f"всего весов: {len(flat)} ({len(flat) * 4 / 1024:.1f} КБ)")

    vals = ", ".join(f"{v:.6f}f" for v in flat)
    java = f'''package kz.bazar.fx;

/**
 * Веса нейросети-апскейлера BazarFX-Neural (2x, ESPCN-подобная).
 *
 * Сгенерировано scripts/train_sr.py — не редактировать руками.
 * Архитектура: conv 3->8 (3x3, ReLU) -> conv 8->12 (3x3) -> pixelshuffle x2.
 * Формат: [conv1 tap][in][out] + b1 + [conv2 tap][in][out] + b2,
 * упаковывается в RGBA32F-текстуру и читается шейдером через texelFetch.
 */
public final class SRWeights {{

    public static final int TAPS = {TAPS};
    public static final int C_IN = {C_IN};
    public static final int C_HID = {C_HID};
    public static final int C_OUT_SP = {C_OUT_SP};
    public static final int COUNT = {len(flat)};

    public static final float[] VALUES = new float[] {{
{chr(10).join("            " + ", ".join(f"{v:.6f}f" for v in flat[i:i + 8]) + "," for i in range(0, len(flat), 8))}
    }};

    private SRWeights() {{
    }}
}}
'''
    import os
    path = os.path.join(os.path.dirname(__file__), "..", "integrations", "android",
                        "app", "src", "main", "java", "kz", "bazar", "fx", "SRWeights.java")
    path = os.path.abspath(path)
    with open(path, "w") as f:
        f.write(java)
    print("записано:", path)


if __name__ == "__main__":
    main()
