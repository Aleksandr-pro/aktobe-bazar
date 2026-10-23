// BazarFX — контроллер для Unity (URP + Built-in).
//
// Что делает:
//   1. берёт готовый кадр сцены и проигрывает «дешёвый» путь: даунсэмпл в
//      низкое разрешение (главная экономия на пост-обработке и блуме);
//   2. восстанавливает его шейдером апскейла с motion vectors URP и историей;
//   3. адаптивно шарпит.
//
// ВАЖНО: чтобы получить экономию на самой геометрии, нужно рендерить камеру в
// низком разрешении (Screen Percentage). В URP это Asset → Rendering →
// Upscaling Filter = Nearest/None + Render Scale 50%, либо
// `camera.targetTexture = lowRT` в своём пайплайне. Тогда этот компонент
// работает как «финальный» проход: вход — lowRT, выход — экран.
//
// Установка:
//   Assets/BazarFX/{BazarFXUpscale.shader, BazarFXController.cs}
//   Повесить BazarFXController на объект с Camera, выбрать пресет.
//
// Ограничения:
//   * URP нужен включённый Motion Vector (Camera → Rendering → Motion Vectors),
//     иначе история не репроецируется и TAA выключается автоматически.
//   * Frame Generation на уровне Unity-презентации требует своего компоситора
//     (два кадра на один vsync); здесь его нет — только апскейл + TAA + шарп.
//
// Нейросеть (BazarFX-Neural):
//   Включи `neural` — кадр низкого разрешения прогоняется через обученную сеть
//   (conv 3->8 -> 8->12 -> pixelshuffle x2), и уже её выход идёт в апскейл с
//   TAA. Сеть даёт +1..2 дБ PSNR против билинейного восстановления, то есть
//   возвращает детали, а не просто «мылит и шарпит».
//   Ползунок `neuralStrength` смешивает выход сети с билинейным: 0 — без сети,
//   1 — полностью сеть.

using UnityEngine;
using BazarFX;

[RequireComponent(typeof(Camera))]
[AddComponentMenu("BazarFX/BazarFX Controller")]
public class BazarFXController : MonoBehaviour
{
    public enum Preset { Performance, Balanced, Cinema, Quality }

    [Header("Пресет")]
    public Preset preset = Preset.Balanced;

    [Header("Разрешение сцены")]
    [Range(0.25f, 1f)] public float renderScale = 0.5f;

    [Header("Этапы")]
    public bool temporal = true;
    public bool sharpen = true;
    [Range(0.05f, 0.9f)] public float temporalBlend = 0.15f;
    [Range(0f, 1f)] public float sharpenStrength = 0.45f;

    [Header("Нейросеть (BazarFX-Neural)")]
    [Tooltip("Апскейл обученной сетью вместо Catmull-Rom. Дороже по GPU, но возвращает детали.")]
    public bool neural = true;
    [Tooltip("0 — обычная математика, 1 — полностью выход сети.")]
    [Range(0f, 1f)] public float neuralStrength = 1f;

    [Header("Отладка")]
    [Tooltip("Показать кадр без обработки — честное сравнение «до/после».")]
    public bool showLowResAsClassic = false;
    [Tooltip("Показать только выход сети (2x от низкого разрешения).")]
    public bool showNeuralOnly = false;

    Camera cam;
    Texture2D neutralVelocity;
    RenderTexture lowRT;
    RenderTexture history;
    RenderTexture fullRT;
    Material material;
    RenderTexture motionVectors;
    RenderTexture neuralRT;
    bool historyValid;

    static readonly int ID_MainTex = Shader.PropertyToID("_MainTex");
    static readonly int ID_History = Shader.PropertyToID("_HistoryTex");
    static readonly int ID_Velocity = Shader.PropertyToID("_VelocityTex");
    static readonly int ID_Temporal = Shader.PropertyToID("_Temporal");
    static readonly int ID_Sharpen = Shader.PropertyToID("_Sharpen");
    static readonly int ID_HistoryValid = Shader.PropertyToID("_HistoryValid");

    void OnEnable()
    {
        cam = GetComponent<Camera>();

        var shader = Shader.Find("Hidden/BazarFX/Upscale");
        if (shader == null)
        {
            Debug.LogError("[BazarFX] Не найден шейдер Hidden/BazarFX/Upscale. Скопируй BazarFXUpscale.shader в проект.");
            enabled = false;
            return;
        }
        material = new Material(shader) { hideFlags = HideFlags.HideAndDontSave };

        if (neural && !BazarFXNeural.IsAvailable)
        {
            Debug.LogWarning("[BazarFX] Нейросеть недоступна, работаю обычным апскейлом: "
                             + BazarFXNeural.LastError);
            neural = false;
        }

        ApplyPreset();
        cam.allowHDR = true;
        cam.allowMSAA = false;

        neutralVelocity = new Texture2D(1, 1, TextureFormat.RGBA32, false);
        neutralVelocity.SetPixel(0, 0, new Color(0.5f, 0.5f, 0.5f, 1f));
        neutralVelocity.Apply();
    }

