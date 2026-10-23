// BazarFX для Unity — проход апскейла (URP/Built-in).
// Положи в Assets/BazarFX/ и создай материал с этим шейдером.
Shader "Hidden/BazarFX/Upscale"
{
    Properties
    {
        _MainTex ("Low-res source", 2D) = "white" {}
        _HistoryTex ("History", 2D) = "black" {}
        _VelocityTex ("Motion vectors", 2D) = "gray" {}
        _Temporal ("Temporal blend", Range(0, 1)) = 0.15
        _Sharpen ("Sharpening", Range(0, 1)) = 0.45
        _VelocityScale ("Velocity scale", Float) = 0.09
        _HistoryValid ("History valid", Float) = 0
    }

    SubShader
    {
        Cull Off ZWrite Off ZTest Always

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            sampler2D _MainTex;
            float4 _MainTex_TexelSize;
            sampler2D _HistoryTex;
            sampler2D _VelocityTex;
            float _Temporal;
            float _Sharpen;
            float _VelocityScale;
            float _HistoryValid;

            struct appdata { float4 vertex : POSITION; float2 uv : TEXCOORD0; };
            struct v2f { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; };

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = v.uv;
                return o;
            }

            float cr(float x)
            {
                x = abs(x);
                if (x < 1.0) return 1.5 * x * x * x - 2.5 * x * x + 1.0;
                if (x < 2.0) return -0.5 * x * x * x + 2.5 * x * x - 4.0 * x + 2.0;
                return 0.0;
            }

            // Catmull-Rom 4x4 — то же ядро, что в WebGL-версии
            float3 upsampleCatmull(float2 uv)
            {
                float2 texel = _MainTex_TexelSize.xy;
                float2 p = uv / texel - 0.5;
                float2 i = floor(p);
                float2 f = p - i;

                float3 acc = 0;
                float wsum = 0;
                [unroll]
                for (int y = -1; y <= 2; y++)
                {
                    [unroll]
                    for (int x = -1; x <= 2; x++)
                    {
                        float2 o = float2(x, y);
                        float w = cr(o.x - f.x) * cr(o.y - f.y);
                        float2 st = (i + o + 0.5) * texel;
                        acc += tex2D(_MainTex, saturate(st)).rgb * w;
                        wsum += w;
                    }
                }
                float3 col = acc / max(wsum, 1e-4);

                // edge guard
                float3 mn = 1e4, mx = -1e4;
                [unroll]
                for (int yy = -1; yy <= 1; yy++)
                {
                    [unroll]
                    for (int xx = -1; xx <= 1; xx++)
                    {
                        float3 s = tex2D(_MainTex, saturate(uv + float2(xx, yy) * texel)).rgb;
                        mn = min(mn, s);
                        mx = max(mx, s);
                    }
                }
                float range = max(mx.r - mn.r, max(mx.g - mn.g, mx.b - mn.b));
                return saturate(col + 0.0);
            }

            float3 sharpen(float2 uv, float3 cur)
            {
                float2 texel = _MainTex_TexelSize.xy;
                float3 b = tex2D(_MainTex, uv + float2(0, -texel.y)).rgb;
                float3 d = tex2D(_MainTex, uv + float2(-texel.x, 0)).rgb;
                float3 f = tex2D(_MainTex, uv + float2(texel.x, 0)).rgb;
                float3 h = tex2D(_MainTex, uv + float2(0, texel.y)).rgb;

                float3 mn = min(min(b, d), min(f, h));
                float3 mx = max(max(b, d), max(f, h));
                float3 contrast = mx - mn;
                float3 adaptive = 1.0 / (1.0 + contrast * 9.0);
                float3 laplacian = (b + d + f + h) * 0.25 - cur;
                float3 col = cur - laplacian * _Sharpen * adaptive * 2.0;
                return clamp(col, mn - 0.02, mx + 0.02);
            }

            fixed4 frag(v2f i) : SV_Target
            {
                float3 current = upsampleCatmull(i.uv);

                float2 vel = (tex2D(_VelocityTex, i.uv).rg * 2.0 - 1.0) * _VelocityScale;
                float3 history = tex2D(_HistoryTex, saturate(i.uv - vel)).rgb;

                // variance clipping 3x3
                float3 m1 = 0, m2 = 0;
                [unroll]
                for (int y = -1; y <= 1; y++)
                {
                    [unroll]
                    for (int x = -1; x <= 1; x++)
                    {
                        float3 s = tex2D(_MainTex, i.uv + float2(x, y) * _MainTex_TexelSize.xy).rgb;
                        m1 += s;
                        m2 += s * s;
                    }
                }
                m1 /= 9.0;
                m2 /= 9.0;
                float3 sigma = sqrt(max(m2 - m1 * m1, 0));
                history = clamp(history, m1 - sigma * 1.6, m1 + sigma * 1.6);

                float alpha = lerp(1.0, _Temporal, _HistoryValid);
                float3 col = lerp(history, current, alpha);
                col = sharpen(i.uv, col);
                return fixed4(saturate(col), 1.0);
            }
            ENDCG
        }
    }
}
