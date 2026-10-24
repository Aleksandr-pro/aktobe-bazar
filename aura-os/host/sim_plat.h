#ifndef AURA_SIM_PLAT_H
#define AURA_SIM_PLAT_H

#include <stdint.h>
#include <stddef.h>

/* Virtual hardware shims used by kernel code under HOST_SIM */
uint8_t inb(uint16_t port);
void outb(uint16_t port, uint8_t v);
void io_wait(void);
void cli(void);
void sti(void);

void plat_idle(void);

/* sim -> kernel adapters */
void sim_putc(char c);
void sim_vga_init(void);
void sim_vga_present(void);
const uint8_t *sim_font_glyph(uint8_t ch);

#endif
