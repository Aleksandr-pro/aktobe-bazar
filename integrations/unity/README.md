# BazarFX — интеграция в Unity

Два файла:

| Файл | Что это |
| --- | --- |
| `BazarFXUpscale.shader` | проход апскейла: Catmull-Rom + TAA + адаптивный шарп |
| `BazarFXController.cs` | MonoBehaviour для камеры, пресеты, буферы истории |

## Быстрая установка (5 минут)

1. Скопируй папку `BazarFX` в `Assets/` своего Unity-проекта.
2. Выбери камеру → **Add Component → BazarFX → BazarFX Controller**.
3. В инспекторе выбери пресет (`Balanced` по умолчанию) и включи в камере
   **Rendering → Motion Vectors: Force No Motion** → *нет*, нужно наоборот:
   `Camera → Rendering → Motion Vectors` должен быть **включён** (URP) — иначе
   история не репроецируется и TAA автоматически отключается.
4. Запусти. Слева/справа можно сравнить, включив `showLowResAsClassic` (показывает
   «как без технологии»).

## Где берётся экономия

Компонент работает как финальный проход: берёт кадр сцены, даунсэмплит и
восстанавливает. Это даёт экономию на пост-обработке (блум, DOF, colour grading
идут в низком разрешении), но **не** на геометрии.

Чтобы сэкономить и на геометрии, нужно рендерить сцену в низком разрешении:

**URP (проще всего)**
```
Universal Render Pipeline Asset → Rendering
  Render Scale            = 0.5
  Upscaling Filter        = Point (Nearest)   // чтобы BazarFX заменил стандартный
```
и подключи `BazarFXController` как `ScriptableRendererFeature` (см. ниже).

**Built-in**
```csharp
cam.targetTexture = lowRT;   // 640×360 при 1280×720
cam.Render();
// затем Graphics.Blit(lowRT, screen, bazarFxMaterial)
```

## ScriptableRendererFeature для URP

```csharp
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public class BazarFXFeature : ScriptableRendererFeature
{
    public Shader shader;
    public float temporalBlend = 0.15f;
    public float sharpen = 0.45f;

    Material mat;
    BazarFXPass pass;

    public override void Create()
    {
        if (!shader) shader = Shader.Find("Hidden/BazarFX/Upscale");
        mat = CoreUtils.CreateEngineMaterial(shader);
        pass = new BazarFXPass(mat) { renderPassEvent = RenderPassEvent.BeforeRenderingPostProcessing };
        pass.ConfigureInput(ScriptableRenderPassInput.Motion); // motion vectors!
    }

    public override void AddRenderPasses(ScriptableRenderer renderer, ref RenderingData data)
    {
        mat.SetFloat("_Temporal", temporalBlend);
        mat.SetFloat("_Sharpen", sharpen);
        renderer.EnqueuePass(pass);
    }

    protected override void Dispose(bool disposing) => CoreUtils.Destroy(mat);
}

class BazarFXPass : ScriptableRenderPass
{
    readonly Material mat;
    RenderTexture history;
    bool valid;

    public BazarFXPass(Material m) { mat = m; }

    public override void Execute(ScriptableRenderContext ctx, ref RenderingData data)
    {
        var cmd = CommandBufferPool.Get("BazarFX");
        var src = data.cameraData.renderer.cameraColorTargetHandle;

        int w = data.cameraData.cameraTargetDescriptor.width;
        int h = data.cameraData.cameraTargetDescriptor.height;
        if (history == null || history.width != w)
        {
            if (history) history.Release();
            history = new RenderTexture(w, h, 0, RenderTextureFormat.DefaultHDR);
            history.Create();
            valid = false;
        }

        var desc = data.cameraData.cameraTargetDescriptor;
        desc.depthBufferBits = 0;
        var tmp = Shader.PropertyToID("_BazarFXTmp");
        cmd.GetTemporaryRT(tmp, desc);

        mat.SetTexture("_HistoryTex", history);
        mat.SetTexture("_VelocityTex", Shader.GetGlobalTexture("_CameraMotionVectorsTexture"));
        mat.SetFloat("_HistoryValid", valid ? 1 : 0);

        cmd.Blit(src, tmp, mat);
        cmd.Blit(tmp, src);
        cmd.Blit(tmp, history);
        valid = true;

        ctx.ExecuteCommandBuffer(cmd);
        CommandBufferPool.Release(cmd);
    }
}
```

## Платформы

* **Android (Vulkan / GLES3)** — работает, ядро то же, что в WebGL-демо.
* **iOS/Metal** — работает.
* **WebGL** — работает (это и есть демо на `/fx`).

## Что важно помнить

1. **Input lag** — TAA и апскейл не добавляют кадров, они лишь восстанавливают
   картинку. Задержка ввода остаётся как у низкого разрешения.
2. **Frame Generation в Unity** — отдельная история: нужно два кадра на один
   vsync и свой компоситор. В этом пакете его нет (в WebGL-демо — есть).
3. **Прозрачность и UI** — UI рисуйте после BazarFX, иначе он размоется
   апскейлом.
4. **Motion vectors** — если их нет (`_CameraMotionVectorsTexture` пустой),
   TAA выключится, останется только апскейл + шарп. Тогда качество будет как у
   FSR 1.0, это ожидаемо.
