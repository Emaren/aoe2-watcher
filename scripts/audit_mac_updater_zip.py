#!/usr/bin/env python3
"""Source-only release-time safety audit of a native macOS ZIP; never extracts."""
import argparse
import posixpath
import re
import stat
import unicodedata
import zipfile
from pathlib import Path

ROOT = "AoE2HDBets Watcher.app"
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_EXPANDED = 1200 * 1024 * 1024
MAX_FILES = 25000
MAX_DEPTH = 32
MAX_FILE = 768 * 1024 * 1024
MAX_SYMLINK = 4096
MAX_RATIO = 900

class UnsafeZip(ValueError):
    pass

def refuse(reason):
    raise UnsafeZip("STOP: unsafe native Watcher ZIP: " + reason)

def safe_name(name):
    if (not isinstance(name, str) or not name or len(name) > 700 or
        "\x00" in name or "\\" in name or name.startswith("/") or
        re.match(r"^[a-zA-Z]:", name) or "//" in name):
        refuse("malformed entry name")
    raw = name[:-1] if name.endswith("/") else name
    parts = raw.split("/")
    if (not parts or parts[0] != ROOT or
        any(part in ("", ".", "..") for part in parts) or
        len(parts) > MAX_DEPTH or
        unicodedata.normalize("NFC", raw) != raw):
        refuse("unsafe or unexpected bundle member: " + name[:120])
    return raw

def validate_target(entry, target):
    if (not target or len(target) > MAX_SYMLINK or
        target.startswith("/") or "\\" in target or "\x00" in target):
        refuse("unsafe symlink target for " + entry)
    linked = posixpath.normpath(posixpath.join(posixpath.dirname(entry), target))
    if linked != ROOT and not linked.startswith(ROOT + "/"):
        refuse("bundle symlink escapes application: " + entry)
    return linked

