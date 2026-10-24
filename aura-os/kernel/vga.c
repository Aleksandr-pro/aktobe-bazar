#include "vga.h"
#include "plat.h"
#include "mem.h"

uint8_t *vga_front = (uint8_t *)0xA0000;
uint8_t backbuf[SCR_SIZE];
uint8_t pal_r[256], pal_g[256], pal_b[256];
uint8_t blend_tab[256][256];

static const uint8_t base_r[16] = {  4, 11, 20, 30, 59,143,232,255,  0,124,255, 57,255,255, 43, 10};
static const uint8_t base_g[16] = {  5, 16, 27, 42, 74,163,240,255,229, 77, 61,255,179, 92,217, 15};
static const uint8_t base_b[16] = { 14, 32, 51, 77,122,214,255,255,255,255,165,176, 71,122,255, 34};

static void dac_set(uint8_t idx, uint8_t r, uint8_t g, uint8_t b) {
    pal_r[idx] = r; pal_g[idx] = g; pal_b[idx] = b;
#ifndef HOST_SIM
    outb(0x3C8, idx);
    outb(0x3C9, (uint8_t)(r >> 2));
    outb(0x3C9, (uint8_t)(g >> 2));
    outb(0x3C9, (uint8_t)(b >> 2));
#endif
}

static void ramp(uint8_t start, uint8_t r0, uint8_t g0, uint8_t b0,
                 uint8_t r1, uint8_t g1, uint8_t b1) {
    for (int i = 0; i < RAMP_N; i++) {
        int t = i * 255 / (RAMP_N - 1);
        dac_set((uint8_t)(start + i),
                (uint8_t)(r0 + (r1 - r0) * t / 255),
                (uint8_t)(g0 + (g1 - g0) * t / 255),
                (uint8_t)(b0 + (b1 - b0) * t / 255));
    }
}

uint8_t color_nearest(uint8_t r, uint8_t g, uint8_t b) {
    uint32_t best = 0xFFFFFFFFu;
    uint8_t idx = 0;
    for (int i = 0; i < 256; i++) {
        int dr = (int)r - pal_r[i];
        int dg = (int)g - pal_g[i];
        int db = (int)b - pal_b[i];
        uint32_t d = (uint32_t)(dr * dr + dg * dg + db * db);
        if (d < best) { best = d; idx = (uint8_t)i; }
    }
    return idx;
}

void vga_init(void) {
    for (int i = 0; i < 16; i++)
        dac_set((uint8_t)i, base_r[i], base_g[i], base_b[i]);

    ramp(R_SPACE,   5,  6, 17,  48, 20,  92);
    ramp(R_CYAN,    6, 26, 44,   0,229, 255);
    ramp(R_MAG,    40, 10, 46, 255, 61, 165);
    ramp(R_MINT,    8, 38, 30,  57,255, 176);
    ramp(R_AMBER,  44, 26,  8, 255,179,  71);
    ramp(R_GRAY,   22, 26, 40, 190,204, 235);
    ramp(R_VIOLET, 24, 12, 56, 124, 77, 255);

    /* Precompute alpha-style blending for glass panels */
    for (int a = 0; a < 256; a++)
        for (int b = 0; b < 256; b++) {
            uint8_t r = (uint8_t)(((uint16_t)pal_r[a] + pal_r[b]) / 2);
            uint8_t g = (uint8_t)(((uint16_t)pal_g[a] + pal_g[b]) / 2);
            uint8_t bl = (uint8_t)(((uint16_t)pal_b[a] + pal_b[b]) / 2);
            blend_tab[a][b] = color_nearest(r, g, bl);
        }

    memset(backbuf, C_VOID, SCR_SIZE);
#ifdef HOST_SIM
    sim_vga_init();
#else
    vga_front = (uint8_t *)0xA0000;
#endif
}

void vga_present(void) {
#ifdef HOST_SIM
    sim_vga_present();
#else
    memcpy(vga_front, backbuf, SCR_SIZE);
#endif
}

const uint8_t *font_glyph(uint8_t ch) {
#ifdef HOST_SIM
    return sim_font_glyph(ch);
#else
    static const uint8_t *font = (const uint8_t *)0;
    if (!font) font = *(const uint8_t *const *)0x9000;
    return font + ch * 8u;
#endif
}
