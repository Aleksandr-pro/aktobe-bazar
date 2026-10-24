/*
 * AURA//OS host simulator.
 * Compiles the unmodified kernel C against user-space shims, pumps virtual
 * 10 ms ticks, scripts input and saves PPM screenshots. No QEMU required.
 */
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>

#include "sim_plat.h"
#include "../kernel/vga.h"
#include "../kernel/timer.h"
#include "../kernel/kb.h"
#include "../kernel/mouse.h"
#include "../kernel/ui/desktop.h"
#include "../kernel/ui/window.h"

extern const uint8_t host_font8x8[95][8];

#define SIM_TICKS 500

void kernel_main(void);

/* --- virtual ports -------------------------------------------------------- */
uint8_t inb(uint16_t port) { (void)port; return 0; }
void outb(uint16_t port, uint8_t v) { (void)port; (void)v; }
void io_wait(void) { }
void cli(void) { }
void sti(void) { }

/* --- serial mirror -------------------------------------------------------- */
void sim_putc(char c) { putchar(c); }

/* --- framebuffer ---------------------------------------------------------- */
void sim_vga_init(void) {
    vga_front = malloc(SCR_SIZE);
    if (!vga_front) { fprintf(stderr, "sim: out of memory\n"); exit(2); }
}
void sim_vga_present(void) { /* frames are snapshotted on demand */ }

const uint8_t *sim_font_glyph(uint8_t ch) {
    static const uint8_t blank[8] = {0};
    if (ch < 32 || ch > 126) return blank;
    return host_font8x8[ch - 32];
}

/* --- screenshots ---------------------------------------------------------- */
static void shot(const char *path) {
    FILE *f = fopen(path, "wb");
    if (!f) { perror(path); return; }
    fprintf(f, "P6\n%d %d\n255\n", SCR_W, SCR_H);
    for (int i = 0; i < SCR_SIZE; i++) {
        uint8_t c = backbuf[i];
        unsigned char rgb[3] = { pal_r[c], pal_g[c], pal_b[c] };
        fwrite(rgb, 1, 3, f);
    }
    fclose(f);
    printf("sim: wrote %s\n", path);
}

/* --- scripted input ------------------------------------------------------- */
static void click_dock(int app, int t) {
    if (g_tick == (uint32_t)t) {
        int x, y, w, h;
        ui_dock_geometry(app, &x, &y, &w, &h);
        mouse_inject(x + 8, y + 4, 1);
    }
    if (g_tick == (uint32_t)(t + 1)) mouse_inject(mouse_x(), mouse_y(), 0);
}

static void type_at(int t, const char *s) {
    if (g_tick == (uint32_t)t)
        while (*s) kb_inject_char(*s++);
}

static void scenario(void) {
    if (g_tick == 80)  shot("screenshots/00-boot.ppm");
    if (g_tick == 210) shot("screenshots/01-desktop.ppm");

    click_dock(APP_PULSE, 230);
    if (g_tick == 265) shot("screenshots/02-pulse.ppm");

    click_dock(APP_TERMINAL, 280);
    type_at(292, "help");
    type_at(299, "\n");
    type_at(309, "aura");
    type_at(316, "\n");

    click_dock(APP_LOGS, 340);
    click_dock(APP_ABOUT, 370);

    /* drag the terminal by its title bar */
    if (g_tick == 410) {
        win_t *w = wm_get(APP_TERMINAL);
        mouse_inject(w->x + 50, w->y + 6, 1);
    }
    if (g_tick == 414) mouse_inject(90, 60, 1);
    if (g_tick == 418) mouse_inject(120, 80, 1);
    if (g_tick == 420) mouse_inject(120, 80, 0);

    if (g_tick == 480) shot("screenshots/03-workspace.ppm");
}

/* --- virtual time --------------------------------------------------------- */
void plat_idle(void) {
    scenario();
    timer_on_irq();
    if (g_tick >= SIM_TICKS) {
        printf("sim: scenario complete after %u ticks\n", g_tick);
        exit(0);
    }
}

int main(void) {
    mkdir("screenshots", 0755);
    kernel_main();
    return 0;
}
