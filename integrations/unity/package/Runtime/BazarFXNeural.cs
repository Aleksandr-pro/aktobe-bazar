// BazarFX-Neural для Unity: прогон обученной сети на GPU.
//
// Сеть: conv 3->8 (3x3, ReLU) -> conv 8->12 (3x3) -> pixelshuffle x2.
// Веса лежат в BazarFXNeuralWeights.hlsl (генерируются scripts/export_unity_weights.py
// из тех же данных, что работают в Android-версии).
//
// Как это встраивается в кадр:
//   1. камера рендерит сцену в низком разрешении (Camera.targetTexture или
//      URP Asset -> Render Scale);
//   2. BazarFXNeural.Run() поднимает кадр сетью до 2x от низкого;
//   3. дальше результат можно отдать существующему BazarFXUpscale.shader
//      (Catmull-Rom + TAA + шарп) — он доводит до разрешения экрана.
//
// Пример:
//   var rt = BazarFXNeural.Run(lowRT);          // 2x от lowRT
//   Graphics.Blit(rt, dst, upscaleMaterial);

using System;
using UnityEngine;

namespace BazarFX
{
    public static class BazarFXNeural
    {
        public const int WeightCount = 276;

        static Material conv1;
        static Material conv2;
        static bool failed;

        public static bool IsAvailable
        {
            get
            {
                EnsureMaterials();
                return !failed;
            }
        }

        public static string LastError { get; private set; }

        /// <summary>Материалы для URP-фичи (создаются лениво).</summary>
        public sealed class MaterialPair
        {
            public Material Conv1;
            public Material Conv2;
        }

        static MaterialPair pair;

        public static MaterialPair Materials
        {
            get
            {
                EnsureMaterials();
                if (failed || conv1 == null) return null;
                if (pair == null) pair = new MaterialPair { Conv1 = conv1, Conv2 = conv2 };
                return pair;
            }
        }

        static void EnsureMaterials()
        {
            if (conv1 != null || failed) return;

            Shader s1 = Shader.Find("Hidden/BazarFX/NeuralConv1");
            Shader s2 = Shader.Find("Hidden/BazarFX/NeuralConv2");
            if (s1 == null || s2 == null)
            {
                failed = true;
                LastError = "Не найдены шейдеры Hidden/BazarFX/NeuralConv1/2. " +
                            "Проверь, что пакет BazarFX импортирован целиком.";
                Debug.LogError("[BazarFX] " + LastError);
                return;
            }

            conv1 = new Material(s1) { hideFlags = HideFlags.HideAndDontSave };
            conv2 = new Material(s2) { hideFlags = HideFlags.HideAndDontSave };
        }

        /// <summary>
        /// Прогоняет сеть по низкому разрешению. Возвращает временную текстуру
        /// размером source.width*2 × source.height*2. Вызывающий обязан вернуть
        /// её через <see cref="Release"/>.
        /// </summary>
        /// <param name="source">Кадр низкого разрешения.</param>
        /// <param name="strength">0 — чистый билинейный апскейл, 1 — полный выход сети.</param>
        public static RenderTexture Run(RenderTexture source, float strength = 1f)
        {
            EnsureMaterials();
            if (failed || source == null) return source;

            int lowW = source.width;
            int lowH = source.height;

            RenderTexture ch0 = RenderTexture.GetTemporary(lowW, lowH, 0,
                RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear);
            RenderTexture ch1 = RenderTexture.GetTemporary(lowW, lowH, 0,
                RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear);
            ch0.filterMode = FilterMode.Bilinear;
            ch1.filterMode = FilterMode.Bilinear;

            // --- первый слой: два RGBA-таргета (MRT)
            conv1.SetTexture("_MainTex", source);
            var targets = new RenderTargetIdentifier[]
            {
                new RenderTargetIdentifier(ch0),
                new RenderTargetIdentifier(ch1)
            };
            Graphics.SetRenderTarget(targets, new RenderTargetIdentifier(BuiltinRenderTextureType.None));
            GL.PushMatrix();
            GL.LoadOrtho();
            conv1.SetPass(0);
            DrawFullscreenQuad();
            GL.PopMatrix();

            // --- второй слой: 2x + pixelshuffle
            RenderTexture output = RenderTexture.GetTemporary(lowW * 2, lowH * 2, 0,
                RenderTextureFormat.ARGBHalf, RenderTextureReadWrite.Linear);
            output.filterMode = FilterMode.Bilinear;

            conv2.SetTexture("_C0", ch0);
            conv2.SetTexture("_C1", ch1);
            conv2.SetTexture("_Plain", source);
            conv2.SetFloat("_Strength", Mathf.Clamp01(strength));
            conv2.SetVector("_OutSize", new Vector4(lowW * 2, lowH * 2, 0, 0));
            Graphics.Blit(ch0, output, conv2);

            RenderTexture.ReleaseTemporary(ch0);
            RenderTexture.ReleaseTemporary(ch1);
            return output;
        }

        public static void Release(RenderTexture rt)
        {
            if (rt != null) RenderTexture.ReleaseTemporary(rt);
        }

        /// <summary>Полноэкранный треугольник (быстрее квада и без меша).</summary>
        static void DrawFullscreenQuad()
        {
            GL.Begin(GL.TRIANGLES);
            GL.TexCoord2(0f, 0f); GL.Vertex3(0f, 0f, 0f);
            GL.TexCoord2(2f, 0f); GL.Vertex3(2f, 0f, 0f);
            GL.TexCoord2(0f, 2f); GL.Vertex3(0f, 2f, 0f);
            GL.End();
        }

        /// <summary>Освобождает материалы (при выходе из Play Mode).</summary>
        public static void Dispose()
        {
            if (conv1 != null) UnityEngine.Object.DestroyImmediate(conv1);
            if (conv2 != null) UnityEngine.Object.DestroyImmediate(conv2);
            conv1 = null;
            conv2 = null;
            failed = false;
            LastError = null;
        }
    }
}
