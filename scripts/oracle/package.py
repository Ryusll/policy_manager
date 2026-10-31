#!/usr/bin/env python3
"""커밋 전 변경도 포함해 배포 소스만 압축한다. .env/개인키/빌드 산출물은 제외."""
import argparse
import os
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="생성할 .tar.gz 경로 (기존 파일 덮어쓰기 안 함)")
    args = parser.parse_args()
    names = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=ROOT
    ).decode().split("\0")
    top_files = {"package.json", "package-lock.json", ".dockerignore", ".env.oracle.example",
                 "docker-compose.oracle.yml", "README.md",
                 "docs/Deliverables/16_Runbook_배포롤백/OracleCloud_신규구축_절차서_macOS.md"}
    selected = []
    for name in sorted(set(names)):
        path = Path(name)
        if not name or (name not in top_files and not name.startswith(("apps/", "scripts/"))):
            continue
        if any(part in {"node_modules", "dist", "dist-seed", "__pycache__", "uploads"} for part in path.parts):
            continue
        if name != ".env.oracle.example" and (path.name.startswith(".env") or path.suffix in {".pem", ".key", ".log"}):
            continue
        source = ROOT / path
        if source.is_symlink() or not source.is_file():
            continue
        selected.append(path)
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as out, tarfile.open(fileobj=out, mode="w:gz") as archive:
        for path in selected:
            archive.add(ROOT / path, arcname=str(Path("policy_manager") / path), recursive=False)
    print(f"배포 소스 {len(selected)}개: {args.output}")


if __name__ == "__main__":
    main()
