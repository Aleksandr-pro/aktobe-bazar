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
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.View;
import android.view.WindowManager;
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
    public static final String EXTRA_CODE = "code";
    public static final String EXTRA_DATA = "data";

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
    private Handler handler;
    private NotificationManager notificationManager;
    private String lastStats = "";
    private boolean running;

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        handler = new Handler(Looper.getMainLooper());
        settings = FxSettings.load(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        if (ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, buildNotification("BazarFX включён", "Обработка экрана активна"));

        int code = intent.getIntExtra(EXTRA_CODE, 0);
        Intent data = intent.getParcelableExtra(EXTRA_DATA);
        if (code == 0 || data == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!running) {
            startPipeline(code, data);
        }
        return START_STICKY;
    }

    private void startPipeline(int resultCode, Intent data) {
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            stopSelf();
            return;
        }
        projection = manager.getMediaProjection(resultCode, data);
        if (projection == null) {
            stopSelf();
            return;
        }

        projectionCallback = new MediaProjection.Callback() {
            @Override
            public void onStop() {
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        stopSelf();
                    }
                });
            }
        };
        projection.registerCallback(projectionCallback, handler);

        showOverlay();
        running = true;

        // Ждём, пока GL-поток создаст SurfaceTexture, и только потом создаём VirtualDisplay.
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
                    createVirtualDisplay();
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

        overlayParams = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.OPAQUE);
        overlayParams.gravity = Gravity.TOP | Gravity.START;
        overlayParams.x = 0;
        overlayParams.y = 0;
        overlayParams.setTitle("BazarFX");

        try {
            windowManager.addView(glView, overlayParams);
            glView.onResume();
        } catch (Exception e) {
            stopSelf();
            return;
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
                stopSelf();
                return true;
            }
        });

        try {
            windowManager.addView(bubble, bubbleParams);
        } catch (Exception ignored) {
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

    private void createVirtualDisplay() {
        DisplayMetrics metrics = currentMetrics();
        releaseVirtualDisplay();

        if (renderer == null) return;
        SurfaceTexture st = renderer.getSurfaceTexture();
        if (st == null) return;
        st.setDefaultBufferSize(metrics.widthPixels, metrics.heightPixels);
        captureSurface = new Surface(st);
        activeSurfaceTexture = st;

        if (projection == null) return;
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

    private DisplayMetrics currentMetrics() {
        DisplayMetrics metrics = new DisplayMetrics();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getDisplay().getRealMetrics(metrics);
        } else {
            windowManager.getDefaultDisplay().getRealMetrics(metrics);
        }
        return metrics;
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Поворот экрана — пересоздаём VirtualDisplay под новый размер
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (renderer != null) {
                    DisplayMetrics metrics = currentMetrics();
                    renderer.onSurfaceSizeChanged(metrics.widthPixels, metrics.heightPixels);
                    handler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            createVirtualDisplay();
                        }
                    }, 120);
                }
            }
        }, 300);
    }

    @Override
    public void onStats(float captureFps, float presentFps, int lowW, int lowH, int fullW, int fullH) {
        lastStats = String.format("%.0f→%.0f fps · %d×%d→%d×%d", captureFps, presentFps, lowW, lowH, fullW, fullH);
        updateNotification(lastStats);
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

        return builder
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .setOngoing(true)
                .setContentIntent(openPending)
                .addAction(new Notification.Action.Builder(
                        null, "Остановить", stopPending).build())
                .build();
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);

        releaseVirtualDisplay();

        if (projection != null) {
            if (projectionCallback != null) {
                projection.unregisterCallback(projectionCallback);
            }
            projection.stop();
            projection = null;
        }

        if (renderer != null) {
            renderer.release();
        }

        if (glView != null) {
            try {
                glView.onPause();
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
