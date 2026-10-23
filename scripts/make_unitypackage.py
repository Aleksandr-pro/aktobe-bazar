"""
Сборка .unitypackage из папки пакета.

.unitypackage — это gzip'нутый tar, внутри по папке на каждый ассет:
    <guid>/pathname   — путь внутри проекта (Assets/...)
    <guid>/asset      — содержимое файла
    <guid>/asset.meta — .meta с тем же guid

GUID детерминированные (md5 от пути), поэтому пересборка даёт тот же пакет
и Unity не считает ассеты новыми.

Запуск: python3 scripts/make_unitypackage.py
Выход: integrations/unity/BazarFX-Neural.unitypackage (+ копия в public/)
"""

import gzip
import hashlib
import io
import os
import tarfile
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "integrations", "unity", "package")
# Артефакт кладём рядом с исходниками (как APK — в integrations/android/),
# а копию — в public/, чтобы он был доступен и со страницы сайта.
OUT = os.path.join(ROOT, "integrations", "unity", "BazarFX-Neural.unitypackage")
PUBLIC_COPY = os.path.join(ROOT, "public", "BazarFX-Neural.unitypackage")

ASSET_PREFIX = "Assets/BazarFX"

META_TEMPLATE = """fileFormatVersion: 2
guid: {guid}
{body}"""

SCRIPTS = (".cs",)
SHADERS = (".shader", ".hlsl", ".cginc")


def guid_for(path):
    return hashlib.md5(("bazarfx:" + path).encode("utf-8")).hexdigest()


def meta_body(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in SCRIPTS:
        return "MonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n"
    if ext in SHADERS:
        return "ShaderImporter:\n  externalObjects: {}\n  defaultTextures: []\n  nonModifiableTextures: []\n  preprocessorOverride: 0\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n"
    if ext == ".json":
        return "TextScriptImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n"
    return "DefaultImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n"


def collect():
    files = []
    for base, _dirs, names in os.walk(SRC):
        for name in names:
            if name.startswith("."):
                continue
            src = os.path.join(base, name)
            rel = os.path.relpath(src, SRC).replace(os.sep, "/")
            if rel == "package.json":
                continue  # UPM-манифест нужен только при установке через git
            files.append((src, f"{ASSET_PREFIX}/{rel}"))
    files.sort(key=lambda item: item[1])
    return files


def main():
    files = collect()
    if not files:
        raise SystemExit("нет файлов для упаковки")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w") as tar:
        for src, pathname in files:
            guid = guid_for(pathname)
            with open(src, "rb") as f:
                data = f.read()
            meta = META_TEMPLATE.format(guid=guid, body=meta_body(pathname)).encode("utf-8")

            for fname, payload in (("pathname", pathname.encode("utf-8")),
                                   ("asset", data),
                                   ("asset.meta", meta)):
                info = tarfile.TarInfo(name=f"{guid}/{fname}")
                info.size = len(payload)
                info.mtime = 1700000000
                info.mode = 0o644
                tar.addfile(info, io.BytesIO(payload))

    with gzip.GzipFile(OUT, "wb", mtime=1700000000) as gz:
        gz.write(raw.getvalue())

    os.makedirs(os.path.dirname(PUBLIC_COPY), exist_ok=True)
    with open(OUT, "rb") as src, open(PUBLIC_COPY, "wb") as dst:
        dst.write(src.read())

    print(f"собрано: {OUT} ({os.path.getsize(OUT)} байт), файлов: {len(files)}")
    for _src, pathname in files:
        print("  ", pathname)


if __name__ == "__main__":
    main()
