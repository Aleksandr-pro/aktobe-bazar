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
import android.text.InputType;
import android.view.Gravity;
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

    private static final int REQ_CAPTURE = 1001;
    private static final int REQ_NOTIFICATIONS = 1002;

    private FxSettings settings;
    private TextView status;
    private Button startButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        settings = FxSettings.load(this);
        setContentView(buildUi());
        refreshStatus();
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
                Intent intent = new Intent(MainActivity.this, FxService.class)
                        .setAction(FxService.ACTION_STOP);
                startService(intent);
                Toast.makeText(MainActivity.this, "BazarFX остановлен", Toast.LENGTH_SHORT).show();
                refreshStatus();
            }
        });

        root.addView(sectionHeader("Качество"));

        root.addView(slider("Разрешение сцены", 30, 100, Math.round(settings.renderScale * 100),
                new OnValue() {
                    @Override
                    public void onValue(int value) {
                        settings.renderScale = value / 100f;
                        settings.save(MainActivity.this);
                        updateStatusText();
                    }
                }, "%"));

        root.addView(slider("Резкость (шарпенинг)", 0, 100, Math.round(settings.sharpen * 100),
                new OnValue() {
                    @Override
                    public void onValue(int value) {
                        settings.sharpen = value / 100f;
                        settings.save(MainActivity.this);
                    }
                }, "%"));

        root.addView(checkbox("Temporal-сглаживание (TAA)",
                "Убирает лесенки, но без motion vectors даёт шлейфы. Для статичных сцен — да.",
                settings.temporal,
                new OnChecked() {
                    @Override
                    public void onChecked(boolean checked) {
                        settings.temporal = checked;
                        settings.save(MainActivity.this);
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
                        settings.save(MainActivity.this);
                    }
                }));

        root.addView(checkbox("Плавающая кнопка",
                "Кружок FX поверх игры: тап — сравнить с оригиналом, удержание — выключить.",
                settings.showBubble,
                new OnChecked() {
                    @Override
                    public void onChecked(boolean checked) {
                        settings.showBubble = checked;
                        settings.save(MainActivity.this);
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
        // Сворачиваемся, чтобы сразу попасть в игру
        moveTaskToBack(true);
        refreshStatus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshStatus();
    }

    private void refreshStatus() {
        updateStatusText();
    }

    private void updateStatusText() {
        if (status == null) return;
        boolean overlay = Settings.canDrawOverlays(this);
        status.setText("Разрешение «поверх других приложений»: " + (overlay ? "есть" : "нет")
                + "\nСцена: " + Math.round(settings.renderScale * 100) + "% пикселей"
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

    private interface OnValue {
        void onValue(int value);
    }

    private interface OnChecked {
        void onChecked(boolean checked);
    }

    private View slider(String label, int min, int max, int current, OnValue listener, String suffix) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(0, dp(10), 0, dp(6));

        TextView title = new TextView(this);
        title.setText(label + ": " + current + suffix);
        title.setTextColor(0xFFE4E4E7);
        title.setTextSize(14f);
        box.addView(title);

        SeekBar bar = new SeekBar(this);
        bar.setMax(max - min);
        bar.setProgress(Math.max(0, current - min));
        bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                int value = min + progress;
                title.setText(label + ": " + value + suffix);
                if (fromUser) listener.onValue(value);
            }

            @Override
            public void onStartTrackingTouch(SeekBar seekBar) {
            }

            @Override
            public void onStopTrackingTouch(SeekBar seekBar) {
            }
        });
        box.addView(bar);
        return box;
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

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
