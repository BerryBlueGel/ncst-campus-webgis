import json
import struct
from pathlib import Path


import os
PATH = Path(os.environ.get('CAMPUS_GEOREF_TIF', Path(__file__).resolve().parents[2] / '￥%……&/campus_georef.tif'))

TYPE_FORMATS = {
    1: "B",   # BYTE
    2: "c",   # ASCII
    3: "H",   # SHORT
    4: "I",   # LONG
    5: "II",  # RATIONAL
    11: "f",  # FLOAT
    12: "d",  # DOUBLE
}
TYPE_SIZES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8}


def read_values(handle, endian, tag_type, count, value_field, value_offset):
    total = TYPE_SIZES.get(tag_type, 1) * count
    raw = value_field[:total] if total <= 4 else None
    if raw is None:
        position = handle.tell()
        handle.seek(value_offset)
        raw = handle.read(total)
        handle.seek(position)
    if tag_type == 2:
        return raw.rstrip(b"\x00").decode("utf-8", errors="replace")
    fmt = TYPE_FORMATS.get(tag_type)
    if not fmt:
        return raw.hex()
    if tag_type == 5:
        values = struct.unpack(endian + fmt * count, raw)
        return [values[i] / values[i + 1] for i in range(0, len(values), 2)]
    return list(struct.unpack(endian + fmt * count, raw))


def main():
    with PATH.open("rb") as handle:
        byte_order = handle.read(2)
        endian = "<" if byte_order == b"II" else ">"
        magic = struct.unpack(endian + "H", handle.read(2))[0]
        if magic != 42:
            raise RuntimeError(f"只支持经典 TIFF，检测到 magic={magic}")
        ifd_offset = struct.unpack(endian + "I", handle.read(4))[0]
        handle.seek(ifd_offset)
        count = struct.unpack(endian + "H", handle.read(2))[0]
        wanted = {256, 257, 33550, 33922, 34264, 34735, 34736, 34737}
        tags = {}
        for _ in range(count):
            entry = handle.read(12)
            tag, tag_type, item_count = struct.unpack(endian + "HHI", entry[:8])
            value_field = entry[8:12]
            value_offset = struct.unpack(endian + "I", value_field)[0]
            if tag in wanted:
                tags[str(tag)] = read_values(
                    handle, endian, tag_type, item_count, value_field, value_offset
                )
    print(json.dumps({"path": str(PATH), "tags": tags}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
