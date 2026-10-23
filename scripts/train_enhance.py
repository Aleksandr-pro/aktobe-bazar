"""
Обучение второй сети BazarFX — «дорисовки» деталей (enhance).

Зачем вторая сеть
-----------------
Апскейлер (train_sr.py) восстанавливает крупные формы, но после него кадр
всё равно выглядит «мягким»: сеть училась на билинейно уменьшенных фото и не
знает, какой именно мусор оставляет рендер игры. Вторая сеть учится уже на
реальном выходе апскейлера и добавляет к нему остаток (residual):

    out = sr(x) + E(sr(x))

то есть она не перерисовывает кадр целиком, а доделывает то, что апскейлер
потерял: микрорельеф, границы объектов, мелкие надписи. Это ровно то, что
просят от «ИИ дорисовывает картинку».

Архитектура (крошечная — исполняется во фрагментных шейдерах GLES):
    conv1: 3 → 8, 3×3, ReLU
    conv2: 8 → 3, 3×3
    residual add

Веса сохраняются в EnhanceWeights.java.
Запуск: python3 scripts/train_enhance.py --steps 2500
"""

import argparse
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_sr import (  # noqa: E402
    TAPS, C_IN, C_HID, C_OUT_SP, K,
    Adam, col2im, downsample2, im2col, load_images, psnr,
)

E_HID = 8   # каналов в скрытом слое второй сети


# ------------------------------------------------------------ чтение весов SR
def load_sr_weights(path):
    """Разбирает SRWeights.java → (w1, b1, w2, b2) в форме для numpy."""
    text = open(path).read()
    body = text[text.index('VALUES = new float[] {'):]
    body = body[:body.index('};')]
    vals = [float(v) for v in re.findall(r'(-?\d+\.\d+)f', body)]
    assert len(vals) == 1100, f"ожидалось 1100 весов SR, получено {len(vals)}"

    i = 0
    w1 = np.zeros((C_IN * TAPS, C_HID), np.float32)
    for t in range(TAPS):
        for c in range(C_IN):
            for o in range(C_HID):
                w1[c * TAPS + t, o] = vals[i]
                i += 1
    b1 = np.array(vals[i:i + C_HID], np.float32)
    i += C_HID
    w2 = np.zeros((C_HID * TAPS, C_OUT_SP), np.float32)
    for t in range(TAPS):
        for c in range(C_HID):
            for s in range(C_OUT_SP):
                w2[c * TAPS + t, s] = vals[i]
                i += 1
    b2 = np.array(vals[i:i + C_OUT_SP], np.float32)
    return w1, b1, w2, b2


# ---------------------------------------------------------------- SR forward
def conv(x, w, b, k, pad_mode="edge"):
    """Свёртка 3×3 для (B,H,W,C). pad_mode=edge повторяет край — как clamp в GLES.

    Раскладка столбцов совпадает с im2col из train_sr.py: (канал, tap).
    """
    p = k // 2
    mode = "edge" if pad_mode == "edge" else "constant"
    xp = np.pad(x, ((0, 0), (p, p), (p, p), (0, 0)), mode=mode)
    b_, h, w_, c = x.shape
    cols = np.empty((b_ * h * w_, c * k * k), np.float32)
    for i in range(k):
        for j in range(k):
            block = xp[:, i:i + h, j:j + w_, :].reshape(-1, c)
            cols[:, (i * k + j)::k * k] = block
    out = cols @ w + b
    return out.reshape(b_, h, w_, -1), cols, (b_, h, w_, c)


def pixelshuffle(y):
    b, h, w, c = y.shape
    y = y.reshape(b, h, w, 2, 2, 3)
    out = np.empty((b, h * 2, w * 2, 3), np.float32)
    for dy in range(2):
        for dx in range(2):
            out[:, dy::2, dx::2, :] = y[:, :, :, dy, dx, :]
    return out


