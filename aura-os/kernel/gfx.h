#ifndef AURA_GFX_H
#define AURA_GFX_H

#include "types.h"

void gfx_clear(uint8_t c);
void gfx_pset(int x, int y, uint8_t c);
uint8_t gfx_pget(int x, int y);

void gfx_fill_rect(int x, int y, int w, int h, uint8_t c);
void gfx_blend_rect(int x, int y, int w, int h, uint8_t c);
void gfx_rect(int x, int y, int w, int h, uint8_t c);
void gfx_round_rect(int x, int y, int w, int h, int r, uint8_t c);
void gfx_round_blend(int x, int y, int w, int h, int r, uint8_t c);
void gfx_round_outline(int x, int y, int w, int h, int r, uint8_t c);

void gfx_line(int x0, int y0, int x1, int y1, uint8_t c);
void gfx_circle_fill(int cx, int cy, int r, uint8_t c);
void gfx_circle_blend(int cx, int cy, int r, uint8_t c);
void gfx_ring(int cx, int cy, int r, uint8_t c);
void gfx_arc(int cx, int cy, int r, uint8_t a0, uint8_t a1, uint8_t c);

void gfx_char(int x, int y, char ch, uint8_t c, int scale);
void gfx_text(int x, int y, const char *s, uint8_t c);
void gfx_text2(int x, int y, const char *s, uint8_t c);
int  gfx_text_width(const char *s, int scale);
void gfx_text_center(int y, const char *s, uint8_t c, int scale);

#endif
