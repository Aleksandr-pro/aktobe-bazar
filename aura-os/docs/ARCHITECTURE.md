# AURA//OS architecture

## Source-level portability model

Every kernel C file compiles in two configurations from the same source:

| Configuration | `HOST_SIM` defined | Toolchain                     | `inb/outb` | Time source        |
|---------------|--------------------|-------------------------------|------------|--------------------|
| bare i686     | no                 | `gcc -m32 -ffreestanding`     | real ports | PIT IRQ0, `hlt`    |
| simulator     | yes                | native host gcc               | shim no-ops| scripted virtual ticks |

`kernel/plat.h` selects between real port I/O inline assembly and the
shims declared in `host/sim_plat.h` and implemented in `host/sim.c`.

## Boot chain

```
BIOS (POST, DL = boot drive)
  │
  ▼ 0x07C00  stage1, 512 bytes, 0xAA55 signature (boot/boot.s .stage1)
  │   int 13h AH=02h: read 16 sectors (LBA 1..16) to 0x7E00, 3 retries
  ▼ 0x07E00  stage2 (.stage2)
  │   1. int 10h AX=0013h        → VGA mode 13h, 320×200×8, fb 0xA0000
  │   2. int 10h AX=1130h BH=03h → BIOS 8×8 font physical pointer
  │      stored as a 4-byte pointer at physical 0x9000 (.fontptr section)
  │   3. int 13h CHS loop        → load 200 sectors (LBA 17..216) to 0x10000
  │   4. A20: BIOS 2401h → keyboard controller → fast gate 0x92
  │   5. LGDT, CR0.PE=1, far jump 0x08:pm_entry (32-bit)
  │   6. segment selectors 0x10, ESP=0x9FC00, jmp 0x10000
  ▼ 0x10000  kernel _start (kernel/isrs.s, section .text.start)
      call kernel_main → hlt loop
```

The GDT holds a null descriptor plus flat ring-0 code (`0xCF9A`) and data
(`0xCF92`) segments covering all 4 GiB with 4 KiB granularity.

## Disk layout (raw, no filesystem)

| LBA            | Contents                          | Size      |
|----------------|-----------------------------------|-----------|
| 0              | stage 1 boot sector               | 512 B     |
| 1 – 16         | stage 2                           | ≤ 8 KiB   |
| 17 – 216       | kernel flat binary                | ≤ 100 KiB |
| rest           | unused (1.44 MiB floppy geometry) |           |

`tools/mkimage.py` validates the signature, capacity limits and places the
blobs; CHS math assumes 18 sectors/track, 2 heads (1.44 MB floppy).

## Physical memory map

| Range               | Usage                                   |
|---------------------|-----------------------------------------|
| `0x00000–0x00500`   | BIOS IVT/BDA (untouched)                |
| `0x07C00–0x07DFF`   | stage 1                                 |
| `0x07E00–0x08FFF`   | stage 2                                 |
| `0x09000–0x09003`   | BIOS font physical pointer              |
| `0x10000–~0x35000`  | kernel text/rodata/data + BSS           |
| `~0x9C000–0x9FC00`  | kernel stack (grows down from 0x9FC00)  |
| `0xA0000–0xAFFFF`   | VGA mode-13h framebuffer (64 KiB)       |

## Interrupts

- IDT of 48 gates installed by `kernel/idt.c`; vectors 0–31 are CPU
  exceptions (uniform stack frames via dummy error codes), 32–47 are IRQs.
- 8259 PIC remapped to vectors `0x20/0x28`; unmasked: IRQ0 timer,
  IRQ1 keyboard, IRQ2 cascade, IRQ12 mouse.
- All ISRs (`kernel/isrs.s`) save GPRs/segments and call `irq_dispatch()`.
- PIT channel 0: `1193182 / 100 ≈ 11932` → 100 Hz tick (10 ms quantum).
- Exceptions print `vec/err/eip` on COM1 and halt — the serial trace is the
  panic screen of this OS.

## Drivers

- **keyboard** (`kb.c`): Set-1 scancode table, Shift state, 64-char ring.
- **mouse** (`mouse.c`): 0xD4 aux-stream enable, 3-byte packet assembly
  with resync, signed deltas clamped to the screen, one-shot click edges.
- **serial** (`serial.c`): COM1 38400 8N1, tiny `kprintf` (`%d %u %x %s
  %c`, zero padding).
- **timer** (`timer.c`): tick counter + per-tick pending flag consumed by
  `plat_idle()` (`hlt` on metal, pumped in the simulator).

## Graphics

- Mode 13h palette programmed through DAC ports `0x3C8/0x3C9`:
  16 identity colors + seven 32-step perceptual ramps (space, cyan,
  magenta, mint, amber, gray, violet).
- `blend_tab[256][256]` precomputes nearest-palette 50% blends, giving
  glassmorphism in one byte lookup per pixel — no per-frame FPU/division.
- All rendering goes to `backbuf[64000]`; one `memcpy` presents the frame,
  eliminating flicker. Primitives: lines (Bresenham), circles/rings/arcs
  via an integer sine LUT (`sin256.h`), rounded rectangles with integer
  square roots, 1×/2× bitmap text.
- Metal uses the BIOS ROM font; the simulator uses the generated
  `host/font8x8.c` (4× supersampled TTF, hand-tuned overrides).

## Window manager

`window.c` keeps four window descriptors with an explicit z-order array.
Per frame: desktop background → top bar → windows back-to-front
(glass body, accent frame for focus, close button, app callback) → dock →
cursor. Mouse clicks hit-test dock, close buttons, title bars (drag) and
window bodies (focus raise).

## Build artifacts and limits

- Kernel binary budget: 100 KiB (200 sectors); current build ≈ 15 KiB.
- Stage 2 budget: 8 KiB; current build ≈ 4.6 KiB.
- No libc: `mem.c` supplies the freestanding string/format routines; the
  build passes `-fno-builtin` so GCC cannot recursively substitute its own
  `memset`/`memcpy` intrinsics.

## CI

`.github/workflows/aura-os.yml` builds both targets on every push, runs the
simulator scenario, and performs a headless QEMU smoke test asserting the
`AURA BOOT SEQUENCE COMPLETE` marker on the serial console.
