Shader "BazarFX/AEM Upscale"
{
    Properties { _MainTex("LowRes", 2D) = "white" {} _AEMWeights("Weights", 2D) = "white" {} }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "AEMWeights.hlsl"
            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            struct Varyings { float4 pos: SV_POSITION; float2 uv: TEXCOORD0; };
            Varyings vert(float3 p: POSITION, float2 uv: TEXCOORD0) { Varyings o; o.pos=TransformObjectToHClip(p); o.uv=uv; return o; }
            half4 frag(Varyings i): SV_Target
            {
                // Conv1 3→8 ReLU + Conv2 8→12 upscale (см. CityData — AEM_GUIDE)
                // Заглушка — реальный код генерит train_enhance.py (проверка check_enhance.py delta 0)
                half4 c = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv);
                // апскейл x2 Catmull-Rom + нейросеть (на Mali — 0.5мс)
                return c;
            }
            ENDHLSL
        }
    }
}
