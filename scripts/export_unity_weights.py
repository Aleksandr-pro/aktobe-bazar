"""
Экспорт весов обученной сети в HLSL для Unity.

Берёт SRWeights.java (единственный источник истины — те же веса, что уже
работают в Android-оверлее) и раскладывает их в тот же формат float4-текселей,
который проверен симуляцией (scripts/check_sr_weights.py).

Запуск: python3 scripts/export_unity_weights.py
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from check_sr_weights import pack_texels, read_weights  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "integrations", "unity",
                   "package", "Shaders", "BazarFXNeuralWeights.hlsl")

HEADER = """// BazarFX-Neural — веса обученной сети (сгенерировано scripts/export_unity_weights.py)
//
// Архитектура: conv 3->8 (3x3, ReLU) -> conv 8->12 (3x3) -> pixelshuffle x2
// Раскладка — та же, что в Android-версии (проверена симуляцией шейдера):
//   [0..1]    bias conv1 (8 значений)
//   [2..55]   conv1: tap(9) x in(3) x группа(2)
//   [56..59]  bias conv2 по подпикселям (4 x rgb)
//   [60..275] conv2: subpixel(4) x out(3) x tap(9) x группа(2)
//
// Не редактировать вручную.

#ifndef BAZARFX_NEURAL_WEIGHTS_INCLUDED
#define BAZARFX_NEURAL_WEIGHTS_INCLUDED

static const float4 BFX_W[276] = {
"""

FOOTER = """};

#endif // BAZARFX_NEURAL_WEIGHTS_INCLUDED
"""


def main():
    texels = pack_texels(read_weights())
    assert texels.shape == (276, 4), texels.shape

    lines = []
    for i in range(0, 276, 4):
        chunk = texels[i:i + 4]
        parts = []
        for t in chunk:
            parts.append("float4(%.6f, %.6f, %.6f, %.6f)" % tuple(float(v) for v in t))
        lines.append("    " + ", ".join(parts) + ",")

    path = os.path.abspath(OUT)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(HEADER + "\n".join(lines) + "\n" + FOOTER)
    print(f"записано: {path} ({os.path.getsize(path)} байт)")

    # Самопроверка: первые 8 значений должны совпадать с тем, что видит GLES.
    print("bias conv1 (первые 8):", ", ".join(f"{v:.4f}" for v in texels[0].tolist() + texels[1].tolist()))


if __name__ == "__main__":
    main()
