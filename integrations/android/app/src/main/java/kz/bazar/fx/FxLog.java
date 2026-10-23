package kz.bazar.fx;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Файловый лог BazarFX.
 *
 * Зачем: приложение работает поверх чужих игр, и если что-то падает — пользователь
 * видит только «Приложение остановлено» без причины. Пишем всё в файл, который
 * можно показать из приложения (кнопка «Лог»), и ставим обработчик непойманных
 * исключений, чтобы вместо падения сервис аккуратно выключился и записал стек.
 */
public final class FxLog {

    private static final String TAG = "BazarFX";
    private static final String FILE_NAME = "bazarfx.log";
    private static final long MAX_BYTES = 256 * 1024;

    private static Context appContext;

    private FxLog() {
    }

    public static synchronized void init(Context context) {
        if (appContext == null) {
            appContext = context.getApplicationContext();
        }
    }

    public static synchronized void i(String message) {
        Log.i(TAG, message);
        append("I", message, null);
    }

    public static synchronized void w(String message) {
        Log.w(TAG, message);
        append("W", message, null);
    }

    public static synchronized void e(String message, Throwable error) {
        Log.e(TAG, message, error);
        append("E", message, error);
    }

    /** Ставит обработчик непойманных исключений (переживает падения в GL-потоке). */
    public static void installCrashGuard(final Runnable onCrash) {
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread thread, Throwable error) {
                e("Непойманное исключение в потоке " + thread.getName(), error);
                try {
                    if (onCrash != null) onCrash.run();
                } catch (Throwable ignored) {
                }
                // Не роняем процесс: сервис уже остановлен, пользователь увидит уведомление.
                if (previous != null && !isOurThread(thread)) {
                    previous.uncaughtException(thread, error);
                }
            }
        });
    }

    private static boolean isOurThread(Thread thread) {
        String name = thread.getName();
        return name != null && (name.contains("GLThread") || name.startsWith("BazarFX"));
    }

    public static File logFile() {
        if (appContext == null) return null;
        return new File(appContext.getFilesDir(), FILE_NAME);
    }

    public static String read() {
        File file = logFile();
        if (file == null || !file.exists()) return "Лог пуст";
        try {
            byte[] data = new byte[(int) file.length()];
            java.io.FileInputStream in = new java.io.FileInputStream(file);
            try {
                int read = in.read(data);
                return read > 0 ? new String(data, 0, read, "UTF-8") : "Лог пуст";
            } finally {
                in.close();
            }
        } catch (Throwable t) {
            return "Не удалось прочитать лог: " + t;
        }
    }

    public static void clear() {
        File file = logFile();
        if (file != null && file.exists()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private static void append(String level, String message, Throwable error) {
        File file = logFile();
        if (file == null) return;
        try {
            if (file.length() > MAX_BYTES) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
            String time = new SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(new Date());
            FileWriter writer = new FileWriter(file, true);
            PrintWriter out = new PrintWriter(writer);
            try {
                out.println(time + " " + level + " " + message);
                if (error != null) {
                    StringWriter buffer = new StringWriter();
                    error.printStackTrace(new PrintWriter(buffer));
                    out.println(buffer.toString());
                }
            } finally {
                out.close();
                writer.close();
            }
        } catch (Throwable ignored) {
            // логирование не должно ломать приложение
        }
    }
}
