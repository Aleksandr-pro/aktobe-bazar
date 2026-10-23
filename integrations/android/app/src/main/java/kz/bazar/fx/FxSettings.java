package kz.bazar.fx;

import android.content.Context;
import android.content.SharedPreferences;

/** Настройки пайплайна BazarFX (сохраняются между запусками). */
public final class FxSettings {

    public float renderScale = 0.7f;   // доля пикселей сцены (0.3 .. 1.0)
    public float sharpen = 0.5f;       // сила адаптивного шарпа (0 .. 1)
    public boolean temporal = false;   // TAA (без motion vectors даёт шлейфы)
    public boolean frameGen = false;   // генерация промежуточных кадров (экспериментально)
    public boolean showBubble = true;  // плавающая кнопка
    public boolean secureOverlay = true; // исключить свой оверлей из захвата (FLAG_SECURE)
    public int flowStep = 3;           // шаг сетки блочного потока (для frameGen)
    public int flowSearch = 4;         // радиус поиска в шагах сетки
    public float flowTaps = 1f;        // окно сопоставления: 1 = 3x3, 2 = 5x5

    private static final String PREFS = "bazarfx";

    public static FxSettings load(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        FxSettings s = new FxSettings();
        s.renderScale = p.getFloat("renderScale", s.renderScale);
        s.sharpen = p.getFloat("sharpen", s.sharpen);
        s.temporal = p.getBoolean("temporal", s.temporal);
        s.frameGen = p.getBoolean("frameGen", s.frameGen);
        s.showBubble = p.getBoolean("showBubble", s.showBubble);
        s.secureOverlay = p.getBoolean("secureOverlay", s.secureOverlay);
        s.flowStep = p.getInt("flowStep", s.flowStep);
        s.flowSearch = p.getInt("flowSearch", s.flowSearch);
        s.flowTaps = p.getFloat("flowTaps", s.flowTaps);
        return s;
    }

    public void save(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putFloat("renderScale", renderScale)
                .putFloat("sharpen", sharpen)
                .putBoolean("temporal", temporal)
                .putBoolean("frameGen", frameGen)
                .putBoolean("showBubble", showBubble)
                .putBoolean("secureOverlay", secureOverlay)
                .putInt("flowStep", flowStep)
                .putInt("flowSearch", flowSearch)
                .putFloat("flowTaps", flowTaps)
                .apply();
    }
}
