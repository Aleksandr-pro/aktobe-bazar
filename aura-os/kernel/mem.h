#ifndef AURA_MEM_H
#define AURA_MEM_H

#include "types.h"

void *memset(void *d, int v, size_t n);
void *memcpy(void *d, const void *s, size_t n);
void *memmove(void *d, const void *s, size_t n);

size_t strlen(const char *s);
int strcmp(const char *a, const char *b);
int strncmp(const char *a, const char *b, size_t n);
char *strcpy(char *d, const char *s);
char *strncpy(char *d, const char *s, size_t n);
char *strcat(char *d, const char *s);

void itoa(int v, char *out);
void utoa(uint32_t v, char *out);
void uhex(uint32_t v, char *out);
int str_vfmt(char *out, int cap, const char *fmt, va_list ap);

#endif
