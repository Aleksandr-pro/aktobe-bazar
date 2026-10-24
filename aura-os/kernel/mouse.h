#ifndef AURA_MOUSE_H
#define AURA_MOUSE_H

#include "types.h"

void mouse_init(void);
void mouse_on_irq(void);

int mouse_x(void);
int mouse_y(void);
int mouse_left(void);
int mouse_consume_press(void);           /* one-shot edge for left click */
void mouse_inject(int x, int y, int buttons);  /* simulator path */

#endif
