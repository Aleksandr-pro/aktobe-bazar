package kz.bazar.fx;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Настройки пайплайна BazarFX (сохраняются между запусками).
 *
 * Качество задаётся пресетом (0..4) и может быть донастроено вручную —
 * тогда пресет помечается как «свои настройки» (CUSTOM).
 */
public final class FxSettings {

    public static final int QUALITY_PERFORMANCE = 0;
    public static final int QUALITY_BALANCED = 1;
    public static final int QUALITY_HIGH = 2;
    public static final int QUALITY_ULTRA = 3;
    public static final int QUALITY_REALISM = 4;
    public static final int QUALITY_NEURAL = 5;
    public static final int QUALITY_ESPORTS = 6;
    public static final int QUALITY_CINEMA = 7;
    public static final int CUSTOM = 8;

    public static final String[] QUALITY_NAMES = {
            "Экономия", "Баланс", "Высокое", "Ультра", "Реализм", "AI · нейро", "Киберспорт",
            "AI · Кинематограф", "Свои настройки"
    };

    public static final String[] QUALITY_HINTS = {
            "0.5× сцены — максимум FPS, картинка мягче",
            "0.7× сцены — компромисс по умолчанию",
            "0.85× + TAA — резче и чище, чем исходник",
            "1.0× + TAA + clarity — предел качества апскейла",
            "1.0× + TAA + clarity + тон — «кино»-картинка без лесенок и полос",
            "нейросеть восстанавливает детали из низкого разрешения (медленнее)",
            "без TAA и генерации кадров — ни шлейфов, ни лишней задержки. Для шутеров",
            "две сети: апскейл + дорисовка деталей. Самая «киношная» картинка (дорого)"
    };

    public int quality = QUALITY_HIGH;

    public float renderScale = 0.85f;   // доля пикселей сцены (0.3 .. 1.0)
    public float sharpen = 0.55f;       // сила адаптивного шарпа (0 .. 1)
    public float clarity = 0.35f;       // локальный контраст / «объём» (0 .. 1)
    public float grade = 0.25f;           // тон: контраст, насыщенность, антибандинг (0 .. 1)
    public boolean temporal = true;   // TAA (без motion vectors даёт шлейфы)
    public boolean frameGen = false;   // генерация промежуточных кадров (экспериментально)
    public boolean showBubble = true;  // плавающая кнопка
    public boolean secureOverlay = true;
    public boolean autoQuality = true;   // сам снижает масштаб, если не успевает
    public boolean splitCompare = false; // слева оригинал, справа обработка
    public boolean neural = false;        // нейросетевой апскейл
    public float neuralStrength = 1f;     // 0..1 — доля «AI» в результате
    public boolean enhance = false;       // вторая сеть: дорисовка деталей поверх апскейла
    public float enhanceStrength = 1f;    // 0..1 — сила дорисовки
    public float neuralScale = 0.36f;     // низкое разрешение на входе сети
    public int flowStep = 3;           // шаг сетки блочного потока (для frameGen)
    public int flowSearch = 4;         // радиус поиска в шагах сетки
    public float flowTaps = 1f;        // окно сопоставления: 1 = 3x3, 2 = 5x5

    private static final String PREFS = "bazarfx";

    /** Готовый набор значений для пресета. */
    public static FxSettings preset(Context context, int quality) {
        FxSettings s = FxSettings.load(context);
        s.applyPreset(quality);
        return s;
    }

