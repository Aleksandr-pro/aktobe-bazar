# ============================================================================
# AURA//OS — boot chain, stage 1 (512-byte MBR/floppy boot sector) + stage 2
# Pure GNU as (AT&T syntax). No external bootloader: no GRUB, no NASM.
#
# Stage 1: load stage 2 from raw sectors, jump to 0x7E00.
# Stage 2: VGA mode 13h, grab BIOS 8x8 font, load kernel at 0x10000,
#          enable A20, install GDT, enter 32-bit protected mode, jump kernel.
# ============================================================================

# ----------------------------------------------------------------------------
# Stage 1 : lives at physical 0x7C00, must be exactly 512 bytes, ends 0xAA55
# ----------------------------------------------------------------------------
.code16
.section .stage1,"ax"
.globl stage1_start
stage1_start:
    cli
    xorw    %ax, %ax
    movw    %ax, %ds
    movw    %ax, %es
    movw    %ax, %ss
    movw    $0x7C00, %sp
    movb    %dl, boot_drive            # BIOS hands us the boot drive in DL
    sti

    movw    $3, %cx                    # retry counter
1:
    pushw   %cx
    movw    $0x0210, %ax               # ah=02h read sectors, al=16 sectors
    movw    $0x0002, %cx               # ch=0 cylinder, cl=2 sector
    movb    $0, %dh                    # head 0
    movb    boot_drive, %dl
    xorw    %bx, %bx
    movw    %bx, %es
    movw    $0x7E00, %bx               # ES:BX = 0000:7E00
    int     $0x13
    jnc     2f
    xorb    %ah, %ah                   # disk reset on failure
    movb    boot_drive, %dl
    int     $0x13
    popw    %cx
    loop    1b
    jmp     .                          # dead: unreadable medium
2:
    popw    %cx
    ljmp    $0, $0x7E00

.org stage1_start + 510
    .word   0xAA55

# ----------------------------------------------------------------------------
# Stage 2 : physical 0x7E00, real mode -> protected mode
# ----------------------------------------------------------------------------
.code16
.section .stage2,"ax"
.globl stage2_start
stage2_start:
    cli
    xorw    %ax, %ax
    movw    %ax, %ds
    movw    %ax, %es
    movw    %ax, %ss
    movw    $0x7C00, %sp
    sti

    # --- VGA mode 13h: 320x200, 256 colors, framebuffer at phys 0xA0000 ----
    movw    $0x0013, %ax
    int     $0x10

    # --- BIOS 8x8 font pointer (int 10h, AX=1130h, BH=3) -> ES:BP ----------
    movw    $0x1130, %ax
    movb    $0x03, %bh
    int     $0x10
    movw    %es, %ax
    movw    $16, %cx
    mulw    %cx                        # DX:AX = ES*16
    addw    %bp, %ax
    adcw    $0, %dx
    movw    %ax, font_addr
    movw    %dx, font_addr+2           # physical font address for the kernel

    # --- load the kernel: LBA 17, 200 sectors (100 KiB) -> phys 0x10000 ----
    movw    $17, lba
    movw    $0x1000, dst_seg           # paragraph address of 0x10000
    movw    $200, remaining
.read_loop:
    # LBA -> CHS for a 1.44 MiB floppy (18 spt, 2 heads)
    movw    lba, %ax
    xorw    %dx, %dx
    movw    $36, %cx
    divw    %cx                        # AX = cylinder, DX = LBA % 36
    movb    %al, %ch
    movw    %dx, %ax
    xorw    %dx, %dx
    movw    $18, %cx
    divw    %cx                        # AX = head, DX = sector - 1
    movb    %al, %dh
    movb    %dl, %cl
    incb    %cl
    movb    boot_drive, %dl

    movb    $3, retry
3:
    movw    dst_seg, %es
    xorw    %bx, %bx
    movw    $0x0201, %ax               # read one sector
    int     $0x13
    jnc     4f
    decb    retry
    js      .
    xorb    %ah, %ah
    int     $0x13                      # reset, retry
    jmp     3b
4:
    incw    lba
    addw    $0x20, dst_seg             # 512 bytes = 0x20 paragraphs
    decw    remaining
    jnz     .read_loop

    # --- enable A20: try BIOS, keyboard controller, then fast gate ---------
    movw    $0x2401, %ax
    int     $0x15
    jc      .Lkbd_a20
    jmp     .La20_done
.Lkbd_a20:
    call    a20_kbd
.La20_done:
    inb     $0x92, %al
    orb     $2, %al
    andb    $0xFE, %al                 # never touch the fast-reset bit
    outb    %al, $0x92

    # --- GDT + protected mode ----------------------------------------------
    cli
    lgdt    gdt_desc
    movl    %cr0, %eax
    orb     $1, %al
    movl    %eax, %cr0
    ljmp    $0x08, $pm_entry

.code32
pm_entry:
    movw    $0x10, %ax
    movw    %ax, %ds
    movw    %ax, %es
    movw    %ax, %fs
    movw    %ax, %gs
    movw    %ax, %ss
    movl    $0x9FC00, %esp             # stack just under 640 KiB
    movl    $0x10000, %eax
    jmp     *%eax                      # -> kernel _start

# --- helpers / data ---------------------------------------------------------
.code16
a20_kbd:
    call    kbd_wait_in
    movb    $0xAD, %al
    outb    %al, $0x64                 # disable keyboard
    call    kbd_wait_in
    movb    $0xD0, %al
    outb    %al, $0x64                 # read output port
    call    kbd_wait_out
    inb     $0x60, %al
    pushl   %eax
    call    kbd_wait_in
    movb    $0xD1, %al
    outb    %al, $0x64                 # write output port
    call    kbd_wait_in
    popl    %eax
    orb     $2, %al                    # A20 enable bit
    outb    %al, $0x60
    call    kbd_wait_in
    movb    $0xAE, %al
    outb    %al, $0x64                 # enable keyboard
    call    kbd_wait_in
    ret

kbd_wait_in:
    inb     $0x64, %al
    testb   $2, %al
    jnz     kbd_wait_in
    ret

kbd_wait_out:
    inb     $0x64, %al
    testb   $1, %al
    jz      kbd_wait_out
    ret

.align 8
gdt_base:
    .long   0, 0                       # null
    .long   0x0000FFFF, 0x00CF9A00     # ring-0 code, 4 KiB granularity, 4 GiB
    .long   0x0000FFFF, 0x00CF9200     # ring-0 data
gdt_desc:
    .word   gdt_desc - gdt_base - 1
    .long   gdt_base

boot_drive:
    .byte   0
retry:
    .byte   0
lba:
    .word   0
dst_seg:
    .word   0
remaining:
    .word   0

/* Fixed physical 0x9000 — kernel reads the font pointer here */
.section .fontptr,"aw"
.globl  font_addr
font_addr:
    .long   0
