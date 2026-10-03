"""Independently verify downloaded bytes, Spine pairs, PNG dimensions and ZIP CRCs."""
import argparse
import collections
import hashlib
import json
import re
import struct
import zipfile
import zlib
from pathlib import Path


def png_size(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'PNG signature mismatch'
    offset = 8
    while offset < len(data):
        size = struct.unpack_from('>I', data, offset)[0]
        kind = data[offset + 4:offset + 8]
        body = data[offset + 8:offset + 8 + size]
        crc = struct.unpack_from('>I', data, offset + 8 + size)[0]
        assert zlib.crc32(kind + body) & 0xffffffff == crc, 'PNG chunk CRC mismatch'
        offset += 12 + size
        if kind == b'IEND':
            break
    assert offset == len(data), 'PNG contains trailing or truncated bytes'
    return struct.unpack_from('>II', data, 16)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--zip', type=Path)
    args = parser.parse_args()
    root = args.directory
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    errors, versions, extensions = [], collections.Counter(), collections.Counter()
    total_bytes = 0
    for item in manifest['files']:
        data = (root / item['path']).read_bytes()
        extensions[Path(item['path']).suffix.lower()] += 1
        total_bytes += len(data)
        if len(data) != item['size'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            errors.append(f"Hash/size mismatch: {item['path']}")
        if item['path'].lower().endswith('.png'):
            try:
                png_size(data)
            except Exception as error:
                errors.append(f"{item['path']}: {error}")
    animations = 0
    for spine in manifest['spines']:
        data = json.loads((root / spine['json']).read_text(encoding='utf-8'))
        assert data.get('skeleton') and data.get('bones'), spine['json']
        versions[data['skeleton']['spine']] += 1
        animations += len(data.get('animations', {}))
        atlas = (root / spine['atlas']).read_text(encoding='utf-8')
        for page in spine['pages']:
            dimensions = re.search(re.escape(page['page']) + r'\s*\n\s*size:\s*(\d+)\s*,\s*(\d+)', atlas)
            if not dimensions:
                errors.append(f"Atlas dimensions missing: {spine['id']}")
                continue
            expected = tuple(map(int, dimensions.groups()))
            actual = png_size((root / page['path']).read_bytes())
            if expected != actual:
                errors.append(f"Atlas/PNG size mismatch: {spine['id']} {expected} != {actual}")
    zip_entries = None
    if args.zip:
        with zipfile.ZipFile(args.zip) as archive:
            bad = archive.testzip()
            if bad:
                errors.append(f'ZIP CRC mismatch: {bad}')
            names = archive.namelist()
            zip_entries = len(names)
            if len(names) != len(set(names)):
                errors.append('Duplicate ZIP entry names')
            for item in manifest['files']:
                if hashlib.sha256(archive.read(item['path'])).hexdigest() != item['sha256']:
                    errors.append(f"ZIP SHA-256 mismatch: {item['path']}")
    result = dict(files=len(manifest['files']), spines=len(manifest['spines']), animations=animations,
                  bytes=total_bytes, extensions=dict(extensions), spine_versions=dict(versions),
                  download_failures=len(manifest['failures']), extraction_warnings=len(manifest['warnings']),
                  zip_entries=zip_entries, errors=errors)
    (root / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if errors or manifest['failures'] or manifest['warnings']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
