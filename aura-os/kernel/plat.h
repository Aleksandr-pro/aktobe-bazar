#ifndef AURA_PLAT_H
#define AURA_PLAT_H

#include "types.h"

/*
 * Two build targets share every line of kernel C:
 *   - bare i686  : real ports, HLT, interrupt-driven event loop
 *   - HOST_SIM   : user-space simulator with injected ports/events
 */
#ifdef HOST_SIM
#include "sim_plat.h"
#else

static inline uint8_t inb(uint16_t port) {
    uint8_t v;
    __asm__ volatile("inb %1, %0" : "=a"(v) : "Nd"(port));
    return v;
}

static inline void outb(uint16_t port, uint8_t v) {
    __asm__ volatile("outb %0, %1" : : "a"(v), "Nd"(port));
}

static inline void io_wait(void) { outb(0x80, 0); }
static inline void cli(void) { __asm__ volatile("cli"); }
static inline void sti(void) { __asm__ volatile("sti"); }

/* Defined in main.c: block until the next PIT tick. */
void plat_idle(void);

#endif /* HOST_SIM */
#endif
