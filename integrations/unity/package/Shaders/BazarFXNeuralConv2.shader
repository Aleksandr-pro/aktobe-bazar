// BazarFX-Neural: второй слой 8 -> 12 каналов (3x3) + pixelshuffle x2.
// Рисуем сразу в удвоенное разрешение: подпиксель выбирается по экранной
// координате, поэтому три выходных канала считаются в одном проходе и
// выборки c0/c1 переиспользуются (это главный выигрыш по скорости).
Shader "Hidden/BazarFX/NeuralConv2"
{
    Properties
    {
        _C0 ("Каналы 0-3", 2D) = "black" {}
        _C1 ("Каналы 4-7", 2D) = "black" {}
        _Plain ("Билинейный апскейл (для смешивания)", 2D) = "black" {}
        _Strength ("Сила сети", Range(0, 1)) = 1
    }

    SubShader
    {
        Cull Off
        ZWrite Off
        ZTest Always

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #include "UnityCG.cginc"
            #include "BazarFXNeuralWeights.hlsl"

            sampler2D _C0;
            sampler2D _C1;
            sampler2D _Plain;
            float4 _C0_TexelSize;
            float4 _OutSize;      // x = ширина выхода, y = высота выхода
            float _Strength;

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv  : TEXCOORD0;
            };

            v2f vert (appdata_img v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = v.texcoord;
                return o;
            }

            float4 frag (v2f i) : SV_Target
            {
                float2 outSize = _OutSize.xy;
                int2 hp = (int2)(i.uv * outSize);
                int sx = hp.x & 1;
                int sy = hp.y & 1;
                // В текстуре Y растёт снизу вверх, а сеть обучена в координатах
                // изображения — подпиксель по Y инвертируем (как в GLES-версии).
                int sub = (1 - sy) * 2 + sx;

                int2 lp = hp >> 1;
                float2 invLow = _C0_TexelSize.xy;         // 1/ширина, 1/высота входа
                int2 lowMax = (int2)_C0_TexelSize.zw - 1; // размер входа минус 1

                float3 acc = 0;
                [unroll]
                for (int t = 0; t < 9; t++)
                {
                    int ty = t / 3 - 1;
                    int tx = t - (t / 3) * 3 - 1;
                    int2 q = clamp(lp + int2(tx, ty), int2(0, 0), lowMax);
                    // Выборка строго по центру текселя: билинейная фильтрация не
                    // размывает соседние тапы, результат совпадает с обучением.
                    float2 qUV = (float2(q) + 0.5) * invLow;
                    float4 c0 = tex2D(_C0, qUV);
                    float4 c1 = tex2D(_C1, qUV);

                    int base = 60 + (sub * 3) * 18 + t * 2;
                    float3 r;
                    r.r = dot(c0, BFX_W[base])      + dot(c1, BFX_W[base + 1]);
                    r.g = dot(c0, BFX_W[base + 18]) + dot(c1, BFX_W[base + 19]);
                    r.b = dot(c0, BFX_W[base + 36]) + dot(c1, BFX_W[base + 37]);
                    acc += r;
                }

                acc += BFX_W[56 + sub].rgb;
                float3 plain = tex2D(_Plain, i.uv).rgb;
                return float4(saturate(lerp(plain, acc, _Strength)), 1.0);
            }

            ENDCG
        }
    }
    Fallback Off
}
