using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

/// <summary>
/// URP Renderer Feature для ARM ASR.
/// Вставляет temporal upscale после opaque, до PostProcess/UI.
/// Требует: URP Motion Vectors On, Depth Priming On (для depth buffer).
/// На A15 — Vulkan, GLES 3.2 fallback через FFXM_FSR2_OPENGL_ES_3_2.
/// Пока — заглушка, после клона Generic Library заменяется на реальный Blit с ffxmFsr2ContextDispatch.
/// </summary>
public class ArmAsrFeature : ScriptableRendererFeature
{
    class ArmAsrPass : ScriptableRenderPass
    {
        Material blitMat;
        ArmAsrManager manager;
        RenderTargetHandle asrHistory;

        public void Setup(ArmAsrManager m, Material mat) { manager = m; blitMat = mat; }
        public override void Execute(ScriptableRenderContext ctx, ref RenderingData data)
        {
            if (manager == null || !manager.enabledASR || manager.preset == ArmAsrManager.AsrPreset.Off) return;
            // Реально:
            // - Собрать FfxmFsr2DispatchDescription: color= cameraColorTarget, depth= cameraDepthTarget,
            //   motionVectors= _CameraMotionVectorsTexture, reactive= _ReactiveMask (генерим если нет),
            //   renderSize = camera.pixelWidth*scale, displaySize = camera.pixelWidth
            // - ffxmFsr2ContextDispatch(ctx, desc)
            // Сейчас — Catmull-Rom блит как fallback чтобы не чёрный экран
            CommandBuffer cmd = CommandBufferPool.Get("ARM ASR");
            var src = data.cameraData.renderer.cameraColorTargetHandle;
            cmd.Blit(src, src, blitMat);
            ctx.ExecuteCommandBuffer(cmd);
            CommandBufferPool.Release(cmd);
        }
    }

    ArmAsrPass pass;
    public Material fallbackBlitMaterial; // URP Blit, заменяется на Arm ASR compute

    public override void Create()
    {
        pass = new ArmAsrPass();
        pass.renderPassEvent = RenderPassEvent.BeforeRenderingPostProcessing;
    }
    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData data)
    {
        var mgr = FindFirstObjectByType<ArmAsrManager>();
        if (mgr == null || fallbackBlitMaterial == null) return;
        pass.Setup(mgr, fallbackBlitMaterial);
        renderer.EnqueuePass(pass);
    }
}
