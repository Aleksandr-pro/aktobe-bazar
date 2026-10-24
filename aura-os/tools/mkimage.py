#!/usr/bin/env python3
"""Build a bootable 1.44 MiB floppy image for AURA//OS.

Layout (raw sectors, no filesystem — the boot chain loads by LBA):
    sector 0        stage 1 boot sector (512 B, 0xAA55 signature)
    sectors 1..16   stage 2 (8 KiB max)
    sector 17..216  kernel flat binary (100 KiB max)
"""
import sys
import os

FLOPPY_SIZE = 1474560
STAGE2_SECTORS = 16
KERNEL_LBA = 1 + STAGE2_SECTORS          # 17
KERNEL_SECTORS = 200
SECTOR = 512

STAGE2_MAX = STAGE2_SECTORS * SECTOR
KERNEL_MAX = KERNEL_SECTORS * SECTOR


def main(boot_bin: str, kernel_bin: str, out_img: str) -> None:
    with open(boot_bin, "rb") as f:
        boot = f.read()
    with open(kernel_bin, "rb") as f:
        kernel = f.read()

    if len(boot) < SECTOR:
        sys.exit("mkimage: boot.bin shorter than 512 bytes")
    stage1 = boot[:SECTOR]
    if stage1[510:512] != b"\x55\xaa":
        sys.exit("mkimage: missing 0xAA55 signature in stage 1")

    stage2 = boot[SECTOR:]
    if len(stage2) > STAGE2_MAX:
        sys.exit(f"mkimage: stage 2 too large ({len(stage2)} > {STAGE2_MAX})")
    if len(kernel) > KERNEL_MAX:
        sys.exit(f"mkimage: kernel too large ({len(kernel)} > {KERNEL_MAX})")

    img = bytearray(FLOPPY_SIZE)
    img[0:SECTOR] = stage1
    off = SECTOR
    img[off:off + len(stage2)] = stage2
    off = KERNEL_LBA * SECTOR
    img[off:off + len(kernel)] = kernel

    with open(out_img, "wb") as f:
        f.write(bytes(img))

    print(f"mkimage: {out_img}  "
          f"(stage2 {len(stage2)}/{STAGE2_MAX} B, "
          f"kernel {len(kernel)}/{KERNEL_MAX} B)")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(f"usage: {os.path.basename(sys.argv[0])} boot.bin kernel.bin out.img")
    main(*sys.argv[1:])
