#!/usr/bin/env python3
"""Convert raw PPM screenshots from the simulator into PNG (pure stdlib)."""
import glob
import os
import struct
import zlib


def read_ppm(path):
    with open(path, "rb") as f:
        assert f.readline().strip() == b"P6"
        line = f.readline()
        while line.startswith(b"#"):
            line = f.readline()
        w, h = map(int, line.split())
        assert f.readline().strip() == b"255"
        data = f.read(w * h * 3)
    return w, h, data


def write_png(path, w, h, rgb):
    def chunk(tag, payload):
        out = struct.pack(">I", len(payload)) + tag + payload
        crc = zlib.crc32(tag + payload) & 0xFFFFFFFF
        return out + struct.pack(">I", crc)

    scanlines = b"".join(b"\x00" + rgb[y * w * 3:(y + 1) * w * 3]
                         for y in range(h))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(scanlines, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    for ppm in sorted(glob.glob("screenshots/*.ppm")):
        w, h, data = read_ppm(ppm)
        png = os.path.splitext(ppm)[0] + ".png"
        write_png(png, w, h, data)
        os.remove(ppm)
        print(f"shot: {ppm} -> {png} ({w}x{h})")


if __name__ == "__main__":
    main()
