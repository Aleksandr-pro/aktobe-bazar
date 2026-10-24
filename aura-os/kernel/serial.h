#ifndef AURA_SERIAL_H
#define AURA_SERIAL_H

#include "types.h"

void serial_init(void);
void serial_putc(char c);
void serial_puts(const char *s);
void kprintf(const char *fmt, ...);

#endif
