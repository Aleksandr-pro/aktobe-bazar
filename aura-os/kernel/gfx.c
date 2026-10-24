#include "gfx.h"
#include "vga.h"
#include "mem.h"
#include "util.h"
#include "sin256.h"

static inline int onscreen(int x, int y) {
    return x >= 0 && y >= 0 && x < SCR_W && y < SCR_H;
}

void gfx_clear(uint8_t c) { memset(backbuf, c, SCR_SIZE); }

void gfx_pset(int x, int y, uint8_t c) {
    if (onscreen(x, y)) backbuf[y * SCR_W + x] = c;
}

uint8_t gfx_pget(int x, int y) {
    if (!onscreen(x, y)) return C_VOID;
    return backbuf[y * SCR_W + x];
}

void gfx_fill_rect(int x, int y, int w, int h, uint8_t c) {
    int x0 = iclamp(x, 0, SCR_W), x1 = iclamp(x + w, 0, SCR_W);
    int y0 = iclamp(y, 0, SCR_H), y1 = iclamp(y + h, 0, SCR_H);
    for (int yy = y0; yy < y1; yy++)
        memset(backbuf + yy * SCR_W + x0, c, (size_t)(x1 - x0));
}

void gfx_blend_rect(int x, int y, int w, int h, uint8_t c) {
    int x0 = iclamp(x, 0, SCR_W), x1 = iclamp(x + w, 0, SCR_W);
    int y0 = iclamp(y, 0, SCR_H), y1 = iclamp(y + h, 0, SCR_H);
    for (int yy = y0; yy < y1; yy++)
        for (int xx = x0; xx < x1; xx++) {
            uint8_t *p = backbuf + yy * SCR_W + xx;
            *p = blend_tab[*p][c];
        }
}

void gfx_rect(int x, int y, int w, int h, uint8_t c) {
    gfx_fill_rect(x, y, w, 1, c);
    gfx_fill_rect(x, y + h - 1, w, 1, c);
    gfx_fill_rect(x, y, 1, h, c);
    gfx_fill_rect(x + w - 1, y, 1, h, c);
}

void gfx_round_rect(int x, int y, int w, int h, int r, uint8_t c) {
    for (int dy = 0; dy < h; dy++) {
        int inset = 0;
        if (dy < r) {
            int dy2 = r - dy - 1;
            inset = r - (int)isqrt_u32((uint32_t)(r * r - dy2 * dy2));
        } else if (dy >= h - r) {
            int dy2 = dy - (h - r);
            inset = r - (int)isqrt_u32((uint32_t)(r * r - dy2 * dy2));
        }
        gfx_fill_rect(x + inset, y + dy, w - 2 * inset, 1, c);
    }
}

void gfx_round_blend(int x, int y, int w, int h, int r, uint8_t c) {
    for (int dy = 0; dy < h; dy++) {
        int inset = 0;
        if (dy < r) {
            int dy2 = r - dy - 1;
            inset = r - (int)isqrt_u32((uint32_t)(r * r - dy2 * dy2));
        } else if (dy >= h - r) {
            int dy2 = dy - (h - r);
            inset = r - (int)isqrt_u32((uint32_t)(r * r - dy2 * dy2));
        }
        gfx_blend_rect(x + inset, y + dy, w - 2 * inset, 1, c);
    }
}

void gfx_round_outline(int x, int y, int w, int h, int r, uint8_t c) {
    gfx_arc(x + r, y + r, r, 128 + 32, 128 + 64, c);       /* top-left     */
    gfx_arc(x + w - r - 1, y + r, r, 128, 128 + 32, c);   /* top-right    */
    gfx_arc(x + r, y + h - r - 1, r, 64, 96, c);           /* bottom-left  */
    gfx_arc(x + w - r - 1, y + h - r - 1, r, 0, 32, c);   /* bottom-right */
    gfx_fill_rect(x + r, y, w - 2 * r, 1, c);
    gfx_fill_rect(x + r, y + h - 1, w - 2 * r, 1, c);
    gfx_fill_rect(x, y + r, 1, h - 2 * r, c);
    gfx_fill_rect(x + w - 1, y + r, 1, h - 2 * r, c);
}

void gfx_line(int x0, int y0, int x1, int y1, uint8_t c) {
    int dx = (x1 > x0 ? x1 - x0 : x0 - x1), sx = x0 < x1 ? 1 : -1;
    int dy = -(y1 > y0 ? y1 - y0 : y0 - y1), sy = y0 < y1 ? 1 : -1;
    int err = dx + dy;
    for (;;) {
        gfx_pset(x0, y0, c);
        if (x0 == x1 && y0 == y1) break;
        int e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

void gfx_circle_fill(int cx, int cy, int r, uint8_t c) {
    for (int dy = -r; dy <= r; dy++) {
        int span = (int)isqrt_u32((uint32_t)(r * r - dy * dy));
        gfx_fill_rect(cx - span, cy + dy, 2 * span + 1, 1, c);
    }
}

void gfx_circle_blend(int cx, int cy, int r, uint8_t c) {
    for (int dy = -r; dy <= r; dy++) {
        int span = (int)isqrt_u32((uint32_t)(r * r - dy * dy));
        gfx_blend_rect(cx - span, cy + dy, 2 * span + 1, 1, c);
    }
}

void gfx_ring(int cx, int cy, int r, uint8_t c) {
    for (uint8_t a = 0; a < 255; a++) {
        int x = cx + (icos(a) * r) / 4096;
        int y = cy + (isin(a) * r) / 4096;
        gfx_pset(x, y, c);
    }
}

void gfx_arc(int cx, int cy, int r, uint8_t a0, uint8_t a1, uint8_t c) {
    for (uint8_t a = a0; a != a1; a++) {
        int x = cx + (icos(a) * r) / 4096;
        int y = cy + (isin(a) * r) / 4096;
        gfx_pset(x, y, c);
    }
}

void gfx_char(int x, int y, char ch, uint8_t c, int scale) {
    const uint8_t *g = font_glyph((uint8_t)ch);
    for (int row = 0; row < 8; row++) {
        uint8_t bits = g[row];
        for (int col = 0; col < 8; col++) {
            if (!(bits & (0x80 >> col))) continue;
            if (scale == 1) gfx_pset(x + col, y + row, c);
            else gfx_fill_rect(x + col * scale, y + row * scale, scale, scale, c);
        }
    }
}

void gfx_text(int x, int y, const char *s, uint8_t c) {
    while (*s) { gfx_char(x, y, *s++, c, 1); x += 8; }
}

void gfx_text2(int x, int y, const char *s, uint8_t c) {
    while (*s) { gfx_char(x, y, *s++, c, 2); x += 16; }
}

int gfx_text_width(const char *s, int scale) {
    return (int)strlen(s) * 8 * scale;
}

void gfx_text_center(int y, const char *s, uint8_t c, int scale) {
    int w = gfx_text_width(s, scale);
    int x = (SCR_W - w) / 2;
    if (scale == 2) gfx_text2(x, y, s, c);
    else gfx_text(x, y, s, c);
}
