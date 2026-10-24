#include "events.h"
#include "../mem.h"

static char events[LOG_CAP][LOG_LEN];
static int count = 0;

void log_event(const char *s) {
    if (count >= LOG_CAP) {
        for (int i = 1; i < LOG_CAP; i++)
            strcpy(events[i - 1], events[i]);
        count = LOG_CAP - 1;
    }
    strncpy(events[count], s, LOG_LEN - 1);
    events[count][LOG_LEN - 1] = 0;
    count++;
}

int log_count(void) { return count; }
const char *log_get(int i) {
    return (i >= 0 && i < count) ? events[i] : "";
}
