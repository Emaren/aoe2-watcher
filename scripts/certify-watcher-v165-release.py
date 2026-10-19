#!/usr/bin/env python3
"""Certify exact-source Watcher 1.6.5 release inventory. No deployment actions."""
import base64
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

VERSION = "1.6.5"
ROOT = Path("staging")
OUT = Path("release")
SHA_RE = __import__("re").compile(r"^[0-9a-f]{64}$")


def stop(message):
    raise SystemExit("STOP: " + message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sha512(path):
    return base64.b64encode(hashlib.sha512(path.read_bytes()).digest()).decode("ascii")


def attestation(path):
    rows = {}
    if not path.is_file():
        stop("missing signed/unsigned attestation: " + str(path))
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        text = line.strip()
        if not text:
            continue
        fields = text.split(None, 1)
        if len(fields) != 2 or not SHA_RE.fullmatch(fields[0]):
            stop("malformed attestation entry")
        name = Path(fields[1].strip()).name
        if not name or name in rows or "/" in name:
            stop("duplicate/invalid attestation filename")
        rows[name] = fields[0]
    return rows


def copy_verified(source, name, attested=None):
    if Path(name).name != name:
        stop("unsafe release filename")
    p = source / name
    if not p.is_file() or p.stat().st_size < 1:
        stop("missing release artifact " + name)
    if attested is not None and (attested.get(name) != digest(p)):
        stop("source-bound artifact checksum mismatch " + name)
    dest = OUT / name
    dest.write_bytes(p.read_bytes())
    if digest(dest) != digest(p):
        stop("release copy checksum mismatch " + name)
    return dest


def manifest_version(path):
    content = path.read_text()
    if "version: " + VERSION not in content:
        stop("wrong updater version in " + path.name)
    return content


def main():
    if not all(x.isdigit() and int(x) > 0 for x in [os.environ["WINDOWS_RUN_ID"], os.environ["NONWINDOWS_RUN_ID"]]):
        stop("missing successful exact-head run pins")
    build_source = os.environ["BUILD_SOURCE_SHA"]
    if len(build_source) != 40 or any(c not in "0123456789abcdef" for c in build_source):
        stop("invalid pinned source SHA")
    win, mac, linux = ROOT / "windows", ROOT / "macos", ROOT / "linux"
    setup = f"AoE2HDBets Watcher Setup {VERSION}.exe"
    portable = f"AoE2HDBets Watcher {VERSION}.exe"
    dmg = f"AoE2HDBets Watcher-{VERSION}-arm64.dmg"
    native_zip = f"AoE2HDBets Watcher-{VERSION}-arm64-mac.zip"
    appimage = f"AoE2HDBets Watcher-{VERSION}.AppImage"
    direct = "aoe2hdbets-watcher-direct.zip"
    blockmap = dmg + ".blockmap"
    windows_names = [setup, portable]
    mac_names = [dmg, blockmap, direct, native_zip, "latest-mac.yml"]
    linux_names = [appimage, "latest-linux.yml"]
    winproof = attestation(win / "SIGNED_WINDOWS_SHA256.txt")
    macproof = attestation(mac / "UNSIGNED_MACOS_SHA256.txt")
    if set(winproof) != set(windows_names):
        stop("signed Windows attestation is not the exact two EXEs")
    if set(macproof) != set([dmg, direct, native_zip, "latest-mac.yml"]):
        stop("unsigned Mac attestation is not the approved 4-file list")
    if (mac / "SIGNED_MACOS_SHA256.txt").exists():
        stop("mixed signed/unsigned macOS provenance")
    OUT.mkdir(parents=True, exist_ok=True)
    if any(OUT.iterdir()):
        stop("release directory must be empty")
    copied = []
    for name in windows_names:
        copied.append(copy_verified(win, name, winproof))
    for name in mac_names:
        copied.append(copy_verified(mac, name, macproof if name in macproof else None))
    for name in linux_names:
        copied.append(copy_verified(linux, name))
    installer = OUT / setup
    latest_win = OUT / "latest.yml"
    sh = sha512(installer)
    latest_win.write_text(
        f"version: {VERSION}\nfiles:\n"
        f"  - url: AoE2HDBets%20Watcher%20Setup%20{VERSION}.exe\n"
        f"    sha512: {sh}\n    size: {installer.stat().st_size}\n"
        f"path: {setup}\nsha512: {sh}\n"
        f"releaseDate: '{datetime.now(timezone.utc).isoformat()}'\n")
    copied.append(latest_win)
    mac_yaml = manifest_version(OUT / "latest-mac.yml")
    if native_zip not in mac_yaml or sha512(OUT / native_zip) not in mac_yaml:
        stop("mac native ZIP digest does not match updater manifest")
    linux_yaml = manifest_version(OUT / "latest-linux.yml")
    if appimage not in linux_yaml or sha512(OUT / appimage) not in linux_yaml:
        stop("Linux AppImage digest does not match updater manifest")
    names = [p.name for p in copied]
    if len(names) != 10 or len(set(names)) != 10:
        stop("canonical ten-asset inventory mismatch")
    rows = [{"filename":p.name, "bytes":p.stat().st_size, "sha256":digest(p)}
            for p in copied]
    (OUT / f"SHA256SUMS-{VERSION}.txt").write_text(
        "".join(f"{row['sha256']}  {row['filename']}\n" for row in rows))
    metadata = {
        "schema": 3, "version": VERSION, "build_source_sha": build_source,
        "runtime_source_sha": os.environ["RUNTIME_SOURCE_SHA"],
        "windows_signing_run_id": int(os.environ["WINDOWS_RUN_ID"]),
        "nonwindows_build_run_id": int(os.environ["NONWINDOWS_RUN_ID"]),
        "windows_signature": "Azure Artifact Signed; timestamp and Authenticode verified by signing workflow",
        "macos_signature": "UNSIGNED", "macos_notarization": "NONE",
        "macos_installation": "MANUAL_ONLY",
        "linux_signature": "UNSIGNED",
        "financial_bridge_activation": "NOT_AUTHORIZED_BY_WATCHER_RELEASE",
        "files": rows,
    }
    (OUT / f"watcher-release-manifest-{VERSION}.json").write_text(
        json.dumps(metadata, indent=2) + "\n")
    (Path("release-notes.md")).write_text(
        f"""AoE2HDBets Watcher {VERSION}

⚔️ War Room: new dashboard with Old Blue fully preserved, French/English toggle,
optional verified first-party avatar, improved broadcast and replay status.
FR uses the local toggle or French operating-system language; automatic
website-profile language and avatar sync need a future authenticated endpoint.

Windows: both installer and portable signed and RFC3161 timestamped by Azure.
macOS: intentionally UNSIGNED and NOT Apple notarized; DMG and direct ZIP
are manual downloads. macOS Gatekeeper may warn or block installation.
Verify download and SHA256SUMS before use; do not disable security protections.
Linux: unsigned AppImage.

War Satchel and Auto Bets: profile link and clearly marked NOT YET ACTIVE tile.
Watcher does not custody WOLO or place wagers. Financial production controls
remain independently held.

Exact build source: {build_source}
Windows signing run: {metadata['windows_signing_run_id']}
Mac/Linux release run: {metadata['nonwindows_build_run_id']}
"""
    )
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