def audit_native_zip(archive_path, expected_version=None):
    source = Path(archive_path)
    if (not source.is_file() or source.is_symlink() or
        source.stat().st_size <= 0 or source.stat().st_size > MAX_ARCHIVE):
        refuse("invalid bounded ZIP source")
    if expected_version is not None:
        if not re.fullmatch(r"\d+\.\d+\.\d+", expected_version):
            refuse("invalid release version")
        if source.name != "AoE2HDBets Watcher-" + expected_version + "-arm64-mac.zip":
            refuse("wrong native updater ZIP basename")
    total = 0
    files = 0
    seen = set()
    links = []
    present = set()
    entry_types = {}
    hierarchy_case = {}
    with zipfile.ZipFile(source, "r", allowZip64=True) as package:
        members = package.infolist()
        if len(members) < 1 or len(members) > MAX_FILES:
            refuse("invalid ZIP member count")
        for info in members:
            entry = safe_name(info.filename)
            folded = entry.casefold()
            if folded in seen:
                refuse("duplicate or case-colliding ZIP member: " + entry)
            seen.add(folded)
            present.add(entry)
            # macOS volume names are typically case-insensitive. A collision
            # between implicit ancestor folders is as dangerous as an explicit
            # filename collision, even when names are otherwise distinct.
            components = entry.split("/")
            for length in range(1, len(components) + 1):
                prefix = "/".join(components[:length])
                folded_prefix = prefix.casefold()
                previous = hierarchy_case.get(folded_prefix)
                if previous is not None and previous != prefix:
                    refuse("case-colliding parent directories: " + entry)
                hierarchy_case[folded_prefix] = prefix
            if info.flag_bits & 0x1:
                refuse("encrypted ZIP members not allowed")
            if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                refuse("unsupported compression method")
            if info.file_size < 0 or info.file_size > MAX_FILE:
                refuse("oversize ZIP entry")
            if info.compress_size == 0 and info.file_size > 0:
                refuse("impossible compression size")
            if info.compress_size > 0 and info.file_size / info.compress_size > MAX_RATIO:
                refuse("excessive compression ratio")
            unix_mode = (info.external_attr >> 16) & 0xFFFF
            kind = stat.S_IFMT(unix_mode)
            directory = info.is_dir()
            if kind not in (0, stat.S_IFDIR, stat.S_IFREG, stat.S_IFLNK):
                refuse("unsafe special filesystem entry")
            if directory and kind not in (0, stat.S_IFDIR):
                refuse("directory/type disagreement")
            if kind == stat.S_IFDIR and not directory:
                refuse("directory/type disagreement")
            if directory and info.file_size != 0:
                refuse("nonempty directory entry")
            entry_types[entry] = ("symlink" if kind == stat.S_IFLNK
                                  else "directory" if directory else "file")
            total += info.file_size
            if total > MAX_EXPANDED:
                refuse("archive exceeds expanded size limit")
            if not directory:
                files += 1
            if kind == stat.S_IFLNK and info.file_size > MAX_SYMLINK:
                refuse("oversize symlink")
            read_bytes = 0
            symlink_bytes = bytearray() if kind == stat.S_IFLNK else None
            # Stream to EOF so zipfile checks CRC. Never materialize app binaries.
            with package.open(info, "r") as body:
                while True:
                    block = body.read(256 * 1024)
                    if not block:
                        break
                    read_bytes += len(block)
                    if read_bytes > info.file_size or read_bytes > MAX_FILE:
                        refuse("expanded size inconsistent with ZIP header")
                    if symlink_bytes is not None:
                        symlink_bytes.extend(block)
                        if len(symlink_bytes) > MAX_SYMLINK:
                            refuse("oversize symlink data")
            if read_bytes != info.file_size:
                refuse("truncated ZIP entry")
            if symlink_bytes is not None:
                try:
                    target = bytes(symlink_bytes).decode("utf-8")
                except UnicodeDecodeError:
                    refuse("invalid UTF-8 symlink")
                links.append((entry, validate_target(entry, target)))
    # Refuse members whose parent is a file or a symlink. ZIP extraction tools
    # differ in how they handle such an entry and can end up writing through an
    # earlier symlink rather than into the intended archive path.
    for entry in entry_types:
        components = entry.split("/")
        for length in range(1, len(components)):
            parent = "/".join(components[:length])
            if entry_types.get(parent) in ("symlink", "file"):
                refuse("member nested under non-directory: " + entry)

    symlink_map = dict(links)
    valid_paths = set(hierarchy_case.values())

    def resolve_link(initial):
        current = initial
        visited = set()
        for _ in range(32):
            if current in visited:
                refuse("cyclic bundle symlink: " + initial)
            visited.add(current)
            components = current.split("/")
            substituted = False
            for length in range(1, len(components) + 1):
                parent = "/".join(components[:length])
                if parent not in symlink_map:
                    continue
                rest = "/".join(components[length:])
                current = posixpath.normpath(posixpath.join(symlink_map[parent], rest))
                if current != ROOT and not current.startswith(ROOT + "/"):
                    refuse("symlink chain escapes application: " + initial)
                substituted = True
                break
            if not substituted:
                if current not in valid_paths:
                    refuse("dangling bundle symlink: " + initial)
                return
        refuse("bundle symlink chain exceeds hop limit")

    for member, target in links:
        if target == member:
            refuse("self-referential symlink")
        resolve_link(target)
    if files == 0 or not any(x.startswith(ROOT + "/Contents/") for x in present):
        refuse("ZIP missing application contents")
    return {"files": files, "entries": len(seen), "expanded_bytes": total,
            "symlinks": len(links)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    result = audit_native_zip(args.archive, args.version)
    print("MAC_NATIVE_ZIP_AUDIT_PASS files={files} entries={entries} expanded_bytes={expanded_bytes} symlinks={symlinks}".format(**result))

if __name__ == "__main__":
    main()
