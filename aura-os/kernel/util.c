#include "util.h"
#include "sin256.h"

static uint32_t rng_state = 0xA5A5F00Du;

uint32_t rng_next(void) {
    /* xorshift32 — deterministic, good enough for ambient motion */
    uint32_t x = rng_state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    rng_state = x;
    return x;
}

uint32_t rng_range(uint32_t n) {
    return n ? rng_next() % n : 0;
}

int isin(uint8_t angle) { return SIN256[angle]; }
int icos(uint8_t angle) { return SIN256[(angle + 64) & 0xFF]; }

uint32_t isqrt_u32(uint32_t x) {
    uint32_t r = 0, bit = 1u << 30;
    while (bit > x) bit >>= 2;
    while (bit) {
        if (x >= r + bit) { x -= r + bit; r = (r >> 1) + bit; }
        else r >>= 1;
        bit >>= 2;
    }
    return r;
}

int imax(int a, int b) { return a > b ? a : b; }
int imin(int a, int b) { return a < b ? a : b; }
int iclamp(int v, int lo, int hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}
