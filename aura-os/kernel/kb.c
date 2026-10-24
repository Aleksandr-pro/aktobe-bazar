#include "kb.h"
#include "plat.h"

#define KB_DATA 0x60
#define RING 64

static char ring[RING];
static volatile int rhead, rtail;

/* Set-1 scancodes, US layout (lowercase / shifted) */
static const char map_lower[59] = {
    0,  27, '1','2','3','4','5','6','7','8','9','0','-','=', '\b',
    '\t','q','w','e','r','t','y','u','i','o','p','[',']','\n',
    0, 'a','s','d','f','g','h','j','k','l',';', '\'', '`',
    0, '\\','z','x','c','v','b','n','m',',','.','/', 0, '*', 0, ' '
};
static const char map_upper[59] = {
    0,  27, '!','@','#','$','%','^','&','*','(',')','_','+', '\b',
    '\t','Q','W','E','R','T','Y','U','I','O','P','{','}','\n',
    0, 'A','S','D','F','G','H','J','K','L',':','"','~',
    0, '|','Z','X','C','V','B','N','M','<','>','?', 0, '*', 0, ' '
};

static int shift = 0;

static void enqueue(char c) {
    int next = (rtail + 1) % RING;
    if (next == rhead) return;           /* drop on overflow */
    ring[rtail] = c;
    rtail = next;
}

void kb_init(void) { rhead = rtail = 0; }

void kb_on_irq(void) {
    uint8_t sc = inb(KB_DATA);
    if (sc == 0x2A || sc == 0x36) { shift = 1; return; }
    if (sc == 0xAA || sc == 0xB6) { shift = 0; return; }
    if (sc & 0x80) return;               /* key release */
    if (sc >= 59) return;
    char c = shift ? map_upper[sc] : map_lower[sc];
    if (c) enqueue(c);
}

int kb_getchar(void) {
    if (rhead == rtail) return -1;
    char c = ring[rhead];
    rhead = (rhead + 1) % RING;
    return (uint8_t)c;
}

int kb_kbhit(void) { return rhead != rtail; }

void kb_inject_char(char c) { enqueue(c); }
