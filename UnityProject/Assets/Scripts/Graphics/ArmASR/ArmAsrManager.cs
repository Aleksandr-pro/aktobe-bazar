using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

/// <summary>
/// ARM ASR (Accuracy Super Resolution) менеджер для GTA 6 Mini.
/// Основан на AMD FSR2 → оптимизирован Arm для Mali/Adreno (твой A15).
/// Пока Unity плагина нет — используем Generic Library (Vulkan) + Tight Integration.
/// 
/// Что делает:
/// - Jitter проекции каждый кадр (ffxmFsr2GetJitterOffset)
/// - Mip Bias = log2(render/display) - 1.0
/// - Dispatch с color/depth/motion/reactive
/// - Переключение Quality/Balanced/Performance на лету
/// </summary>
public class ArmAsrManager : MonoBehaviour
{
    public enum AsrPreset { Off, Quality_1_5x, Balanced_1_7x, Performance_2_0x }

    [Header("ARM ASR")]
    public bool enabledASR = true;
    public AsrPreset preset = AsrPreset.Quality_1_5x; // для A15 — Quality
    public bool enableSharpening = true;
    [Range(0f, 1f)] public float sharpness = 0.2f;
    public bool debugReactiveMask = false;

    [Header("Render Scale (внутри)")]
    [Tooltip("URP Render Scale — ставь 0.66 для 1.5x, 0.58 для 1.7x, 0.5 для 2.0x")]
    [Range(0.33f, 1f)] public float renderScale = 0.66f;

    Camera cam;
    Matrix4x4 originalProj;

    // Заглушка — после git clone Generic Library сюда подставятся реальные вызовы:
    // ffxmFsr2ContextCreate / ffxmFsr2GetJitterOffset / ffxmFsr2ContextDispatch
    // Сейчас — эмуляция чтобы проект компилился без либы.

    void Awake()
    {
        cam = Camera.main ?? GetComponent<Camera>();
        if (cam != null) originalProj = cam.projectionMatrix;
        ApplyMipBias();
        Debug.Log($"[ARM ASR] Инициализирован для Mali-G57 (A15). Preset={preset}, renderScale={renderScale}, jitter=on, mipBias={GetMipBias():F2}");
    }

    void OnEnable() => RenderPipelineManager.beginCameraRendering += OnBeginCamera;
    void OnDisable() => RenderPipelineManager.beginCameraRendering -= OnBeginCamera;

    void OnBeginCamera(ScriptableRenderContext ctx, Camera c)
    {
        if (!enabledASR || preset == AsrPreset.Off) return;
        if (c != cam) return;

        // 1. Jitter — каждый кадр сдвигаем проекцию на sub-pixel
        // Реально: ffxmFsr2GetJitterOffset(out jitterX, jitterY, frameIndex, displaySize)
        // Эмуляция: Halton(2,3) как в старом BazarFX
        int frame = Time.frameCount;
        float jitterX = Halton(frame, 2) - 0.5f;
        float jitterY = Halton(frame, 3) - 0.5f;
        // Применяем к камере (URP подхватит)
        float scaleX = 1f / c.pixelWidth;
        float scaleY = 1f / c.pixelHeight;
        Matrix4x4 jitterMat = Matrix4x4.Translate(new Vector3(jitterX * scaleX * 2f, jitterY * scaleY * 2f, 0));
        c.projectionMatrix = jitterMat * originalProj;

        // 2. Motion vectors — URP уже рендерит _CameraMotionVectorsTexture если включен Motion Vectors в URP Asset
        // 3. Reactive mask — для пальм/частиц казино (ffxmFsr2ContextGenerateReactiveMask)
        // 4. Dispatch — в ArmAsrFeature.cs (URP RenderPass) вызовет ffxmFsr2ContextDispatch(color, depth, motion, reactive, display)
    }

    float Halton(int index, int b) { float f = 1f, r = 0; int i = index; while (i > 0) { f /= b; r += f * (i % b); i /= b; } return r; }
    float GetMipBias() => Mathf.Log(renderScale, 2f) - 1f;
    void ApplyMipBias()
    {
        float bias = GetMipBias();
        // Применяем ко всем текстурам города (QualitySettings + material)
        // URP: GraphicsSettings + streamingMipmapsActive
        Shader.SetGlobalFloat("_MipBias", bias);
        Debug.Log($"[ARM ASR] MipBias={bias:F2} для renderScale {renderScale}");
    }

    // Переключение на лету — кнопка в HUD
    public void SetPreset(AsrPreset p)
    {
        preset = p;
        renderScale = p switch { AsrPreset.Quality_1_5x => 0.66f, AsrPreset.Balanced_1_7x => 0.58f, AsrPreset.Performance_2_0x => 0.5f, _ => 1f };
        ApplyMipBias();
        // Также менять URP Asset renderScale: URPAsset.renderScale = renderScale
        var urp = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
        if (urp) urp.renderScale = renderScale;
    }

    // Вызывается из HUD: "Графика → Низко/Средне/Высоко"
    public void ApplyQualityForA15()
    {
        // A15 рекомендации (Mali-G57):
        // - Включи Vulkan в Player Settings
        // - URP Shadows 1024, LOD 1.2, MSAA off, HDR off (экономия bandwidth)
        // - ASR Quality 1.5× (720→1080) — лучший баланс
        SetPreset(AsrPreset.Quality_1_5x);
        QualitySettings.vSyncCount = 0;
        Application.targetFrameRate = 60;
    }
}
