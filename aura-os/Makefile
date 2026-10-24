# ============================================================================
# AURA//OS build system
#   make            build bootable aura.img
#   make run        boot it in QEMU
#   make debug      QEMU frozen at startup, waiting for gdb on :1234
#   make sim        host simulator (no hardware needed)
#   make shots      render UI screenshots into screenshots/*.png
#   make clean
# ============================================================================

CC      := gcc
AS      := as
LD      := ld
OBJCOPY := objcopy

CFLAGS  := -m32 -ffreestanding -fno-pic -fno-pie -fno-stack-protector \
           -fno-asynchronous-unwind-tables -std=c11 -Os \
           -Wall -Wextra -Wno-unused-parameter -Ikernel
HOST_CC := gcc
HOST_FL := -DHOST_SIM -ffreestanding -fno-builtin -std=c11 -O2 \
           -Wall -Wextra -Wno-unused-parameter -Ikernel -Ihost

KERN_C   := $(wildcard kernel/*.c) $(wildcard kernel/ui/*.c)
KERN_OBJ := $(patsubst %.c,build/%.o,$(KERN_C)) build/kernel/isrs.o
SIM_C    := $(filter-out kernel/idt.c,$(KERN_C)) host/sim.c host/font8x8.c
IMG      := aura.img

.PHONY: all run debug sim shots clean

all: $(IMG)

# --- boot chain --------------------------------------------------------------
build/boot/boot.elf: boot/boot.s boot/boot.ld
	@mkdir -p build/boot
	$(AS) --32 boot/boot.s -o build/boot/boot.o
	$(LD) -m elf_i386 -T boot/boot.ld -o build/boot/boot.elf build/boot/boot.o

build/boot.bin: build/boot/boot.elf
	$(OBJCOPY) -O binary $< $@

# --- kernel ------------------------------------------------------------------
build/%.o: %.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

build/%.o: %.s
	@mkdir -p $(dir $@)
	$(AS) --32 $< -o $@

build/kernel.bin: $(KERN_OBJ) kernel/linker.ld
	$(LD) -m elf_i386 -T kernel/linker.ld --oformat binary -nostdlib \
	      -o $@ $(KERN_OBJ)
	@size=$$(stat -c%s $@); echo "kernel.bin: $$size bytes"

# --- disk image --------------------------------------------------------------
$(IMG): build/boot.bin build/kernel.bin
	python3 tools/mkimage.py build/boot.bin build/kernel.bin $@

# --- QEMU targets ------------------------------------------------------------
run: $(IMG)
	qemu-system-i386 -fda $(IMG) -serial stdio -m 32

debug: $(IMG)
	qemu-system-i386 -fda $(IMG) -serial stdio -m 32 -s -S

# --- host simulator + screenshots -------------------------------------------
sim: build/sim

build/sim: $(SIM_C)
	@mkdir -p build screenshots
	$(HOST_CC) $(HOST_FL) $(SIM_C) -o $@

shots: build/sim
	@mkdir -p screenshots
	./build/sim
	python3 host/shot.py

clean:
	rm -rf build $(IMG) serial.log screenshots
