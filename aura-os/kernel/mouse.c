#include "mouse.h"
#include "plat.h"
#include "util.h"
#include "vga.h"

#define KBD_DATA 0x60
#define KBD_STAT 0x64

static int mx = SCR_W / 2, my = SCR_H / 2;
static int buttons = 0;
static int press_edge = 0;
static uint8_t packet[3];
static int phase = 0;

#ifndef HOST_SIM
static void kbd_wait_in(void) {
    int t = 100000;
    while ((inb(KBD_STAT) & 2) && t--) { }
}
static void kbd_wait_out(void) {
    int t = 100000;
    while (!(inb(KBD_STAT) & 1) && t--) { }
}
static void mouse_cmd(uint8_t c) {
    kbd_wait_in(); outb(KBD_STAT, 0xD4);
    kbd_wait_in(); outb(KBD_DATA, c);
    kbd_wait_out(); (void)inb(KBD_DATA);         /* ACK */
}
#endif

void mouse_init(void) {
#ifdef HOST_SIM
    return;
#else
    kbd_wait_in(); outb(KBD_STAT, 0xA8);         /* enable aux port */
    kbd_wait_in(); outb(KBD_STAT, 0x20);         /* read config */
    kbd_wait_out();
    uint8_t cfg = inb(KBD_DATA);
    cfg |= 0x02;                                 /* IRQ12 enable */
    cfg &= (uint8_t)~0x20;                       /* clear aux clock disable */
    kbd_wait_in(); outb(KBD_STAT, 0x60);
    kbd_wait_in(); outb(KBD_DATA, cfg);
    mouse_cmd(0xF6);                             /* defaults */
    mouse_cmd(0xF4);                             /* enable streaming */
#endif
}

void mouse_on_irq(void) {
    uint8_t b = inb(KBD_DATA);
    if (phase == 0 && !(b & 0x08)) return;       /* resync */
    packet[phase++] = b;
    if (phase < 3) return;
    phase = 0;

    int dx = (int8_t)packet[1];
    int dy = (int8_t)packet[2];
    if (packet[0] & 0xC0) { dx = 0; dy = 0; }    /* discard overflow */
    mx = iclamp(mx + dx, 0, SCR_W - 1);
    my = iclamp(my - dy, 0, SCR_H - 1);

    int now = packet[0] & 0x07;
    if ((now & 1) && !(buttons & 1)) press_edge = 1;
    buttons = now;
}

int mouse_x(void) { return mx; }
int mouse_y(void) { return my; }
int mouse_left(void) { return buttons & 1; }

int mouse_consume_press(void) {
    int e = press_edge;
    press_edge = 0;
    return e;
}

void mouse_inject(int x, int y, int btns) {
    if ((btns & 1) && !(buttons & 1)) press_edge = 1;
    mx = iclamp(x, 0, SCR_W - 1);
    my = iclamp(y, 0, SCR_H - 1);
    buttons = btns;
}
