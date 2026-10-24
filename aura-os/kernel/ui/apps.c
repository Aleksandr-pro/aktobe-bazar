#include "apps.h"
#include "../gfx.h"
#include "../vga.h"
#include "../mem.h"
#include "../util.h"
#include "../timer.h"
#include "../kb.h"
#include "window.h"
#include "events.h"

/* ---------------- terminal ---------------------------------------------- */

#define T_COLS 30
#define T_ROWS 11
#define T_HIST 40
#define T_MAX  (T_COLS - 17)

static char hist[T_HIST][T_COLS + 2];
static int hist_n = 0;
static char input[T_COLS + 2];
static int input_len = 0;

static void t_print(const char *s) {
    while (*s) {
        if (hist_n >= T_HIST) {
            for (int i = 1; i < T_HIST; i++) strcpy(hist[i - 1], hist[i]);
            hist_n = T_HIST - 1;
        }
        int n = (int)strlen(s);
        if (n > T_COLS) n = T_COLS;
        strncpy(hist[hist_n], s, (size_t)n);
        hist[hist_n][n] = 0;
        hist_n++;
        s += n;
    }
}

static void t_help(void) {
    t_print("COMMANDS:");
    t_print("help sys cores date echo");
    t_print("aura clear exit");
}

static void t_sys(void) {
    t_print("AURA//OS 2045.1 [HELIOS]");
    t_print("neurokernel 8-core / cap-secure IPC");
    t_print("mem 512 KiB  fb 320x200x8  quantum q0");
}

static void t_execute(void) {
    char echo[T_COLS + 2];
    strcpy(echo, "aura@nexus:~$ ");
    strcat(echo, input);
    t_print(echo);

    char cmd[16];
    int i = 0;
    while (input[i] == ' ' && i < input_len) i++;
    int k = 0;
    while (input[i] && input[i] != ' ' && k < 15) cmd[k++] = input[i++];
    cmd[k] = 0;

    if (cmd[0] == 0) { }
    else if (strcmp(cmd, "help") == 0) t_help();
    else if (strcmp(cmd, "sys") == 0) t_sys();
    else if (strcmp(cmd, "cores") == 0) {
        t_print("8 NEURAL CORES ONLINE");
        t_print("load 0.42  synth 12.8 TFLOP/s");
    }
    else if (strcmp(cmd, "date") == 0) {
        uint32_t up = g_tick / 100;
        char b[T_COLS + 2];
        strcpy(b, "uptime ");
        char num[12];
        utoa(up / 3600, num); strcat(b, num); strcat(b, "h ");
        utoa((up / 60) % 60, num); strcat(b, num); strcat(b, "m ");
        utoa(up % 60, num); strcat(b, num); strcat(b, "s");
        t_print(b);
    }
    else if (strcmp(cmd, "clear") == 0) hist_n = 0;
    else if (strcmp(cmd, "exit") == 0) {
        wm_close(wm_get(APP_TERMINAL));
    }
    else if (strcmp(cmd, "aura") == 0) {
        t_print("  .--.  AURA//OS");
        t_print(" |o_o | NEURAL DESKTOP");
        t_print("  '--'  build 2045.1");
    }
    else if (strcmp(cmd, "echo") == 0) {
        while (input[i] == ' ') i++;
        t_print(input + i);
    }
    else {
        char b[T_COLS + 2];
        strcpy(b, cmd);
        strcat(b, ": command not found");
        t_print(b);
    }
    input_len = 0;
    input[0] = 0;
}

static void draw_terminal(int x, int y, int w, int h) {
    (void)w; (void)h;
    int shown = hist_n < T_ROWS ? hist_n : T_ROWS;
    int start = hist_n - shown;
    for (int i = 0; i < shown; i++)
        gfx_text(x, y + i * 9, hist[start + i], C_MINT);

    int row = y + shown * 9;
    gfx_text(x, row, "aura@nexus:~$ ", C_CYAN);
    gfx_text(x + 15 * 8, row, input, C_TEXT);
    if ((g_tick / 5) & 1)
        gfx_fill_rect(x + 15 * 8 + input_len * 8, row, 7, 8, C_CYAN);
}

/* ---------------- pulse monitor ----------------------------------------- */

static uint8_t spark[44];
static int spark_i = 0;

