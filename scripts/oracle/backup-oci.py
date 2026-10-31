#!/usr/bin/env python3
"""서버 Instance Principal로 비공개 OCI 버킷에 백업하고 다운로드 해시를 검증한다."""
import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

import oci


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path.home() / '.config/veda-backup.json')
    args = parser.parse_args()
    settings = json.loads(args.config.read_text())
    root = Path(__file__).resolve().parents[2]
    backups = root / 'backups/oracle'
    backups.mkdir(parents=True, exist_ok=True)
    lock = (backups / '.oci-backup.lock').open('w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    client = oci.object_storage.ObjectStorageClient(
        {'region': settings['region']}, signer=oci.auth.signers.InstancePrincipalsSecurityTokenSigner())
    namespace, bucket = settings['namespace'], settings['bucket']
    existing = oci.pagination.list_call_get_all_results(
        client.list_objects, namespace, bucket, fields='name,size').data.objects
    used = sum(obj.size for obj in existing)
    limit = 5 * 1024**3
    if used >= limit:
        raise RuntimeError('전용 백업 버킷 5 GiB 제한 도달. 백업 용량과 보관 정책을 확인하세요.')
    staging = Path(tempfile.mkdtemp(prefix='.oci-', dir=backups))
    compose = ['bash', str(root / 'scripts/oracle/compose.sh')]
    try:
        # DB와 첨부의 시점을 맞춘다. 백업 실패 시에도 서비스를 다시 기동한다.
        subprocess.run(compose + ['stop', 'web', 'api'], check=True)
        try:
            subprocess.run(['bash', str(root / 'scripts/oracle/backup-local.sh')],
                           env={**os.environ, 'ORACLE_BACKUP_DIR': str(staging)}, check=True)
        finally:
            subprocess.run(compose + ['up', '-d', '--wait', '--wait-timeout', '120', 'api', 'web'], check=True)
        candidates = list(staging.iterdir())
        if len(candidates) != 1 or not (candidates[0] / 'COMPLETE').is_file():
            raise RuntimeError('완료된 백업을 찾지 못했습니다.')
        snapshot = backups / candidates[0].name
        candidates[0].rename(snapshot)
    finally:
        if not any(staging.iterdir()):
            staging.rmdir()
    shutil.copyfile(root / '.env.oracle', snapshot / 'environment.env')
    files = [snapshot / name for name in ('db.sql.gz', 'uploads.tar.gz', 'environment.env')]
    if used + sum(file.stat().st_size for file in files) + 4096 > limit:
        raise RuntimeError('업로드하면 전용 버킷 5 GiB 제한을 초과합니다. 로컬 백업은 유지했습니다.')
    hashes = {}
    prefix = 'daily/' + snapshot.name + '/'
    for file in files:
        digest, md5 = hashlib.sha256(), hashlib.md5()
        with file.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
                md5.update(chunk)
        checksum = digest.hexdigest()
        with file.open('rb') as source:
            client.put_object(namespace, bucket, prefix + file.name, source,
                              content_length=file.stat().st_size,
                              content_md5=base64.b64encode(md5.digest()).decode(),
                              if_none_match='*')
        response = client.get_object(namespace, bucket, prefix + file.name)
        downloaded = hashlib.sha256()
        try:
            for chunk in response.data.raw.stream(1024 * 1024, decode_content=False):
                downloaded.update(chunk)
        finally:
            response.data.close()
        if downloaded.hexdigest() != checksum:
            raise RuntimeError('원격 백업 해시 불일치: ' + file.name)
        hashes[file.name] = checksum
    manifest = json.dumps(hashes, indent=2).encode()
    client.put_object(namespace, bucket, prefix + 'SHA256SUMS.json', manifest, if_none_match='*')
    (snapshot / 'OFFSITE_VERIFIED').write_bytes(manifest)
    # 원격 검증까지 끝난 로컬 사본만 정리한다. 수동/실패 백업은 보존한다.
    verified = sorted(p.parent for p in backups.glob('*/OFFSITE_VERIFIED'))
    for old in verified[:-7]:
        shutil.rmtree(old)
    print('OCI_BACKUP_VERIFIED:', bucket + '/' + prefix, flush=True)


if __name__ == '__main__':
    main()
