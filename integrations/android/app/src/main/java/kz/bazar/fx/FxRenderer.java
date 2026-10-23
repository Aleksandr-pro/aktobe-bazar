package kz.bazar.fx;

import android.graphics.SurfaceTexture;
import android.opengl.GLES11Ext;
import android.opengl.GLES30;
import android.opengl.GLSurfaceView;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * Пайплайн BazarFX на OpenGL ES 3.0.
 *
 * Поток кадра:
 *   OES-текстура (кадр, снятый MediaProjection)
 *     → сцена низкого разрешения (renderScale)
 *     → Catmull-Rom апскейл до полного разрешения
 *     → (опц.) temporal-накопление / TAA
 *     → адаптивный шарпенинг (RCAS-подобный)
 *     → (опц.) clarity — локальный контраст, «объём»
 *     → (опц.) grade — тон, насыщенность, антибандинг
 *     → экран (в оверлее поверх игры)
 *
 * Пресеты качества (Экономия … Реализм) включают разное количество проходов,
 * поэтому буферы выделяются лениво: на слабом пресете память не тратится на
 * проходы, которые выключены.
 */
public class FxRenderer implements GLSurfaceView.Renderer, SurfaceTexture.OnFrameAvailableListener {

    public interface StatsListener {
        void onStats(float captureFps, float presentFps, int lowW, int lowH, int fullW, int fullH,
                     float latencyMs);

        /** Непоправимая ошибка пайплайна — сервис должен аккуратно выключиться. */
        void onError(String message);

        /** Не критично для работы, но пользователю стоит знать (например, игра блокирует захват). */
        void onWarning(String message);
    }

    private static final String VERT = ""
            + "#version 300 es\n"
            + "precision highp float;\n"
            + "out vec2 vUV;\n"
            + "void main() {\n"
            + "  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n"
            + "  vUV = p;\n"
            + "  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n"
            + "}\n";

    /** Снимаем OES-кадр в обычную 2D-текстуру низкого разрешения. */
    private static final String FRAG_SAMPLE = ""
            + "#version 300 es\n"
            + "#extension GL_OES_EGL_image_external_essl3 : require\n"
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "out vec4 fragColor;\n"
            + "uniform samplerExternalOES tOes;\n"
            + "void main() {\n"
            // Кадр из MediaProjection лежит в текстуре строками сверху вниз, а
            // GL читает текстуру снизу вверх — без этого переворота картинка
            // выводится вверх ногами (и «не работают кнопки», потому что всё
            // нажатия попадают не туда, где они нарисованы).
            + "  vec2 uv = vec2(vUV.x, 1.0 - vUV.y);\n"
            + "  fragColor = vec4(texture(tOes, uv).rgb, 1.0);\n"
            + "}\n";

    /** Простое копирование текстуры (для истории/предыдущего кадра). */
    private static final String FRAG_COPY = ""
            + "#version 300 es\n"
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "out vec4 fragColor;\n"
            + "uniform sampler2D tSrc;\n"
            + "void main() { fragColor = texture(tSrc, vUV); }\n";

    /** Catmull-Rom апскейл с ограничителем ringing (как в веб-версии). */
    private static final String FRAG_UPSCALE = ""
            + "#version 300 es\n"
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "out vec4 fragColor;\n"
            + "uniform sampler2D tLow;\n"
            + "uniform vec2 uLowRes;\n"
            + "float cr(float x) {\n"
            + "  x = abs(x);\n"
            + "  if (x < 1.0) return 1.5 * x * x * x - 2.5 * x * x + 1.0;\n"
            + "  if (x < 2.0) return -0.5 * x * x * x + 2.5 * x * x - 4.0 * x + 2.0;\n"
            + "  return 0.0;\n"
            + "}\n"
            + "void main() {\n"
            + "  vec2 texel = 1.0 / uLowRes;\n"
            + "  vec2 p = vUV / texel - 0.5;\n"
            + "  vec2 i = floor(p);\n"
            + "  vec2 f = p - i;\n"
            + "  vec3 acc = vec3(0.0);\n"
            + "  float wsum = 0.0;\n"
            + "  for (int y = -1; y <= 2; y++) {\n"
            + "    for (int x = -1; x <= 2; x++) {\n"
            + "      vec2 o = vec2(float(x), float(y));\n"
            + "      float w = cr(o.x - f.x) * cr(o.y - f.y);\n"
            + "      vec2 st = (i + o + 0.5) * texel;\n"
            + "      acc += texture(tLow, clamp(st, texel * 0.5, 1.0 - texel * 0.5)).rgb * w;\n"
            + "      wsum += w;\n"
            + "    }\n"
            + "  }\n"
            + "  vec3 col = acc / max(wsum, 1e-4);\n"
            + "  vec3 mn = vec3(1e4), mx = vec3(-1e4);\n"
            + "  for (int y = -1; y <= 1; y++) {\n"
            + "    for (int x = -1; x <= 1; x++) {\n"
            + "      vec2 st = vUV + vec2(float(x), float(y)) * texel;\n"
            + "      vec3 s = texture(tLow, clamp(st, texel * 0.5, 1.0 - texel * 0.5)).rgb;\n"
            + "      mn = min(mn, s); mx = max(mx, s);\n"
            + "    }\n"
            + "  }\n"
            + "  float range = max(mx.r - mn.r, max(mx.g - mn.g, mx.b - mn.b));\n"
            + "  col = clamp(col, mn - range * 0.35, mx + range * 0.35);\n"
            + "  fragColor = vec4(max(col, 0.0), 1.0);\n"
            + "}\n";

    /** Temporal: репроекция истории + variance clipping. */
    private static final String FRAG_TEMPORAL = ""
            + "#version 300 es\n"
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "out vec4 fragColor;\n"
            + "uniform sampler2D tCurrent;\n"
            + "uniform sampler2D tHistory;\n"
            + "uniform sampler2D tVelocity;\n"
            + "uniform vec2 uFullRes;\n"
            + "uniform float uAlpha;\n"
            + "uniform float uHistoryValid;\n"
            + "uniform float uVelRange;\n"
            + "void main() {\n"
            + "  vec2 texel = 1.0 / uFullRes;\n"
            + "  vec3 m1 = vec3(0.0), m2 = vec3(0.0);\n"
            + "  vec3 mn = vec3(1e4), mx = vec3(-1e4);\n"
            + "  for (int y = -1; y <= 1; y++) {\n"
            + "    for (int x = -1; x <= 1; x++) {\n"
            + "      vec3 s = texture(tCurrent, vUV + vec2(float(x), float(y)) * texel).rgb;\n"
            + "      m1 += s; m2 += s * s; mn = min(mn, s); mx = max(mx, s);\n"
            + "    }\n"
            + "  }\n"
            + "  m1 /= 9.0; m2 /= 9.0;\n"
            + "  vec3 sigma = sqrt(max(m2 - m1 * m1, 0.0));\n"
            + "  vec2 vel = (texture(tVelocity, vUV).rg * 2.0 - 1.0) * uVelRange;\n"
            + "  vec3 hist = texture(tHistory, clamp(vUV - vel, vec2(0.0), vec2(1.0))).rgb;\n"
            + "  hist = clamp(hist, max(mn, m1 - sigma * 1.25), min(mx, m1 + sigma * 1.25));\n"
            + "  vec3 cur = texture(tCurrent, vUV).rgb;\n"
            + "  float alpha = mix(1.0, uAlpha, uHistoryValid);\n"
            + "  // История не годится там, где картинка заметно изменилась: без motion\n"
            + "  // vectors это единственный способ не оставить шлейф за движущимся объектом.\n"
            + "  vec3 diff = abs(cur - hist);\n"
            + "  float moved = smoothstep(0.05, 0.16, max(diff.r, max(diff.g, diff.b)));\n"
            + "  alpha = mix(alpha, 1.0, moved);\n"
            + "  fragColor = vec4(mix(hist, cur, alpha), 1.0);\n"
            + "}\n";

    /** Адаптивный шарпенинг (RCAS-подобный). */
    private static final String FRAG_SHARPEN = ""
            + "#version 300 es\n"
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "out vec4 fragColor;\n"
            + "uniform sampler2D tSrc;\n"
            + "uniform vec2 uFullRes;\n"
            + "uniform float uStrength;\n"
            + "void main() {\n"
            + "  vec2 texel = 1.0 / uFullRes;\n"
            + "  vec3 e = texture(tSrc, vUV).rgb;\n"
            + "  vec3 b = texture(tSrc, vUV + vec2(0.0, -texel.y)).rgb;\n"
            + "  vec3 d = texture(tSrc, vUV + vec2(-texel.x, 0.0)).rgb;\n"
            + "  vec3 f = texture(tSrc, vUV + vec2(texel.x, 0.0)).rgb;\n"
            + "  vec3 h = texture(tSrc, vUV + vec2(0.0, texel.y)).rgb;\n"
            + "  vec3 mn = min(min(b, d), min(f, h));\n"
            + "  vec3 mx = max(max(b, d), max(f, h));\n"
            + "  vec3 adaptive = vec3(1.0) / (1.0 + (mx - mn) * 9.0);\n"
            + "  vec3 lap = (b + d + f + h) * 0.25 - e;\n"
            + "  vec3 col = e - lap * uStrength * adaptive * 2.0;\n"
            + "  fragColor = vec4(clamp(col, mn - 0.02, mx + 0.02), 1.0);\n"
            + "}\n";