static void draw_pulse(int x, int y, int w, int h) {
    (void)h;
    int bars = 8;
    int bw = (w - (bars - 1) * 3) / bars;
    int base = y + 42;
    for (int i = 0; i < bars; i++) {
        int wave = (isin((uint8_t)(g_tick * 2 + i * 24)) + 4096) / 8192 * 16;
        int jit = (int)(rng_range(5));
        int bh = 6 + wave + jit;
        uint8_t c = (uint8_t)(R_MAG + (bh * (RAMP_N - 1)) / 28);
        gfx_fill_rect(x + i * (bw + 3), base - bh, bw, bh, c);
        gfx_fill_rect(x + i * (bw + 3), base, bw, 1, C_BORDER);
    }
    gfx_text(x, y + 2, "NEURAL CORE LOAD", C_MAG);

    /* gauges */
    int npu = 100 + (isin((uint8_t)g_tick) + 4096) / 170;
    int mem = 80 + (icos((uint8_t)(g_tick / 2)) + 4096) / 260;
    if (npu > w - 30) npu = w - 30;
    if (mem > w - 30) mem = w - 30;
    gfx_text(x, y + 50, "NPU", C_DIM);
    gfx_rect(x + 28, y + 50, w - 28, 7, C_BORDER);
    gfx_fill_rect(x + 29, y + 51, npu, 5, RAMP(R_CYAN, 200));
    gfx_text(x, y + 62, "MEM", C_DIM);
    gfx_rect(x + 28, y + 62, w - 28, 7, C_BORDER);
    gfx_fill_rect(x + 29, y + 63, mem, 5, RAMP(R_MINT, 200));

    /* sparkline */
    spark[spark_i] = (uint8_t)(10 + (isin((uint8_t)(g_tick * 3)) + 4096) / 400
                               + rng_range(4));
    spark_i = (spark_i + 1) % 44;
    gfx_text(x, y + 76, "QUANTUM BUS", C_DIM);
    for (int i = 1; i < 44; i++) {
        int a = spark[(spark_i + i) % 44];
        int b = spark[(spark_i + i + 1) % 44];
        gfx_line(x + i * 4, y + 92 - a, x + (i + 1) * 4, y + 92 - b, C_AMBER);
    }
}

/* ---------------- system log --------------------------------------------- */

static void draw_logs(int x, int y, int w, int h) {
    int cols = w / 8;
    if (cols < 10) cols = 10;
    int max_rows = (h - 4) / 9;

    char lines[LOG_CAP * 2][LOG_LEN + 8];
    int rows = 0;
    int n = log_count();
    for (int i = 0; i < n && rows < LOG_CAP * 2; i++) {
        char line[LOG_LEN + 8];
        strcpy(line, "[");
        char num[8];
        utoa((uint32_t)i, num);
        strcat(line, num);
        strcat(line, "] ");
        strcat(line, log_get(i));
        int len = (int)strlen(line);
        for (int off = 0; off < len && rows < LOG_CAP * 2; off += cols) {
            int k = len - off;
            if (k > cols) k = cols;
            strncpy(lines[rows], line + off, (size_t)k);
            lines[rows][k] = 0;
            rows++;
        }
    }
    int start = rows > max_rows ? rows - max_rows : 0;
    for (int r = start; r < rows; r++)
        gfx_text(x, y + (r - start) * 9, lines[r],
                 r == rows - 1 ? C_MINT : C_MID);
}

/* ---------------- about --------------------------------------------------- */

static void draw_about(int x, int y, int w, int h) {
    (void)h;
    int cx = x + 30;
    int cy = y + 22;
    gfx_ring(cx, cy, 16, C_CYAN);
    gfx_ring(cx, cy, 11, RAMP(R_VIOLET, 180));
    gfx_circle_fill(cx, cy, 5, C_MAG);
    uint8_t a = (uint8_t)(g_tick * 3);
    gfx_circle_fill(cx + (icos(a) * 16) / 4096,
                    cy + (isin(a) * 16) / 4096, 2, C_WHITE);

    gfx_text2(x + 58, y + 4, "AURA//OS", C_TEXT);
    gfx_text(x + 60, y + 24, "VERSION 2045.1 HELIOS", C_CYAN);
    gfx_text(x, y + 50, "ADAPTIVE RUNTIME", C_MID);
    gfx_text(x, y + 60, "CAPABILITY KERNEL", C_MID);
    gfx_text(x, y + 70, "GLASS COMPOSITOR", C_MID);
    gfx_text(x, y + 80, "NEURO SCHEDULER", C_MID);
    gfx_text(x, y + 96, "QEMU / BARE METAL", C_DIM);
    (void)w;
}

/* ---------------- dispatch ------------------------------------------------ */

void apps_draw(int app, int x, int y, int w, int h) {
    switch (app) {
    case APP_TERMINAL: draw_terminal(x, y, w, h); break;
    case APP_PULSE:    draw_pulse(x, y, w, h); break;
    case APP_LOGS:     draw_logs(x, y, w, h); break;
    case APP_ABOUT:    draw_about(x, y, w, h); break;
    default: break;
    }
}

void apps_on_key(char c) {
    win_t *t = wm_get(APP_TERMINAL);
    if (!t->open || wm_focused() != t) return;
    if (c == '\n') { t_execute(); return; }
    if (c == '\b') { if (input_len) input[--input_len] = 0; return; }
    if (input_len < T_MAX && c >= ' ') {
        input[input_len++] = c;
        input[input_len] = 0;
    }
}

void apps_tick(void) {
    while (kb_kbhit()) {
        int c = kb_getchar();
        if (c >= 0) apps_on_key((char)c);
    }
}
