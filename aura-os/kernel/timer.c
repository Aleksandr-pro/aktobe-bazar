#include "timer.h"
#include "plat.h"

#define PIT_CH0 0x40
#define PIT_CMD 0x43
#define PIT_FREQ 1193182u
#define HZ 100u

volatile uint32_t g_tick = 0;
volatile int g_tick_pending = 0;

void timer_init(void) {
#ifdef HOST_SIM
    /* Virtual time is pumped by the simulator. */
#else
    uint32_t div = PIT_FREQ / HZ;
    outb(PIT_CMD, 0x36);                 /* channel 0, lobyte/hibyte, mode 3 */
    outb(PIT_CH0, (uint8_t)(div & 0xFF));
    outb(PIT_CH0, (uint8_t)((div >> 8) & 0xFF));
#endif
}

void timer_on_irq(void) {
    g_tick++;
    g_tick_pending = 1;
}