    /**
     * Clarity: локальный контраст на среднем радиусе. Даёт «объём» и
     * детализацию текстур, не превращая края в белые ореолы — сила
     * подавляется там, где перепад слишком большой (край объекта).
     */
    private static final String FRAG_CLARITY = ""
            + "#version 300 es\n"
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "out vec4 fragColor;\n"
            + "uniform sampler2D tSrc;\n"
            + "uniform vec2 uFullRes;\n"
            + "uniform float uAmount;\n"
            + "void main() {\n"
            + "  vec2 t = 1.0 / uFullRes;\n"
            + "  vec3 e = texture(tSrc, vUV).rgb;\n"
            + "  vec3 blur = vec3(0.0);\n"
            + "  blur += texture(tSrc, vUV + vec2( 2.0,  0.0) * t).rgb;\n"
            + "  blur += texture(tSrc, vUV + vec2(-2.0,  0.0) * t).rgb;\n"
            + "  blur += texture(tSrc, vUV + vec2( 0.0,  2.0) * t).rgb;\n"
            + "  blur += texture(tSrc, vUV + vec2( 0.0, -2.0) * t).rgb;\n"
            + "  blur += texture(tSrc, vUV + vec2( 1.5,  1.5) * t).rgb * 0.6;\n"
            + "  blur += texture(tSrc, vUV + vec2(-1.5,  1.5) * t).rgb * 0.6;\n"
            + "  blur += texture(tSrc, vUV + vec2( 1.5, -1.5) * t).rgb * 0.6;\n"
            + "  blur += texture(tSrc, vUV + vec2(-1.5, -1.5) * t).rgb * 0.6;\n"
            + "  blur /= 6.4;\n"
            + "  vec3 detail = e - blur;\n"
            + "  float edge = smoothstep(0.06, 0.35, length(detail));\n"
            + "  vec3 col = e + detail * uAmount * (1.0 - edge * 0.75);\n"
            + "  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);\n"
            + "}\n";

    /**
     * Grade: мягкая S-кривая контраста, насыщенность и антибандинг.
     * Дизеринг ±0.5 LSB убивает полосы на градиентах (небо, туман, тени) —
     * именно из-за них картинка выглядит «цифровой».
     */
    private static final String FRAG_GRADE = ""
            + "#version 300 es\n"
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "out vec4 fragColor;\n"
            + "uniform sampler2D tSrc;\n"
            + "uniform vec2 uFullRes;\n"
            + "uniform float uAmount;\n"
            + "uniform float uDither;\n"
            + "float hash(vec2 p) {\n"
            + "  p = fract(p * vec2(443.897, 441.423));\n"
            + "  p += dot(p, p.yx + 19.19);\n"
            + "  return fract((p.x + p.y) * p.x);\n"
            + "}\n"
            + "void main() {\n"
            + "  vec3 c = clamp(texture(tSrc, vUV).rgb, 0.0, 1.0);\n"
            + "  float k = uAmount * 0.35;\n"
            + "  vec3 s = mix(c, smoothstep(vec3(0.02), vec3(0.98), c), k);\n"
            + "  float l = dot(s, vec3(0.299, 0.587, 0.114));\n"
            + "  s = mix(vec3(l), s, 1.0 + uAmount * 0.12);\n"
            + "  float n = (hash(vUV * uFullRes + uDither) - 0.5) / 255.0;\n"
            + "  fragColor = vec4(clamp(s + n, 0.0, 1.0), 1.0);\n"
            + "}\n";

    /**
     * Нейросетевой апскейлер BazarFX-Neural: настоящий forward-pass свёрточной
     * сети во фрагментных шейдерах.
     *
     *   conv1: 3 → 8 каналов, 3×3, ReLU   (пишем в две RGBA-текстуры, MRT)
     *   conv2: 8 → 12, 3×3                (12 = 4 подпикселя × RGB)
     *   pixelshuffle ×2                   (подпиксель выбирается по gl_FragCoord)
     *
     * Веса обучены офлайн (scripts/train_sr.py) и лежат в RGBA32F-текстуре.
     * Раскладка (тексель = 4 float):
     *   [0..1]    bias conv1 (8 значений)
     *   [2..55]   conv1: tap(9) × in(3) × группа(2)
     *   [56..59]  bias conv2 по подпикселям (4 × rgb)
     *   [60..275] conv2: subpixel(4) × out(3) × tap(9) × группа(2)
     */
    private static final int W_TEXELS = 276;

    private static final String FRAG_NET_CONV1 = ""
            + "#version 300 es\n"
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "layout(location = 0) out vec4 outA;\n"
            + "layout(location = 1) out vec4 outB;\n"
            + "uniform sampler2D tSrc;\n"
            + "uniform sampler2D tW;\n"
            + "uniform vec2 uSize;\n"
            + "void main() {\n"
            + "  vec2 texel = 1.0 / uSize;\n"
            + "  vec4 acc0 = texelFetch(tW, ivec2(0, 0), 0);\n"
            + "  vec4 acc1 = texelFetch(tW, ivec2(1, 0), 0);\n"
            + "  for (int t = 0; t < 9; t++) {\n"
            + "    int ty = t / 3 - 1;\n"
            + "    int tx = t - (t / 3) * 3 - 1;\n"
            + "    vec3 s = texture(tSrc, vUV + vec2(float(tx), float(ty)) * texel).rgb;\n"
            + "    for (int c = 0; c < 3; c++) {\n"
            + "      float v = c == 0 ? s.r : (c == 1 ? s.g : s.b);\n"
            + "      int base = 2 + (t * 3 + c) * 2;\n"
            + "      acc0 += texelFetch(tW, ivec2(base, 0), 0) * v;\n"
            + "      acc1 += texelFetch(tW, ivec2(base + 1, 0), 0) * v;\n"
            + "    }\n"
            + "  }\n"
            + "  outA = max(acc0, vec4(0.0));\n"
            + "  outB = max(acc1, vec4(0.0));\n"
            + "}\n";

    private static final String FRAG_NET_CONV2 = ""
            + "#version 300 es\n"
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "out vec4 fragColor;\n"
            + "uniform sampler2D tC0;\n"
            + "uniform sampler2D tC1;\n"
            + "uniform sampler2D tPlain;\n"
            + "uniform sampler2D tW;\n"
            + "uniform vec2 uLowSize;\n"
            + "uniform float uStrength;\n"
            + "void main() {\n"
            + "  ivec2 hp = ivec2(gl_FragCoord.xy);\n"
            + "  int sx = hp.x - (hp.x / 2) * 2;\n"
            + "  int sy = hp.y - (hp.y / 2) * 2;\n"
            // gl_FragCoord считается снизу вверх, а сеть обучалась в координатах
            // изображения сверху вниз — поэтому подпиксель по Y инвертируется.
            + "  int sub = (1 - sy) * 2 + sx;\n"
            + "  ivec2 lp = ivec2(hp.x / 2, hp.y / 2);\n"
            + "  ivec2 lmax = ivec2(uLowSize) - 1;\n"
            + "  vec3 acc = vec3(0.0);\n"
            + "  for (int t = 0; t < 9; t++) {\n"
            + "    int ty = t / 3 - 1;\n"
            + "    int tx = t - (t / 3) * 3 - 1;\n"
            + "    ivec2 q = clamp(lp + ivec2(tx, ty), ivec2(0), lmax);\n"
            + "    vec4 c0 = texelFetch(tC0, q, 0);\n"
            + "    vec4 c1 = texelFetch(tC1, q, 0);\n"
            // 3 выходных канала для выбранного подпикселя: считаем в одном проходе,
            // поэтому выборки c0/c1 переиспользуются (это главный выигрыш по скорости).
            + "    int base = 60 + (sub * 3) * 18 + t * 2;\n"
            + "    vec3 r = vec3(dot(c0, texelFetch(tW, ivec2(base, 0), 0))\n"
            + "                + dot(c1, texelFetch(tW, ivec2(base + 1, 0), 0)),\n"
            + "                 dot(c0, texelFetch(tW, ivec2(base + 18, 0), 0))\n"
            + "                + dot(c1, texelFetch(tW, ivec2(base + 19, 0), 0)),\n"
            + "                 dot(c0, texelFetch(tW, ivec2(base + 36, 0), 0))\n"
            + "                + dot(c1, texelFetch(tW, ivec2(base + 37, 0), 0)));\n"
            + "    acc += r;\n"
            + "  }\n"
            + "  acc += texelFetch(tW, ivec2(56 + sub, 0), 0).rgb;\n"
            + "  vec3 plain = texture(tPlain, vUV).rgb;\n"
            + "  fragColor = vec4(clamp(mix(plain, acc, uStrength), 0.0, 1.0), 1.0);\n"
            + "}\n";

