"""
Проверка HLSL-версии сети (Unity) на соответствие обученной модели.

Повторяет логику BazarFXNeuralConv1/Conv2.shader по сгенерированному
BazarFXNeuralWeights.hlsl и сравнивает с numpy-forward. Если индексация или
подпиксельный выбор разъедутся — увидим это здесь, а не в Unity.

Запуск: python3 scripts/check_unity_shaders.py
"""

import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from train_sr import im2col, pixelshuffle, psnr, downsample2, C_HID, C_OUT_SP, TAPS  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HLSL = os.path.join(ROOT, "integrations", "unity", "package", "Shaders", "BazarFXNeuralWeights.hlsl")


def read_hlsl():
    src = open(HLSL, encoding="utf-8").read()
    body = src[src.index("BFX_W[276] = {"):]
    body = body[body.index("{") + 1:body.index("};")]
    nums = [float(x) for x in re.findall(r"-?\d+\.\d+", body)]
    assert len(nums) == 276 * 4, f"ожидалось {276 * 4} чисел, найдено {len(nums)}"
    return np.array(nums, np.float32).reshape(276, 4)


def shader_forward(W, lr):
    """Точная копия шейдеров: conv1 (MRT) → conv2 + pixelshuffle."""
    h, w, _ = lr.shape

    # conv1: смещения по текселям, клампим как GL (текстура CLAMP_TO_EDGE)
    def samp(y, x):
        return lr[min(max(y, 0), h - 1), min(max(x, 0), w - 1)]

    acc = np.zeros((h, w, C_HID), np.float32)
    acc += np.concatenate([W[0], W[1]])[None, None, :]
    for t in range(TAPS):
        ty, tx = t // 3 - 1, t % 3 - 1
        for c in range(3):
            base = 2 + (t * 3 + c) * 2
            plane = np.empty((h, w), np.float32)
            for y in range(h):
                for x in range(w):
                    plane[y, x] = samp(y + ty, x + tx)[c]
            for k in range(4):
                acc[:, :, k] += plane * W[base][k]
                acc[:, :, 4 + k] += plane * W[base + 1][k]
    acc = np.maximum(acc, 0)

    # conv2 + pixelshuffle, как в шейдере
    out = np.zeros((h * 2, w * 2, 3), np.float32)
    for hp_y in range(h * 2):
        for hp_x in range(w * 2):
            sx = hp_x & 1
            sy = hp_y & 1
            # Симуляция идёт сверху вниз (строка 0 = верх), а gl_FragCoord
            # отсчитывается снизу вверх — поэтому здесь инверсии нет:
            # в самом шейдере она есть и даёт тот же результат.
            sub = sy * 2 + sx
            lp_y, lp_x = hp_y >> 1, hp_x >> 1
            acc2 = np.zeros(3, np.float32) + W[56 + sub][:3]
            for t in range(TAPS):
                ty, tx = t // 3 - 1, t % 3 - 1
                cy = min(max(lp_y + ty, 0), h - 1)
                cx = min(max(lp_x + tx, 0), w - 1)
                c0 = acc[cy, cx, 0:4]
                c1 = acc[cy, cx, 4:8]
                base = 60 + (sub * 3) * 18 + t * 2
                for o in range(3):
                    acc2[o] += c0 @ W[base + o * 18] + c1 @ W[base + o * 18 + 1]
            out[hp_y, hp_x] = np.clip(acc2, 0, 1)
    return out


def unpack(W):
    """Обратная распаковка: тексели -> матрицы в формате im2col (c*TAPS + t)."""
    flat1 = np.zeros(TAPS * 3 * C_HID, np.float32)      # порядок [tap][in][out]
    flat2 = np.zeros(TAPS * C_HID * C_OUT_SP, np.float32)  # [tap][hid][sub*3+o]
    b1 = np.concatenate([W[0], W[1]])
    b2 = np.zeros(C_OUT_SP, np.float32)
    for t in range(TAPS):
        for c in range(3):
            for g in range(2):
                flat1[(t * 3 + c) * C_HID + g * 4:(t * 3 + c) * C_HID + g * 4 + 4] = \
                    W[2 + (t * 3 + c) * 2 + g]
    for sp in range(4):
        b2[sp * 3:sp * 3 + 3] = W[56 + sp][:3]
        for o in range(3):
            for t in range(TAPS):
                for g in range(2):
                    for k in range(4):
                        c = g * 4 + k
                        flat2[(t * C_HID + c) * C_OUT_SP + sp * 3 + o] = \
                            W[60 + ((sp * 3 + o) * TAPS + t) * 2 + g][k]

    w1f = flat1.reshape(TAPS, 3, C_HID)
    w2f = flat2.reshape(TAPS, C_HID, C_OUT_SP)
    w1 = np.zeros((3 * TAPS, C_HID), np.float32)
    w2 = np.zeros((C_HID * TAPS, C_OUT_SP), np.float32)
    for t in range(TAPS):
        for c in range(3):
            w1[c * TAPS + t] = w1f[t, c]
        for c in range(C_HID):
            w2[c * TAPS + t] = w2f[t, c]
    return w1, b1, w2, b2


def model_forward(W, lr):
    w1, b1, w2, b2 = unpack(W)
    c1, _ = im2col(lr[None], 3)
    h1 = np.maximum(c1 @ w1 + b1, 0).reshape(1, lr.shape[0], lr.shape[1], C_HID)
    c2, _ = im2col(h1, 3)
    return np.clip(pixelshuffle((c2 @ w2 + b2).reshape(1, lr.shape[0], lr.shape[1], C_OUT_SP)), 0, 1)[0]


def main():
    W = read_hlsl()
    from skimage import data
    img = data.astronaut().astype(np.float32) / 255.0
    img = img[:96, :96, :3]          # маленький кроп: симуляция медленная
    lr = downsample2(img)

    got = shader_forward(W, lr)
    # модель обучена на padding=1 нулями, шейдер клампит — сравниваем без краёв
    ref_model = model_forward(W, lr)
    k = 6
    a = got[k:-k, k:-k]
    b = ref_model[k:-k, k:-k]
    diff = float(np.mean(np.abs(a - b)))
    print(f"HLSL-симуляция vs model: средн|Δ| = {diff:.5f}")
    print(f"PSNR HLSL {psnr(got, img[:got.shape[0], :got.shape[1]]):.2f} дБ")
    bil = np.repeat(np.repeat(lr, 2, 0), 2, 1)[:got.shape[0], :got.shape[1]]
    print(f"PSNR билинейно {psnr(bil, img[:bil.shape[0], :bil.shape[1]]):.2f} дБ")
    ok = diff < 0.01
    print("РЕЗУЛЬТАТ:", "совпадает" if ok else "РАСХОЖДЕНИЕ")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
