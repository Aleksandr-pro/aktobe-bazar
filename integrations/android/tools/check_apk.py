#!/usr/bin/env python3
"""Проверка собранного APK без устройства.

Проверяет то, из-за чего APK чаще всего не ставится:
  * zip целостность и наличие обязательных файлов;
  * resources.arsc без сжатия и с выравниванием 4;
  * classes.dex с корректной сигнатурой;
  * наличие наших классов в dex;
  * манифест (через `aapt2 dump badging`, если он есть).

Использование: python3 tools/check_apk.py BazarFX.apk
"""

import struct
import subprocess
import sys
import zipfile
from pathlib import Path

LOCAL_SIG = 0x04034B50


def local_data_offset(apk_path: Path, filename: str):
    """Смещение данных записи по локальному заголовку (zipfile отдаёт extra из
    центрального каталога, а выравнивание считается по локальному)."""
    with zipfile.ZipFile(apk_path) as zf:
        info = zf.getinfo(filename)
    with open(apk_path, "rb") as fh:
        fh.seek(info.header_offset)
        header = fh.read(30)
        if struct.unpack_from("<I", header, 0)[0] != LOCAL_SIG:
            return None
        nlen, elen = struct.unpack_from("<HH", header, 26)
        return info.header_offset + 30 + nlen + elen, info.compress_type

REQUIRED_CLASSES = [
    "Lkz/bazar/fx/MainActivity;",
    "Lkz/bazar/fx/FxService;",
    "Lkz/bazar/fx/FxRenderer;",
    "Lkz/bazar/fx/FxSettings;",
]


def fail(message: str) -> None:
    print(f"FAIL {message}")
    sys.exit(1)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: check_apk.py path/to/app.apk")
    apk = Path(sys.argv[1])
    if not apk.exists():
        fail(f"нет файла {apk}")

    problems = []

    with zipfile.ZipFile(apk) as zf:
        bad = zf.testzip()
        if bad:
            fail(f"повреждённая запись в zip: {bad}")

        names = zf.namelist()
        for required in ("AndroidManifest.xml", "resources.arsc", "classes.dex"):
            if required not in names:
                problems.append(f"нет {required}")

        arsc = zf.getinfo("resources.arsc")
        if arsc.compress_type != zipfile.ZIP_STORED:
            problems.append("resources.arsc сжат (Android 11+ не установит)")
        arsc_info = local_data_offset(apk, "resources.arsc")
        if arsc_info:
            offset, _ = arsc_info
            if offset % 4 != 0:
                problems.append(f"resources.arsc не выровнен: offset={offset} (offset%4={offset % 4})")

        dex = zf.read("classes.dex")
        if dex[:4] != b"dex\n":
            problems.append("classes.dex с битой сигнатурой")
        else:
            version = dex[4:7].decode(errors="replace")
            file_size = struct.unpack_from("<I", dex, 32)[0]
            if file_size != len(dex):
                problems.append(f"classes.dex: размер в заголовке {file_size} != {len(dex)}")
            for cls in REQUIRED_CLASSES:
                if cls.encode() not in dex:
                    problems.append(f"в dex нет класса {cls}")

    # манифест
    aapt2 = Path(__file__).resolve().parent / "sdk" / "aapt2"
    if aapt2.exists():
        out = subprocess.run(
            [str(aapt2), "dump", "badging", str(apk)],
            capture_output=True, text=True,
        )
        if out.returncode != 0:
            problems.append("aapt2 не смог прочитать манифест")
        else:
            text = out.stdout
            for needle in ("package: name='kz.bazar.fx'", "minSdkVersion:'", "launchable-activity: name='kz.bazar.fx.MainActivity'"):
                if needle not in text:
                    problems.append(f"в манифесте нет: {needle}")
            if "FOREGROUND_SERVICE_MEDIA_PROJECTION" not in text:
                problems.append("нет разрешения FOREGROUND_SERVICE_MEDIA_PROJECTION")
            print("\n".join(line for line in text.splitlines() if line.startswith(
                ("package:", "minSdkVersion", "targetSdkVersion", "launchable-activity", "application-label"))))

    if problems:
        print()
        for p in problems:
            print("FAIL", p)
        sys.exit(1)

    size_kb = apk.stat().st_size / 1024
    print(f"\nok   APK корректен: {apk.name} ({size_kb:.0f} КБ)")
    print("ok   resources.arsc не сжат и выровнен")
    print("ok   classes.dex и все классы на месте")


if __name__ == "__main__":
    main()
