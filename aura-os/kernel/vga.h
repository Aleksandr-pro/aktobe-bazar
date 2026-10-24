#ifndef AURA_VGA_H
#define AURA_VGA_H

#include "types.h"

#define SCR_W 320
#define SCR_H 200
#define SCR_SIZE (SCR_W * SCR_H)

/* Fixed UI identity colors (indices 0..15) */
enum {
    C_VOID = 0, C_PANEL = 1, C_PANEL2 = 2, C_BORDER = 3,
    C_DIM = 4, C_MID = 5, C_TEXT = 6, C_WHITE = 7,
    C_CYAN = 8, C_VIOLET = 9, C_MAG = 10, C_MINT = 11,
    C_AMBER = 12, C_RED = 13, C_CYAN2 = 14, C_DEEP = 15
};

/* 32-step perceptual ramps */
#define R_SPACE 16
#define R_CYAN  48
#define R_MAG   80
#define R_MINT  128
#define R_AMBER 160
#define R_GRAY  192
#define R_VIOLET 224
#define RAMP_N  32
#define RAMP(base, t) ((uint8_t)((base) + ((t) * (RAMP_N - 1)) / 255))

extern uint8_t *vga_front;
extern uint8_t backbuf[SCR_SIZE];
extern uint8_t pal_r[256], pal_g[256], pal_b[256];
extern uint8_t blend_tab[256][256];

void vga_init(void);
void vga_present(void);
uint8_t color_nearest(uint8_t r, uint8_t g, uint8_t b);
const uint8_t *font_glyph(uint8_t ch);

#endif
