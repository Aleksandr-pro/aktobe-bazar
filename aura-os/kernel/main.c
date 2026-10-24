#include "types.h"
#include "plat.h"
#include "serial.h"
#include "vga.h"
#include "timer.h"
#include "kb.h"
#include "mouse.h"
#include "ui/desktop.h"
#include "ui/window.h"

#ifndef HOST_SIM
void idt_init(void);
void pic_init(void);

void plat_idle(void) {
    while (!g_tick_pending)
        __asm__ volatile("hlt");
    g_tick_pending = 0;
}
#endif

void kernel_main(void) {
    serial_init();
    kprintf("\nAURA//OS serial link up\n");

    vga_init();
    wm_init();

#ifdef HOST_SIM
    timer_init();
    kb_init();
    mouse_init();
#else
    idt_init();
    pic_init();
    timer_init();
    kb_init();
    mouse_init();
    sti();
#endif

    ui_boot();
    ui_desktop_init();
    kprintf("AURA BOOT SEQUENCE COMPLETE\n");

    for (;;) {
        plat_idle();
        ui_frame();
    }
}
