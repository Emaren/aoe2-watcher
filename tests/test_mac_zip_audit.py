import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("audit", ROOT/"scripts"/"audit_mac_updater_zip.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

PREFIX = "AoE2HDBets Watcher.app/Contents/"
class ZipAuditTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "AoE2HDBets Watcher-1.6.6-arm64-mac.zip"
    def tearDown(self):
        self.temp.cleanup()
    def make(self, members):
        with zipfile.ZipFile(self.path, "w", compression=zipfile.ZIP_DEFLATED) as z:
            for name, contents, mode in members:
                info = zipfile.ZipInfo(name)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = (mode & 0xFFFF) << 16
                z.writestr(info, contents)
    def plain(self):
        return [(PREFIX+"Info.plist", b"fixture-only", stat.S_IFREG|0o644),
                (PREFIX+"MacOS/Watcher", b"executable fixture",stat.S_IFREG|0o755)]
    def test_good_mac_archive(self):
        self.make(self.plain())
        result = mod.audit_native_zip(self.path, "1.6.6")
        self.assertEqual(result["files"], 2)
    def test_legitimate_internal_framework_symlink(self):
        members = self.plain()
        members += [(PREFIX+"Frameworks/Framework.framework/Versions/A/Bin",b"exe",stat.S_IFREG|0o755),
                    (PREFIX+"Frameworks/Framework.framework/Versions/Current",b"A",stat.S_IFLNK|0o777)]
        self.make(members)
        self.assertEqual(mod.audit_native_zip(self.path, "1.6.6")["symlinks"], 1)
    def test_reject_zip_slip_absolute_and_backslash(self):
        for name in ["../outside","/etc/passwd",
                     PREFIX+"../../../../escape",PREFIX+r"C:\escape"]:
            with self.subTest(name=name):
                self.make(self.plain()+[(name,b"x",stat.S_IFREG|0o644)])
                with self.assertRaises(mod.UnsafeZip):
                    mod.audit_native_zip(self.path, "1.6.6")
    def test_reject_symlink_escape(self):
        for target in [b"/etc/passwd",b"../../../../escape",b"bad\\path"]:
            with self.subTest(target=target):
                self.make(self.plain()+[
                    (PREFIX+"Frameworks/Bad",target,stat.S_IFLNK|0o777)])
                with self.assertRaises(mod.UnsafeZip):
                    mod.audit_native_zip(self.path, "1.6.6")
    def test_case_collision_and_invalid_device(self):
        members=self.plain()
        members.append((PREFIX+"info.PLIST",b"x",stat.S_IFREG|0o644))
        self.make(members)
        with self.assertRaises(mod.UnsafeZip):
            mod.audit_native_zip(self.path, "1.6.6")
        self.make(self.plain()+[(PREFIX+"malicious",b"x",stat.S_IFIFO|0o600)])
        with self.assertRaises(mod.UnsafeZip):
            mod.audit_native_zip(self.path, "1.6.6")
    def test_zip_bomb_and_wrong_version(self):
        self.make(self.plain()+[(PREFIX+"zeros",b"\x00"*(2*1024*1024),
                                  stat.S_IFREG|0o644)])
        with self.assertRaises(mod.UnsafeZip):
            mod.audit_native_zip(self.path, "1.6.6")
        self.make(self.plain())
        with self.assertRaises(mod.UnsafeZip):
            mod.audit_native_zip(self.path, "1.6.7")
if __name__=="__main__":
    unittest.main()
