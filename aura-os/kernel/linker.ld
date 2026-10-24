/* Kernel: flat 32-bit binary loaded at physical 0x10000 */
OUTPUT_FORMAT("binary")
ENTRY(_start)
SECTIONS
{
    . = 0x10000;
    .text : {
        KEEP(*(.text.start))
        *(.text*)
    }
    .rodata : {
        *(.rodata*)
    }
    .data : {
        *(.data*)
    }
    .bss : {
        *(.bss*)
        *(COMMON)
    }
}
