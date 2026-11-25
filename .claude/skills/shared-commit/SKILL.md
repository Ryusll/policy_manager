---
name: shared-commit
description: 다른 세션도 고치는 파일(작업관리대장·README·SRS 등)이나 남의 미커밋 줄이 섞인 파일에서 내 줄만 커밋한다 — 임시 인덱스에 "HEAD + 내 hunk"를 올려 커밋한다. git-guard가 "이 세션이 쓰지 않은 줄"로 막았을 때, 대장·문서 기록을 커밋할 때 사용한다.
argument-hint: "[파일 경로...]"
---

# 내 줄만 커밋하기

같은 작업 트리를 여러 세션이 쓴다. `git add <파일>`·`git commit -- <파일>`(--only)은 그 파일의 작업 트리 전체를 올려 **남의 미커밋 줄까지** 커밋한다. 공용 인덱스에는 남이 올려 둔 파일이 있을 수 있다. 그래서 임시 인덱스를 쓴다.

대상: $ARGUMENTS

## 1. 내 hunk 가리기

- `git diff HEAD -- <파일>`을 보고, 이 세션이 고친 hunk만 고른다. 애매하면 그 줄을 쓴 세션에 묻는다.
- 내 hunk만 담은 패치를 scratchpad에 만든다: 전체 diff를 저장한 뒤 남의 hunk를 지운다. hunk 머리(`@@`)의 줄 수가 맞아야 한다.
- 파일을 다시 쓰는 스크립트는 읽기 → 바꾸기 → 쓰기 순서로 한다(`open(p,'w')`가 먼저 열리면 파일이 비워진다).

## 2. 임시 인덱스로 커밋 (한 번의 Bash 호출로)

```bash
SP=<scratchpad>; export GIT_INDEX_FILE=$SP/idx
git read-tree HEAD
git apply --cached $SP/mine.patch
git diff --cached --stat
git commit -F $SP/msg.txt
unset GIT_INDEX_FILE
git reset -q -- <파일들>
```

- `git apply --cached`가 실패하면 패치가 HEAD와 맞지 않는 것이다 — 그사이 다른 세션이 커밋했는지 `git log -3`으로 보고 패치를 다시 만든다.
- 마지막 `git reset -q -- <파일들>`은 진짜 인덱스를 새 HEAD에 맞춘다(경로를 꼭 적는다 — 경로 없는 reset은 git-guard가 막는다).
- 임시 인덱스 커밋에도 git-guard의 노출 검사(공인 IP·키·로컬 전용 파일)는 그대로 걸린다.

## 3. 확인

- `git show --stat HEAD`에 내 파일만 있는지.
- `git diff HEAD -- <파일>`에 남의 hunk만 남았는지(내 줄이 남아 있으면 빠뜨린 것이다).
- 작업 트리 파일은 건드리지 않았으므로 다른 세션의 작업은 그대로다.
