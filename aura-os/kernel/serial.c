#include "serial.h"
#include "plat.h"
#include "mem.h"

#define COM1 0x3F8

#ifndef HOST_SIM
static int tx_ready(void) { return (inb(COM1 + 5) & 0x20) != 0; }
#endif

void serial_init(void) {
#ifdef HOST_SIM
    /* The simulator mirrors log lines to stdout instead. */
#else
    outb(COM1 + 1, 0x00);                /* disable interrupts              */
    outb(COM1 + 3, 0x80);                /* DLAB on                         */
    outb(COM1 + 0, 0x03);                /* divisor 3 (38400 baud)          */
    outb(COM1 + 1, 0x00);
    outb(COM1 + 3, 0x03);                /* 8N1, DLAB off                   */
    outb(COM1 + 2, 0xC7);                /* FIFO, clear, 14-byte threshold  */
    outb(COM1 + 4, 0x0B);                /* IRQs enabled, RTS/DSR set       */
#endif
}

void serial_putc(char c) {
#ifdef HOST_SIM
    sim_putc(c);
#else
    if (c == '\n') {
        while (!tx_ready()) { }
        outb(COM1, '\r');
    }
    while (!tx_ready()) { }
    outb(COM1, (uint8_t)c);
#endif
}

void serial_puts(const char *s) {
    while (*s) serial_putc(*s++);
}

void kprintf(const char *fmt, ...) {
    char buf[160];
    va_list ap;
    va_start(ap, fmt);
    str_vfmt(buf, (int)sizeof(buf), fmt, ap);
    va_end(ap);
    serial_puts(buf);
}
