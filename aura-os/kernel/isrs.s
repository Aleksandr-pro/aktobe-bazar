# ============================================================================
# AURA//OS — protected-mode entry point and interrupt service routines
# GNU as, AT&T syntax, 32-bit.
# ============================================================================

.code32
.section .text.start, "ax"

.globl _start
_start:
    call    kernel_main
1:
    hlt
    jmp     1b

.code32
.section .text

# --- ISR stubs: CPU exceptions 0..31 push a dummy error code where the CPU
#     does not supply one, so every frame has an identical layout. -----------
.macro ISR_NOERR n
.globl isr\n
isr\n:
    cli
    pushl   $0
    pushl   $\n
    jmp     isr_common
.endm

.macro ISR_ERR n
.globl isr\n
isr\n:
    cli
    pushl   $\n
    jmp     isr_common
.endm

    ISR_NOERR 0
    ISR_NOERR 1
    ISR_NOERR 2
    ISR_NOERR 3
    ISR_NOERR 4
    ISR_NOERR 5
    ISR_NOERR 6
    ISR_NOERR 7
    ISR_ERR   8
    ISR_NOERR 9
    ISR_ERR   10
    ISR_ERR   11
    ISR_ERR   12
    ISR_ERR   13
    ISR_ERR   14
    ISR_NOERR 15
    ISR_NOERR 16
    ISR_ERR   17
    ISR_NOERR 18
    ISR_NOERR 19
    ISR_NOERR 20
    ISR_ERR   21
    ISR_NOERR 22
    ISR_NOERR 23
    ISR_NOERR 24
    ISR_NOERR 25
    ISR_NOERR 26
    ISR_NOERR 27
    ISR_NOERR 28
    ISR_NOERR 29
    ISR_ERR   30
    ISR_NOERR 31
    ISR_NOERR 32
    ISR_NOERR 33
    ISR_NOERR 34
    ISR_NOERR 35
    ISR_NOERR 36
    ISR_NOERR 37
    ISR_NOERR 38
    ISR_NOERR 39
    ISR_NOERR 40
    ISR_NOERR 41
    ISR_NOERR 42
    ISR_NOERR 43
    ISR_NOERR 44
    ISR_NOERR 45
    ISR_NOERR 46
    ISR_NOERR 47

# --- common stub: build a register frame, dispatch into C -------------------
isr_common:
    pushal
    pushl   %ds
    pushl   %es
    pushl   %fs
    pushl   %gs

    movw    $0x10, %ax
    movw    %ax, %ds
    movw    %ax, %es
    movw    %ax, %fs
    movw    %ax, %gs

    pushl   %esp
    call    irq_dispatch
    addl    $4, %esp

    popl    %gs
    popl    %fs
    popl    %es
    popl    %ds
    popal
    addl    $8, %esp                # pop vector + error code
    iret

# --- table of stub addresses consumed by idt_init() in C --------------------
.section .rodata
.globl isr_table
isr_table:
    .long isr0,  isr1,  isr2,  isr3,  isr4,  isr5,  isr6,  isr7
    .long isr8,  isr9,  isr10, isr11, isr12, isr13, isr14, isr15
    .long isr16, isr17, isr18, isr19, isr20, isr21, isr22, isr23
    .long isr24, isr25, isr26, isr27, isr28, isr29, isr30, isr31
    .long isr32, isr33, isr34, isr35, isr36, isr37, isr38, isr39
    .long isr40, isr41, isr42, isr43, isr44, isr45, isr46, isr47
