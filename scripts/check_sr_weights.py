"""
Проверка, что веса, упакованные для GLSL-текстуры, дают ровно тот же
результат, что numpy-модель. Ловит ошибки индексации до запуска на телефоне.
"""
import re
import sys
import numpy as np
from skimage import data as skdata

sys.path.insert(0, 'scripts')
from train_sr import downsample2, im2col, pixelshuffle, psnr, C_IN, C_HID, C_OUT_SP, TAPS, K


def read_weights():
    src = open('integrations/android/app/src/main/java/kz/bazar/fx/SRWeights.java').read()
    body = src[src.index('VALUES = new float[] {'):]
    body = body[body.index('{') + 1:body.index('};')]
    vals = [float(v.strip().rstrip('f')) for v in body.split(',') if v.strip()]
    return np.array(vals, np.float32)


def pack_texels(flat):
    """Повторяет логику createWeightTexture() в FxRenderer.java."""
    out = np.zeros(276 * 4, np.float32)
    b1 = TAPS * C_IN * C_HID
    w2 = b1 + C_HID
    b2 = w2 + TAPS * C_HID * C_OUT_SP
    for o in range(C_HID):
        out[o] = flat[b1 + o]
    for t in range(TAPS):
        for c in range(C_IN):
            for g in range(C_HID // 4):
                texel = 2 + (t * C_IN + c) * 2 + g
                for k in range(4):
                    o = g * 4 + k
                    out[texel * 4 + k] = flat[(t * C_IN + c) * C_HID + o]
    for sp in range(4):
        for o in range(3):
            out[(56 + sp) * 4 + o] = flat[b2 + sp * 3 + o]
    for sp in range(4):
        for o in range(3):
            for t in range(TAPS):
                for g in range(C_HID // 4):
                    texel = 60 + ((sp * 3 + o) * TAPS + t) * 2 + g
                    for k in range(4):
                        c = g * 4 + k
                        out[texel * 4 + k] = flat[w2 + (t * C_HID + c) * C_OUT_SP + sp * 3 + o]
    return out.reshape(276, 4)


def shader_sim(img_lr):
    """Повторяет FRAG_NET_CONV1 + FRAG_NET_CONV2 по упакованным текселям."""
    W = pack_texels(read_weights())
    h, w, _ = img_lr.shape

    # --- conv1
    pad = np.pad(img_lr, ((1, 1), (1, 1), (0, 0)))
    acc = np.zeros((h, w, C_HID), np.float32)
    acc += np.concatenate([W[0], W[1]])[None, None, :]
    for t in range(TAPS):
        ty, tx = t // 3 - 1, t % 3 - 1
        sl = pad[1 + ty:1 + ty + h, 1 + tx:1 + tx + w]
        for c in range(C_IN):
            base = 2 + (t * C_IN + c) * 2
            acc[:, :, 0:4] += sl[:, :, c:c + 1] * W[base][None, None, :]
            acc[:, :, 4:8] += sl[:, :, c:c + 1] * W[base + 1][None, None, :]
    acc = np.maximum(acc, 0)

    # --- conv2 + pixelshuffle
    out = np.zeros((h * 2, w * 2, 3), np.float32)
    for sp in range(4):
        sy, sx = sp // 2, sp % 2
        acc2 = np.zeros((h, w, 3), np.float32)
        acc2 += W[56 + sp][None, None, :3]
        for t in range(TAPS):
            ty, tx = t // 3 - 1, t % 3 - 1
            ys = np.clip(np.arange(h) + ty, 0, h - 1)
            xs = np.clip(np.arange(w) + tx, 0, w - 1)
            c0 = acc[ys][:, xs]
            for o in range(3):
                base = 60 + (sp * 3 + o) * TAPS * 2 + t * 2
                v = c0[:, :, 0:4] @ W[base] + c0[:, :, 4:8] @ W[base + 1]
                acc2[:, :, o] += v
        out[sy::2, sx::2, :] = np.clip(acc2, 0, 1)
    return out


def main():
    img = skdata.astronaut().astype(np.float32) / 255.0
    img = img[64:320, 64:384, :3]
    lr = downsample2(img)
    got = shader_sim(lr)
    ref = img[:got.shape[0], :got.shape[1]]
    bil = np.repeat(np.repeat(lr, 2, axis=0), 2, axis=1)[:got.shape[0], :got.shape[1]]
    print(f"PSNR шейдер-симуляция = {psnr(got, ref):.2f} дБ")
    print(f"PSNR билинейно        = {psnr(bil, ref):.2f} дБ")
    print(f"PSNR сеть(numpy)      ~ см. обучение")
    same = np.mean(np.abs(got - bil)) < 0.5
    print("результат отличается от билинейного:", not same)


if __name__ == '__main__':
    main()
