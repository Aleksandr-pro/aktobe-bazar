"""
Проверка второй сети (дорисовки) так, как её исполнит GLES.

Скрипт делает то же, что делает телефон:
  1. раскладывает EnhanceWeights.VALUES в RGBA32F-текстуру по той же схеме,
     что createEnhanceWeightTexture() в FxRenderer.java;
  2. повторяет шейдеры FRAG_ENH_CONV1 / FRAG_ENH_CONV2 буквально — с clamp
     по краям и texelFetch по центрам текселей;
  3. сверяет результат с «эталонной» моделью на numpy.

Если раскладка весов или логика шейдера разойдутся с обучением — здесь будет
большая дельта, а не «вроде похоже» на телефоне.

Запуск: python3 scripts/check_enhance.py
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_enhance import E_HID, conv_edge_fwd, load_sr_weights, sr_forward  # noqa: E402
from train_sr import K, TAPS, C_IN, downsample2, load_images, psnr, col2im  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JAVA = os.path.join(ROOT, "integrations", "android", "app", "src", "main",
                    "java", "kz", "bazar", "fx")
E_TEXELS = 111


def read_values(path):
    text = open(path).read()
    body = text[text.index("VALUES = new float[] {"):]
    body = body[:body.index("};")]
    return np.array([float(v) for v in __import__("re").findall(r"(-?\d+\.\d+)f", body)],
                    dtype=np.float32)


def pack_texels(src):
    """Повторяет createEnhanceWeightTexture() из FxRenderer.java."""
    out = np.zeros((E_TEXELS, 4), np.float32)
    cHid = E_HID
    b1Offset = TAPS * C_IN * cHid
    w2Offset = b1Offset + cHid
    b2Offset = w2Offset + TAPS * cHid * 3

    out[0, :] = src[b1Offset:b1Offset + 4]
    out[1, :] = src[b1Offset + 4:b1Offset + 8]
    for t in range(TAPS):
        for c in range(C_IN):
            for g in range(cHid // 4):
                texel = 2 + (t * C_IN + c) * 2 + g
                out[texel] = src[(t * C_IN + c) * cHid + g * 4:(t * C_IN + c) * cHid + g * 4 + 4]
    out[56, :3] = src[b2Offset:b2Offset + 3]
    for t in range(TAPS):
        for o in range(3):
            for g in range(cHid // 4):
                # раскладка o-major: на один выходной канал — пара текселей
                # (группа 0 и группа 1), как читает FRAG_ENH_CONV2
                texel = 57 + (t * 3 + o) * 2 + g
                for k in range(4):
                    out[texel, k] = src[w2Offset + (t * cHid + g * 4 + k) * 3 + o]
    return out


def unpack_texels(tex):
    """Обратная операция: из текстуры собираем плоский массив весов."""
    flat = np.zeros(443, np.float32)
    cHid = E_HID
    b1Offset = TAPS * C_IN * cHid
    w2Offset = b1Offset + cHid
    b2Offset = w2Offset + TAPS * cHid * 3

    flat[b1Offset:b1Offset + 4] = tex[0]
    flat[b1Offset + 4:b1Offset + 8] = tex[1]
    for t in range(TAPS):
        for c in range(C_IN):
            for g in range(cHid // 4):
                texel = 2 + (t * C_IN + c) * 2 + g
                flat[(t * C_IN + c) * cHid + g * 4:(t * C_IN + c) * cHid + g * 4 + 4] = tex[texel]
    flat[b2Offset:b2Offset + 3] = tex[56, :3]
    for t in range(TAPS):
        for o in range(3):
            for g in range(cHid // 4):
                texel = 57 + (t * 3 + o) * 2 + g
                for k in range(4):
                    flat[w2Offset + (t * cHid + g * 4 + k) * 3 + o] = tex[texel, k]
    return flat


def shader_enhance(x, tex, strength=1.0):
    """Буквальное повторение FRAG_ENH_CONV1 + FRAG_ENH_CONV2 для (H,W,3)."""
    h, w, _ = x.shape

    def fetch(ix, iy):
        # texture() с CLAMP_TO_EDGE
        return x[min(max(iy, 0), h - 1), min(max(ix, 0), w - 1)]

    hid = np.zeros((h, w, 8), np.float32)
    for y in range(h):
        for xx in range(w):
            acc0 = tex[0].copy()
            acc1 = tex[1].copy()
            for t in range(9):
                ty = t // 3 - 1
                tx = t - (t // 3) * 3 - 1
                s = fetch(xx + tx, y + ty)
                for c in range(3):
                    base = 2 + (t * 3 + c) * 2
                    acc0 += tex[base] * s[c]
                    acc1 += tex[base + 1] * s[c]
            hid[y, xx, :4] = np.maximum(acc0, 0)
            hid[y, xx, 4:] = np.maximum(acc1, 0)

    out = np.zeros((h, w, 3), np.float32)
    for y in range(h):
        for xx in range(w):
            res = np.zeros(3, np.float32)
            for t in range(9):
                ty = t // 3 - 1
                tx = t - (t // 3) * 3 - 1
                qy = min(max(y + ty, 0), h - 1)
                qx = min(max(xx + tx, 0), w - 1)
                c0 = hid[qy, qx, :4]
                c1 = hid[qy, qx, 4:]
                base = 57 + t * 6
                res[0] += float(c0 @ tex[base]) + float(c1 @ tex[base + 1])
                res[1] += float(c0 @ tex[base + 2]) + float(c1 @ tex[base + 3])
                res[2] += float(c0 @ tex[base + 4]) + float(c1 @ tex[base + 5])
            res += tex[56, :3]
            out[y, xx] = np.clip(x[y, xx] + res * strength, 0, 1)
    return out


def model_enhance(x, w1, b1, w2, b2):
    """Эталон на numpy: те же свёртки с повтором края, но без упаковки в текстуру.

    Важно: именно edge-padding, а не zero-padding — шейдер делает clamp(),
    и обучение тоже шло с повтором края. Иначе на границах кропа получаем
    ложное «расхождение».
    """
    h, w = x.shape[:2]
    h1 = np.maximum(conv_edge_fwd(x[None], w1, b1, K)[0], 0).reshape(1, h, w, E_HID)
    res = conv_edge_fwd(h1, w2, b2, K)[0].reshape(1, h, w, 3)
    return np.clip(x[None] + res, 0, 1)[0]


def main():
    src = read_values(os.path.join(JAVA, "EnhanceWeights.java"))
    print(f"весов дорисовки прочитано: {len(src)}")

    tex = pack_texels(src)
    back = unpack_texels(tex)
    d_round = float(np.abs(back - src).max())
    print(f"упаковка → распаковка: max|Δ| = {d_round:.6f} "
          f"{'— раскладка корректна' if d_round < 1e-6 else '— ОШИБКА РАСКЛАДКИ'}")

    w1 = np.zeros((C_IN * TAPS, E_HID), np.float32)
    for t in range(TAPS):
        for c in range(C_IN):
            w1[c * TAPS + t] = back[(t * C_IN + c) * E_HID:(t * C_IN + c) * E_HID + E_HID]
    b1 = back[TAPS * C_IN * E_HID:TAPS * C_IN * E_HID + E_HID]
    w2off = TAPS * C_IN * E_HID + E_HID
    w2 = np.zeros((E_HID * TAPS, 3), np.float32)
    for t in range(TAPS):
        for c in range(E_HID):
            w2[c * TAPS + t] = back[w2off + (t * E_HID + c) * 3:w2off + (t * E_HID + c) * 3 + 3]
    b2 = back[w2off + TAPS * E_HID * 3:w2off + TAPS * E_HID * 3 + 3]

    sr = load_sr_weights(os.path.join(JAVA, "SRWeights.java"))
    imgs = load_images()
    v = imgs[1]
    crop = v[64:64 + 72, 64:64 + 72]
    sr_out = sr_forward(downsample2(crop)[None], *sr)[0]
    ref = crop[:sr_out.shape[0], :sr_out.shape[1]]

    shader_out = shader_enhance(sr_out, tex, 1.0)
    model_out = model_enhance(sr_out, w1, b1, w2, b2)[:shader_out.shape[0], :shader_out.shape[1]]
    d = float(np.abs(shader_out - model_out).mean())
    print(f"шейдер (симуляция) vs модель: средн|Δ| = {d:.6f} "
          f"{'— совпадает' if d < 1e-4 else '— РАСХОЖДЕНИЕ'}")

    print(f"PSNR на кропе {sr_out.shape[1]}x{sr_out.shape[0]}:")
    print(f"  билинейно            {psnr(np.repeat(np.repeat(downsample2(crop), 2, 0), 2, 1)[:ref.shape[0], :ref.shape[1]], ref):.2f} дБ")
    print(f"  апскейлер            {psnr(sr_out, ref):.2f} дБ")
    print(f"  апскейлер + дорисовка {psnr(shader_out, ref):.2f} дБ")

    # насколько сеть «дорисовывает»: сколько деталей добавилось
    g_sr = np.abs(np.diff(sr_out, axis=0)).mean() + np.abs(np.diff(sr_out, axis=1)).mean()
    g_out = np.abs(np.diff(shader_out, axis=0)).mean() + np.abs(np.diff(shader_out, axis=1)).mean()
    g_ref = np.abs(np.diff(ref, axis=0)).mean() + np.abs(np.diff(ref, axis=1)).mean()
    print(f"детализация (средн. градиент): апскейлер {g_sr:.4f} → "
          f"с дорисовкой {g_out:.4f} · эталон {g_ref:.4f}")


if __name__ == "__main__":
    main()
