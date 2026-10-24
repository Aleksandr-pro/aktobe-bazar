#include "mem.h"

void *memset(void *d, int v, size_t n) {
    uint8_t *p = d;
    while (n--) *p++ = (uint8_t)v;
    return d;
}

void *memcpy(void *d, const void *s, size_t n) {
    uint8_t *p = d;
    const uint8_t *q = s;
    while (n--) *p++ = *q++;
    return d;
}

void *memmove(void *d, const void *s, size_t n) {
    uint8_t *p = d;
    const uint8_t *q = s;
    if (p == q || n == 0) return d;
    if (p < q) {
        while (n--) *p++ = *q++;
    } else {
        p += n; q += n;
        while (n--) *--p = *--q;
    }
    return d;
}

size_t strlen(const char *s) {
    size_t n = 0;
    while (s[n]) n++;
    return n;
}

int strcmp(const char *a, const char *b) {
    while (*a && *a == *b) { a++; b++; }
    return (uint8_t)*a - (uint8_t)*b;
}

int strncmp(const char *a, const char *b, size_t n) {
    while (n && *a && *a == *b) { a++; b++; n--; }
    return n ? (uint8_t)*a - (uint8_t)*b : 0;
}

char *strcpy(char *d, const char *s) {
    char *r = d;
    while ((*d++ = *s++)) { }
    return r;
}

char *strncpy(char *d, const char *s, size_t n) {
    char *r = d;
    while (n && *s) { *d++ = *s++; n--; }
    while (n--) *d++ = 0;
    return r;
}

char *strcat(char *d, const char *s) {
    char *r = d;
    while (*d) d++;
    while ((*d++ = *s++)) { }
    return r;
}

void utoa(uint32_t v, char *out) {
    char tmp[12];
    int i = 0;
    if (v == 0) tmp[i++] = '0';
    while (v) { tmp[i++] = (char)('0' + v % 10); v /= 10; }
    int j = 0;
    while (i) out[j++] = tmp[--i];
    out[j] = 0;
}

void itoa(int v, char *out) {
    if (v < 0) { *out++ = '-'; v = -v; }
    utoa((uint32_t)v, out);
}

void uhex(uint32_t v, char *out) {
    static const char hx[] = "0123456789ABCDEF";
    int started = 0, i;
    for (i = 28; i >= 0; i -= 4) {
        char c = hx[(v >> i) & 0xF];
        if (c != '0' || i == 0) started = 1;
        if (started) *out++ = c;
    }
    *out = 0;
}

/* Tiny printf: %s %c %d %u %x, optional zero padding (e.g. %02d), %% */
int str_vfmt(char *out, int cap, const char *fmt, va_list ap) {
    int n = 0;
    #define EMIT(c) do { if (n < cap - 1) out[n] = (c); n++; } while (0)

    while (*fmt) {
        if (*fmt != '%') { EMIT(*fmt++); continue; }
        fmt++;
        int zpad = 0, width = 0;
        if (*fmt == '0') { zpad = 1; fmt++; }
        while (*fmt >= '0' && *fmt <= '9') { width = width * 10 + (*fmt++ - '0'); }
        char num[12];
        const char *s;
        switch (*fmt) {
        case 's':
            s = va_arg(ap, const char *);
            if (!s) s = "(null)";
            while (*s) EMIT(*s++);
            break;
        case 'c':
            EMIT((char)va_arg(ap, int));
            break;
        case 'd': itoa(va_arg(ap, int), num); s = num; goto emit_num;
        case 'u': utoa(va_arg(ap, uint32_t), num); s = num; goto emit_num;
        case 'x': uhex(va_arg(ap, uint32_t), num); s = num; goto emit_num;
        emit_num: {
                int len = (int)strlen(s);
                while (len < width) { EMIT(zpad ? '0' : ' '); len++; }
                while (*s) EMIT(*s++);
            }
            break;
        case '%': EMIT('%'); break;
        case 0: goto done;
        default: EMIT('?'); EMIT(*fmt); break;
        }
        fmt++;
    }
done:
    if (cap > 0) out[n < cap ? n : cap - 1] = 0;
    #undef EMIT
    return n;
}