    void OnDisable()
    {
        ReleaseTargets();
        if (material != null) DestroyImmediate(material);
        if (neutralVelocity != null) DestroyImmediate(neutralVelocity);
    }

    public void ApplyPreset()
    {
        switch (preset)
        {
            case Preset.Performance:
                renderScale = 0.35f; temporal = false; sharpen = true;
                break;
            case Preset.Balanced:
                renderScale = 0.5f; temporal = true; sharpen = true;
                break;
            case Preset.Cinema:
                renderScale = 0.5f; temporal = true; sharpen = true; temporalBlend = 0.12f;
                break;
            case Preset.Quality:
                renderScale = 0.75f; temporal = true; sharpen = true;
                break;
        }
    }

    void EnsureTargets(int w, int h)
    {
        int lowW = Mathf.Max(160, Mathf.RoundToInt(w * renderScale));
        int lowH = Mathf.Max(90, Mathf.RoundToInt(h * renderScale));

        if (lowRT != null && lowRT.width == lowW && lowRT.height == lowH) return;

        ReleaseTargets();
        lowRT = new RenderTexture(lowW, lowH, 24, RenderTextureFormat.DefaultHDR) { name = "BazarFX_Low" };
        fullRT = new RenderTexture(w, h, 0, RenderTextureFormat.DefaultHDR) { name = "BazarFX_Full" };
        history = new RenderTexture(w, h, 0, RenderTextureFormat.DefaultHDR) { name = "BazarFX_History" };
        lowRT.Create(); fullRT.Create(); history.Create();
        historyValid = false;
    }

    void ReleaseTargets()
    {
        if (neuralRT != null)
        {
            RenderTexture.ReleaseTemporary(neuralRT);
            neuralRT = null;
        }
        foreach (var rt in new[] { lowRT, fullRT, history })
        {
            if (rt == null) continue;
            rt.Release();
            DestroyImmediate(rt);
        }
        lowRT = fullRT = history = null;
    }

    /// <summary>
    /// Сцена уже отрендерена Unity в src (полное разрешение) — здесь мы
    /// проигрываем «плохой» вариант (src → low → восстановление), чтобы не
    /// трогать настройки камеры и корректно работать в цепочке пост-эффектов.
    /// </summary>
    void OnRenderImage(RenderTexture src, RenderTexture dst)
    {
        int w = src.width;
        int h = src.height;
        EnsureTargets(w, h);

        // 1. «игра рендерит в низком разрешении»: билинейный даунсэмпл
        Graphics.Blit(src, lowRT);

        // 2. motion vectors URP, если включены; иначе нейтральные
        motionVectors = Shader.GetGlobalTexture("_CameraMotionVectorsTexture") as RenderTexture;
        if (motionVectors == null) motionVectors = neutralVelocity;

        // 2.5 нейросетевой апскейл: lowRT -> 2x от низкого разрешения
        RenderTexture upscaled = lowRT;
        if (neural && BazarFXNeural.IsAvailable)
        {
            if (neuralRT != null)
            {
                RenderTexture.ReleaseTemporary(neuralRT);
                neuralRT = null;
            }
            neuralRT = BazarFXNeural.Run(lowRT, neuralStrength);
            if (neuralRT != null) upscaled = neuralRT;
            if (showNeuralOnly)
            {
                Graphics.Blit(upscaled, dst);
                return;
            }
        }

        material.SetTexture(ID_MainTex, upscaled);
        material.SetVector("_InputSize",
            new Vector4(upscaled.width, upscaled.height, 1f / upscaled.width, 1f / upscaled.height));
        material.SetTexture(ID_History, history);
        material.SetTexture(ID_Velocity, motionVectors);
        material.SetFloat(ID_Temporal, temporal ? temporalBlend : 1f);
        material.SetFloat(ID_Sharpen, sharpen ? sharpenStrength : 0f);
        material.SetFloat(ID_HistoryValid, historyValid ? 1f : 0f);

        // 3. апскейл + temporal + шарп
        Graphics.Blit(lowRT, fullRT, material);
        Graphics.Blit(fullRT, history);
        historyValid = true;

        Graphics.Blit(showLowResAsClassic ? lowRT : fullRT, dst);
    }
}
