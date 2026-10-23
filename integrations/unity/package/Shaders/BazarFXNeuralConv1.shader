// BazarFX-Neural: первый свёрточный слой 3 -> 8 каналов (3x3, ReLU).
// Пишет в два RGBA-таргета (MRT): каналы 0..3 и 4..7.
Shader "Hidden/BazarFX/NeuralConv1"
{
    Properties
    {
        _MainTex ("Source (low res)", 2D) = "black" {}
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

            sampler2D _MainTex;
            float4 _MainTex_TexelSize;

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv  : TEXCOORD0;
            };

            struct outMRT
            {
                float4 a : SV_Target0;
                float4 b : SV_Target1;
            };

            v2f vert (appdata_img v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = v.texcoord;
                return o;
            }

            outMRT frag (v2f i)
            {
                float2 texel = _MainTex_TexelSize.xy;
                float4 acc0 = BFX_W[0];
                float4 acc1 = BFX_W[1];

                // 9 тапов 3x3, для каждого — 3 входных канала.
                [unroll]
                for (int t = 0; t < 9; t++)
                {
                    int ty = t / 3 - 1;
                    int tx = t - (t / 3) * 3 - 1;
                    float2 off = float2(tx, ty) * texel;
                    float3 s = tex2D(_MainTex, i.uv + off).rgb;

                    [unroll]
                    for (int c = 0; c < 3; c++)
                    {
                        float v = c == 0 ? s.r : (c == 1 ? s.g : s.b);
                        int base = 2 + (t * 3 + c) * 2;
                        acc0 += BFX_W[base] * v;
                        acc1 += BFX_W[base + 1] * v;
                    }
                }

                outMRT o;
                o.a = max(acc0, 0.0);
                o.b = max(acc1, 0.0);
                return o;
            }
            ENDCG
        }
    }
    Fallback Off
}
