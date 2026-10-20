# Watcher native macOS ZIP safety proof — release-time, zero client overhead

The real native update ZIP is examined before a candidate's macOS CI build can pass, and before the separate non-Windows release workflow can publish candidate artifacts. The auditor is Python standard-library code, **not** an installed Watcher service or custom ZIP extractor.

It verifies each ZIP entry's name, root app bundle, case-insensitive collisions, nested paths, compressed/uncompressed sizes, entry count, compression ratio, forbidden device types, internal-only symlink targets, and streamed CRC integrity. It never extracts the ZIP and rejects zip-slip/escape attempts, ZIP bombs, corrupted records and suspicious symlinks. Ordinary contained macOS framework symlinks are permitted.

Security limits align to the existing app bundle audit (25,000 entries, depth 32, 1.2 GiB expanded), with a maximum 512 MiB compressed update. Real Electron-built packages must pass the macOS runner to establish compatibility; synthetic malformed-archive tests are independently run on Ubuntu.

**This is release-time defense-in-depth only.** It does not make an unsigned local installer safe by itself. The eventual user-scoped Mac helper must still use a security-reviewed extractor, strict stage ownership, and post-extraction app-bundle verification. The 1.6.5 public binaries, current manual Mac update path, replay uploader, and financial authority are unchanged.
