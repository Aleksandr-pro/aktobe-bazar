#ifndef AURA_UTIL_H
#define AURA_UTIL_H

#include "types.h"

uint32_t rng_next(void);
uint32_t rng_range(uint32_t n);

int isin(uint8_t angle);               /* sin(angle*2pi/256) * 4096 */
int icos(uint8_t angle);
uint32_t isqrt_u32(uint32_t x);
int imax(int a, int b);
int imin(int a, int b);
int iclamp(int v, int lo, int hi);

#endif
