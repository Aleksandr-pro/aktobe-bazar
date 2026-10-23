#!/usr/bin/env python3
"""Выравнивание APK без zipalign (аналог `zipalign -p 4`).

Android 11+ требует, чтобы `resources.arsc` и `.so` лежали в APK без сжатия
и с выравниванием 4/4096 байт. zipalign — утилита из Android SDK, поэтому
здесь маленькая замена на Python: перепаковывает zip, добавляя padding в
extra-поле локальных заголовков.

Использование: align_apk.py in.apk out.apk
"""

import struct
import sys
import zipfile
import zlib

STORED = 0
DEFLATED = 8
LOCAL_SIG = 0x04034B50
CENTRAL_SIG = 0x02014B50
EOCD_SIG = 0x06054B50


def alignment_for(name: str) -> int:
    if name.endswith(".so"):
        return 4096
    return 4


def should_store(name: str) -> bool:
    return name == "resources.arsc" or name.endswith(".so") or name == "classes.dex"


def read_entries(path: str):
    with zipfile.ZipFile(path) as zf:
        entries = []
        for info in zf.infolist():
            data = zf.read(info.filename)
            entries.append((info.filename, data, info.date_time))
        return entries


def build(entries, out_path: str):
    offset = 0
    central = []
    out = open(out_path, "wb")
    try:
        for name, data, date_time in entries:
            name_bytes = name.encode("utf-8")
            store = should_store(name)
            if store:
                method = STORED
                payload = data
                crc = zlib.crc32(data) & 0xFFFFFFFF
                comp_size = len(data)
                raw_size = len(data)
            else:
                method = DEFLATED
                comp = zlib.compressobj(9, zlib.DEFLATED, -15)
                payload = comp.compress(data) + comp.flush()
                crc = zlib.crc32(data) & 0xFFFFFFFF
                comp_size = len(payload)
                raw_size = len(data)

            align = alignment_for(name) if store else 1

            # Подбираем длину extra-поля так, чтобы данные легли по выравниванию
            extra = b""
            header_size = 30 + len(name_bytes)
            data_offset = offset + header_size + len(extra)
            pad = (align - (data_offset % align)) % align
            if pad:
                extra = b"\x00" * pad

            # локальный заголовок
            local = struct.pack(
                "<IHHHHHIIIHH",
                LOCAL_SIG,
                20,           # version needed
                0,            # flags
                method,
                0,            # mod time
                0,            # mod date
                crc,
                comp_size,
                raw_size,
                len(name_bytes),
                len(extra),
            )
            out.write(local)
            out.write(name_bytes)
            out.write(extra)
            out.write(payload)

            central.append(
                (
                    name_bytes,
                    method,
                    crc,
                    comp_size,
                    raw_size,
                    offset,
                    date_time,
                    extra,
                )
            )
            offset += len(local) + len(name_bytes) + len(extra) + len(payload)

        central_start = offset
        for name_bytes, method, crc, comp_size, raw_size, local_offset, date_time, extra in central:
            dos_time = (date_time[3] << 11) | (date_time[4] << 5) | (date_time[5] // 2)
            dos_date = ((date_time[0] - 1980) << 9) | (date_time[1] << 5) | date_time[2]
            header = struct.pack(
                "<IHHHHHHIIIHHHHHII",
                CENTRAL_SIG,
                20,
                20,
                0,
                method,
                dos_time,
                dos_date,
                crc,
                comp_size,
                raw_size,
                len(name_bytes),
                len(extra),  # extra len
                0,      # comment len
                0,      # disk number
                0,      # internal attrs
                0,      # external attrs
                local_offset,
            )
            out.write(header)
            out.write(name_bytes)
            out.write(extra)
            offset += len(header) + len(name_bytes) + len(extra)

        central_size = offset - central_start
        eocd = struct.pack(
            "<IHHHHIIH",
            EOCD_SIG,
            0,
            0,
            len(central),
            len(central),
            central_size,
            central_start,
            0,
        )
        out.write(eocd)
    finally:
        out.close()


def main():
    if len(sys.argv) != 3:
        print("usage: align_apk.py in.apk out.apk")
        return 1
    entries = read_entries(sys.argv[1])
    build(entries, sys.argv[2])

    with zipfile.ZipFile(sys.argv[2]) as zf:
        bad = zf.testzip()
        if bad is not None:
            print("corrupt entry:", bad)
            return 1
        for info in zf.infolist():
            if info.filename == "resources.arsc":
                offset = info.header_offset + 30 + len(info.filename) + len(info.extra)
                print(f"resources.arsc: stored={info.compress_type == 0} offset%4={offset % 4}")
    print("ok:", sys.argv[2])
    return 0


if __name__ == "__main__":
    sys.exit(main())
