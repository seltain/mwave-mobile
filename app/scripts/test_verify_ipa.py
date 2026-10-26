"""Synthetic ZIP/Mach-O fixtures test rejection logic; they are not iOS builds."""
import importlib.util
import plistlib
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('verify_ipa', Path(__file__).with_name('verify-ipa.py'))
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


def macho(platform=2, cpu=0x0100000C, signed=False):
    commands = struct.pack('<6I', 0x32, 24, platform, 0, 0, 0)
    if signed:
        commands += struct.pack('<4I', 0x1D, 16, 0, 0)
    return struct.pack('<8I', 0xFEEDFACF, cpu, 0, 2, 1 + int(signed), len(commands), 0, 0) + commands


class ValidatorTests(unittest.TestCase):
    def verify_fixture(self, binary=None, js=True, extra=None):
        with tempfile.TemporaryDirectory(prefix='cabbit-validator-test-') as directory:
            path = Path(directory) / 'synthetic-fixture.zip'
            prefix = 'Payload/CabbitTest.app/'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr(prefix + 'Info.plist', plistlib.dumps({
                    'CFBundleIdentifier': 'com.cabbit.iostest',
                    'CFBundleExecutable': 'CabbitTest',
                    'CFBundleSupportedPlatforms': ['iPhoneOS'],
                    'DTPlatformName': 'iphoneos',
                    'UIDeviceFamily': [1],
                    'CFBundlePackageType': 'APPL',
                }))
                archive.writestr(prefix + 'CabbitTest', binary if binary is not None else macho())
                if js:
                    archive.writestr(prefix + 'main.jsbundle', b'synthetic-test-content')
                for name, data in (extra or {}).items():
                    archive.writestr(prefix + name, data)
            return validator.verify(path, 'com.cabbit.iostest', True)

    def test_device_structure_passes(self):
        report = self.verify_fixture()
        self.assertEqual(report['structural_validation'], 'passed')
        self.assertEqual(report['physical_device_installation'], 'not tested by this script')

    def test_arm64_simulator_rejected_even_with_device_plist(self):
        with self.assertRaisesRegex(ValueError, 'platform iOS=2'):
            self.verify_fixture(binary=macho(platform=7))

    def test_x86_simulator_rejected(self):
        with self.assertRaisesRegex(ValueError, 'arm64'):
            self.verify_fixture(binary=macho(cpu=0x01000007))

    def test_missing_offline_bundle_rejected(self):
        with self.assertRaisesRegex(ValueError, 'JavaScript'):
            self.verify_fixture(js=False)

    def test_signed_binary_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Signed Mach-O'):
            self.verify_fixture(binary=macho(signed=True))

    def test_simulator_framework_rejected(self):
        with self.assertRaisesRegex(ValueError, 'platform iOS=2'):
            self.verify_fixture(extra={'Frameworks/Test.framework/Test': macho(platform=7)})

    def test_profile_rejected(self):
        with self.assertRaisesRegex(ValueError, 'unsigned archive'):
            self.verify_fixture(extra={'embedded.mobileprovision': b'not-a-real-profile'})

    def test_truncated_macho_rejected(self):
        with self.assertRaisesRegex(ValueError, 'header'):
            validator.inspect_macho(b'\xcf\xfa\xed\xfe')


if __name__ == '__main__':
    unittest.main()