    /** Блочный оптический поток (нужен только для генерации кадров). */
    private static final String FRAG_FLOW = ""
            + "#version 300 es\n"
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "out vec4 fragColor;\n"
            + "uniform sampler2D tCur;\n"
            + "uniform sampler2D tPrev;\n"
            + "uniform vec2 uLowRes;\n"
            + "uniform float uStep;\n"
            + "uniform float uSearch;\n"
            + "uniform float uTaps;\n"
            + "uniform float uVelRange;\n"
            + "const int MAX_SEARCH = 6;\n"
            + "const int MAX_TAPS = 2;\n"
            + "const float REG = 0.002;\n"
            + "float lc(vec2 uv) { return dot(texture(tCur, clamp(uv, vec2(0.0), vec2(1.0))).rgb, vec3(0.299, 0.587, 0.114)); }\n"
            + "float lp(vec2 uv) { return dot(texture(tPrev, clamp(uv, vec2(0.0), vec2(1.0))).rgb, vec3(0.299, 0.587, 0.114)); }\n"
            + "float sad(vec2 uv, vec2 tapStep, vec2 off) {\n"
            + "  float acc = 0.0;\n"
            + "  for (int y = -MAX_TAPS; y <= MAX_TAPS; y++) {\n"
            + "    for (int x = -MAX_TAPS; x <= MAX_TAPS; x++) {\n"
            + "      if (float(abs(x)) > uTaps || float(abs(y)) > uTaps) continue;\n"
            + "      vec2 t = vec2(float(x), float(y)) * tapStep;\n"
            + "      acc += abs(lc(uv + t) - lp(uv + t + off));\n"
            + "    }\n"
            + "  }\n"
            + "  return acc;\n"
            + "}\n"
            + "void main() {\n"
            + "  vec2 texel = 1.0 / uLowRes;\n"
            + "  vec2 tapStep = texel * uStep;\n"
            + "  float best = 1e9;\n"
            + "  vec2 bestOff = vec2(0.0);\n"
            + "  for (int dy = -MAX_SEARCH; dy <= MAX_SEARCH; dy++) {\n"
            + "    for (int dx = -MAX_SEARCH; dx <= MAX_SEARCH; dx++) {\n"
            + "      if (float(abs(dx)) > uSearch || float(abs(dy)) > uSearch) continue;\n"
            + "      vec2 off = vec2(float(dx), float(dy));\n"
            + "      float cost = sad(vUV, tapStep, off * uStep * texel) + REG * length(off);\n"
            + "      if (cost < best) { best = cost; bestOff = off; }\n"
            + "    }\n"
            + "  }\n"
            + "  float c0 = sad(vUV, tapStep, bestOff * uStep * texel);\n"
            + "  float sl = sad(vUV, tapStep, (bestOff + vec2(-1.0, 0.0)) * uStep * texel);\n"
            + "  float sr = sad(vUV, tapStep, (bestOff + vec2(1.0, 0.0)) * uStep * texel);\n"
            + "  float su = sad(vUV, tapStep, (bestOff + vec2(0.0, -1.0)) * uStep * texel);\n"
            + "  float sd = sad(vUV, tapStep, (bestOff + vec2(0.0, 1.0)) * uStep * texel);\n"
            + "  float denX = 2.0 * (sr - 2.0 * c0 + sl);\n"
            + "  float denY = 2.0 * (sd - 2.0 * c0 + su);\n"
            + "  float subX = abs(denX) > 1e-6 ? clamp((sl - sr) / denX, -1.0, 1.0) : 0.0;\n"
            + "  float subY = abs(denY) > 1e-6 ? clamp((su - sd) / denY, -1.0, 1.0) : 0.0;\n"
            + "  vec2 dispPx = -(bestOff + vec2(subX, subY)) * uStep;\n"
            + "  vec2 vel = dispPx * texel;\n"
            + "  float mag = length(vel);\n"
            + "  if (mag > uVelRange) vel *= uVelRange / max(mag, 1e-5);\n"
            + "  fragColor = vec4(clamp(vel / uVelRange * 0.5 + 0.5, 0.0, 1.0), 0.0, 1.0);\n"
            + "}\n";

    /** Апскейл + сглаживание поля потока. */
    private static final String FRAG_FLOW_UP = ""
            + "#version 300 es\n"
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "out vec4 fragColor;\n"
            + "uniform sampler2D tFlow;\n"
            + "uniform vec2 uLowRes;\n"
            + "void main() {\n"
            + "  vec2 texel = 1.0 / uLowRes;\n"
            + "  vec2 acc = vec2(0.0);\n"
            + "  float wsum = 0.0;\n"
            + "  for (int y = -1; y <= 1; y++) {\n"
            + "    for (int x = -1; x <= 1; x++) {\n"
            + "      float w = (x == 0 && y == 0) ? 1.0 : 0.5;\n"
            + "      vec2 s = texture(tFlow, vUV + vec2(float(x), float(y)) * texel * 1.5).rg * 2.0 - 1.0;\n"
            + "      acc += s * w; wsum += w;\n"
            + "    }\n"
            + "  }\n"
            + "  fragColor = vec4(clamp(acc / wsum * 0.5 + 0.5, 0.0, 1.0), 0.0, 1.0);\n"
            + "}\n";

    /** Вывод на экран + (опционально) интерполяция между двумя кадрами. */
    private static final String FRAG_DISPLAY = ""
            + "#version 300 es\n"
            + "#extension GL_OES_EGL_image_external_essl3 : require\n"
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "out vec4 fragColor;\n"
            + "uniform sampler2D tCurrent;\n"
            + "uniform sampler2D tPrevious;\n"
            + "uniform sampler2D tVelocity;\n"
            + "uniform samplerExternalOES tRawOes;\n"
            + "uniform float uPhase;\n"
            + "uniform float uVelRange;\n"
            + "uniform float uSplit;\n"
            + "void main() {\n"
            + "  vec3 col = texture(tCurrent, vUV).rgb;\n"
            + "  if (uPhase > 0.001) {\n"
            + "    vec2 vel = (texture(tVelocity, vUV).rg * 2.0 - 1.0) * uVelRange;\n"
            + "    vec3 prev = texture(tPrevious, clamp(vUV - vel * uPhase, vec2(0.0), vec2(1.0))).rgb;\n"
            + "    vec3 nxt = texture(tCurrent, clamp(vUV + vel * (1.0 - uPhase), vec2(0.0), vec2(1.0))).rgb;\n"
            + "    col = mix(prev, nxt, uPhase);\n"
            + "  }\n"
            + "  if (uSplit > 0.0) {\n"
            // Слева — что игра отдала, справа — что сделал BazarFX. Единственный
            // честный способ увидеть разницу на живой картинке.
            + "    vec2 rawUV = vec2(vUV.x, 1.0 - vUV.y);\n"
            + "    vec3 raw = texture(tRawOes, rawUV).rgb;\n"
            + "    col = vUV.x < uSplit ? raw : col;\n"
            + "    if (abs(vUV.x - uSplit) < 0.0012) col = vec3(0.2, 0.95, 0.6);\n"
            + "  }\n"
            + "  fragColor = vec4(col, 1.0);\n"
            + "}\n";

    private static final float VEL_RANGE = 0.09f;

    private final StatsListener statsListener;

    // --- копия настроек, которую читает GL-поток (без гонок за объектом SharedPreferences)
    private volatile float cfgScale = 0.7f;
    private volatile float cfgSharpen = 0.5f;
    private volatile float cfgClarity = 0.2f;
    private volatile float cfgGrade = 0f;
    private volatile boolean cfgTemporal;
    private volatile boolean cfgFrameGen;
    private volatile float cfgFlowStep = 3f;
    private volatile float cfgFlowSearch = 4f;
    private volatile float cfgFlowTaps = 1f;

    private GLSurfaceView view;
    private SurfaceTexture surfaceTexture;
    private int oesTexture = -1;
    private int surfaceTextureId = -1;

    private int sampleProgram, upscaleProgram, temporalProgram, sharpenProgram,
            clarityProgram, gradeProgram, flowProgram, flowUpProgram, displayProgram, copyProgram;

    private int lowFbo, lowTex, prevLowFbo, prevLowTex,
            upFbo, upTex, scratchFbo, scratchTex,
            histFboA, histTexA, histFboB, histTexB,
            frameFboA, frameTexA, frameFboB, frameTexB,
            flowFbo, flowTex, flowUpFbo, flowUpTex, neutralTex;

    // --- нейросетевой апскейлер (BazarFX-Neural)
    private int netConv1Program, netConv2Program, weightTexture;
    private int netLowFbo, netLowTex, netConv1Fbo, netC1TexA, netC1TexB, netOutFbo, netOutTex;
    private int netW = 1, netH = 1;
    private volatile boolean neural;
    private volatile float neuralStrength = 1f;
    private volatile float netScale = 0.45f;