    public void applyPreset(int preset) {
        quality = preset;
        switch (preset) {
            case QUALITY_PERFORMANCE:
                renderScale = 0.5f;
                sharpen = 0.45f;
                clarity = 0f;
                grade = 0f;
                temporal = false;
                frameGen = false;
                neural = false;
                enhance = false;
                flowStep = 4;
                flowSearch = 3;
                flowTaps = 1f;
                break;
            case QUALITY_BALANCED:
                renderScale = 0.7f;
                sharpen = 0.5f;
                clarity = 0.2f;
                grade = 0f;
                temporal = false;
                frameGen = false;
                neural = false;
                enhance = false;
                flowStep = 3;
                flowSearch = 4;
                flowTaps = 1f;
                break;
            case QUALITY_HIGH:
                renderScale = 0.85f;
                sharpen = 0.55f;
                clarity = 0.35f;
                grade = 0.25f;
                temporal = true;
                frameGen = false;
                neural = false;
                enhance = false;
                flowStep = 3;
                flowSearch = 4;
                flowTaps = 1f;
                break;
            case QUALITY_ULTRA:
                renderScale = 1f;
                sharpen = 0.6f;
                clarity = 0.5f;
                grade = 0.4f;
                temporal = true;
                frameGen = false;
                neural = false;
                enhance = false;
                flowStep = 2;
                flowSearch = 5;
                flowTaps = 2f;
                break;
            case QUALITY_REALISM:
                renderScale = 1f;
                sharpen = 0.7f;
                clarity = 0.6f;
                grade = 0.5f;
                temporal = true;
                frameGen = false;
                neural = false;
                enhance = false;
                flowStep = 2;
                flowSearch = 5;
                flowTaps = 2f;
                break;
            case QUALITY_NEURAL:
                // Сеть сама восстанавливает детали, поэтому агрессивный шарп не нужен:
                // иначе к «нарисованным» краям добавляются ореолы.
                renderScale = 0.5f;
                sharpen = 0.35f;
                clarity = 0.15f;
                grade = 0.15f;
                temporal = true;
                frameGen = false;
                neural = true;
                enhance = false;
                enhanceStrength = 1f;
                neuralStrength = 1f;
                neuralScale = 0.36f;
                break;
            case QUALITY_CINEMA:
                // Главный режим «ИИ дорисовывает картинку»: апскейлер вытягивает
                // форму, вторая сеть доделывает детали, тон доводит до «кино».
                renderScale = 0.5f;
                sharpen = 0.3f;
                clarity = 0.25f;
                grade = 0.45f;
                temporal = true;
                frameGen = false;
                neural = true;
                enhance = true;
                neuralStrength = 1f;
                enhanceStrength = 1f;
                neuralScale = 0.36f;
                flowStep = 4;
                flowSearch = 3;
                flowTaps = 1f;
                break;
            case QUALITY_ESPORTS:
                // Для соревновательных шутеров важнее всего задержка и отсутствие
                // шлейфов: TAA «смазывает» бегущих врагов, frameGen добавляет кадр
                // задержки. Поэтому только шарп + локальный контраст на полном кадре.
                renderScale = 1f;
                sharpen = 0.6f;
                clarity = 0.5f;
                grade = 0f;
                temporal = false;
                frameGen = false;
                neural = false;
                enhance = false;
                flowStep = 3;
                flowSearch = 4;
                flowTaps = 1f;
                break;
            default:
                quality = CUSTOM;
                break;
        }
    }

    public String qualityName() {
        return QUALITY_NAMES[Math.max(0, Math.min(QUALITY_NAMES.length - 1, quality))];
    }

    /** Любое ручное изменение = «свои настройки». */
    public void markCustom() {
        quality = CUSTOM;
    }

    public static FxSettings load(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        FxSettings s = new FxSettings();
        s.quality = p.getInt("quality", s.quality);
        s.renderScale = p.getFloat("renderScale", s.renderScale);
        s.sharpen = p.getFloat("sharpen", s.sharpen);
        s.clarity = p.getFloat("clarity", s.clarity);
        s.grade = p.getFloat("grade", s.grade);
        s.temporal = p.getBoolean("temporal", s.temporal);
        s.frameGen = p.getBoolean("frameGen", s.frameGen);
        s.showBubble = p.getBoolean("showBubble", s.showBubble);
        s.secureOverlay = p.getBoolean("secureOverlay", s.secureOverlay);
        s.autoQuality = p.getBoolean("autoQuality", s.autoQuality);
        s.splitCompare = p.getBoolean("splitCompare", s.splitCompare);
        s.neural = p.getBoolean("neural", s.neural);
        s.neuralStrength = p.getFloat("neuralStrength", s.neuralStrength);
        s.enhance = p.getBoolean("enhance", s.enhance);
        s.enhanceStrength = p.getFloat("enhanceStrength", s.enhanceStrength);
        s.neuralScale = p.getFloat("neuralScale", s.neuralScale);
        s.flowStep = p.getInt("flowStep", s.flowStep);
        s.flowSearch = p.getInt("flowSearch", s.flowSearch);
        s.flowTaps = p.getFloat("flowTaps", s.flowTaps);
        return s;
    }

    public void save(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putInt("quality", quality)
                .putFloat("renderScale", renderScale)
                .putFloat("sharpen", sharpen)
                .putFloat("clarity", clarity)
                .putFloat("grade", grade)
                .putBoolean("temporal", temporal)
                .putBoolean("frameGen", frameGen)
                .putBoolean("showBubble", showBubble)
                .putBoolean("secureOverlay", secureOverlay)
                .putBoolean("autoQuality", autoQuality)
                .putBoolean("splitCompare", splitCompare)
                .putBoolean("neural", neural)
                .putFloat("neuralStrength", neuralStrength)
                .putBoolean("enhance", enhance)
                .putFloat("enhanceStrength", enhanceStrength)
                .putFloat("neuralScale", neuralScale)
                .putInt("flowStep", flowStep)
                .putInt("flowSearch", flowSearch)
                .putFloat("flowTaps", flowTaps)
                .apply();
    }
}
