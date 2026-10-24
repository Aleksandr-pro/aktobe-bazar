#ifndef AURA_IDT_H
#define AURA_IDT_H

#include "types.h"

typedef struct {
    uint32_t gs, fs, es, ds;
    uint32_t edi, esi, ebp, esp0, ebx, edx, ecx, eax;
    uint32_t vec, err;
    uint32_t eip, cs, eflags;
} regs_t;

void idt_init(void);
void pic_init(void);
void irq_dispatch(regs_t *r);

#endif