    private int lowW = 1, lowH = 1, fullW = 1, fullH = 1;
    /** Сцена уже в полном разрешении: апскейл не нужен, а low-буфер работает как пробник. */
    private boolean directMode;
    private int flowGridW = 1, flowGridH = 1;

    private boolean historyValid;
    private boolean hasPrevFrame;
    private boolean flowValid;
    private int readHist;
    private int frameSlot;         // в какой из двух финальных буферов пишем этот кадр
    private long lastCaptureNanos;
    private double captureIntervalSec = 1 / 60.0;
    private boolean frameAvailable;
    private volatile boolean bypass;
    /** false — вывод на экран выключен (пользователь скрыл оверлей, чтобы играть/делать скриншоты). */
    private volatile boolean outputEnabled = true;
    /** 0 — выключено, иначе доля экрана, где показывается оригинал (сравнение «до/после»). */
    private volatile float split = 0f;
    /** Автоподстройка нагрузки: сами снижаем масштаб, если кадры не успевают. */
    private volatile boolean autoQuality = true;
    private volatile float autoScale = 1f;
    private float latencyMs;
    private int latencySamples;
    private volatile boolean frameGen;
    private int frameCounter;

    private int captureFrames;
    private int presentFrames;
    private long statsWindowStart;

    private volatile boolean glReady;      // контекст создан, можно аллоцировать
    private volatile boolean targetsReady; // FBO выделены и рабочие
    private volatile int desiredW, desiredH; // размер, запрошенный сервисом
    private int drawErrors;

    private volatile boolean failed;
    private volatile String lastError = "";
    private long lastBlackCheckNanos;
    private int consecutiveBlackFrames;
    private boolean warnedAboutBlack;

    public boolean isFailed() {
        return failed;
    }

    public String getLastError() {
        return lastError;
    }

    public FxRenderer(FxSettings settings, StatsListener listener) {
        this.statsListener = listener;
        applySettings(settings);
    }

    /** Копирует настройки в поля рендерера. Безопасно вызывать из любого потока. */
    public void applySettings(FxSettings s) {
        cfgScale = clamp(s.renderScale, 0.3f, 1f);
        cfgSharpen = clamp(s.sharpen, 0f, 1f);
        cfgClarity = clamp(s.clarity, 0f, 1f);
        cfgGrade = clamp(s.grade, 0f, 1f);
        cfgTemporal = s.temporal;
        cfgFrameGen = s.frameGen;
        cfgFlowStep = Math.max(2, s.flowStep);
        cfgFlowSearch = Math.max(1, s.flowSearch);
        cfgFlowTaps = Math.max(1f, Math.min(2f, s.flowTaps));
        autoQuality = s.autoQuality;
        neural = s.neural;
        neuralStrength = clamp(s.neuralStrength, 0f, 1f);
        netScale = clamp(s.neuralScale, 0.25f, 1f);
        if (!s.autoQuality) autoScale = 1f;
        split = s.splitCompare ? 0.5f : 0f;
        frameGen = s.frameGen;
    }

    /**
     * Настройки поменяли на ходу (пресет качества из оверлея или из приложения):
     * пересобираем буферы под новый renderScale и включаем/выключаем проходы.
     */
    public void updateSettings(FxSettings s) {
        applySettings(s);
        FxLog.i("Настройки применены: " + s.qualityName()
                + " (сцена " + Math.round(s.renderScale * 100) + "%, шарп "
                + Math.round(s.sharpen * 100) + "%, clarity " + Math.round(s.clarity * 100)
                + "%, тон " + Math.round(s.grade * 100) + "%, TAA " + s.temporal
                + ", frameGen " + s.frameGen + ")");
        if (view != null) {
            view.setRenderMode(frameGen ? GLSurfaceView.RENDERMODE_CONTINUOUSLY : GLSurfaceView.RENDERMODE_WHEN_DIRTY);
            view.queueEvent(new Runnable() {
                @Override
                public void run() {
                    try {
                        allocateTargets();
                    } catch (Throwable t) {
                        targetsReady = false;
                        FxLog.e("Не удалось применить настройки: " + t, t);
                    }
                    view.requestRender();
                }
            });
        }
    }

    public void attachView(GLSurfaceView view) {
        this.view = view;
    }

    public SurfaceTexture getSurfaceTexture() {
        return surfaceTexture;
    }

    /**
     * Смена размера (поворот, игра ушла в ландшафт). Важно: SurfaceTexture НЕ
     * пересоздаётся — старый SurfaceTexture нельзя освобождать, пока на него
     * пишет VirtualDisplay (это нативный краш). Достаточно поменять размер
     * буфера и пересоздать FBO.
     */
    public void onSurfaceSizeChanged(int width, int height) {
        desiredW = Math.max(2, width);
        desiredH = Math.max(2, height);
        if (desiredW == fullW && desiredH == fullH && targetsReady) return;
        if (!glReady) {
            // Сервис сообщает размер сразу после addView(), когда GL-поток ещё не
            // создал контекст. Раньше мы в этот момент лезли в GL и получали
            // «Framebuffer неполный: 0x0», после чего рендерер навсегда помечался
            // сломанным. Теперь просто запоминаем размер — применим в onSurfaceCreated.
            FxLog.i("Размер " + desiredW + "x" + desiredH + " запомнен (GL ещё не готов)");
            return;
        }
        applySize(desiredW, desiredH);
    }

    /** Применяет размер уже на GL-потоке. */
    private void applySize(final int width, final int height) {
        if (view == null) return;
        view.queueEvent(new Runnable() {
            @Override
            public void run() {
                setSizeOnGl(width, height);
            }
        });
    }

    /** Только из GL-потока. */
    private void setSizeOnGl(int width, int height) {
        if (!glReady) return;
        if (width == fullW && height == fullH && targetsReady) return;
        fullW = width;
        fullH = height;
        FxLog.i("Смена размера: " + fullW + "x" + fullH);
        try {
            allocateTargets();
            resizeSurfaceTexture();
        } catch (Throwable t) {
            // Транзиентная ошибка (например, нехватка памяти под буферы) не должна
            // убивать пайплайн: помечаем буферы неготовыми и повторим на следующем кадре.
            targetsReady = false;
            FxLog.e("Не удалось выделить буферы " + width + "x" + height + ": " + t, t);
        }
    }

    /** Включает/выключает вывод. При выключении GL-поток не тратит GPU на кадры. */
    public void setOutputEnabled(boolean enabled) {
        outputEnabled = enabled;
        if (view != null) view.requestRender();
    }

    public boolean isSplitOn() {
        return split > 0.01f;
    }

    public void setSplit(float value) {
        split = Math.max(0f, Math.min(1f, value));
        if (view != null) view.requestRender();
    }

    public void setAutoQuality(boolean value) {
        autoQuality = value;
        if (!value) autoScale = 1f;
    }

    /** Текущий фактический масштаб сцены (с учётом автоподстройки). */
    public float getEffectiveScale() {
        return clamp(cfgScale * autoScale, 0.3f, 1f);
    }

    public void setBypass(boolean value) {
        bypass = value;
        historyValid = false; // после сравнения историю нельзя тянуть — будет «призрак»
        if (view != null) view.requestRender();
    }

    public boolean isBypass() {
        return bypass;
    }

    public void setFrameGen(boolean value) {
        frameGen = value;
        if (view != null) {
            view.setRenderMode(value ? GLSurfaceView.RENDERMODE_CONTINUOUSLY : GLSurfaceView.RENDERMODE_WHEN_DIRTY);
            view.requestRender();
        }
    }

    // ---------------------------------------------------------------- GL setup

    @Override
    public void onSurfaceCreated(GL10 gl, EGLConfig config) {
        try {
            GLES30.glDisable(GLES30.GL_DEPTH_TEST);
            GLES30.glDisable(GLES30.GL_BLEND);
            GLES30.glDisable(GLES30.GL_DITHER);
            GLES30.glClearColor(0f, 0f, 0f, 1f);

            if (GLES30.glGetString(GLES30.GL_VERSION) == null) {
                fail("Устройство не поддерживает OpenGL ES 3.0", null);
                return;
            }

            sampleProgram = buildProgram(VERT, FRAG_SAMPLE);
            copyProgram = buildProgram(VERT, FRAG_COPY);
            upscaleProgram = buildProgram(VERT, FRAG_UPSCALE);
            temporalProgram = buildProgram(VERT, FRAG_TEMPORAL);
            sharpenProgram = buildProgram(VERT, FRAG_SHARPEN);
            clarityProgram = buildProgram(VERT, FRAG_CLARITY);
            gradeProgram = buildProgram(VERT, FRAG_GRADE);
            flowProgram = buildProgram(VERT, FRAG_FLOW);
            flowUpProgram = buildProgram(VERT, FRAG_FLOW_UP);
            displayProgram = buildProgram(VERT, FRAG_DISPLAY);
            netConv1Program = buildProgram(VERT, FRAG_NET_CONV1);
            netConv2Program = buildProgram(VERT, FRAG_NET_CONV2);
            weightTexture = createWeightTexture();
            FxLog.i("Нейросеть готова: " + SRWeights.COUNT + " весов, "
                    + SRWeights.C_IN + "->" + SRWeights.C_HID + "->" + SRWeights.C_OUT_SP);

            neutralTex = createTexture2D(1, 1, new byte[]{(byte) 128, (byte) 128, (byte) 128, (byte) 255});
            historyValid = false;
            hasPrevFrame = false;
            glReady = true;
            if (desiredW > 1 && (desiredW != fullW || desiredH != fullH)) {
                fullW = desiredW;
                fullH = desiredH;
            }
            allocateTargets();
            ensureSurfaceTexture();
            FxLog.i("GL готов: " + GLES30.glGetString(GLES30.GL_VERSION)
                    + " / " + GLES30.glGetString(GLES30.GL_RENDERER)
                    + ", экран " + fullW + "x" + fullH + ", сцена " + lowW + "x" + lowH);
        } catch (Throwable t) {
            fail("Не удалось инициализировать OpenGL: " + t, t);
        }
    }