def sr_forward(x, w1, b1, w2, b2):
    """То же, что делает шейдер: conv 3→8 ReLU → conv 8→12 → pixelshuffle ×2."""
    y1, _, _ = conv(x, w1, b1, K)
    y1 = np.maximum(y1, 0)
    y2, _, _ = conv(y1, w2, b2, K)
    return np.clip(pixelshuffle(y2), 0, 1)



def conv_edge_fwd(x, w, b, k):
    """Свёртка с повтором края — ровно то, что делает clamp в шейдере.

    Раскладка столбцов как у im2col в train_sr.py: (канал, tap), то есть
    индекс веса = c * TAPS + tap.
    """
    p = k // 2
    xp = np.pad(x, ((0, 0), (p, p), (p, p), (0, 0)), mode="edge")
    b_, h, w_, c = x.shape
    n = b_ * h * w_
    tmp = np.empty((n, c, k, k), np.float32)
    for i in range(k):
        for j in range(k):
            tmp[:, :, i, j] = xp[:, i:i + h, j:j + w_, :].reshape(n, c)
    cols = tmp.reshape(n, c * k * k)
    return cols @ w + b, cols


def conv_edge_bwd(dout, cols, w, shape, k):
    """Обратный проход с повтором края: градиент из «приклеенных» краёв
    складывается обратно в крайние пиксели."""
    b_, h, w_, c = shape
    p = k // 2
    dcols = dout @ w.T
    dtmp = dcols.reshape(b_ * h * w_, c, k, k)
    dxp = np.zeros((b_, h + 2 * p, w_ + 2 * p, c), np.float32)
    for i in range(k):
        for j in range(k):
            dxp[:, i:i + h, j:j + w_, :] += dtmp[:, :, i, j].reshape(b_, h, w_, c)
    d = dxp[:, p:p + h, p:p + w_, :].copy()
    if p > 0:
        for i in range(p):
            # верхняя и нижняя строка (без углов)
            d[:, 0] += dxp[:, i, p:p + w_, :]
            d[:, h - 1] += dxp[:, p + h + i, p:p + w_, :]
            # левый и правый столбец (без углов)
            d[:, :, 0] += dxp[:, p:p + h, i, :]
            d[:, :, w_ - 1] += dxp[:, p:p + h, p + w_ + i, :]
            for j in range(p):
                # четыре угла: в паддинге они попадают сразу в строку и столбец
                d[:, 0, 0] += dxp[:, i, j]
                d[:, 0, w_ - 1] += dxp[:, i, p + w_ + j]
                d[:, h - 1, 0] += dxp[:, p + h + i, j]
                d[:, h - 1, w_ - 1] += dxp[:, p + h + i, p + w_ + j]
    return d


def degrade(x, rng):
    """Портим вход так, как его портит реальный рендер игры.

    Сеть учится не «угадывать» уже восстановленный кадр, а добавлять детали
    к мягкому/шумному — поэтому на телефоне эффект заметнее.
    """
    out = x.copy()
    # мягкое размытие 3×3 (имитация билинейного апскейла движка)
    if rng.random() < 0.35:
        k = np.array([0.25, 0.5, 0.25], np.float32)
        out = (out * 0.5
               + 0.25 * np.roll(out, 1, axis=1)
               + 0.25 * np.roll(out, -1, axis=1))
        out = (out * 0.5 + 0.25 * np.roll(out, 1, axis=0) + 0.25 * np.roll(out, -1, axis=0))
    # шум сенсора/компрессии
    if rng.random() < 0.25:
        out = out + rng.normal(0, rng.uniform(0.002, 0.012), out.shape).astype(np.float32)
    # лёгкая потеря контраста
    if rng.random() < 0.25:
        c = rng.uniform(0.93, 1.0)
        out = 0.5 + (out - 0.5) * c
    return np.clip(out, 0, 1).astype(np.float32)


