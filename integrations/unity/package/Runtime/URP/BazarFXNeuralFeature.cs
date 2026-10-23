// BazarFX-Neural для URP: ScriptableRendererFeature.
//
// URP не вызывает OnRenderImage, поэтому компонент BazarFXController там не
// работает. Эта фича делает то же самое внутри URP-рендерера:
//   источник → сеть (conv1 MRT → conv2 + pixelshuffle x2) → финальный апскейл.
//
// Установка:
//   1. Пакет BazarFX импортирован в проект.
//   2. Universal Renderer Data → Add Renderer Feature → «BazarFX Neural Upscale».
//   3. В инспекторе выбери материал финального прохода (Shader
//      Hidden/BazarFX/Upscale) — он добавит Catmull-Rom/TAA/шарп. Можно оставить
//      пустым: тогда будет только нейросетевой апскейл.
//
// Чтобы получить выигрыш по FPS, включи Render Scale 0.5 в URP Asset (сцена
// рендерится в низком разрешении, сеть поднимает её обратно).

// Файл компилируется только когда в проекте есть URP и добавлен символ BFX_URP
// (Project Settings → Player → Scripting Define Symbols → BFX_URP).
// Без него пакет работает в Built-in RP через BazarFXController и не ломает сборку.
#if BFX_URP

using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace BazarFX
{
    [System.Serializable]
    public class BazarFXNeuralSettings
    {
        [Tooltip("0 — билинейно, 1 — полностью выход сети.")]
        [Range(0f, 1f)] public float strength = 1f;

        [Tooltip("Материал финального прохода (Shader/Hidden/BazarFX/Upscale). Необязателен.")]
        public Material finalMaterial;
    }

    public class BazarFXNeuralFeature : ScriptableRendererFeature
    {
        public BazarFXNeuralSettings settings = new BazarFXNeuralSettings();

        BazarFXNeuralPass pass;
        Mesh quad;

        public override void Create()
        {
            quad = new Mesh { name = "BazarFX_FullscreenQuad", hideFlags = HideFlags.HideAndDontSave };
            quad.SetVertices(new[]
            {
                new Vector3(-1, -1, 0), new Vector3(3, -1, 0), new Vector3(-1, 3, 0)
            });
            quad.SetUVs(0, new[] { new Vector2(0, 0), new Vector2(2, 0), new Vector2(0, 2) });
            quad.SetIndices(new[] { 0, 1, 2 }, MeshTopology.Triangles, 0);

            pass = new BazarFXNeuralPass(settings, quad)
            {
                renderPassEvent = RenderPassEvent.AfterRenderingPostProcessing
            };
        }

        public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData renderingData)
        {
            if (renderingData.cameraData.cameraType != CameraType.Game) return;
            if (!BazarFXNeural.IsAvailable) return;
            renderer.EnqueuePass(pass);
        }

        protected override void Dispose(bool disposing)
        {
            pass?.Dispose();
            if (quad != null) DestroyImmediate(quad);
        }

        class BazarFXNeuralPass : ScriptableRenderPass
        {
            readonly BazarFXNeuralSettings settings;
            readonly Mesh quad;
            readonly ProfilingSampler sampler = new ProfilingSampler("BazarFX Neural Upscale");

            static readonly int SourceId = Shader.PropertyToID("_BFXSource");
            static readonly int Ch0Id = Shader.PropertyToID("_BFXCh0");
            static readonly int Ch1Id = Shader.PropertyToID("_BFXCh1");
            static readonly int OutId = Shader.PropertyToID("_BFXOut");

            public BazarFXNeuralPass(BazarFXNeuralSettings settings, Mesh quad)
            {
                this.settings = settings;
                this.quad = quad;
            }

            public override void Execute(ScriptableRenderContext context, ref RenderingData renderingData)
            {
                var materials = BazarFXNeural.Materials;
                if (materials == null) return;

                CommandBuffer cmd = CommandBufferPool.Get();
                using (new ProfilingScope(cmd, sampler))
                {
                    var desc = renderingData.cameraData.cameraTargetDescriptor;
                    desc.depthBufferBits = 0;
                    desc.msaaSamples = 1;
                    int w = desc.width;
                    int h = desc.height;

                    RenderTargetIdentifier source = renderingData.cameraData.renderer.cameraColorTargetHandle;

                    // 1. копия источника в текстуру (сеть читает обычный sampler2D)
                    cmd.GetTemporaryRT(SourceId, desc, FilterMode.Bilinear);
                    cmd.Blit(source, SourceId);

                    // 2. первый слой: два RGBA-таргета (MRT)
                    var half = desc;
                    half.format = RenderTextureFormat.ARGBHalf;
                    cmd.GetTemporaryRT(Ch0Id, half, FilterMode.Bilinear);
                    cmd.GetTemporaryRT(Ch1Id, half, FilterMode.Bilinear);

                    materials.Conv1.SetTexture("_MainTex", Shader.GetGlobalTexture(SourceId));
                    // SetTexture по RTHandle нельзя — используем SetRenderTarget и DrawMesh,
                    // а вход подаём через глобальную текстуру, чтобы не зависеть от API.
                    cmd.SetGlobalTexture("_MainTex", SourceId);
                    cmd.SetRenderTarget(new[] { new RenderTargetIdentifier(Ch0Id), new RenderTargetIdentifier(Ch1Id) },
                        new RenderTargetIdentifier(BuiltinRenderTextureType.None));
                    cmd.DrawMesh(quad, Matrix4x4.identity, materials.Conv1, 0, 0);

                    // 3. второй слой + pixelshuffle x2
                    cmd.SetGlobalTexture("_C0", Ch0Id);
                    cmd.SetGlobalTexture("_C1", Ch1Id);
                    cmd.SetGlobalTexture("_Plain", SourceId);
                    materials.Conv2.SetFloat("_Strength", Mathf.Clamp01(settings.strength));
                    materials.Conv2.SetVector("_OutSize", new Vector4(w * 2, h * 2, 0, 0));
                    cmd.GetTemporaryRT(OutId, w * 2, h * 2, 0, FilterMode.Bilinear, RenderTextureFormat.ARGBHalf);
                    cmd.Blit(Ch0Id, OutId, materials.Conv2);

                    // 4. обратно в камеру (с финальным шарпом, если материал задан)
                    if (settings.finalMaterial != null)
                        cmd.Blit(OutId, source, settings.finalMaterial);
                    else
                        cmd.Blit(OutId, source);

                    cmd.ReleaseTemporaryRT(SourceId);
                    cmd.ReleaseTemporaryRT(Ch0Id);
                    cmd.ReleaseTemporaryRT(Ch1Id);
                    cmd.ReleaseTemporaryRT(OutId);
                }
                context.ExecuteCommandBuffer(cmd);
                CommandBufferPool.Release(cmd);
            }

            public void Dispose()
            {
                BazarFXNeural.Dispose();
            }
        }
    }
}

#endif // BFX_URP