    /** Создаёт SurfaceTexture один раз за жизнь GL-контекста. */
    private void ensureSurfaceTexture() {
        if (fullW <= 1) return;
        if (surfaceTexture != null) {
            resizeSurfaceTexture();
            return;
        }
        if (oesTexture == -1) {
            int[] t = new int[1];
            GLES30.glGenTextures(1, t, 0);
            oesTexture = t[0];
            GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture);
            GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR);
            GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR);
            GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE);
            GLES30.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE);
        }
        try {
            surfaceTexture = new SurfaceTexture(oesTexture);
            // Слушатель — на главный Looper: GL-поток без Looper может уронить SurfaceTexture
            surfaceTexture.setOnFrameAvailableListener(this, new android.os.Handler(android.os.Looper.getMainLooper()));
            surfaceTexture.setDefaultBufferSize(fullW, fullH);
            surfaceTextureId = oesTexture;
            FxLog.i("SurfaceTexture создан под " + fullW + "x" + fullH);
        } catch (Throwable t) {
            fail("Не удалось создать SurfaceTexture: " + t, t);
            return;
        }
        if (view != null) {
            view.setRenderMode(frameGen ? GLSurfaceView.RENDERMODE_CONTINUOUSLY : GLSurfaceView.RENDERMODE_WHEN_DIRTY);
        }
    }

    /** Меняет только размер буфера — без release(), иначе VirtualDisplay пишет в освобождённый Surface. */
    private void resizeSurfaceTexture() {
        if (surfaceTexture == null) {
            ensureSurfaceTexture();
            return;
        }
        try {
            surfaceTexture.setDefaultBufferSize(fullW, fullH);
        } catch (Throwable t) {
            FxLog.w("setDefaultBufferSize не удался: " + t);
        }
    }

    @Override
    public void onSurfaceChanged(GL10 gl, int width, int height) {
        try {
            // Размер оверлея может отличаться от размера экрана (вырез, панель
            // навигации). Источник истины — сервис: он задаёт размер захвата.
            if (desiredW <= 1) {
                fullW = Math.max(2, width);
                fullH = Math.max(2, height);
            } else if (Math.abs(width - fullW) > 4 || Math.abs(height - fullH) > 4) {
                FxLog.i("Поверхность оверлея " + width + "x" + height
                        + ", рендерим в " + fullW + "x" + fullH);
            }
            GLES30.glViewport(0, 0, fullW, fullH);
            allocateTargets();
            ensureSurfaceTexture();
        } catch (Throwable t) {
            targetsReady = false;
            FxLog.e("onSurfaceChanged: " + t, t);
        }
    }

    @Override
    public void onDrawFrame(GL10 gl) {
        if (failed || surfaceTextureId == -1 || fullW <= 1) return;
        if (!outputEnabled) {
            // Оверлей скрыт: кадры из VirtualDisplay продолжают поступать, но мы
            // их не обрабатываем — экономия батареи и нулевая нагрузка на GPU.
            frameAvailable = false;
            return;
        }
        if (!targetsReady) {
            // Повторяем выделение буферов, пока не получится (например, игра
            // временно заняла всю видеопамять).
            try {
                allocateTargets();
            } catch (Throwable t) {
                targetsReady = false;
                if (drawErrors++ % 120 == 0) {
                    FxLog.e("Буферы всё ещё не готовы: " + t, null);
                }
                return;
            }
        }
        try {
            drawFrameInternal();
            drawErrors = 0;
        } catch (Throwable t) {
            // Одиночный сбой кадра — не повод выключать всю технологию.
            if (++drawErrors >= 30) {
                fail("Ошибка отрисовки: " + t, t);
            } else {
                FxLog.w("Сбой кадра (" + drawErrors + "): " + t);
            }
        }
    }

    private void drawFrameInternal() {
        boolean newFrame = frameAvailable;
        if (newFrame && surfaceTexture != null) {
            try {
                surfaceTexture.updateTexImage();
            } catch (Throwable t) {
                // SurfaceTexture «осиротел» (VirtualDisplay пересоздан/остановлен)
                FxLog.w("updateTexImage: " + t);
                frameAvailable = false;
                return;
            }
            frameAvailable = false;
        }

        long now = System.nanoTime();
        if (newFrame) {
            if (lastCaptureNanos > 0) {
                double delta = (now - lastCaptureNanos) / 1e9;
                if (delta > 0.001 && delta < 0.5) {
                    captureIntervalSec = captureIntervalSec * 0.85 + delta * 0.15;
                }
            }
            lastCaptureNanos = now;
            captureFrames++;

            if (!bypass) {
                renderPipeline();
            }
            hasPrevFrame = true;
            frameCounter++;
        }

        if (newFrame) {
            // Столько времени кадр шёл от захвата до экрана — это и есть та
            // задержка, из-за которой кажется, что «кнопки не нажимаются».
            long ageMs = (now - lastCaptureNanos) / 1_000_000L;
            if (ageMs >= 0 && ageMs < 1000) {
                latencyMs = latencyMs * 0.8f + ageMs * 0.2f;
                latencySamples++;
            }
        }

        if (bypass) {
            // Сравнение «без BazarFX»: показываем исходный кадр как есть —
            // без проходов, но и без потери резкости (раньше тут была сцена 0.7×).
            drawPassthrough();
            presentFrames++;
        } else if (frameGen && hasPrevFrame && lastCaptureNanos > 0) {
            double since = (now - lastCaptureNanos) / 1e9;
            float p = (float) Math.min(0.95, Math.max(0.0, since / Math.max(captureIntervalSec, 1e-3)));
            drawDisplay(flowValid ? p : 0f);
            presentFrames++;
        } else if (newFrame) {
            drawDisplay(0f);
            presentFrames++;
        }

        if (newFrame && !bypass) {
            detectBlackCapture(now);
        }

        reportStats(now);
    }

    /**
     * Некоторые игры (и почти все античиты) ставят FLAG_SECURE — тогда
     * MediaProjection отдаёт полностью чёрный кадр. Отличаем это от обычной
     * тёмной сцены и сообщаем пользователю, иначе выглядит как «сломалось».
     */
    private void detectBlackCapture(long now) {
        if (now - lastBlackCheckNanos < 1_500_000_000L) return;
        lastBlackCheckNanos = now;
        if (lowFbo == 0 || lowW <= 2) return;
        try {
            // Читаем именно СЫРУЮ сцену (что отдал MediaProjection), а не результат
            // обработки: у финального кадра есть дизеринг и шарп, по ним нельзя судить.
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, lowFbo);
            ByteBuffer buf = ByteBuffer.allocateDirect(16).order(ByteOrder.nativeOrder());
            GLES30.glReadPixels(0, 0, 2, 2, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, buf);
            int sum = 0;
            for (int i = 0; i < 16; i++) {
                sum += buf.get(i) & 0xFF;
            }
            if (sum < 24) {
                consecutiveBlackFrames++;
                if (consecutiveBlackFrames >= 2 && !warnedAboutBlack) {
                    warnedAboutBlack = true;
                    FxLog.w("Захват отдаёт чёрный кадр — вероятно, игра использует FLAG_SECURE");
                    if (statsListener != null) {
                        statsListener.onWarning(
                                "Игра отдаёт чёрный кадр (защита от записи экрана). "
                                        + "К этой игре технология примениться не может.");
                    }
                }
            } else {
                consecutiveBlackFrames = 0;
            }
        } catch (Throwable ignored) {
            // диагностика не должна влиять на работу
        } finally {
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        }
    }

    private void fail(String message, Throwable error) {
        if (failed) return;
        failed = true;
        lastError = message;
        FxLog.e(message, error);
        if (statsListener != null) {
            try {
                statsListener.onError(message);
            } catch (Throwable ignored) {
            }
        }
    }

    @Override
    public void onFrameAvailable(SurfaceTexture st) {
        frameAvailable = true;
        if (view != null && outputEnabled) view.requestRender();
    }

    // ------------------------------------------------------------- pipeline

    private void renderPipeline() {
        // 1. мелкий пробник нужен только для проверки «чёрного захвата» и потока
        runSampleTo(lowFbo, lowW, lowH);

        int stage;
        if (neural && netOutTex != 0) {
            // Нейросетевой путь: сеть апскейлит в 2× от низкого разрешения, дальше
            // обычный Catmull-Rom до полного и вся пост-обработка.
            runNeural();
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, upFbo);
            GLES30.glViewport(0, 0, fullW, fullH);
            GLES30.glUseProgram(upscaleProgram);
            bindTex(0, netOutTex);
            uniform1i(upscaleProgram, "tLow", 0);
            uniform2f(upscaleProgram, "uLowRes", netW * 2, netH * 2);
            draw();
            stage = upTex;
        } else if (directMode) {
            // Сцена уже в полном разрешении (пресет «Реализм»): апскейлить нечего,
            // снимаем кадр сразу в 1:1. Экономит буфер и целый проход.
            runSampleTo(upFbo, fullW, fullH);
            stage = upTex;
        } else {
            // 2. Catmull-Rom апскейл до полного разрешения
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, upFbo);
            GLES30.glViewport(0, 0, fullW, fullH);
            GLES30.glUseProgram(upscaleProgram);
            bindTex(0, lowTex);
            uniform1i(upscaleProgram, "tLow", 0);
            uniform2f(upscaleProgram, "uLowRes", lowW, lowH);
            draw();
            stage = upTex;
        }

        // 3. временное накопление
        if (cfgTemporal && histTexA != 0 && histTexB != 0) {
            int writeFbo = readHist == 0 ? histFboA : histFboB;
            int writeTex = readHist == 0 ? histTexA : histTexB;
            int readTex = readHist == 0 ? histTexB : histTexA;
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, writeFbo);
            GLES30.glViewport(0, 0, fullW, fullH);
            GLES30.glUseProgram(temporalProgram);
            bindTex(0, upTex);
            bindTex(1, readTex);
            bindTex(2, frameGen && flowTex != 0 ? flowUpTex : neutralTex);
            uniform1i(temporalProgram, "tCurrent", 0);
            uniform1i(temporalProgram, "tHistory", 1);
            uniform1i(temporalProgram, "tVelocity", 2);
            uniform2f(temporalProgram, "uFullRes", fullW, fullH);
            uniform1f(temporalProgram, "uAlpha", 0.22f);
            uniform1f(temporalProgram, "uHistoryValid", historyValid ? 1f : 0f);
            uniform1f(temporalProgram, "uVelRange", VEL_RANGE);
            draw();
            stage = writeTex;
            readHist = readHist == 0 ? 1 : 0;
            historyValid = true;
        }

        // 4. пост-обработка: sharp → clarity → grade, последний проход пишет в финальный буфер
        boolean doClarity = cfgClarity > 0.001f;
        boolean doGrade = cfgGrade > 0.001f;
        int passes = 1 + (doClarity ? 1 : 0) + (doGrade ? 1 : 0);

        frameSlot = frameSlot == 0 ? 1 : 0;
        int targetTex = frameSlot == 0 ? frameTexA : frameTexB;
        int targetFbo = frameSlot == 0 ? frameFboA : frameFboB;

        int[] dsts = new int[passes];
        int[] dstFbos = new int[passes];
        int[] programs = new int[passes];
        // Порядок и состав проходов зависят от того, что включено в настройках:
        // sharp → (clarity) → (grade). Собираем список явно, иначе при
        // выключенном clarity, но включённом grade, второй проход взял бы не тот шейдер.
        programs[0] = sharpenProgram;
        int slot = 1;
        if (doClarity) programs[slot++] = clarityProgram;
        if (doGrade) programs[slot] = gradeProgram;

        // Промежуточные проходы чередуют scratch ↔ upTex, финальный всегда
        // пишет в «текущий» буфер кадра, а второй остаётся предыдущим кадром
        // (нужен для интерполяции и для сравнения «до/после»).
        if (passes == 1) {
            dsts[0] = targetTex;
            dstFbos[0] = targetFbo;
        } else if (passes == 2) {
            dsts[0] = scratchTex;
            dstFbos[0] = scratchFbo;
            dsts[1] = targetTex;
            dstFbos[1] = targetFbo;
        } else {
            dsts[0] = scratchTex;
            dstFbos[0] = scratchFbo;
            dsts[1] = upTex;
            dstFbos[1] = upFbo;
            dsts[2] = targetTex;
            dstFbos[2] = targetFbo;
        }

        for (int i = 0; i < passes; i++) {
            int program = programs[i];
            GLES30.glUseProgram(program);
            bindTex(0, stage);
            uniform1i(program, "tSrc", 0);
            uniform2f(program, "uFullRes", fullW, fullH);
            if (i == 0) {
                uniform1f(program, "uStrength", cfgSharpen);
            } else if (program == clarityProgram) {
                uniform1f(program, "uAmount", cfgClarity);
            } else {
                uniform1f(program, "uAmount", cfgGrade);
                uniform1f(program, "uDither", (frameCounter % 64) * 1.7f);
            }
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, dstFbos[i]);
            GLES30.glViewport(0, 0, fullW, fullH);
            draw();
            stage = dsts[i];
        }

        // 5. поток между кадрами (для генерации промежуточных)
        if (frameGen) {
            computeFlow();
        }

        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
    }

    private void runSampleTo(int fbo, int w, int h) {
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo);
        GLES30.glViewport(0, 0, w, h);
        GLES30.glUseProgram(sampleProgram);
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0);
        GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture);
        uniform1i(sampleProgram, "tOes", 0);
        draw();
    }

    private void computeFlow() {
        if (flowFbo == 0 || prevLowFbo == 0) return;

        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, flowFbo);
        GLES30.glViewport(0, 0, flowGridW, flowGridH);
        GLES30.glUseProgram(flowProgram);
        bindTex(0, lowTex);
        bindTex(1, prevLowTex);
        uniform1i(flowProgram, "tCur", 0);
        uniform1i(flowProgram, "tPrev", 1);
        uniform2f(flowProgram, "uLowRes", lowW, lowH);
        uniform1f(flowProgram, "uStep", cfgFlowStep);
        uniform1f(flowProgram, "uSearch", cfgFlowSearch);
        uniform1f(flowProgram, "uTaps", cfgFlowTaps);
        uniform1f(flowProgram, "uVelRange", VEL_RANGE);
        draw();

        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, flowUpFbo);
        GLES30.glViewport(0, 0, lowW, lowH);
        GLES30.glUseProgram(flowUpProgram);
        bindTex(0, flowTex);
        uniform1i(flowUpProgram, "tFlow", 0);
        uniform2f(flowUpProgram, "uLowRes", lowW, lowH);
        draw();

        // текущий lowRes-кадр становится «предыдущим» (копия, без повторного сэмпла OES)
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, prevLowFbo);
        GLES30.glViewport(0, 0, lowW, lowH);
        GLES30.glUseProgram(copyProgram);
        bindTex(0, lowTex);
        uniform1i(copyProgram, "tSrc", 0);
        draw();

        flowValid = hasPrevFrame;
    }

    /** Показ исходного кадра без обработки (режим сравнения). */
    private void drawPassthrough() {
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        GLES30.glViewport(0, 0, fullW, fullH);
        GLES30.glUseProgram(sampleProgram);
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0);
        GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture);
        uniform1i(sampleProgram, "tOes", 0);
        draw();
    }

    private void drawDisplay(float p) {
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        GLES30.glViewport(0, 0, fullW, fullH);
        GLES30.glUseProgram(displayProgram);
        int curTex = frameSlot == 0 ? frameTexA : frameTexB; // только что записанный
        // Второго буфера может не быть (без генерации кадров) — тогда подставляем
        // текущий: привязка текстуры 0 к юниту дала бы неполную текстуру и чёрный кадр.
        int prevTex = frameSlot == 0 ? frameTexB : frameTexA;
        if (prevTex == 0) prevTex = curTex;
        bindTex(0, curTex);
        bindTex(1, prevTex);
        bindTex(2, frameGen && flowTex != 0 ? flowUpTex : neutralTex);
        GLES30.glActiveTexture(GLES30.GL_TEXTURE3);
        GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture);
        uniform1i(displayProgram, "tCurrent", 0);
        uniform1i(displayProgram, "tPrevious", 1);
        uniform1i(displayProgram, "tVelocity", 2);
        uniform1i(displayProgram, "tRawOes", 3);
        uniform1f(displayProgram, "uPhase", p);
        uniform1f(displayProgram, "uVelRange", VEL_RANGE);
        uniform1f(displayProgram, "uSplit", split);
        draw();
    }

    // --------------------------------------------------------------- targets

    // ------------------------------------------------------- нейросеть

    /** Текстура весов: RGBA32F, 276 текселей по 4 float. */
    private int createWeightTexture() {
        float[] src = SRWeights.VALUES;
        float[] out = new float[W_TEXELS * 4];

        int cIn = SRWeights.C_IN, cHid = SRWeights.C_HID, taps = SRWeights.TAPS;
        int cOutSp = SRWeights.C_OUT_SP;
        int b1Offset = taps * cIn * cHid;                  // после conv1
        int w2Offset = b1Offset + cHid;                    // после bias conv1
        int b2Offset = w2Offset + taps * cHid * cOutSp;

        // [0..1] bias conv1
        for (int o = 0; o < cHid; o++) {
            out[o] = src[b1Offset + o];
        }
        // [2..55] conv1: tap × in × группа
        for (int t = 0; t < taps; t++) {
            for (int c = 0; c < cIn; c++) {
                for (int g = 0; g < cHid / 4; g++) {
                    int texel = 2 + (t * cIn + c) * 2 + g;
                    for (int k = 0; k < 4; k++) {
                        int o = g * 4 + k;
                        out[texel * 4 + k] = src[(t * cIn + c) * cHid + o];
                    }
                }
            }
        }
        // [56..59] bias conv2 по подпикселям
        for (int sp = 0; sp < 4; sp++) {
            for (int o = 0; o < 3; o++) {
                out[(56 + sp) * 4 + o] = src[b2Offset + sp * 3 + o];
            }
        }
        // [60..275] conv2: subpixel × out × tap × группа
        for (int sp = 0; sp < 4; sp++) {
            for (int o = 0; o < 3; o++) {
                for (int t = 0; t < taps; t++) {
                    for (int g = 0; g < cHid / 4; g++) {
                        int texel = 60 + ((sp * 3 + o) * taps + t) * 2 + g;
                        for (int k = 0; k < 4; k++) {
                            int c = g * 4 + k;
                            out[texel * 4 + k] = src[w2Offset + (t * cHid + c) * cOutSp + sp * 3 + o];
                        }
                    }
                }
            }
        }

        java.nio.FloatBuffer buf = ByteBuffer.allocateDirect(out.length * 4)
                .order(ByteOrder.nativeOrder()).asFloatBuffer();
        buf.put(out).position(0);

        int[] tex = new int[1];
        GLES30.glGenTextures(1, tex, 0);
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, tex[0]);
        GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA32F,
                W_TEXELS, 1, 0, GLES30.GL_RGBA, GLES30.GL_FLOAT, buf);
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_NEAREST);
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_NEAREST);
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE);
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE);
        int err = GLES30.glGetError();
        if (err != 0) {
            FxLog.e("Не удалось создать текстуру весов, glError=" + err, null);
        }
        return tex[0];
    }

    private void allocateNeuralTargets() {
        // Вход сети — доля от полного разрешения: сеть дорогая, гонять её в 1:1 нет смысла.
        // Авто-качество действует и на сеть: если GPU не тянет, вход уменьшается.
        netW = Math.max(160, Math.round(fullW * netScale * autoScale));
        netH = Math.max(96, Math.round(fullH * netScale * autoScale));
        if (netW == lowW && netH == lowH && netOutTex != 0) return;

        if (netLowTex != 0) {
            int[] nt = {netLowTex, netC1TexA, netC1TexB, netOutTex};
            int[] nf = {netLowFbo, netConv1Fbo, netOutFbo};
            GLES30.glDeleteTextures(nt.length, nt, 0);
            GLES30.glDeleteFramebuffers(nf.length, nf, 0);
        }

        netLowTex = createTexture2D(netW, netH, null);
        netLowFbo = createFbo(netLowTex);

        netC1TexA = createTexture2D(netW, netH, null);
        netC1TexB = createTexture2D(netW, netH, null);
        netConv1Fbo = createFbo(netC1TexA, netC1TexB);

        netOutTex = createTexture2D(netW * 2, netH * 2, null);
        netOutFbo = createFbo(netOutTex);

        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        FxLog.i("Нейро-апскейл: вход " + netW + "x" + netH + " → выход "
                + (netW * 2) + "x" + (netH * 2));
    }

    /** Прогон сети: LR-кадр → 8 каналов → пиксельшуфл 2× → текстура netOutTex. */
    private void runNeural() {
        // 1. OES-кадр в RGB-текстуру низкого разрешения
        runSampleTo(netLowFbo, netW, netH);

        // 2. первый слой в две RGBA-текстуры
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, netConv1Fbo);
        int[] buffers = {GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_COLOR_ATTACHMENT1};
        GLES30.glDrawBuffers(2, buffers, 0);
        GLES30.glViewport(0, 0, netW, netH);
        GLES30.glUseProgram(netConv1Program);
        bindTex(0, netLowTex);
        bindTex(1, weightTexture);
        uniform1i(netConv1Program, "tSrc", 0);
        uniform1i(netConv1Program, "tW", 1);
        uniform2f(netConv1Program, "uSize", netW, netH);
        draw();
        GLES30.glDrawBuffers(1, new int[]{GLES30.GL_COLOR_ATTACHMENT0}, 0);

        // 3. второй слой + pixelshuffle, сразу в 2× разрешение
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, netOutFbo);
        GLES30.glViewport(0, 0, netW * 2, netH * 2);
        GLES30.glUseProgram(netConv2Program);
        bindTex(0, netC1TexA);
        bindTex(1, netC1TexB);
        bindTex(2, netLowTex);
        bindTex(3, weightTexture);
        uniform1i(netConv2Program, "tC0", 0);
        uniform1i(netConv2Program, "tC1", 1);
        uniform1i(netConv2Program, "tPlain", 2);
        uniform1i(netConv2Program, "tW", 3);
        uniform2f(netConv2Program, "uLowSize", netW, netH);
        uniform1f(netConv2Program, "uStrength", neuralStrength);
        draw();
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
    }

    private void allocateTargets() {
        if (fullW <= 1) return;
        float scale = getEffectiveScale();
        boolean newDirect = scale >= 0.995f && !cfgFrameGen && !neural;
        int newLowW;
        int newLowH;
        if (newDirect) {
            // В полном разрешении low-буфер нужен только как пробник для
            // диагностики — держим его маленьким, экономим видеопамять.
            newLowW = Math.max(64, Math.min(320, fullW / 4));
            newLowH = Math.max(36, Math.min(320, fullH / 4));
        } else {
            newLowW = Math.max(64, Math.round(fullW * scale));
            newLowH = Math.max(36, Math.round(fullH * scale));
        }
        int newGridW = Math.max(8, newLowW / Math.max(2, (int) cfgFlowStep));
        int newGridH = Math.max(8, newLowH / Math.max(2, (int) cfgFlowStep));

        boolean needScratch = cfgClarity > 0.001f || cfgGrade > 0.001f;
        boolean sizeSame = (newLowW == lowW && newLowH == lowH
                && newGridW == flowGridW && newGridH == flowGridH);
        boolean temporalSame = cfgTemporal == (histTexA != 0);
        boolean frameGenSame = cfgFrameGen == (prevLowTex != 0);
        boolean scratchSame = needScratch == (scratchTex != 0);
        boolean directSame = newDirect == directMode;
        boolean neuralSame = neural == (netOutTex != 0);
        int wantNetW = Math.max(160, Math.round(fullW * netScale * autoScale));
        boolean netSizeSame = wantNetW == netW;
        if (sizeSame && temporalSame && frameGenSame && scratchSame && directSame
                && neuralSame && (netSizeSame || !neural) && frameTexA != 0) {
            targetsReady = true;
            return; // ничего не поменялось — не дёргаем GPU
        }

        directMode = newDirect;
        lowW = newLowW;
        lowH = newLowH;
        flowGridW = newGridW;
        flowGridH = newGridH;

        destroyTargets();

        lowTex = createTexture2D(lowW, lowH, null);
        lowFbo = createFbo(lowTex);

        upTex = createTexture2D(fullW, fullH, null);
        upFbo = createFbo(upTex);

        if (needScratch) {
            scratchTex = createTexture2D(fullW, fullH, null);
            scratchFbo = createFbo(scratchTex);
        }

        frameTexA = createTexture2D(fullW, fullH, null);
        frameFboA = createFbo(frameTexA);
        if (cfgFrameGen) {
            // предыдущий кадр нужен только для интерполяции
            frameTexB = createTexture2D(fullW, fullH, null);
            frameFboB = createFbo(frameTexB);
        }

        if (cfgTemporal) {
            histTexA = createTexture2D(fullW, fullH, null);
            histFboA = createFbo(histTexA);
            histTexB = createTexture2D(fullW, fullH, null);
            histFboB = createFbo(histTexB);
        }
        if (neural) {
            allocateNeuralTargets();
        }

        if (cfgFrameGen) {
            prevLowTex = createTexture2D(lowW, lowH, null);
            prevLowFbo = createFbo(prevLowTex);
            flowTex = createTexture2D(flowGridW, flowGridH, null);
            flowFbo = createFbo(flowTex);
            flowUpTex = createTexture2D(lowW, lowH, null);
            flowUpFbo = createFbo(flowUpTex);
            flowValid = false;
        }

        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        historyValid = false;
        hasPrevFrame = false;

        int texCount = 2 + (needScratch ? 1 : 0) + (cfgFrameGen ? 2 : 0)
                + (cfgTemporal ? 2 : 0);
        long mb = (long) texCount * fullW * fullH * 4L / (1024 * 1024);
        int err = GLES30.glGetError();
        FxLog.i("Буферы: " + fullW + "x" + fullH + (directMode
                        ? " → без апскейла (1:1)" : " → сцена " + lowW + "x" + lowH)
                + ", ~" + mb + " МБ видеопамяти" + (err != 0 ? ", glError=" + err : ""));
        targetsReady = err == 0;
    }

    private void destroyTargets() {
        targetsReady = false;
        int[] textures = {lowTex, prevLowTex, upTex, scratchTex, histTexA, histTexB,
                frameTexA, frameTexB, flowTex, flowUpTex};
        int[] framebuffers = {lowFbo, prevLowFbo, upFbo, scratchFbo, histFboA, histFboB,
                frameFboA, frameFboB, flowFbo, flowUpFbo};
        GLES30.glDeleteTextures(textures.length, textures, 0);
        GLES30.glDeleteFramebuffers(framebuffers.length, framebuffers, 0);
        lowTex = prevLowTex = upTex = scratchTex = histTexA = histTexB = 0;
        frameTexA = frameTexB = flowTex = flowUpTex = 0;
        if (netLowTex != 0) {
            int[] nt = {netLowTex, netC1TexA, netC1TexB, netOutTex};
            int[] nf = {netLowFbo, netConv1Fbo, netOutFbo};
            GLES30.glDeleteTextures(nt.length, nt, 0);
            GLES30.glDeleteFramebuffers(nf.length, nf, 0);
        }
        netLowTex = netC1TexA = netC1TexB = netOutTex = 0;
        netLowFbo = netConv1Fbo = netOutFbo = 0;
        lowFbo = prevLowFbo = upFbo = scratchFbo = histFboA = histFboB = 0;
        frameFboA = frameFboB = flowFbo = flowUpFbo = 0;
    }

    public void release() {
        failed = true; // дальше кадры не рисуем
        if (surfaceTexture != null) {
            try {
                surfaceTexture.setOnFrameAvailableListener(null);
                surfaceTexture.release();
            } catch (Throwable t) {
                FxLog.w("release SurfaceTexture: " + t);
            }
            surfaceTexture = null;
        }
    }

    private int createFbo(int texA, int texB) {
        int[] fbo = new int[1];
        GLES30.glGenFramebuffers(1, fbo, 0);
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo[0]);
        GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0,
                GLES30.GL_TEXTURE_2D, texA, 0);
        GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT1,
                GLES30.GL_TEXTURE_2D, texB, 0);
        GLES30.glDrawBuffers(2, new int[]{GLES30.GL_COLOR_ATTACHMENT0,
                GLES30.GL_COLOR_ATTACHMENT1}, 0);
        int status = GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER);
        GLES30.glDrawBuffers(1, new int[]{GLES30.GL_COLOR_ATTACHMENT0}, 0);
        if (status != GLES30.GL_FRAMEBUFFER_COMPLETE) {
            throw new RuntimeException("MRT framebuffer неполный: 0x" + Integer.toHexString(status));
        }
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        return fbo[0];
    }

    private int createFbo(int tex) {
        int[] fbo = new int[1];
        GLES30.glGenFramebuffers(1, fbo, 0);
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo[0]);
        GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0,
                GLES30.GL_TEXTURE_2D, tex, 0);
        int status = GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER);
        if (status != GLES30.GL_FRAMEBUFFER_COMPLETE) {
            throw new RuntimeException("Framebuffer неполный: 0x" + Integer.toHexString(status));
        }
        GLES30.glViewport(0, 0, 1, 1);
        GLES30.glClearColor(0f, 0f, 0f, 1f);
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT);
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        return fbo[0];
    }

    private int createTexture2D(int w, int h, byte[] initial) {
        int[] t = new int[1];
        GLES30.glGenTextures(1, t, 0);
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, t[0]);
        if (initial == null) {
            GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA8, w, h, 0,
                    GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, null);
        } else {
            ByteBuffer buf = ByteBuffer.allocateDirect(initial.length);
            buf.put(initial).position(0);
            GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA8, 1, 1, 0,
                    GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, buf);
        }
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR);
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR);
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE);
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE);
        return t[0];
    }

    private void bindTex(int unit, int tex) {
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0 + unit);
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, tex);
    }

    private void draw() {
        GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, 3);
    }

    private void uniform1i(int program, String name, int v) {
        GLES30.glUniform1i(GLES30.glGetUniformLocation(program, name), v);
    }

    private void uniform1f(int program, String name, float v) {
        GLES30.glUniform1f(GLES30.glGetUniformLocation(program, name), v);
    }

    private void uniform2f(int program, String name, float x, float y) {
        GLES30.glUniform2f(GLES30.glGetUniformLocation(program, name), x, y);
    }

    private int buildProgram(String vert, String frag) {
        int vs = compile(GLES30.GL_VERTEX_SHADER, vert);
        int fs = compile(GLES30.GL_FRAGMENT_SHADER, frag);
        int p = GLES30.glCreateProgram();
        GLES30.glAttachShader(p, vs);
        GLES30.glAttachShader(p, fs);
        GLES30.glLinkProgram(p);
        int[] ok = new int[1];
        GLES30.glGetProgramiv(p, GLES30.GL_LINK_STATUS, ok, 0);
        GLES30.glDeleteShader(vs);
        GLES30.glDeleteShader(fs);
        if (ok[0] == 0) {
            String log = GLES30.glGetProgramInfoLog(p);
            GLES30.glDeleteProgram(p);
            throw new RuntimeException("Ошибка линковки программы: " + log);
        }
        return p;
    }

    private int compile(int type, String src) {
        int shader = compileOnce(type, src);
        if (shader != 0) return shader;

        // На части драйверов расширение доступно только с понижением до `enable`.
        if (src.contains("GL_OES_EGL_image_external_essl3 : require")) {
            String relaxed = src.replace("GL_OES_EGL_image_external_essl3 : require",
                    "GL_OES_EGL_image_external_essl3 : enable");
            shader = compileOnce(type, relaxed);
            if (shader != 0) {
                FxLog.w("Шейдер собран с 'enable' вместо 'require' для OES-расширения");
                return shader;
            }
        }
        throw new RuntimeException("BazarFX: не удалось собрать шейдер");
    }

    private int compileOnce(int type, String src) {
        int shader = GLES30.glCreateShader(type);
        GLES30.glShaderSource(shader, src);
        GLES30.glCompileShader(shader);
        int[] ok = new int[1];
        GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, ok, 0);
        if (ok[0] == 0) {
            FxLog.e("Ошибка компиляции шейдера: " + GLES30.glGetShaderInfoLog(shader), null);
            GLES30.glDeleteShader(shader);
            return 0;
        }
        return shader;
    }

    private void reportStats(long now) {
        if (statsWindowStart == 0) {
            statsWindowStart = now;
            return;
        }
        long elapsed = now - statsWindowStart;
        if (elapsed < 1_000_000_000L) return;
        float sec = elapsed / 1e9f;
        float captureFps = captureFrames / sec;
        float presentFps = presentFrames / sec;
        captureFrames = 0;
        presentFrames = 0;
        statsWindowStart = now;

        // Автоподстройка: если не успеваем — снижаем масштаб сцены, когда есть
        // запас — возвращаем. Без этого на слабом GPU оверлей тормозит так,
        // что кажется сломанным.
        if (autoQuality && !bypass) {
            float before = autoScale;
            if (presentFps < 22f && autoScale > 0.55f) {
                autoScale = Math.max(0.55f, autoScale - 0.12f);
            } else if (presentFps > 48f && autoScale < 1f) {
                autoScale = Math.min(1f, autoScale + 0.05f);
            }
            if (Math.abs(before - autoScale) > 0.005f && view != null) {
                FxLog.i("Авто-качество: масштаб сцены " + Math.round(autoScale * 100) + "%"
                        + " (было " + Math.round(presentFps) + " fps)");
                view.queueEvent(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            allocateTargets();
                        } catch (Throwable t) {
                            targetsReady = false;
                        }
                    }
                });
            }
        }

        if (statsListener != null) {
            statsListener.onStats(captureFps, presentFps,
                    Math.round(fullW * getEffectiveScale()),
                    Math.round(fullH * getEffectiveScale()),
                    fullW, fullH,
                    latencySamples > 0 ? latencyMs : -1f);
        }
    }

    private static float clamp(float v, float min, float max) {
        return v < min ? min : (v > max ? max : v);
    }
}
