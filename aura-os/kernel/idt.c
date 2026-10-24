#include "idt.h"
#include "plat.h"
#include "serial.h"
#include "timer.h"
#include "kb.h"
#include "mouse.h"

#define PIC_M_CMD 0x20
#define PIC_M_DAT 0x21
#define PIC_S_CMD 0xA0
#define PIC_S_DAT 0xA1

typedef struct {
    uint16_t lo;
    uint16_t sel;
    uint8_t zero;
    uint8_t flags;
    uint16_t hi;
} __attribute__((packed)) idt_gate_t;

typedef struct {
    uint16_t limit;
    uint32_t base;
} __attribute__((packed)) idt_reg_t;

static idt_gate_t idt[48];
extern uint32_t isr_table[48];

static void gate(int n, uint32_t handler) {
    idt[n].lo = (uint16_t)(handler & 0xFFFF);
    idt[n].sel = 0x08;
    idt[n].zero = 0;
    idt[n].flags = 0x8E;                 /* present, ring 0, 32-bit interrupt gate */
    idt[n].hi = (uint16_t)(handler >> 16);
}

void idt_init(void) {
    for (int i = 0; i < 48; i++) gate(i, isr_table[i]);
    idt_reg_t reg = { sizeof(idt) - 1, (uint32_t)idt };
    __asm__ volatile("lidt %0" : : "m"(reg));
}

void pic_init(void) {
    /* ICW1: init + ICW4 */
    outb(PIC_M_CMD, 0x11); io_wait();
    outb(PIC_S_CMD, 0x11); io_wait();
    outb(PIC_M_DAT, 0x20); io_wait();    /* master vectors 0x20..0x27 */
    outb(PIC_S_DAT, 0x28); io_wait();    /* slave  vectors 0x28..0x2F */
    outb(PIC_M_DAT, 0x04); io_wait();    /* slave on master IRQ2 */
    outb(PIC_S_DAT, 0x02); io_wait();
    outb(PIC_M_DAT, 0x01); io_wait();    /* 8086 mode */
    outb(PIC_S_DAT, 0x01); io_wait();
    /* Unmask timer(0), keyboard(1), cascade(2), mouse(12 -> slave bit 4) */
    outb(PIC_M_DAT, 0xF8);
    outb(PIC_S_DAT, 0xEF);
}

static void eoi(uint32_t vec) {
    if (vec >= 40) outb(PIC_S_CMD, 0x20);
    outb(PIC_M_CMD, 0x20);
}

void irq_dispatch(regs_t *r) {
    if (r->vec < 32) {
        kprintf("\n*** FATAL EXCEPTION vec=%u err=%u eip=0x%x ***\n",
                r->vec, r->err, r->eip);
        cli();
        for (;;) __asm__ volatile("hlt");
    }
    switch (r->vec) {
    case 32: timer_on_irq(); break;
    case 33: kb_on_irq(); break;
    case 44: mouse_on_irq(); break;
    default: break;
    }
    if (r->vec >= 32 && r->vec < 48) eoi(r->vec);
}
