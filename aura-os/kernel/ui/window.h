#ifndef AURA_WINDOW_H
#define AURA_WINDOW_H

#include "../types.h"

enum { APP_TERMINAL = 0, APP_PULSE = 1, APP_LOGS = 2, APP_ABOUT = 3, APP_COUNT = 4 };

typedef struct {
    int x, y, w, h;
    const char *title;
    uint8_t accent;
    int open;
} win_t;

void wm_init(void);
win_t *wm_get(int app);
win_t *wm_focused(void);
void wm_open(int app);
void wm_close(win_t *w);
void wm_focus(win_t *w);
void wm_draw_all(void);
win_t *wm_pick(int x, int y);
win_t *wm_title_pick(int x, int y);
win_t *wm_close_pick(int x, int y);
void wm_begin_drag(win_t *w, int mx, int my);
void wm_drag_step(int mx, int my);
void wm_end_drag(void);

#endif
