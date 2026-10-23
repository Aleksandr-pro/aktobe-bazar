package kz.bazar.fx;

import android.graphics.SurfaceTexture;
import android.opengl.GLES11Ext;
import android.opengl.GLES30;
import android.opengl.GLSurfaceView;
import android.opengl.Matrix;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * Пайплайн BazarFX на OpenGL ES 3.0.
 *
 * Поток кадра:
 *   OES-текстура (кадр, снятый MediaProjection)
 *     → downscale в «сцену» низкого разрешения
 *     → Catmull-Rom апскейл до полного разрешения
 *     → (опционально) temporal-накопление
 *     → адаптивный шарпенинг
 *     → (опционально) интерполяция кадров по блочному оптическому потоку
 *     → экран (в оверлее поверх игры)
 *
 * Шейдеры — те же, что в WebGL-демо (lib/fx/shaders.ts), портированные на GLES3.
 */
public class FxRenderer implements GLSurfaceView.Renderer, SurfaceTexture.OnFrameAvailableListener {

    public interface StatsListener {
        void onStats(float captureFps, float presentFps, int lowW, int lowH, int fullW, int fullH);

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
            + "void main() { fragColor = vec4(texture(tOes, vUV).rgb, 1.0); }\n";

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
            + "  hist = clamp(hist, max(mn, m1 - sigma * 1.6), min(mx, m1 + sigma * 1.6));\n"
            + "  float alpha = mix(1.0, uAlpha, uHistoryValid);\n"
            + "  fragColor = vec4(mix(hist, texture(tCurrent, vUV).rgb, alpha), 1.0);\n"
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
            + "precision highp float;\n"
            + "in vec2 vUV;\n"
            + "out vec4 fragColor;\n"
            + "uniform sampler2D tCurrent;\n"
            + "uniform sampler2D tPrevious;\n"
            + "uniform sampler2D tVelocity;\n"
            + "uniform float uPhase;\n"
            + "uniform float uVelRange;\n"
            + "uniform float uBypass;\n"
            + "uniform sampler2D tRaw;\n"
            + "void main() {\n"
            + "  vec3 cur = texture(tCurrent, vUV).rgb;\n"
            + "  vec3 col = cur;\n"
            + "  if (uPhase > 0.001) {\n"
            + "    vec2 vel = (texture(tVelocity, vUV).rg * 2.0 - 1.0) * uVelRange;\n"
            + "    vec3 prev = texture(tPrevious, clamp(vUV - vel * uPhase, vec2(0.0), vec2(1.0))).rgb;\n"
            + "    vec3 nxt = texture(tCurrent, clamp(vUV + vel * (1.0 - uPhase), vec2(0.0), vec2(1.0))).rgb;\n"
            + "    col = mix(prev, nxt, uPhase);\n"
            + "  }\n"
            + "  vec3 raw = texture(tRaw, vUV).rgb;\n"
            + "  col = mix(col, raw, uBypass);\n"
            + "  fragColor = vec4(col, 1.0);\n"
            + "}\n";

    private static final float VEL_RANGE = 0.09f;

    private final FxSettings settings;
    private final StatsListener statsListener;

    private GLSurfaceView view;
    private SurfaceTexture surfaceTexture;
    private int oesTexture = -1;
    private int surfaceTextureId = -1;

    private int sampleProgram, upscaleProgram, temporalProgram, sharpenProgram,
            flowProgram, flowUpProgram, displayProgram;

    private int lowFbo, lowTex, upFbo, upTex, histFboA, histTexA, histFboB, histTexB,
            finalFboA, finalTexA, finalFboB, finalTexB, flowFbo, flowTex, flowUpFbo, flowUpTex,
            neutralTex;

    private int lowW = 1, lowH = 1, fullW = 1, fullH = 1;
    private int flowGridW = 1, flowGridH = 1;

    private final FloatBuffer quad = createQuad();

    private boolean historyValid;
    private boolean hasPrevFrame;
    private int frameIndex;
    private int readHist, readFinal;
    private long lastCaptureNanos;
    private double captureIntervalSec = 1 / 60.0;
    private boolean frameAvailable;
    private volatile boolean bypass;
    private volatile boolean frameGen;
    private volatile float phase;

    private int captureFrames;
    private int presentFrames;
    private long statsWindowStart;

