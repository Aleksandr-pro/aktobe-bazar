#include "desktop.h"
#include "../gfx.h"
#include "../vga.h"
#include "../util.h"
#include "../mem.h"
#include "../timer.h"
#include "../mouse.h"
#include "../serial.h"
#include "../plat.h"
#include "window.h"
#include "apps.h"
#include "events.h"

#define DOCK_X 19
#define DOCK_Y 174
#define DOCK_W 282
#define DOCK_H 20
#define BTN_W 62
#define BTN_H 16
#define BTN_GAP 6

#define STAR_N 140
#define BOOT_TICKS 150

typedef struct {
    int x, y;
    uint8_t speed;
    uint8_t c;
} star_t;

static star_t stars[STAR_N];

static const char *boot_status[6] = {
    "NEUROKERNEL CORE ONLINE",
    "MOUNTING PERSISTENT MEMORY",
    "CALIBRATING QUANTUM COPROCESSOR",
    "LOADING SPATIAL GLASS COMPOSITOR",
    "ESTABLISHING MESH LINK",
    "DESKTOP ENVIRONMENT READY"
};
static const uint8_t dock_accent[APP_COUNT] = {
    C_CYAN, C_MAG, C_MINT, C_VIOLET
};
static const char *dock_label[APP_COUNT] = { "TERM", "PULSE", "LOGS", "ABOUT" };

/* Hand-drawn 12x12 neon pictograms */
static void draw_app_icon(int idx, int ix, int iy, uint8_t c) {
    switch (idx) {
    case APP_TERMINAL:                          /* chevron prompt */
        gfx_line(ix + 3, iy + 2, ix + 9, iy + 6, c);
        gfx_line(ix + 9, iy + 6, ix + 3, iy + 10, c);
        gfx_fill_rect(ix + 2, iy + 11, 3, 1, c);
        break;
    case APP_PULSE:                             /* oscilloscope trace */
        gfx_line(ix + 1, iy + 8, ix + 4, iy + 4, c);
        gfx_line(ix + 4, iy + 4, ix + 7, iy + 9, c);
        gfx_line(ix + 7, iy + 9, ix + 11, iy + 3, c);
        break;
    case APP_LOGS:                              /* stacked log lines */
        gfx_fill_rect(ix + 2, iy + 2, 8, 2, c);
        gfx_fill_rect(ix + 2, iy + 6, 8, 2, c);
        gfx_fill_rect(ix + 2, iy + 10, 8, 2, c);
        gfx_fill_rect(ix + 2, iy + 2, 2, 10, RAMP(R_MINT, 150));
        break;
    default:                                    /* info glyph */
        gfx_circle_fill(ix + 6, iy + 2, 1, c);
        gfx_fill_rect(ix + 5, iy + 5, 2, 6, c);
        break;
    }
}

/* ---------------- background ---------------------------------------------- */

static void stars_init(void) {
    for (int i = 0; i < STAR_N; i++) {
        stars[i].x = (int)rng_range(SCR_W);
        stars[i].y = (int)rng_range(SCR_H);
        stars[i].speed = (uint8_t)(1 + rng_range(3));
        static const uint8_t cs[3] = { C_DIM, C_MID, C_WHITE };
        stars[i].c = cs[rng_range(3)];
    }
}

static void bg_draw(void) {
    for (int y = 0; y < SCR_H; y++) {
        uint8_t t = (uint8_t)(36 + y * 180 / (SCR_H - 1));
        gfx_fill_rect(0, y, SCR_W, 1, RAMP(R_SPACE, t));
    }
    /* nebulae */
    gfx_circle_blend(70, 60, 46, RAMP(R_VIOLET, 70));
    gfx_circle_blend(262, 96, 40, RAMP(R_CYAN, 55));
    gfx_circle_blend(170, 150, 34, RAMP(R_MAG, 48));

    for (int i = 0; i < STAR_N; i++) {
        star_t *s = &stars[i];
        s->x -= s->speed;
        if (s->x < 0) {
            s->x = SCR_W - 1;
            s->y = (int)rng_range(SCR_H);
        }
        gfx_pset(s->x, s->y, s->c);
        if (s->c == C_WHITE && s->speed == 3)
            gfx_pset(s->x + 1, s->y, C_DIM);
    }
}

/* ---------------- chrome --------------------------------------------------- */

static void topbar_draw(void) {
    gfx_blend_rect(0, 0, SCR_W, 15, C_PANEL2);
    gfx_fill_rect(0, 15, SCR_W, 1, C_BORDER);
    gfx_text(6, 4, "AURA//OS", C_CYAN);
    gfx_text(86, 4, "NEURAL DESKTOP", C_DIM);

    uint32_t up = g_tick / 100;
    char buf[24];
    char num[8];
    strcpy(buf, "NPU ");
    utoa(up / 3600, num); strcat(buf, num); strcat(buf, ":");
    utoa((up / 60) % 60, num);
    if ((up / 60) % 60 < 10) strcat(buf, "0");
    strcat(buf, num); strcat(buf, ":");
    utoa(up % 60, num);
    if (up % 60 < 10) strcat(buf, "0");
    strcat(buf, num);
    gfx_text(316 - gfx_text_width(buf, 1), 4, buf, C_MID);
}

void ui_dock_geometry(int idx, int *x, int *y, int *w, int *h) {
    if (x) *x = DOCK_X + 8 + idx * (BTN_W + BTN_GAP);
    if (y) *y = DOCK_Y + 2;
    if (w) *w = BTN_W;
    if (h) *h = BTN_H;
}

static int dock_hit(int px, int py) {
    for (int i = 0; i < APP_COUNT; i++) {
        int x, y, w, h;
        ui_dock_geometry(i, &x, &y, &w, &h);
        if (px >= x && py >= y && px < x + w && py < y + h) return i;
    }
    return -1;
}

