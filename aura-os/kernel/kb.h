#ifndef AURA_KB_H
#define AURA_KB_H

#include "types.h"

void kb_init(void);
void kb_on_irq(void);
int  kb_getchar(void);                  /* -1 when empty */
int  kb_kbhit(void);
void kb_inject_char(char c);            /* simulator path */

#endif
