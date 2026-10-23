package kz.bazar.fx;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

/** Настройки и запуск фонового режима BazarFX. */
public class MainActivity extends Activity {

    public static final String EXTRA_SHOW_LOG = "showLog";

    private static final int REQ_CAPTURE = 1001;
    private static final int REQ_NOTIFICATIONS = 1002;

    private FxSettings settings;
    private TextView status;
    private Button startButton;
    private LinearLayout presetBox;
    private final android.os.Handler uiHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable pushRunnable = new Runnable() {
        @Override
        public void run() {
            pushToServiceNow();
        }
    };
    private final java.util.List<SeekBar> seekBars = new java.util.ArrayList<>();
    private final java.util.List<String> seekKeys = new java.util.ArrayList<>();
    private final java.util.List<TextView> seekLabels = new java.util.ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FxLog.init(this);
        settings = FxSettings.load(this);
        setContentView(buildUi());
        refreshStatus();
        if (getIntent() != null && getIntent().getBooleanExtra(EXTRA_SHOW_LOG, false)) {
            showLog();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.getBooleanExtra(EXTRA_SHOW_LOG, false)) {
            showLog();
        }
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFF0B0B0E);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        root.setPadding(pad, dp(28), pad, dp(40));
        scroll.addView(root);

        TextView title = new TextView(this);
        title.setText("BazarFX");
        title.setTextColor(0xFF34D399);
        title.setTextSize(30f);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("Апскейлер и генератор кадров поверх любых игр.\n"
                + "Включите — и обработка будет работать в фоне, пока вы играете.");
        subtitle.setTextColor(0xFFA1A1AA);
        subtitle.setTextSize(14f);
        subtitle.setPadding(0, dp(6), 0, dp(18));
        root.addView(subtitle);

        status = new TextView(this);
        status.setTextSize(13f);
        status.setTextColor(0xFFF4F4F5);
        status.setBackgroundColor(0xFF18181B);
        status.setPadding(dp(14), dp(12), dp(14), dp(12));
        root.addView(status);

        startButton = new Button(this);
        startButton.setText("Включить поверх игр");
        startButton.setBackgroundColor(0xFF059669);
        startButton.setTextColor(Color.WHITE);
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        btnLp.topMargin = dp(16);
        root.addView(startButton, btnLp);
        startButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                onStartClicked();
            }
        });

        Button stopButton = new Button(this);
        stopButton.setText("Остановить");
        stopButton.setBackgroundColor(0xFF27272A);
        stopButton.setTextColor(0xFFF4F4F5);
        LinearLayout.LayoutParams stopLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        stopLp.topMargin = dp(8);
        root.addView(stopButton, stopLp);
        stopButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (FxService.isRunning) {
                    startService(new Intent(MainActivity.this, FxService.class)
                            .setAction(FxService.ACTION_STOP));
                    Toast.makeText(MainActivity.this, "BazarFX остановлен", Toast.LENGTH_SHORT).show();
                } else {
                    Toast.makeText(MainActivity.this, "BazarFX и так выключен", Toast.LENGTH_SHORT).show();
                }
                refreshStatus();
            }
        });

        LinearLayout logRow = new LinearLayout(this);
        logRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rowLp.topMargin = dp(8);
        root.addView(logRow, rowLp);

        Button logButton = new Button(this);
        logButton.setText("Лог");
        logButton.setBackgroundColor(0xFF27272A);
        logButton.setTextColor(0xFFF4F4F5);
        logRow.addView(logButton, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        logButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showLog();
            }
        });

        Button shareButton = new Button(this);
        shareButton.setText("Отправить лог");
        shareButton.setBackgroundColor(0xFF27272A);
        shareButton.setTextColor(0xFFF4F4F5);
        LinearLayout.LayoutParams shareLp = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        shareLp.leftMargin = dp(8);
        logRow.addView(shareButton, shareLp);
        shareButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                shareLog();
            }
        });

        root.addView(sectionHeader("Качество картинки"));

        TextView qualityHint = new TextView(this);
        qualityHint.setText("Выбери пресет — он применится сразу, даже если BazarFX уже работает "
                + "поверх игры. Ниже можно донастроить вручную.");
        qualityHint.setTextColor(0xFF71717A);
        qualityHint.setTextSize(12f);
        qualityHint.setPadding(0, 0, 0, dp(10));
        root.addView(qualityHint);

        presetBox = new LinearLayout(this);
        presetBox.setOrientation(LinearLayout.VERTICAL);
        root.addView(presetBox);
        rebuildPresets();

        root.addView(sectionHeader("Тонкая настройка"));

        addSlider(root, "Разрешение сцены", 30, 100, "renderScale", "%",
                "Ниже — быстрее, но мягче. 100% = обработка в родном разрешении экрана.");
        addSlider(root, "Резкость (шарпенинг)", 0, 100, "sharpen", "%",
                "Адаптивный шарп: возвращает детали, не раздувая края.");
        addSlider(root, "Локальный контраст (clarity)", 0, 100, "clarity", "%",
                "Добавляет «объём» и фактуру поверхностей — заметнее всего на текстурах и траве.");
        addSlider(root, "Тон и антибандинг (grade)", 0, 100, "grade", "%",
                "Мягкий контраст, насыщенность и дизеринг: убирает полосы на небе, тумане, тенях.");

        root.addView(checkbox("Temporal-сглаживание (TAA)",
                "Убирает лесенки и мерцание на тонких линиях. На статичной картинке — чистое улучшение; "
                        + "на быстрых рывках камеры возможен лёгкий след.",
                settings.temporal,
                new OnChecked() {
                    @Override
                    public void onChecked(boolean checked) {
                        settings.temporal = checked;
                        onManualChange();
                    }
                }));

        root.addView(checkbox("Генерация кадров (экспериментально)",
                "Дорисовывает промежуточные кадры по оптическому потоку: 30 fps игры → плавнее вывод. "
                        + "Добавляет задержку и артефакты на быстрых движениях.",
                settings.frameGen,
                new OnChecked() {
                    @Override
                    public void onChecked(boolean checked) {
                        settings.frameGen = checked;
                        onManualChange();
                    }
                }));

        root.addView(sectionHeader("Поведение"));

        root.addView(checkbox("Плавающая кнопка",
                "Кружок FX поверх игры: тап — сравнить с оригиналом, удержание — меню качества.",
                settings.showBubble,
                new OnChecked() {
                    @Override
                    public void onChecked(boolean checked) {
                        settings.showBubble = checked;
                        settings.save(MainActivity.this);
                        pushToService();
                    }
                }));

        root.addView(checkbox("Исключать оверлей из захвата",
                "Обязательно для нормальной работы: иначе приложение снимает само себя. "
                        + "Если на вашем устройстве экран становится чёрным — выключите.",
                settings.secureOverlay,
                new OnChecked() {
                    @Override
                    public void onChecked(boolean checked) {
                        settings.secureOverlay = checked;
                        settings.save(MainActivity.this);
                        Toast.makeText(MainActivity.this,
                                "Применится после перезапуска BazarFX", Toast.LENGTH_SHORT).show();
                    }
                }));

        root.addView(sectionHeader("Честно о возможностях"));

        TextView honest = new TextView(this);
        honest.setText("• Приложение работает поверх любой игры без root: снимает экран, "
                + "прогоняет кадр через пайплайн BazarFX и показывает результат в оверлее.\n\n"
                + "• FPS самой игры при этом НЕ растёт: игра уже отрендерила кадр в своём разрешении. "
                + "BazarFX улучшает резкость и (опционально) плавность вывода кадров.\n\n"
                + "• Чтобы получить настоящий прирост FPS, игра должна рендерить сцену в низком "
                + "разрешении — это делается интеграцией в движок (Unity-пакет в репозитории) "
                + "или root-хуком.\n\n"
                + "• Поток снимается через MediaProjection, поэтому Android каждый раз спрашивает "
                + "разрешение на захват экрана — это системное требование, обойти нельзя.");
        honest.setTextColor(0xFFA1A1AA);
        honest.setTextSize(13f);
        honest.setLineSpacing(dp(2), 1f);
        root.addView(honest);

        return scroll;
    }

    private void onStartClicked() {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Разрешите показ поверх других приложений", Toast.LENGTH_LONG).show();
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName()));
            startActivity(intent);
            return;
        }

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
        }

        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            Toast.makeText(this, "На этом устройстве нет MediaProjection", Toast.LENGTH_LONG).show();
            return;
        }
        startActivityForResult(manager.createScreenCaptureIntent(), REQ_CAPTURE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_CAPTURE) return;

        if (resultCode != RESULT_OK || data == null) {
            Toast.makeText(this, "Захват экрана отменён", Toast.LENGTH_SHORT).show();
            return;
        }

        Intent serviceIntent = new Intent(this, FxService.class)
                .setAction(FxService.ACTION_START)
                .putExtra(FxService.EXTRA_CODE, resultCode)
                .putExtra(FxService.EXTRA_DATA, data);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }

        Toast.makeText(this, "BazarFX включён — можно открывать игру", Toast.LENGTH_LONG).show();
        FxLog.i("Запрошен захват экрана, запускаем сервис");
        // Сворачиваемся, чтобы сразу попасть в игру
        moveTaskToBack(true);
        refreshStatus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Настройки могли поменять из оверлея (меню на кружке) — подхватываем.
        settings = FxSettings.load(this);
        rebuildPresets();
        syncSliders();
        refreshStatus();
    }

    @Override
    protected void onDestroy() {
        uiHandler.removeCallbacks(pushRunnable);
        super.onDestroy();
    }

    private void refreshStatus() {
        updateStatusText();
    }

    private void updateStatusText() {
        if (status == null) return;
        boolean overlay = Settings.canDrawOverlays(this);
        status.setText("Версия 1.3 · Android " + Build.VERSION.RELEASE + " (SDK " + Build.VERSION.SDK_INT + ")"
                + "\nРазрешение «поверх других приложений»: " + (overlay ? "есть" : "нет")
                + "\nКачество: " + settings.qualityName()
                + " · сцена " + Math.round(settings.renderScale * 100) + "%"
                + "\nГенерация кадров: " + (settings.frameGen ? "вкл" : "выкл")
                + "\nTAA: " + (settings.temporal ? "вкл" : "выкл"));
    }

    // ------------------------------------------------------------ UI helpers

    private TextView sectionHeader(String text) {
        TextView tv = new TextView(this);
        tv.setText(text.toUpperCase());
        tv.setTextColor(0xFF71717A);
        tv.setTextSize(11f);
        tv.setPadding(0, dp(28), 0, dp(10));
        return tv;
    }

    private interface OnChecked {
        void onChecked(boolean checked);
    }

    /** Слайдер, привязанный к полю настроек по ключу. */
    private void addSlider(LinearLayout root, String label, int min, int max, final String key,
                           String suffix, String hint) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(0, dp(10), 0, dp(6));

        final TextView title = new TextView(this);
        title.setTextColor(0xFFE4E4E7);
        title.setTextSize(14f);
        box.addView(title);

        final SeekBar bar = new SeekBar(this);
        bar.setMax(max - min);
        bar.setProgress(Math.max(0, Math.min(max - min, Math.round(getValue(key) * 100) - min)));
        title.setText(label + ": " + Math.round(getValue(key) * 100) + suffix);
        bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                int value = min + progress;
                title.setText(label + ": " + value + suffix);
                if (fromUser) {
                    setValue(key, value / 100f);
                    onManualChange();
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar seekBar) {
            }

            @Override
            public void onStopTrackingTouch(SeekBar seekBar) {
            }
        });
        box.addView(bar);

        TextView hintView = new TextView(this);
        hintView.setText(hint);
        hintView.setTextColor(0xFF71717A);
        hintView.setTextSize(11f);
        box.addView(hintView);

        seekBars.add(bar);
        seekKeys.add(key);
        seekLabels.add(title);
        root.addView(box);
    }

    private float getValue(String key) {
        if ("renderScale".equals(key)) return settings.renderScale;
        if ("sharpen".equals(key)) return settings.sharpen;
        if ("clarity".equals(key)) return settings.clarity;
        return settings.grade;
    }

    private void setValue(String key, float value) {
        if ("renderScale".equals(key)) settings.renderScale = Math.max(0.3f, value);
        else if ("sharpen".equals(key)) settings.sharpen = value;
        else if ("clarity".equals(key)) settings.clarity = value;
        else settings.grade = value;
    }

    /** Ручная правка = «свои настройки»: пресет больше не соответствует значениям. */
    private void onManualChange() {
        settings.markCustom();
        settings.save(this);
        rebuildPresets();
        updateStatusText();
        pushToService();
    }

    /** Перерисовывает список пресетов, подсвечивая активный. */
    private void rebuildPresets() {
        if (presetBox == null) return;
        presetBox.removeAllViews();
        for (int i = 0; i < 5; i++) {
            final int preset = i;
            boolean active = settings.quality == preset;
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(dp(14), dp(10), dp(14), dp(10));
            row.setBackgroundColor(active ? 0xFF10312A : 0xFF18181B);

            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(6);

            TextView name = new TextView(this);
            name.setText((active ? "● " : "○ ") + FxSettings.QUALITY_NAMES[preset]);
            name.setTextColor(active ? 0xFF34D399 : 0xFFE4E4E7);
            name.setTextSize(15f);
            row.addView(name);

            TextView hint = new TextView(this);
            hint.setText(FxSettings.QUALITY_HINTS[preset]);
            hint.setTextColor(active ? 0xFF6EE7B7 : 0xFF71717A);
            hint.setTextSize(11f);
            row.addView(hint);

            row.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    applyPreset(preset);
                }
            });
            presetBox.addView(row, lp);
        }

        if (settings.quality == FxSettings.CUSTOM) {
            TextView custom = new TextView(this);
            custom.setText("Пресет не выбран: значения изменены вручную");
            custom.setTextColor(0xFFA1A1AA);
            custom.setTextSize(11f);
            custom.setPadding(dp(2), dp(8), 0, 0);
            presetBox.addView(custom);
        }
    }

    private void applyPreset(int preset) {
        settings.applyPreset(preset);
        settings.save(this);
        syncSliders();
        rebuildPresets();
        updateStatusText();
        pushToService();
        Toast.makeText(this, "Качество: " + FxSettings.QUALITY_NAMES[preset], Toast.LENGTH_SHORT).show();
    }

    /** Подтягивает положение слайдеров под текущие значения (после смены пресета). */
    private void syncSliders() {
        for (int i = 0; i < seekBars.size(); i++) {
            String key = seekKeys.get(i);
            int percent = Math.round(getValue(key) * 100);
            int min = "renderScale".equals(key) ? 30 : 0;
            SeekBar bar = seekBars.get(i);
            bar.setProgress(Math.max(0, Math.min(bar.getMax(), percent - min)));
            String label = "renderScale".equals(key) ? "Разрешение сцены"
                    : "sharpen".equals(key) ? "Резкость (шарпенинг)"
                    : "clarity".equals(key) ? "Локальный контраст (clarity)"
                    : "Тон и антибандинг (grade)";
            seekLabels.get(i).setText(label + ": " + percent + "%");
        }
    }

    /**
     * Отправляет новые настройки запущенному сервису. С задержкой: при
     * перетаскивании слайдера значение меняется десятки раз в секунду, а
     * каждое применение пересоздаёт буферы на GPU — без паузы будут рывки.
     */
    private void pushToService() {
        if (!FxService.isRunning) return;
        uiHandler.removeCallbacks(pushRunnable);
        uiHandler.postDelayed(pushRunnable, 220);
    }

    private void pushToServiceNow() {
        if (!FxService.isRunning) return;
        try {
            startService(new Intent(this, FxService.class).setAction(FxService.ACTION_RELOAD));
        } catch (Throwable t) {
            FxLog.w("pushToService: " + t);
        }
    }

    private View checkbox(String label, String hint, boolean checked, OnChecked listener) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(0, dp(12), 0, dp(4));

        CheckBox cb = new CheckBox(this);
        cb.setText(label);
        cb.setTextColor(0xFFE4E4E7);
        cb.setTextSize(14f);
        cb.setChecked(checked);
        cb.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(android.widget.CompoundButton buttonView, boolean isChecked) {
                listener.onChecked(isChecked);
            }
        });
        box.addView(cb);

        TextView hintView = new TextView(this);
        hintView.setText(hint);
        hintView.setTextColor(0xFF71717A);
        hintView.setTextSize(12f);
        hintView.setPadding(dp(36), 0, 0, 0);
        box.addView(hintView);
        return box;
    }

    private void showLog() {
        String text = FxLog.read();
        if (text.length() > 20000) {
            text = text.substring(text.length() - 20000);
        }
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(10f);
        view.setTextColor(0xFFE4E4E7);
        view.setTypeface(android.graphics.Typeface.MONOSPACE);
        view.setPadding(dp(12), dp(12), dp(12), dp(12));
        view.setTextIsSelectable(true);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(view);
        scroll.setBackgroundColor(0xFF0B0B0E);

        new android.app.AlertDialog.Builder(this)
                .setTitle("Лог BazarFX")
                .setView(scroll)
                .setPositiveButton("Закрыть", null)
                .setNeutralButton("Копировать", new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface dialog, int which) {
                        copyLog();
                    }
                })
                .setNegativeButton("Очистить", new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface dialog, int which) {
                        FxLog.clear();
                        Toast.makeText(MainActivity.this, "Лог очищен", Toast.LENGTH_SHORT).show();
                    }
                })
                .show();
    }

    private void shareLog() {
        try {
            String text = FxLog.read();
            if (text == null || text.trim().isEmpty()) {
                Toast.makeText(this, "Лог пока пуст", Toast.LENGTH_SHORT).show();
                return;
            }
            // Без AndroidX: делимся текстом, файл не отдаём (file:// запрещён с API 24)
            Intent send = new Intent(Intent.ACTION_SEND)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, "Лог BazarFX")
                    .putExtra(Intent.EXTRA_TEXT, text);
            startActivity(Intent.createChooser(send, "Отправить лог"));
        } catch (Throwable t) {
            Toast.makeText(this, "Не удалось отправить: " + t, Toast.LENGTH_LONG).show();
        }
    }

    private void copyLog() {
        try {
            android.content.ClipboardManager clipboard =
                    (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Лог BazarFX", FxLog.read()));
            Toast.makeText(this, "Лог скопирован", Toast.LENGTH_SHORT).show();
        } catch (Throwable t) {
            Toast.makeText(this, "Не удалось скопировать: " + t, Toast.LENGTH_LONG).show();
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
