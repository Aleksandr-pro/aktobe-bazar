/* Linker script for the boot chain: stage 1 at 0x7C00, stage 2 at 0x7E00 */
OUTPUT_FORMAT("elf32-i386")
ENTRY(stage1_start)
SECTIONS
{
    . = 0x7C00;
    .stage1 : {
        *(.stage1)
    }
    . = 0x7E00;
    .stage2 : {
        *(.stage2)
    }
    /* BIOS font pointer shared with the kernel at a fixed physical slot */
    . = 0x9000;
    .fontptr : {
        *(.fontptr)
    }
    /DISCARD/ : {
        *(.note*)
        *(.comment*)
        *(.eh_frame*)
    }
}
