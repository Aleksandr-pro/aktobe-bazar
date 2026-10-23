package kz.bazar.fx;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.SurfaceTexture;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.opengl.GLSurfaceView;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Фоновый режим: показывает поверх любой игры полноэкранный слой, в который
 * BazarFX выводит обработанный кадр, снятый через MediaProjection.
 *
 * Важно (честно): MediaProjection снимает уже готовый кадр игры, поэтому
 * частота кадров самой игры не растёт — растёт только качество/плавность
 * вывода. Реальный прирост FPS требует, чтобы игра рендерила в низком
 * разрешении (это делает интеграция в движок или root-хук).
 */
public class FxService extends Service implements FxRenderer.StatsListener {

    public static final String ACTION_START = "kz.bazar.fx.START";
    public static final String ACTION_STOP = "kz.bazar.fx.STOP";
    /** Перечитать настройки и применить на ходу (пресет качества, шарп и т.д.). */
    public static final String ACTION_RELOAD = "kz.bazar.fx.RELOAD";
    /** Следующий пресет качества (кнопка в уведомлении). */
    public static final String ACTION_CYCLE_QUALITY = "kz.bazar.fx.CYCLE_QUALITY";
    public static final String EXTRA_CODE = "code";
    public static final String EXTRA_DATA = "data";

    /** Работает ли сервис прямо сейчас (чтобы лишний раз его не стартовать). */
    public static volatile boolean isRunning;

    private static final String CHANNEL_ID = "bazarfx";
    private static final int NOTIFICATION_ID = 42;

    private MediaProjection projection;
    private MediaProjection.Callback projectionCallback;
    private VirtualDisplay virtualDisplay;
    private Surface captureSurface;
    private SurfaceTexture activeSurfaceTexture;

    private WindowManager windowManager;
    private GLSurfaceView glView;
    private TextView bubble;
    private WindowManager.LayoutParams overlayParams;
    private WindowManager.LayoutParams bubbleParams;

    private FxRenderer renderer;
    private FxSettings settings;
    private LinearLayout qualityPanel;
    private WindowManager.LayoutParams qualityParams;
    private Handler handler;
    private NotificationManager notificationManager;
    private String lastStats = "";
    private long lastNotificationUpdate;
    private boolean running;

    @Override
    public void onCreate() {
        super.onCreate();
        FxLog.init(this);
        FxLog.i("Сервис создан, SDK " + Build.VERSION.SDK_INT);
        FxLog.installCrashGuard(new Runnable() {
            @Override
            public void run() {
                try {
                    notifyFailure("BazarFX остановлен из-за ошибки. Подробности — в логе приложения.");
                } catch (Throwable ignored) {
                }
            }
        });
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        handler = new Handler(Looper.getMainLooper());
        settings = FxSettings.load(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_RELOAD.equals(action)) {
            if (!running) { // сервис не работает — просто применим настройки при следующем старте
                stopSelf();
                return START_NOT_STICKY;
            }
            reloadSettings(false);
            return START_STICKY;
        }
        if (ACTION_CYCLE_QUALITY.equals(action)) {
            if (!running) {
                stopSelf();
                return START_NOT_STICKY;
            }
            cycleQuality(1);
            return START_STICKY;
        }

        try {
            startForeground(NOTIFICATION_ID, buildNotification("BazarFX включён", "Обработка экрана активна"));
        } catch (Throwable t) {
            FxLog.e("startForeground: " + t, t);
            stopSelf();
            return START_NOT_STICKY;
        }

        int code = intent.getIntExtra(EXTRA_CODE, 0);
        Intent data = intent.getParcelableExtra(EXTRA_DATA);
        if (code == 0 || data == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!running) {
            startPipeline(code, data);
        }
        return START_NOT_STICKY;
    }

    private boolean starting;

    private void startPipeline(int resultCode, Intent data) {
        if (starting || running) return;
        starting = true;
        try {
            startPipelineInternal(resultCode, data);
        } catch (Throwable t) {
            FxLog.e("startPipeline: " + t, t);
            notifyFailure("Не удалось начать захват: " + t.getClass().getSimpleName()
                    + ". Подробности — в логе BazarFX.");
            stopSelf();
        } finally {
            starting = false;
        }
    }