# -------------------------------------------------------------------- данные
def make_pairs(imgs, rng, sr, batch=6, hr=96):
    """Пары (выход апскейлера, эталон) — вторая сеть учится на реальном входе."""
    xs, ys = [], []
    w1, b1, w2, b2 = sr
    for _ in range(batch):
        im = imgs[rng.integers(len(imgs))].copy()
        if rng.random() < 0.5:
            im = im[:, ::-1]
        if rng.random() < 0.5:
            im = np.transpose(im, (1, 0, 2))
        im = np.ascontiguousarray(im)
        h, w = im.shape[:2]
        if h <= hr or w <= hr:
            continue
        y0 = int(rng.integers(0, h - hr))
        x0 = int(rng.integers(0, w - hr))
        crop = im[y0:y0 + hr, x0:x0 + hr]
        low = downsample2(crop)
        sr_out = sr_forward(low[None], w1, b1, w2, b2)[0]
        xs.append(degrade(sr_out, rng))
        ys.append(crop)
    # выравниваем по минимальному размеру (пиксельшуфл может дать на 1 больше)
    hh = min(a.shape[0] for a in xs)
    ww = min(a.shape[1] for a in xs)
    xs = np.stack([a[:hh, :ww] for a in xs])
    ys = np.stack([a[:hh, :ww] for a in ys])
    return xs, ys


