#!/bin/sh
# Boot AURA//OS in QEMU. Extra arguments are forwarded, e.g.:
#   ./scripts/run-qemu.sh -d int        # log interrupts
#   ./scripts/run-qemu.sh -s -S         # freeze and wait for gdb :1234
cd "$(dirname "$0")/.." || exit 1
exec qemu-system-i386 -fda aura.img -serial stdio -m 32 "$@"
