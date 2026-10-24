#ifndef AURA_EVENTS_H
#define AURA_EVENTS_H

#define LOG_CAP 18
#define LOG_LEN 46

void log_event(const char *s);
int log_count(void);
const char *log_get(int i);

#endif