    private volatile boolean failed;
    private String lastError = "";
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
        this.settings = settings;
        this.statsListener = listener;
        this.frameGen = settings.frameGen;
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
        if (width == fullW && height == fullH) return;
        fullW = Math.max(2, width);
        fullH = Math.max(2, height);
        FxLog.i("Смена размера: " + fullW + "x" + fullH);
        if (view != null) {
            view.queueEvent(new Runnable() {
                @Override
                public void run() {
                    try {
                        allocateTargets();
                        resizeSurfaceTexture();
                    } catch (Throwable t) {
                        fail("Не удалось пересоздать буферы: " + t, t);
                    }
                }
            });
        }
    }

    public void setBypass(boolean value) {
        bypass = value;
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

    public void setPhase(float p) {
        phase = p;
    }

    // ---------------------------------------------------------------- GL setup

    @Override
    public void onSurfaceCreated(GL10 gl, EGLConfig config) {
        try {
            GLES30.glDisable(GLES30.GL_DEPTH_TEST);
            GLES30.glDisable(GLES30.GL_BLEND);
            GLES30.glClearColor(0f, 0f, 0f, 1f);

            sampleProgram = buildProgram(VERT, FRAG_SAMPLE);
            upscaleProgram = buildProgram(VERT, FRAG_UPSCALE);
            temporalProgram = buildProgram(VERT, FRAG_TEMPORAL);
            sharpenProgram = buildProgram(VERT, FRAG_SHARPEN);
            flowProgram = buildProgram(VERT, FRAG_FLOW);
            flowUpProgram = buildProgram(VERT, FRAG_FLOW_UP);
            displayProgram = buildProgram(VERT, FRAG_DISPLAY);

            neutralTex = createTexture2D(1, 1, new byte[]{(byte) 128, (byte) 128, (byte) 128, (byte) 255});
            historyValid = false;
            hasPrevFrame = false;
            allocateTargets();
            ensureSurfaceTexture();
            FxLog.i("GL готов: " + fullW + "x" + fullH + ", сцена " + lowW + "x" + lowH);
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
            fullW = Math.max(2, width);
            fullH = Math.max(2, height);
            GLES30.glViewport(0, 0, fullW, fullH);
            allocateTargets();
            ensureSurfaceTexture();
        } catch (Throwable t) {
            fail("onSurfaceChanged: " + t, t);
        }
    }

    @Override
    public void onDrawFrame(GL10 gl) {
        if (failed || surfaceTextureId == -1 || fullW <= 1) return;
        try {
            drawFrameInternal();
        } catch (Throwable t) {
            fail("Ошибка отрисовки: " + t, t);
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
            renderPipeline();
            hasPrevFrame = true;
        }

        if (frameGen && hasPrevFrame) {
            double since = (now - lastCaptureNanos) / 1e9;
            float p = (float) Math.min(0.95, Math.max(0.0, since / Math.max(captureIntervalSec, 1e-3)));
            drawDisplay(p);
            presentFrames++;
            if (view != null) view.requestRender();
        } else if (newFrame) {
            drawDisplay(0f);
            presentFrames++;
        }

        if (newFrame) {
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
        if (fullW <= 1 || finalTexA == 0) return;
        try {
            int[] fbo = new int[1];
            GLES30.glGenFramebuffers(1, fbo, 0);
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo[0]);
            GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0,
                    GLES30.GL_TEXTURE_2D, finalTexA, 0);
            java.nio.ByteBuffer buf = java.nio.ByteBuffer.allocateDirect(16)
                    .order(java.nio.ByteOrder.nativeOrder());
            GLES30.glReadPixels(0, 0, 2, 2, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, buf);
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
            GLES30.glDeleteFramebuffers(1, fbo, 0);
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
        if (view != null) view.requestRender();
    }

    // ------------------------------------------------------------- pipeline

    private void renderPipeline() {
        int curLow = lowFbo; // сцена низкого разрешения

        // 1. снимаем OES-кадр в lowRes
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, curLow);
        GLES30.glViewport(0, 0, lowW, lowH);
        GLES30.glUseProgram(sampleProgram);
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0);
        GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture);
        GLES30.glUniform1i(GLES30.glGetUniformLocation(sampleProgram, "tOes"), 0);
        draw();

        // 2. Catmull-Rom апскейл до полного разрешения
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, upFbo);
        GLES30.glViewport(0, 0, fullW, fullH);
        GLES30.glUseProgram(upscaleProgram);
        bindTex(0, lowTex);
        uniform1i(upscaleProgram, "tLow", 0);
        uniform2f(upscaleProgram, "uLowRes", lowW, lowH);
        draw();

        int shadedTex = upTex;

        // 3. временное накопление (если включено)
        if (settings.temporal) {
            int writeFbo = readHist == 0 ? histFboA : histFboB;
            int writeTex = readHist == 0 ? histTexA : histTexB;
            int readTex = readHist == 0 ? histTexB : histTexA;
            GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, writeFbo);
            GLES30.glViewport(0, 0, fullW, fullH);
            GLES30.glUseProgram(temporalProgram);
            bindTex(0, upTex);
            bindTex(1, readTex);
            bindTex(2, neutralTex);
            uniform1i(temporalProgram, "tCurrent", 0);
            uniform1i(temporalProgram, "tHistory", 1);
            uniform1i(temporalProgram, "tVelocity", 2);
            uniform2f(temporalProgram, "uFullRes", fullW, fullH);
            uniform1f(temporalProgram, "uAlpha", 0.12f);
            uniform1f(temporalProgram, "uHistoryValid", historyValid ? 1f : 0f);
            uniform1f(temporalProgram, "uVelRange", VEL_RANGE);
            draw();
            shadedTex = writeTex;
            readHist = readHist == 0 ? 1 : 0;
            historyValid = true;
        }

        // 4. адаптивный шарпенинг в финальный буфер (ping-pong для генерации кадров)
        int writeFinalFbo = readFinal == 0 ? finalFboA : finalFboB;
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, writeFinalFbo);
        GLES30.glViewport(0, 0, fullW, fullH);
        GLES30.glUseProgram(sharpenProgram);
        bindTex(0, shadedTex);
        uniform1i(sharpenProgram, "tSrc", 0);
        uniform2f(sharpenProgram, "uFullRes", fullW, fullH);
        uniform1f(sharpenProgram, "uStrength", settings.sharpen);
        draw();
        readFinal = readFinal == 0 ? 1 : 0;

        // 5. если нужна генерация кадров — считаем поток между двумя lowRes-кадрами
        if (frameGen) {
            computeFlow();
        }

        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
    }

    private void computeFlow() {
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, flowFbo);
        GLES30.glViewport(0, 0, flowGridW, flowGridH);
        GLES30.glUseProgram(flowProgram);
        bindTex(0, lowTex);
        bindTex(1, prevLowTex);
        uniform1i(flowProgram, "tCur", 0);
        uniform1i(flowProgram, "tPrev", 1);
        uniform2f(flowProgram, "uLowRes", lowW, lowH);
        uniform1f(flowProgram, "uStep", settings.flowStep);
        uniform1f(flowProgram, "uSearch", settings.flowSearch);
        uniform1f(flowProgram, "uTaps", settings.flowTaps);
        uniform1f(flowProgram, "uVelRange", VEL_RANGE);
        draw();

        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, flowUpFbo);
        GLES30.glViewport(0, 0, lowW, lowH);
        GLES30.glUseProgram(flowUpProgram);
        bindTex(0, flowTex);
        uniform1i(flowUpProgram, "tFlow", 0);
        uniform2f(flowUpProgram, "uLowRes", lowW, lowH);
        draw();

        // сохраняем текущий lowRes-кадр как предыдущий
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, prevLowFbo);
        GLES30.glViewport(0, 0, lowW, lowH);
        GLES30.glUseProgram(sampleProgram);
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0);
        GLES30.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oesTexture);
        GLES30.glUniform1i(GLES30.glGetUniformLocation(sampleProgram, "tOes"), 0);
        draw();
    }

    private void drawDisplay(float p) {
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        GLES30.glViewport(0, 0, fullW, fullH);
        GLES30.glUseProgram(displayProgram);
        int curTex = readFinal == 0 ? finalTexB : finalTexA; // последний записанный
        int prevTex = readFinal == 0 ? finalTexA : finalTexB;
        bindTex(0, curTex);
        bindTex(1, prevTex);
        bindTex(2, frameGen ? flowUpTex : neutralTex);
        bindTex(3, lowTex);
        uniform1i(displayProgram, "tCurrent", 0);
        uniform1i(displayProgram, "tPrevious", 1);
        uniform1i(displayProgram, "tVelocity", 2);
        uniform1i(displayProgram, "tRaw", 3);
        uniform1f(displayProgram, "uPhase", p);
        uniform1f(displayProgram, "uVelRange", VEL_RANGE);
        uniform1f(displayProgram, "uBypass", bypass ? 1f : 0f);
        draw();
    }

    // --------------------------------------------------------------- targets

    private int prevLowFbo, prevLowTex;

    private void allocateTargets() {
        if (fullW <= 1) return;
        float scale = Math.max(0.25f, Math.min(1f, settings.renderScale));
        lowW = Math.max(64, Math.round(fullW * scale));
        lowH = Math.max(36, Math.round(fullH * scale));
        flowGridW = Math.max(8, lowW / Math.max(2, settings.flowStep));
        flowGridH = Math.max(8, lowH / Math.max(2, settings.flowStep));

        destroyTargets();

        int[] fbo = new int[1];
        GLES30.glGenFramebuffers(1, fbo, 0);
        lowFbo = fbo[0];
        lowTex = createTexture2D(lowW, lowH, null);
        attach(lowFbo, lowTex);

        GLES30.glGenFramebuffers(1, fbo, 0);
        prevLowFbo = fbo[0];
        prevLowTex = createTexture2D(lowW, lowH, null);
        attach(prevLowFbo, prevLowTex);

        GLES30.glGenFramebuffers(1, fbo, 0);
        upFbo = fbo[0];
        upTex = createTexture2D(fullW, fullH, null);
        attach(upFbo, upTex);

        GLES30.glGenFramebuffers(2, fbo, 0);
        histFboA = fbo[0];
        histFboB = fbo[1];
        histTexA = createTexture2D(fullW, fullH, null);
        histTexB = createTexture2D(fullW, fullH, null);
        attach(histFboA, histTexA);
        attach(histFboB, histTexB);

        GLES30.glGenFramebuffers(2, fbo, 0);
        finalFboA = fbo[0];
        finalFboB = fbo[1];
        finalTexA = createTexture2D(fullW, fullH, null);
        finalTexB = createTexture2D(fullW, fullH, null);
        attach(finalFboA, finalTexA);
        attach(finalFboB, finalTexB);

        GLES30.glGenFramebuffers(1, fbo, 0);
        flowFbo = fbo[0];
        flowTex = createTexture2D(flowGridW, flowGridH, null);
        attach(flowFbo, flowTex);

        GLES30.glGenFramebuffers(1, fbo, 0);
        flowUpFbo = fbo[0];
        flowUpTex = createTexture2D(lowW, lowH, null);
        attach(flowUpFbo, flowUpTex);

        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
        historyValid = false;
        hasPrevFrame = false;
    }

    private void destroyTargets() {
        int[] textures = {lowTex, prevLowTex, upTex, histTexA, histTexB, finalTexA, finalTexB, flowTex, flowUpTex};
        int[] framebuffers = {lowFbo, prevLowFbo, upFbo, histFboA, histFboB, finalFboA, finalFboB, flowFbo, flowUpFbo};
        GLES30.glDeleteTextures(textures.length, textures, 0);
        GLES30.glDeleteFramebuffers(framebuffers.length, framebuffers, 0);
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

    private void attach(int fbo, int tex) {
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo);
        GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, tex, 0);
        GLES30.glViewport(0, 0, 1, 1);
        GLES30.glClearColor(0f, 0f, 0f, 1f);
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT);
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0);
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
        GLES30.glDeleteShader(vs);
        GLES30.glDeleteShader(fs);
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
        if (statsListener != null) {
            statsListener.onStats(captureFps, presentFps, lowW, lowH, fullW, fullH);
        }
    }

    private static FloatBuffer createQuad() {
        float[] verts = {-1, -1, 0, 3, -1, 0, -1, 3, 0};
        ByteBuffer bb = ByteBuffer.allocateDirect(verts.length * 4).order(ByteOrder.nativeOrder());
        FloatBuffer fb = bb.asFloatBuffer();
        fb.put(verts).position(0);
        return fb;
    }

    // Не используется, но оставляем для будущих проходов с матрицами
    private final float[] mvp = new float[16];
    {
        Matrix.setIdentityM(mvp, 0);
    }
}
