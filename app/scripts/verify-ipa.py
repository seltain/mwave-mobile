#!/usr/bin/env python3
"""Inspect a device IPA without extracting files or needing Apple tools.

These structural checks do not prove successful signing, installation or launch.
Only Python's standard library is used.
"""
import argparse
import hashlib
import json
import plistlib
import struct
import sys
import zipfile
from pathlib import Path, PurePosixPath


def require(condition, message):
    if not condition:
        raise ValueError(message)


def inspect_macho(data, modern_platform_required=False):
    # Embedded vendor/Swift libraries may be universal even with ARCHS=arm64.
    if data[:4] in (b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'):
        require(len(data) >= 8, 'Truncated universal Mach-O')
        count = struct.unpack_from('>I', data, 4)[0]
        is64 = data[:4] == b'\xca\xfe\xba\xbf'
        entry_size = 32 if is64 else 20
        require(0 < count <= 16 and 8 + count * entry_size <= len(data), 'Invalid universal Mach-O')
        slices = []
        for index in range(count):
            offset = 8 + index * entry_size
            if is64:
                cpu, _, start, length, _, _ = struct.unpack_from('>IIQQII', data, offset)
            else:
                cpu, _, start, length, _ = struct.unpack_from('>5I', data, offset)
            require(cpu == 0x0100000C, 'Universal binary includes a non-arm64 architecture')
            require(start + length <= len(data), 'Truncated universal slice')
            slices.append(inspect_macho(data[start:start + length], modern_platform_required))
        require(len({item['filetype'] for item in slices}) == 1, 'Inconsistent universal file types')
        return {**slices[0], 'slices': len(slices),
                'code_signature_present': any(item['code_signature_present'] for item in slices)}
    require(len(data) >= 32, 'Mach-O header is missing/truncated')
    header = struct.unpack_from('<8I', data)
    magic, cpu, _, filetype, ncmds, sizeofcmds, _, _ = header
    require(magic == 0xFEEDFACF, 'Expected a thin 64-bit little-endian Mach-O')
    require(cpu == 0x0100000C, 'Expected arm64 (x86_64 simulator builds are rejected)')
    require(32 + sizeofcmds <= len(data), 'Truncated Mach-O load commands')
    offset = 32
    platforms, cryptids, signed, legacy_ios = [], [], False, False
    for _ in range(ncmds):
        require(offset + 8 <= 32 + sizeofcmds, 'Truncated load command')
        cmd, size = struct.unpack_from('<2I', data, offset)
        require(size >= 8 and offset + size <= 32 + sizeofcmds, 'Invalid load command')
        if cmd == 0x32:  # LC_BUILD_VERSION: iOS=2, iOS Simulator=7
            require(size >= 24, 'Invalid LC_BUILD_VERSION')
            platforms.append(struct.unpack_from('<I', data, offset + 8)[0])
        if cmd == 0x2C:  # LC_ENCRYPTION_INFO_64
            require(size >= 24, 'Invalid LC_ENCRYPTION_INFO_64')
            cryptids.append(struct.unpack_from('<I', data, offset + 16)[0])
        if cmd == 0x1D:  # LC_CODE_SIGNATURE
            signed = True
        if cmd == 0x25:  # LC_VERSION_MIN_IPHONEOS in older vendor libraries
            legacy_ios = True
        offset += size
    device_platform = all(platform == 2 for platform in platforms) if platforms else (
        legacy_ios and not modern_platform_required)
    require(device_platform,
            'Expected LC_BUILD_VERSION platform iOS=2; arm64 simulator binaries are rejected')
    require(all(cryptid == 0 for cryptid in cryptids), 'Encrypted App Store binary is unsuitable')
    return {'architecture': 'arm64', 'platform': 'iOS device', 'filetype': filetype,
            'code_signature_present': signed}


def verify(path, expected_bundle_id, require_unsigned):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), 'Duplicate ZIP members')
        for name in names:
            parts = PurePosixPath(name).parts
            require(not name.startswith('/') and '..' not in parts and '\\' not in name,
                    'Invalid ZIP member path')
        apps = {PurePosixPath(name).parts[1] for name in names
                if len(PurePosixPath(name).parts) >= 2
                and PurePosixPath(name).parts[0] == 'Payload'
                and PurePosixPath(name).parts[1].endswith('.app')}
        require(len(apps) == 1, 'Expected exactly one Payload/*.app')
        prefix = 'Payload/' + next(iter(apps)) + '/'
        require(prefix + 'Info.plist' in names, 'Missing app Info.plist')
        info = plistlib.loads(archive.read(prefix + 'Info.plist'))
        require(info.get('CFBundleIdentifier') == expected_bundle_id, 'Unexpected bundle identifier')
        require(info.get('CFBundleSupportedPlatforms') == ['iPhoneOS'], 'Not an iPhoneOS app')
        require(info.get('DTPlatformName') == 'iphoneos', 'SDK platform is not iphoneos')
        require(info.get('UIDeviceFamily') == [1], 'Expected iPhone-only app')
        require(info.get('CFBundlePackageType') == 'APPL', 'Not an app bundle')
        executable = info.get('CFBundleExecutable', '')
        require(executable and '/' not in executable and '\\' not in executable,
                'Invalid executable name')
        binary = inspect_macho(archive.read(prefix + executable), modern_platform_required=True)
        require(binary['filetype'] == 2, 'Main Mach-O is not an executable')
        require(prefix + 'main.jsbundle' in names, 'Missing embedded JavaScript/Hermes bundle')
        require(archive.getinfo(prefix + 'main.jsbundle').file_size > 0, 'Empty JavaScript bundle')
        checked_binaries = 0
        for name in names:
            if name.endswith('/'):
                continue
            if require_unsigned:
                require('_CodeSignature' not in PurePosixPath(name).parts
                        and not name.endswith('/embedded.mobileprovision'),
                        'Expected unsigned archive without signature metadata or provisioning')
            with archive.open(name) as member:
                magic = member.read(4)
            if magic in (b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'):
                native = inspect_macho(archive.read(name))
                if require_unsigned:
                    require(not native['code_signature_present'], 'Signed Mach-O: ' + name)
                checked_binaries += 1
        with path.open('rb') as ipa_file:
            digest = hashlib.file_digest(ipa_file, 'sha256').hexdigest()
        return {
            'ipa': path.name,
            'sha256': digest,
            'bundle_id': info['CFBundleIdentifier'],
            'version': info.get('CFBundleShortVersionString'),
            'minimum_ios': info.get('MinimumOSVersion'),
            'main_binary': binary,
            'native_binaries_checked': checked_binaries,
            'embedded_js_bytes': archive.getinfo(prefix + 'main.jsbundle').file_size,
            'unsigned_required': require_unsigned,
            'structural_validation': 'passed',
            'physical_device_installation': 'not tested by this script',
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ipa', type=Path)
    parser.add_argument('--bundle-id', default='com.cabbit.iostest')
    parser.add_argument('--require-unsigned', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    try:
        report = verify(args.ipa, args.bundle_id, args.require_unsigned)
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, struct.error, plistlib.InvalidFileException) as error:
        print('IPA validation failed: ' + str(error), file=sys.stderr)
        return 1
    text = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.report:
        args.report.write_text(text, encoding='utf-8')
    print(text, end='')
    return 0


if __name__ == '__main__':
    sys.exit(main())
