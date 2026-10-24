#ifndef AURA_TIMER_H
#define AURA_TIMER_H

#include "types.h"

extern volatile uint32_t g_tick;        /* 10 ms units since boot */
extern volatile int g_tick_pending;

void timer_init(void);
void timer_on_irq(void);

#endif
