#include "window.h"
#include "../gfx.h"
#include "../vga.h"
#include "../util.h"
#include "apps.h"

static win_t wins[APP_COUNT];
static int zorder[APP_COUNT];
static int drag_app = -1, drag_dx, drag_dy;

void wm_init(void) {
    static const char *titles[APP_COUNT] = {
        "TERMINAL", "PULSE MONITOR", "SYSTEM LOG", "ABOUT AURA"
    };
    static const uint8_t accents[APP_COUNT] = {
        C_CYAN, C_MAG, C_MINT, C_VIOLET
    };
    static const int geo[APP_COUNT][4] = {
        { 20, 26, 256, 138 },
        { 48, 42, 224, 118 },
        { 30, 34, 242, 124 },
        { 62, 46, 196, 116 }
    };
    for (int i = 0; i < APP_COUNT; i++) {
        wins[i].x = geo[i][0]; wins[i].y = geo[i][1];
        wins[i].w = geo[i][2]; wins[i].h = geo[i][3];
        wins[i].title = titles[i];
        wins[i].accent = accents[i];
        wins[i].open = 0;
        zorder[i] = i;
    }
}

win_t *wm_get(int app) { return &wins[app]; }

win_t *wm_focused(void) {
    for (int z = APP_COUNT - 1; z >= 0; z--) {
        win_t *w = &wins[zorder[z]];
        if (w->open) return w;
    }
    return 0;
}

void wm_focus(win_t *w) {
    int idx = (int)(w - wins);
    int pos = 0;
    for (int i = 0; i < APP_COUNT; i++)
        if (zorder[i] == idx) pos = i;
    for (int i = pos; i < APP_COUNT - 1; i++)
        zorder[i] = zorder[i + 1];
    zorder[APP_COUNT - 1] = idx;
}

void wm_open(int app) {
    if (!wins[app].open) {
        wins[app].open = 1;
        wm_focus(&wins[app]);
    } else {
        wm_focus(&wins[app]);
    }
}

void wm_close(win_t *w) { w->open = 0; }

static int inside(int px, int py, int x, int y, int w, int h) {
    return px >= x && py >= y && px < x + w && py < y + h;
}

win_t *wm_pick(int x, int y) {
    for (int z = APP_COUNT - 1; z >= 0; z--) {
        win_t *w = &wins[zorder[z]];
        if (w->open && inside(x, y, w->x, w->y, w->w, w->h)) return w;
    }
    return 0;
}

win_t *wm_title_pick(int x, int y) {
    win_t *w = wm_pick(x, y);
    if (w && y < w->y + 18 && x < w->x + w->w - 16) return w;
    return 0;
}

win_t *wm_close_pick(int x, int y) {
    for (int z = APP_COUNT - 1; z >= 0; z--) {
        win_t *w = &wins[zorder[z]];
        if (w->open && inside(x, y, w->x + w->w - 14, w->y + 3, 11, 11))
            return w;
    }
    return 0;
}

void wm_begin_drag(win_t *w, int px, int py) {
    drag_app = (int)(w - wins);
    drag_dx = px - w->x;
    drag_dy = py - w->y;
}

void wm_drag_step(int px, int py) {
    if (drag_app < 0) return;
    win_t *w = &wins[drag_app];
    w->x = iclamp(px - drag_dx, -w->w + 24, SCR_W - 24);
    w->y = iclamp(py - drag_dy, 16, SCR_H - 24);
}

void wm_end_drag(void) { drag_app = -1; }

void wm_draw_all(void) {
    for (int z = 0; z < APP_COUNT; z++) {
        int idx = zorder[z];
        win_t *w = &wins[idx];
        if (!w->open) continue;
        int focused = (wm_focused() == w);
        uint8_t frame = focused ? w->accent : C_BORDER;

        gfx_round_blend(w->x, w->y, w->w, w->h, 5, C_PANEL);
        gfx_round_outline(w->x, w->y, w->w, w->h, 5, frame);
        gfx_fill_rect(w->x + 1, w->y + 12, w->w - 2, 1, C_BORDER);

        gfx_text(w->x + 8, w->y + 3, w->title, focused ? w->accent : C_MID);
        /* close button */
        int cx = w->x + w->w - 14, cy = w->y + 3;
        gfx_rect(cx, cy, 11, 11, frame);
        gfx_text(cx + 3, cy + 2, "x", focused ? C_RED : C_MID);

        apps_draw(idx, w->x + 8, w->y + 18, w->w - 16, w->h - 24);
    }
}