static void dock_draw(void) {
    gfx_round_blend(DOCK_X, DOCK_Y, DOCK_W, DOCK_H, 9, C_PANEL);
    gfx_round_outline(DOCK_X, DOCK_Y, DOCK_W, DOCK_H, 9, C_BORDER);
    for (int i = 0; i < APP_COUNT; i++) {
        int x, y, w, h;
        ui_dock_geometry(i, &x, &y, &w, &h);
        win_t *win = wm_get(i);
        int hover = mouse_x() >= x && mouse_x() < x + w &&
                    mouse_y() >= y && mouse_y() < y + h;
        uint8_t c = dock_accent[i];
        gfx_round_rect(x, y, w, h, 4, hover ? RAMP(R_GRAY, 90) : C_PANEL2);
        gfx_round_outline(x, y, w, h, 4, hover ? c : C_BORDER);
        draw_app_icon(i, x + 5, y + 2, c);
        gfx_text(x + 24, y + 4, dock_label[i], hover ? C_TEXT : C_MID);
        if (win->open)
            gfx_fill_rect(x + w / 2 - 2, y + h + 1, 4, 2, c);
    }
}

/* ---------------- cursor --------------------------------------------------- */

static const uint8_t cursor_bmp[16] = {
    0x07, 0x0F, 0x1F, 0x3F, 0x7F, 0xFE, 0xFC, 0xF8,
    0xF0, 0x78, 0x24, 0x24, 0x12, 0x12, 0x00, 0x00
};

static void cursor_draw(void) {
    int x = mouse_x(), y = mouse_y();
    for (int row = 0; row < 16; row++) {
        uint8_t bits = cursor_bmp[row];
        for (int col = 0; col < 8; col++) {
            if (!(bits & (0x80 >> col))) continue;
            /* dark halo first */
            gfx_pset(x + col - 1, y + row, C_VOID);
            gfx_pset(x + col + 1, y + row, C_VOID);
            gfx_pset(x + col, y + row - 1, C_VOID);
            gfx_pset(x + col, y + row + 1, C_VOID);
        }
    }
    for (int row = 0; row < 16; row++) {
        uint8_t bits = cursor_bmp[row];
        for (int col = 0; col < 8; col++)
            if (bits & (0x80 >> col))
                gfx_pset(x + col, y + row, C_WHITE);
    }
}

/* ---------------- boot animation ------------------------------------------- */

static void boot_frame(uint32_t t) {
    bg_draw();
    int cx = SCR_W / 2, cy = 82;

    gfx_ring(cx, cy, 36, RAMP(R_VIOLET, 150));
    gfx_ring(cx, cy, 28, RAMP(R_CYAN, 120));
    uint8_t a = (uint8_t)(t * 2);
    gfx_arc(cx, cy, 36, a, (uint8_t)(a + 70), C_CYAN);
    gfx_arc(cx, cy, 28, (uint8_t)(a + 128), (uint8_t)(a + 200), C_MAG);

    int pulse = 8 + (isin((uint8_t)(t * 4)) + 4096) / 1400;
    gfx_circle_fill(cx, cy, pulse, C_CYAN);
    gfx_circle_fill(cx, cy, pulse / 2, C_WHITE);
    gfx_circle_fill(cx + (icos(a) * 36) / 4096,
                    cy + (isin(a) * 36) / 4096, 2, C_MAG);

    gfx_text_center(128, "AURA//OS", C_TEXT, 2);
    gfx_text_center(150, "NEURAL DESKTOP ENVIRONMENT 2045.1", C_MID, 1);

    int pct = (int)(t * 100 / BOOT_TICKS);
    gfx_rect(70, 166, 180, 7, C_BORDER);
    gfx_fill_rect(71, 167, (178 * pct) / 100, 5, RAMP(R_CYAN, 210));
    char pbuf[8];
    utoa((uint32_t)pct, pbuf);
    strcat(pbuf, "%");
    gfx_text(256, 166, pbuf, C_CYAN);

    int phase = (int)(t * 6 / BOOT_TICKS);
    if (phase > 5) phase = 5;
    gfx_text_center(182, boot_status[phase], C_DIM, 1);
    vga_present();
}

void ui_boot(void) {
    stars_init();
    int last_phase = -1;
    log_event("AURA//OS 2045.1 HELIOS BOOT");
    while (g_tick < BOOT_TICKS) {
        plat_idle();
        int phase = (int)(g_tick * 6 / BOOT_TICKS);
        if (phase > 5) phase = 5;
        if (phase != last_phase) {
            log_event(boot_status[phase]);
            kprintf("[boot] %s\n", boot_status[phase]);
            last_phase = phase;
        }
        boot_frame(g_tick);
    }
}

void ui_desktop_init(void) {
    log_event("DESKTOP SESSION STARTED");
}

/* ---------------- per-frame orchestration --------------------------------- */

void ui_frame(void) {
    apps_tick();
    bg_draw();
    topbar_draw();
    wm_draw_all();
    dock_draw();

    int px = mouse_x(), py = mouse_y();
    if (mouse_consume_press()) {
        int d = dock_hit(px, py);
        if (d >= 0) {
            wm_open(d);
        } else if (wm_close_pick(px, py)) {
            wm_close(wm_close_pick(px, py));
        } else {
            win_t *t = wm_title_pick(px, py);
            if (t) {
                wm_focus(t);
                wm_begin_drag(t, px, py);
            } else if (wm_pick(px, py)) {
                wm_focus(wm_pick(px, py));
            }
        }
    }
    if (mouse_left()) wm_drag_step(px, py);
    else wm_end_drag();

    cursor_draw();
    vga_present();
}
