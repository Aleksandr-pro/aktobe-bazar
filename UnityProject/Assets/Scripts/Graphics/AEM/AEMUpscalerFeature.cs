using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

/// <summary>
/// URP Renderer Feature — наша DLSS/AEM. Вставляется после PostProcess.
/// Рендерит в 0.5x (540p) → нейросеть x2 (3→8→12 + enhance 3→8→3) → 1080p.
/// На A15 — Quality preset, на флагмане — off.
/// Веса общие с Android SRWeights.java (443 веса).
/// </summary>
public class AEMUpscalerFeature : ScriptableRendererFeature
{
    public enum Preset { Off, Quality, Performance, Enhance }
    public Preset preset = Preset.Quality;

    class Pass : ScriptableRenderPass
    {
        Material upscaleMat, enhanceMat;
        RenderTargetHandle lowRes, history;
        Preset preset;

        public void Setup(Material up, Material enh, Preset p) { upscaleMat = up; enhanceMat = enh; preset = p; }

        public override void Execute(ScriptableRenderContext ctx, ref RenderingData data)
        {
            if (preset == Preset.Off) return;
            CommandBuffer cmd = CommandBufferPool.Get("AEM Upscale");
            // 1. downscale уже сделал URP (renderScale 0.5)
            // 2. upscale нейросетью
            cmd.Blit(data.cameraData.renderer.cameraColorTargetHandle, data.cameraData.renderer.cameraColorTargetHandle, upscaleMat);
            // 3. enhance (дорисовка) если Preset.Enhance
            if (preset == Preset.Enhance)
                cmd.Blit(data.cameraData.renderer.cameraColorTargetHandle, data.cameraData.renderer.cameraColorTargetHandle, enhanceMat);
            ctx.ExecuteCommandBuffer(cmd);
            CommandBufferPool.Release(cmd);
        }
    }

    Pass pass;
    public Material upscaleMaterial;
    public Material enhanceMaterial;

    public override void Create() { pass = new Pass(); pass.renderPassEvent = RenderPassEvent.BeforeRenderingPostProcessing; }
    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData data)
    {
        if (upscaleMaterial == null) return;
        pass.Setup(upscaleMaterial, enhanceMaterial, preset);
        renderer.EnqueuePass(pass);
    }
}