def gradient_l1(pred, ref):
    gx_p = pred[:, :, 1:] - pred[:, :, :-1]
    gx_r = ref[:, :, 1:] - ref[:, :, :-1]
    gy_p = pred[:, 1:] - pred[:, :-1]
    gy_r = ref[:, 1:] - ref[:, :-1]
    return np.mean(np.abs(gx_p - gx_r)) + np.mean(np.abs(gy_p - gy_r))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=2500)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--grad", type=float, default=0.8, help="вес штрафа за градиенты")
    args = ap.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sr_path = os.path.join(root, "integrations", "android", "app", "src", "main",
                           "java", "kz", "bazar", "fx", "SRWeights.java")
    sr = load_sr_weights(sr_path)
    print("веса апскейлера прочитаны:", os.path.basename(sr_path), flush=True)

    rng = np.random.default_rng(1)
    imgs = load_images()
    print(f"изображений для обучения: {len(imgs)}", flush=True)

    w1 = (rng.standard_normal((C_IN * TAPS, E_HID)) * np.sqrt(2.0 / (C_IN * TAPS))).astype(np.float32)
    b1 = np.zeros(E_HID, np.float32)
    w2 = (rng.standard_normal((E_HID * TAPS, 3)) * np.sqrt(2.0 / (E_HID * TAPS))).astype(np.float32)
    b2 = np.zeros(3, np.float32)

    o1, o2 = Adam(w1.shape, args.lr), Adam(w2.shape, args.lr)
    ob1, ob2 = Adam(b1.shape, args.lr), Adam(b2.shape, args.lr)

    for step in range(1, args.steps + 1):
        x, y = make_pairs(imgs, rng, sr)
        b, h, w, _ = x.shape

        # forward
        o1v, cols1 = conv_edge_fwd(x, w1, b1, K)
        h1 = o1v.reshape(b, h, w, E_HID)
        h1r = np.maximum(h1, 0)
        o2v, cols2 = conv_edge_fwd(h1r, w2, b2, K)
        res = o2v.reshape(b, h, w, 3)
        pred = np.clip(x + res, 0, 1)

        l1 = np.mean(np.abs(pred - y))
        gl = gradient_l1(pred, y)
        loss = l1 + args.grad * gl

        d = np.sign(pred - y) / pred.size
        # производная штрафа за градиенты
        if args.grad > 0:
            dg = np.zeros_like(d)
            sgn_x = np.sign((pred[:, :, 1:] - pred[:, :, :-1]) - (y[:, :, 1:] - y[:, :, :-1]))
            sgn_y = np.sign((pred[:, 1:] - pred[:, :-1]) - (y[:, 1:] - y[:, :-1]))
            dg[:, :, 1:] += sgn_x
            dg[:, :, :-1] -= sgn_x
            dg[:, 1:] += sgn_y
            dg[:, :-1] -= sgn_y
            d += args.grad * dg / pred.size

        dres = d.reshape(b * h * w, 3)
        gw2 = cols2.T @ dres
        gb2 = dres.sum(axis=0)
        dh1 = conv_edge_bwd(dres, cols2, w2, (b, h, w, E_HID), K) * (h1 > 0)
        dh1f = dh1.reshape(b * h * w, E_HID)
        gw1 = cols1.T @ dh1f
        gb1 = dh1f.sum(axis=0)

        w1 = o1.step(w1, gw1)
        b1 = ob1.step(b1, gb1)
        w2 = o2.step(w2, gw2)
        b2 = ob2.step(b2, gb2)

        if step % 250 == 0:
            # валидация на astronaut целиком
            v = imgs[0]
            hv, wv = (v.shape[0] // 32) * 32, (v.shape[1] // 32) * 32
            v = v[:hv, :wv]
            with np.errstate(all="ignore"):
                v_sr = sr_forward(downsample2(v)[None], *sr)[0]
            ref = v[:v_sr.shape[0], :v_sr.shape[1]]
            hh, ww = v_sr.shape[:2]
            vh = np.maximum(conv_edge_fwd(v_sr[None], w1, b1, K)[0], 0).reshape(1, hh, ww, E_HID)
            vres = conv_edge_fwd(vh, w2, b2, K)[0].reshape(1, hh, ww, 3)
            vout = np.clip(v_sr + vres[0], 0, 1)
            bic = np.repeat(np.repeat(downsample2(v), 2, axis=0), 2, axis=1)
            print(f"step {step:5d}  L1={l1:.4f}  grad={gl:.4f}  "
                  f"PSNR: билинейно={psnr(bic[:ref.shape[0], :ref.shape[1]], ref):.2f}  "
                  f"апскейлер={psnr(v_sr, ref):.2f}  "
                  f"апскейлер+дорисовка={psnr(vout, ref):.2f} дБ", flush=True)

    export(w1, b1, w2, b2, root)


def export(w1, b1, w2, b2, root):
    np.savez("/tmp/enhance_weights.npz", w1=w1, b1=b1, w2=w2, b2=b2)

    flat = []
    for t in range(TAPS):
        for c in range(C_IN):
            for o in range(E_HID):
                flat.append(float(w1[c * TAPS + t, o]))
    for o in range(E_HID):
        flat.append(float(b1[o]))
    for t in range(TAPS):
        for c in range(E_HID):
            for o in range(3):
                flat.append(float(w2[c * TAPS + t, o]))
    for o in range(3):
        flat.append(float(b2[o]))

    print(f"всего весов дорисовки: {len(flat)}")
    java = f'''package kz.bazar.fx;

/**
 * Веса второй сети BazarFX — «дорисовка» деталей поверх апскейлера.
 *
 * Сгенерировано scripts/train_enhance.py — не редактировать руками.
 * Архитектура: conv 3->{E_HID} (3x3, ReLU) -> conv {E_HID}->3 (3x3), residual:
 *   out = sr + E(sr)
 * Формат: [conv1 tap][in][out] + b1 + [conv2 tap][in][out] + b2.
 */
public final class EnhanceWeights {{

    public static final int TAPS = {TAPS};
    public static final int C_IN = {C_IN};
    public static final int C_HID = {E_HID};
    public static final int COUNT = {len(flat)};

    public static final float[] VALUES = new float[] {{
{chr(10).join("            " + ", ".join(f"{v:.6f}f" for v in flat[i:i + 8]) + "," for i in range(0, len(flat), 8))}
    }};

    private EnhanceWeights() {{
    }}
}}
'''
    path = os.path.join(root, "integrations", "android", "app", "src", "main",
                        "java", "kz", "bazar", "fx", "EnhanceWeights.java")
    with open(path, "w") as f:
        f.write(java)
    print("записано:", path)


if __name__ == "__main__":
    main()
