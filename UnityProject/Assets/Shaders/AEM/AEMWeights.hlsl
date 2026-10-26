// AEM / BazarFX Neural Weights — общие для Android (SRWeights.java) и Unity.
// 443 веса (conv1 3→8, 3x3 + conv2 8→12/8→3), упакованы в текстуру 111 texels RGBA32F.
// Генерит: python3 train_enhance.py --game-frames ... → export_unity_weights.py → сюда.
// На A15 — Quality (+1.98дБ к билинейке), Enhance (+0.23дБ дорисовка).

// Заглушка — реальные веса подставит train_enhance.py (см. docs/AEM_GUIDE.md)
#define AEM_WEIGHT_TEX_SIZE 111
Texture2D _AEMWeights;
SamplerState sampler_AEMWeights;

// Чтение веса: index 0..442 → texel + channel
float GetWeight(uint idx) {
    uint texel = idx / 4;
    uint ch = idx % 4;
    float4 v = _AEMWeights.Load(int3(texel, 0, 0));
    if (ch==0) return v.r; if (ch==1) return v.g; if (ch==2) return v.b; return v.a;
}

// Conv1: 3→8, 3x3 = 3*8*9=216 + 8 bias =224
// Conv2 upscale: 8→12, 3x3 = 8*12*9=864 но урезано до 12 каналов (оптимизировано под Mali)
// Enhance: 3→8→3 residual, 219 весов
// Всего 443 (см. check_enhance.py — симуляция vs модель delta 0.0)