    private void startPipelineInternal(int resultCode, Intent data) {
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            notifyFailure("На этом устройстве нет MediaProjection");
            stopSelf();
            return;
        }

        FxLog.i("Шаг 1/4: получаем проекцию экрана");
        try {
            projection = manager.getMediaProjection(resultCode, data);
        } catch (Throwable t) {
            FxLog.e("getMediaProjection: " + t, t);
            notifyFailure("Система не дала доступ к экрану: " + t.getClass().getSimpleName()
                    + ". Разреши захват заново — токен одноразовый.");
            stopSelf();
            return;
        }
        if (projection == null) {
            notifyFailure("Система вернула пустую проекцию. Включи BazarFX заново.");
            stopSelf();
            return;
        }

        projectionCallback = new MediaProjection.Callback() {
            @Override
            public void onStop() {
                FxLog.w("Проекция остановлена системой");
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        stopSelf();
                    }
                });
            }
        };
        try {
            projection.registerCallback(projectionCallback, handler);
        } catch (Throwable t) {
            FxLog.e("registerCallback: " + t, t);
        }

        FxLog.i("Шаг 2/4: показываем оверлей");
        try {
            showOverlay();
        } catch (Throwable t) {
            FxLog.e("showOverlay: " + t, t);
            notifyFailure("Не удалось показать оверлей: " + t.getClass().getSimpleName()
                    + ". Проверь разрешение «поверх других приложений».");
            stopSelf();
            return;
        }
        running = true;
        isRunning = true;

        // Ждём, пока GL-поток создаст SurfaceTexture, и только потом создаём VirtualDisplay.
        FxLog.i("Шаг 3/4: ждём GL-поверхность");
        waitForSurfaceTexture();
    }

    private void waitForSurfaceTexture() {
        if (renderer == null) return;
        SurfaceTexture st = renderer.getSurfaceTexture();
        if (st == null) {
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    waitForSurfaceTexture();
                }
            }, 50);
            return;
        }
        createVirtualDisplay();
        startSurfaceWatchdog();
    }

    /** Если GL-поверхность пересоздалась (поворот, смена размера) — переподключаем захват. */
    private void startSurfaceWatchdog() {
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!running || renderer == null) return;
                SurfaceTexture current = renderer.getSurfaceTexture();
                if (current != null && current != activeSurfaceTexture) {
                    resizeVirtualDisplay();
                }
                if (renderer.isFailed()) {
                    notifyFailure("Ошибка пайплайна: " + renderer.getLastError());
                    stopSelf();
                    return;
                }
                handler.postDelayed(this, 1500);
            }
        }, 1500);
    }

    private void showOverlay() {
        DisplayMetrics metrics = currentMetrics();

        if (glView == null) {
            glView = new GLSurfaceView(this);
            glView.setEGLContextClientVersion(3);
            glView.setEGLConfigChooser(8, 8, 8, 8, 0, 0);
            glView.setPreserveEGLContextOnPause(true);
            glView.getHolder().setFormat(PixelFormat.OPAQUE);

            renderer = new FxRenderer(settings, this);
            renderer.attachView(glView);
            glView.setRenderer(renderer);
            glView.setRenderMode(settings.frameGen
                    ? GLSurfaceView.RENDERMODE_CONTINUOUSLY
                    : GLSurfaceView.RENDERMODE_WHEN_DIRTY);
        }

        int overlayFlags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;

        // Без FLAG_SECURE MediaProjection снимет наш же оверлей — получится
        // «зеркальный коридор». С флагом система исключает этот слой из захвата,
        // и в кадр попадает игра под ним.
        if (settings.secureOverlay) {
            overlayFlags |= WindowManager.LayoutParams.FLAG_SECURE;
        }

        overlayParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                overlayFlags,
                PixelFormat.OPAQUE);
        overlayParams.gravity = Gravity.TOP | Gravity.START;
        overlayParams.x = 0;
        overlayParams.y = 0;
        overlayParams.setTitle("BazarFX");

        try {
            windowManager.addView(glView, overlayParams);
            glView.onResume();
            FxLog.i("Оверлей добавлен: " + overlayParams.width + "x" + overlayParams.height);
        } catch (Throwable t) {
            FxLog.e("addView(overlay): " + t, t);
            throw new RuntimeException("addView оверлея: " + t, t);
        }

        if (settings.showBubble) {
            showBubble(metrics);
        }

        renderer.onSurfaceSizeChanged(metrics.widthPixels, metrics.heightPixels);
    }

    private void showBubble(DisplayMetrics metrics) {
        bubble = new TextView(this);
        bubble.setText("FX");
        bubble.setTextColor(Color.WHITE);
        bubble.setTextSize(14f);
        bubble.setGravity(Gravity.CENTER);
        bubble.setBackgroundColor(0xB3123F33);
        bubble.setPadding(24, 16, 24, 16);

        bubbleParams = new WindowManager.LayoutParams(
                120,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        bubbleParams.gravity = Gravity.TOP | Gravity.START;
        bubbleParams.x = 24;
        bubbleParams.y = metrics.heightPixels / 3;

        bubble.setOnTouchListener(new View.OnTouchListener() {
            private int startX, startY;
            private float touchX, touchY;
            private long downTime;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        startX = bubbleParams.x;
                        startY = bubbleParams.y;
                        touchX = event.getRawX();
                        touchY = event.getRawY();
                        downTime = System.currentTimeMillis();
                        return true;
                    case MotionEvent.ACTION_MOVE: {
                        int dx = (int) (event.getRawX() - touchX);
                        int dy = (int) (event.getRawY() - touchY);
                        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                            bubbleParams.x = startX + dx;
                            bubbleParams.y = startY + dy;
                            safeUpdateBubble();
                        }
                        return true;
                    }
                    case MotionEvent.ACTION_UP:
                        if (System.currentTimeMillis() - downTime < 400
                                && Math.abs(event.getRawX() - touchX) < 12
                                && Math.abs(event.getRawY() - touchY) < 12) {
                            toggleBypass();
                        }
                        return true;
                    default:
                        return false;
                }
            }
        });

        bubble.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                showQualityPanel();
                return true;
            }
        });

        try {
            windowManager.addView(bubble, bubbleParams);
        } catch (Throwable t) {
            FxLog.w("Плавающая кнопка не добавлена: " + t);
        }
    }

    private void showQualityPanel() {
        hideQualityPanel();
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(0xF2121216);
        int pad = (int) (12 * getResources().getDisplayMetrics().density);
        panel.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("Качество BazarFX");
        title.setTextColor(0xFF34D399);
        title.setTextSize(13f);
        title.setPadding(0, 0, 0, pad / 2);
        panel.addView(title);

        for (int i = 0; i < 5; i++) {
            final int preset = i;
            TextView item = new TextView(this);
            boolean active = settings.quality == preset;
            item.setText((active ? "● " : "○ ") + FxSettings.QUALITY_NAMES[preset]
                    + " — " + FxSettings.QUALITY_HINTS[preset]);
            item.setTextColor(active ? 0xFF34D399 : 0xFFE4E4E7);
            item.setTextSize(12f);
            item.setPadding(0, pad / 2, 0, pad / 2);
            item.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    setQuality(preset);
                    hideQualityPanel();
                }
            });
            panel.addView(item);
        }

        TextView off = new TextView(this);
        off.setText("Скрыть панель");
        off.setTextColor(0xFF71717A);
        off.setTextSize(12f);
        off.setPadding(0, pad / 2, 0, 0);
        off.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideQualityPanel();
            }
        });
        panel.addView(off);

        DisplayMetrics metrics = currentMetrics();
        int width = Math.min((int) (metrics.widthPixels * 0.86f), (int) (360 * metrics.density));
        qualityParams = new WindowManager.LayoutParams(
                width,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        qualityParams.gravity = Gravity.CENTER;
        try {
            windowManager.addView(panel, qualityParams);
            qualityPanel = panel;
            // автоскрытие, чтобы панель не мешала играть
            handler.postDelayed(hideQualityRunnable, 12000);
        } catch (Throwable t) {
            FxLog.w("Панель качества: " + t);
        }
    }

    private final Runnable hideQualityRunnable = new Runnable() {
        @Override
        public void run() {
            hideQualityPanel();
        }
    };

    private void hideQualityPanel() {
        handler.removeCallbacks(hideQualityRunnable);
        if (qualityPanel != null) {
            try {
                windowManager.removeView(qualityPanel);
            } catch (Exception ignored) {
            }
            qualityPanel = null;
        }
    }

    private void safeUpdateBubble() {
        try {
            if (bubble != null && bubble.isAttachedToWindow()) {
                windowManager.updateViewLayout(bubble, bubbleParams);
            }
        } catch (Exception ignored) {
        }
    }

    /** Перечитывает настройки из SharedPreferences и применяет к живому пайплайну. */
    private void reloadSettings(boolean save) {
        try {
            FxSettings fresh = FxSettings.load(this);
            boolean bubbleChanged = fresh.showBubble != settings.showBubble;
            boolean secureChanged = fresh.secureOverlay != settings.secureOverlay;
            if (save) fresh.save(this);
            settings = fresh;
            if (renderer != null) {
                renderer.updateSettings(settings);
            }
            if (secureChanged && glView != null) {
                FxLog.w("Смена режима захвата оверлея вступит в силу после перезапуска");
            }
            if (bubbleChanged) {
                if (settings.showBubble) {
                    if (bubble == null) showBubble(currentMetrics());
                } else if (bubble != null) {
                    try {
                        windowManager.removeView(bubble);
                    } catch (Exception ignored) {
                    }
                    bubble = null;
                }
            }
            updateBubbleText();
            updateNotification(lastStats.isEmpty() ? qualityLine() : qualityLine() + "\n" + lastStats);
        } catch (Throwable t) {
            FxLog.e("reloadSettings: " + t, t);
        }
    }

    private String qualityLine() {
        return "Качество: " + settings.qualityName();
    }

    /** Переключение пресета на ходу (кнопка в уведомлении и меню на кружке). */
    private void cycleQuality(int direction) {
        int n = 5; // только 5 основных пресетов, CUSTOM сюда не попадает
        int next = (settings.quality + direction) % n;
        if (next < 0) next += n;
        setQuality(next);
    }

    private void setQuality(int preset) {
        settings.applyPreset(preset);
        settings.save(this);
        reloadSettings(false);
        try {
            android.widget.Toast.makeText(getApplicationContext(),
                    "Качество: " + settings.qualityName(), android.widget.Toast.LENGTH_SHORT).show();
        } catch (Throwable ignored) {
        }
    }

    private void toggleBypass() {
        if (renderer == null) return;
        boolean next = !renderer.isBypass();
        renderer.setBypass(next);
        updateBubbleText();
        updateNotification(next ? "Сравнение: без BazarFX" : "BazarFX включён");
    }

    private void updateBubbleText() {
        if (bubble == null) return;
        boolean bypass = renderer != null && renderer.isBypass();
        bubble.setText(bypass ? "OFF" : "FX");
        bubble.setBackgroundColor(bypass ? 0xB34A1D1D : 0xB3123F33);
    }

    /**
     * VirtualDisplay создаётся РОВНО ОДИН раз на токен MediaProjection.
     * Начиная с Android 14 повторный createVirtualDisplay с тем же токеном
     * бросает SecurityException и роняет приложение — именно это происходило
     * при запуске игры (смена ориентации/разрешения).
     * Дальше размер меняем через resize(), а поверхность — через setSurface().
     */
    private void createVirtualDisplay() {
        if (virtualDisplay != null) {
            resizeVirtualDisplay();
            return;
        }
        if (renderer == null || projection == null) return;

        DisplayMetrics metrics = currentMetrics();
        SurfaceTexture st = renderer.getSurfaceTexture();
        if (st == null) {
            FxLog.w("SurfaceTexture ещё не готов — повторю попытку");
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    createVirtualDisplay();
                }
            }, 100);
            return;
        }

        try {
            captureSurface = new Surface(st);
            activeSurfaceTexture = st;
            virtualDisplay = projection.createVirtualDisplay(
                    "BazarFX",
                    metrics.widthPixels,
                    metrics.heightPixels,
                    Math.max(1, metrics.densityDpi),
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR
                            | DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC,
                    captureSurface,
                    null,
                    handler);
            renderer.onSurfaceSizeChanged(metrics.widthPixels, metrics.heightPixels);
            FxLog.i("Шаг 4/4: VirtualDisplay создан: " + metrics.widthPixels + "x" + metrics.heightPixels);
        } catch (Throwable t) {
            // SecurityException (повторный захват), IllegalStateException (проекция остановлена)
            FxLog.e("Не удалось создать VirtualDisplay: " + t, t);
            notifyFailure("Захват экрана недоступен: " + t.getClass().getSimpleName()
                    + ". Выключите и включите BazarFX заново.");
            stopSelf();
        }
    }

    /** Поворот / смена разрешения: только resize, без пересоздания. */
    private void resizeVirtualDisplay() {
        if (virtualDisplay == null) {
            createVirtualDisplay();
            return;
        }
        DisplayMetrics metrics = currentMetrics();
        try {
            virtualDisplay.resize(metrics.widthPixels, metrics.heightPixels, Math.max(1, metrics.densityDpi));
            if (renderer != null) {
                SurfaceTexture st = renderer.getSurfaceTexture();
                if (st != null && st != activeSurfaceTexture) {
                    // GL-контекст пересоздался — переключаем вывод на новый Surface
                    if (captureSurface != null) {
                        captureSurface.release();
                    }
                    captureSurface = new Surface(st);
                    activeSurfaceTexture = st;
                    virtualDisplay.setSurface(captureSurface);
                }
                renderer.onSurfaceSizeChanged(metrics.widthPixels, metrics.heightPixels);
            }
            FxLog.i("VirtualDisplay resize: " + metrics.widthPixels + "x" + metrics.heightPixels);
        } catch (Throwable t) {
            FxLog.e("resize VirtualDisplay: " + t, t);
        }
    }

    private void releaseVirtualDisplay() {
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (captureSurface != null) {
            captureSurface.release();
            captureSurface = null;
        }
    }

    /**
     * Размер экрана.
     *
     * ВАЖНО: у сервиса нельзя вызывать Context#getDisplay() — контекст сервиса не
     * привязан к дисплею, и метод бросает UnsupportedOperationException. Именно
     * из-за этого «Включить» падало с ошибкой захвата. Ходим через DisplayManager,
     * а если и он недоступен — берём метрики ресурсов.
     */
    private DisplayMetrics currentMetrics() {
        DisplayMetrics metrics = new DisplayMetrics();
        try {
            DisplayManager displayManager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
            Display display = displayManager != null
                    ? displayManager.getDisplay(Display.DEFAULT_DISPLAY) : null;
            if (display != null) {
                display.getRealMetrics(metrics);
                if (metrics.widthPixels > 0 && metrics.heightPixels > 0) return metrics;
            }
        } catch (Throwable t) {
            FxLog.w("DisplayManager.getDisplay: " + t);
        }
        try {
            Display display = windowManager.getDefaultDisplay();
            if (display != null) {
                display.getRealMetrics(metrics);
                if (metrics.widthPixels > 0 && metrics.heightPixels > 0) return metrics;
            }
        } catch (Throwable t) {
            FxLog.w("getDefaultDisplay: " + t);
        }
        metrics.setTo(getResources().getDisplayMetrics());
        FxLog.w("Размер экрана взят из ресурсов: " + metrics.widthPixels + "x" + metrics.heightPixels);
        return metrics;
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Поворот экрана: уменьшаем/увеличиваем существующий VirtualDisplay.
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                try {
                    resizeVirtualDisplay();
                } catch (Throwable t) {
                    FxLog.e("Поворот экрана: " + t, t);
                }
            }
        }, 400);
    }

    @Override
    public void onStats(float captureFps, float presentFps, int lowW, int lowH, int fullW, int fullH) {
        lastStats = String.format("%.0f→%.0f fps · %d×%d→%d×%d", captureFps, presentFps, lowW, lowH, fullW, fullH);
        long now = System.currentTimeMillis();
        if (now - lastNotificationUpdate > 4000) { // раз в 4 с достаточно, реже дёргаем систему
            lastNotificationUpdate = now;
            updateNotification(qualityLine() + " · " + lastStats);
        }
        if (bubble != null) {
            handler.post(new Runnable() {
                @Override
                public void run() {
                    if (renderer != null && !renderer.isBypass()) {
                        bubble.setText("FX");
                    }
                }
            });
        }
    }

    @Override
    public void onError(String message) {
        FxLog.e("Пайплайн: " + message, null);
        notifyFailure(message);
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (bubble != null) {
                    bubble.setText("ERR");
                    bubble.setBackgroundColor(0xB37F1D1D);
                }
            }
        });
    }

    @Override
    public void onWarning(String message) {
        FxLog.w(message);
        try {
            android.widget.Toast.makeText(getApplicationContext(), message, android.widget.Toast.LENGTH_LONG).show();
        } catch (Throwable ignored) {
        }
        updateNotification(message);
    }

    private void notifyFailure(String message) {
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                        "bazarfx_errors", "Ошибки BazarFX", NotificationManager.IMPORTANCE_HIGH);
                manager.createNotificationChannel(channel);
            }
            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(this, "bazarfx_errors")
                    : new Notification.Builder(this);
            Intent open = new Intent(this, MainActivity.class)
                    .putExtra(MainActivity.EXTRA_SHOW_LOG, true)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pending = PendingIntent.getActivity(this, 3, open,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                            ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                            : PendingIntent.FLAG_UPDATE_CURRENT);
            manager.notify(43, builder
                    .setContentTitle("BazarFX: ошибка")
                    .setContentText(message)
                    .setStyle(new Notification.BigTextStyle().bigText(message))
                    .setSmallIcon(android.R.drawable.stat_notify_error)
                    .setContentIntent(pending)
                    .setAutoCancel(true)
                    .build());
        } catch (Throwable t) {
            FxLog.e("notifyFailure: " + t, t);
        }
    }

    private void updateNotification(String text) {
        try {
            notificationManager.notify(NOTIFICATION_ID, buildNotification("BazarFX", text));
        } catch (Exception ignored) {
        }
    }

    private Notification buildNotification(String title, String text) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Работа BazarFX поверх игр");
            notificationManager.createNotificationChannel(channel);
        }

        Intent stopIntent = new Intent(this, FxService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(
                this, 1, stopIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                        : PendingIntent.FLAG_UPDATE_CURRENT);

        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent openPending = PendingIntent.getActivity(
                this, 2, openIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                        : PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        Intent qualityIntent = new Intent(this, FxService.class).setAction(ACTION_CYCLE_QUALITY);
        PendingIntent qualityPending = PendingIntent.getService(
                this, 4, qualityIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                        : PendingIntent.FLAG_UPDATE_CURRENT);

        return builder
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .setOngoing(true)
                .setContentIntent(openPending)
                .addAction(new Notification.Action.Builder(null, "Качество", qualityPending).build())
                .addAction(new Notification.Action.Builder(null, "Стоп", stopPending).build())
                .build();
    }

    @Override
    public void onDestroy() {
        running = false;
        isRunning = false;
        handler.removeCallbacksAndMessages(null);

        releaseVirtualDisplay();

        if (projection != null) {
            if (projectionCallback != null) {
                projection.unregisterCallback(projectionCallback);
            }
            projection.stop();
            projection = null;
        }

        hideQualityPanel();

        // Сначала останавливаем GL-поток, и только потом освобождаем SurfaceTexture,
        // иначе release() может произойти во время отрисовки кадра.
        if (glView != null) {
            try {
                glView.onPause();
            } catch (Throwable ignored) {
            }
        }
        if (renderer != null) {
            renderer.release();
        }
        if (glView != null) {
            try {
                windowManager.removeView(glView);
            } catch (Exception ignored) {
            }
            glView = null;
        }
        if (bubble != null) {
            try {
                windowManager.removeView(bubble);
            } catch (Exception ignored) {
            }
            bubble = null;
        }

        stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
