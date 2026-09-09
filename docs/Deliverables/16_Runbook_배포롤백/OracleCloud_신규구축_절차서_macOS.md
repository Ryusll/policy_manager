# Oracle Cloud 신규 구축 절차서 — macOS · 웹 콘솔 기준

작성일: 2026-08-29
대상: 기존 서버(140.245.71.172)가 **타사 자산이라 접근 불가**로 확정되어, 자사 계정에 처음부터 세우는 경우
결과물: 고정 https 주소로 대표·협업자가 매일 접속 가능한 상시 서버 — **비용 0원**

---

## 0. 준비물과 소요 시간

| 항목 | 비고 |
|---|---|
| 회사 명의 이메일 | 담당자가 바뀌어도 유지되는 주소로 |
| 신용/체크카드 | 본인확인용. Always Free 한도 내에서는 **청구 0원** |
| 휴대폰 | SMS 인증 |
| Mac 터미널 | 기본 설치됨 (별도 도구 불필요) |

소요: 계정 개설 **30분** + 구축 **2~3시간** (첫 도커 빌드 대기 포함)

> 이 문서는 브라우저(웹 콘솔)와 Mac 터미널을 오가며 진행합니다.
> 🌐 = 브라우저에서, 💻 = Mac 터미널에서, 🖥 = 서버에 SSH 접속한 상태에서.

---

## 1. 🌐 Oracle Cloud 계정 개설

1. `cloud.oracle.com` → **무료로 시작하기**
2. 국가: 대한민국 / 이름 / 회사 이메일 입력
3. **⚠️ 홈 리전 선택 — 나중에 바꿀 수 없습니다**
   - 권장: **춘천(ap-chuncheon-1)** 또는 **서울(ap-seoul-1)**
   - 한국 리전이 지연시간에 유리합니다
4. 카드 등록 (소액 승인 후 자동 취소됩니다)
5. 가입 완료 메일 수신 → 콘솔 로그인

### 1-1. Pay As You Go로 전환 (권장)

Always Free 계정은 **7일간 유휴 상태면 인스턴스가 회수**됩니다. 사내 규정관리 도구는
트래픽이 적은 게 정상이라 이 조건에 걸리기 쉽습니다.

PAYG로 올려도 **Always Free 한도 안에서는 요금이 0원**이고, 회수 대상에서 빠지며
A1 인스턴스 확보도 쉬워집니다.

- 콘솔 → 청구 및 비용 관리 → **업그레이드**
- 이어서 **예산 알림**을 $1로 설정: 청구 → 예산 → 예산 생성
  (실수로 유료 리소스를 켜도 즉시 알 수 있습니다)

---

## 2. 💻 SSH 키 만들기 (Mac)

```bash
ssh-keygen -t ed25519 -C "veda-oci" -f ~/.ssh/veda_oci -N ""
pbcopy < ~/.ssh/veda_oci.pub      # 공개키가 클립보드에 복사됨
```

- `~/.ssh/veda_oci` (개인키) 는 **절대 공유 금지**. 서버에도 올리지 않습니다
- 개인키에 비밀번호를 걸려면 `-N ""` 를 빼고 실행하세요

---

## 3. 🌐 인스턴스 생성

콘솔 좌측 메뉴 → **컴퓨트 → 인스턴스 → 인스턴스 생성**

| 항목 | 값 |
|---|---|
| 이름 | `veda-app` |
| 이미지 | **Canonical Ubuntu 24.04** |
| Shape | "이미지 및 shape 변경" → Ampere → **VM.Standard.A1.Flex** |
| OCPU / 메모리 | **2 OCPU / 12GB** (무료 한도 4 OCPU / 24GB 내) |
| 네트워킹 | 새 VCN 생성 (기본값 그대로) |
| 퍼블릭 IPv4 주소 | **할당** |
| SSH 키 | **공개 키 붙여넣기** 선택 → ⌘V |
| 부트 볼륨 | 50GB (기본값. 무료 200GB 내) |

생성 후 **퍼블릭 IP 주소를 기록**해 둡니다.

### ⚠️ "Out of host capacity" 가 뜨면

A1은 무료 인기 shape이라 자주 막힙니다. 순서대로 시도하세요.

1. **가용성 도메인(AD-1 / AD-2 / AD-3)** 을 바꿔 재시도
2. **1 OCPU / 6GB** 로 낮춰 재시도
3. 시간대를 바꿔 재시도 (새벽에 잘 잡힙니다)
4. 1-1의 PAYG 전환을 하면 확보 확률이 올라갑니다

E2.1.Micro(1GB)는 이 스택 빌드에 메모리가 부족하니 최후의 수단으로만 쓰세요.

---

## 4. 💻 접속 확인 (Mac)

```bash
chmod 600 ~/.ssh/veda_oci
ssh -i ~/.ssh/veda_oci ubuntu@<퍼블릭IP>
```

- Ubuntu 이미지의 기본 사용자는 `ubuntu` 입니다 (root 아님)
- 접속이 안 되면: 인스턴스가 "실행 중"인지, IP가 맞는지, 키 권한이 600인지 확인

매번 옵션을 치지 않도록 등록해 둡니다.

```bash
cat >> ~/.ssh/config <<EOF

Host veda
  HostName <퍼블릭IP>
  User ubuntu
  IdentityFile ~/.ssh/veda_oci
EOF
```

이후로는 `ssh veda` 로 접속합니다.

---

## 5. 🖥 서버 기본 세팅

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit                      # 그룹 반영을 위해 반드시 재접속
```

재접속 후 확인:

```bash
docker compose version    # v2.24 이상이어야 합니다
```

---

## 6. 🖥 코드 가져오기 (배포 키 방식)

비공개 저장소라 인증이 필요합니다. **읽기 전용 배포 키**를 권합니다.

```bash
ssh-keygen -t ed25519 -C "veda-deploy" -f ~/.ssh/deploy -N ""
cat ~/.ssh/deploy.pub
```

🌐 출력된 공개키를 GitHub에 등록합니다.
저장소 → **Settings → Deploy keys → Add deploy key** → 붙여넣기
→ **"Allow write access" 는 체크하지 않습니다**

🖥 다시 서버에서:

```bash
cat >> ~/.ssh/config <<EOF
Host github.com
  IdentityFile ~/.ssh/deploy
EOF

git clone git@github.com:Ryusll/policy_manager.git ~/policy_manager
cd ~/policy_manager && git checkout develop
```

> 디렉터리 이름을 `policy_manager` 로 맞추세요. 도커 볼륨 이름이 여기서 파생되며,
> 11절의 백업 스크립트가 그 이름을 씁니다.

---

## 7. 🖥 환경설정 (.env)

서버에는 Node가 없으므로 `npm run secrets:init` 대신 openssl로 만듭니다.
**`+ / =` 문자를 걸러내는 것이 중요합니다** — DB 접속 문자열에 그대로 들어가 접속을 깨뜨립니다.

```bash
cd ~/policy_manager
cp .env.example .env

gen() { openssl rand -base64 "$1" | tr -d '+/=' | cut -c1-"$2"; }

cat >> .env <<EOF

# --- 서버 생성 ($(date +%F)) ---
JWT_SECRET=$(gen 48 60)
JWT_REFRESH_SECRET=$(gen 48 60)
POSTGRES_USER=policy_app
POSTGRES_PASSWORD=$(gen 24 30)
POSTGRES_DB=policy_manager
MINIO_ACCESS_KEY=policy_minio
MINIO_SECRET_KEY=$(gen 24 30)
SEED_DEMO_DATA=false
EOF
```

### ⚠️ `SEED_DEMO_DATA=false` 는 필수입니다

켜두면 `admin@demo.com / password123` 계정이 생깁니다. 그 값은 저장소에 그대로
적혀 있어 **공개된 것과 같습니다.** 주소를 아는 사람은 누구나 관리자로 로그인합니다.

`.env` 를 열어보면 위쪽(.env.example에서 복사된 자리)에 `SEED_DEMO_DATA=true` 가
그대로 남아 있어 헷갈립니다. **같은 키가 두 번 있으면 뒤에 있는 값이 이깁니다.**
헷갈리지 않도록 반드시 눈으로 확인하세요.

```bash
docker compose config | grep SEED_DEMO_DATA
#   SEED_DEMO_DATA: "false"   ← 이렇게 나와야 합니다
```

`PUBLIC_URL` 은 주소가 정해지는 9절에서 채웁니다.

---

## 8. 🖥 첫 배포

```bash
docker compose up -d --build
```

- ARM 2 OCPU 기준 **10~25분** 걸립니다. 파이썬(PyMuPDF) 설치가 가장 오래 걸립니다
- 진행 확인: `docker compose logs -f api`

정상 신호는 이 순서로 나옵니다.

```
[startup] migrate deploy completed.
[startup] SEED_DEMO_DATA=false -> skipping demo seed ...
[startup] Starting API server...
```

확인:

```bash
curl -s localhost/api/health
```

---

## 9. 🖥 외부 접속 — Tailscale Funnel

포트를 하나도 열지 않고 고정 https 주소를 얻습니다.
**OCI 보안 목록과 Ubuntu iptables를 건드릴 필요가 없습니다** (이 스택에서 가장 흔한 실패 지점입니다).

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

출력된 URL을 🌐 Mac 브라우저에서 열어 로그인합니다. 이어서:

```bash
sudo tailscale funnel --bg 80
sudo tailscale funnel status      # 주소 확인
```

`https://veda-app.<tailnet>.ts.net` 형태의 고정 주소가 나옵니다.

> Funnel은 tailnet 관리자 콘솔에서 기능을 켜야 할 수 있습니다. 안내 URL이 나오면 따라가면 됩니다.
> 명령 문법은 버전에 따라 다를 수 있으니 막히면 `tailscale funnel --help` 를 보세요.

🖥 주소를 `.env` 에 반영하고 재기동합니다.

```bash
sed -i 's|^PUBLIC_URL=.*|PUBLIC_URL=https://veda-app.<tailnet>.ts.net|' .env
docker compose up -d
```

---

## 10. 🌐 최초 관리자 계정 만들기

데모 시드를 껐으므로 계정이 하나도 없습니다. 조직과 관리자를 직접 만듭니다.

```bash
curl -X POST https://<주소>/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"tenantSlug":"veda","tenantName":"회사명","email":"admin@회사.com","password":"<충분히 긴 비밀번호>","name":"관리자"}'
```

로그인 화면에서 **조직 코드는 `veda`** 를 입력합니다.

> ⚠️ `/auth/register` 는 인증 없이 열려 있어 **누구나 새 조직을 만들 수 있습니다.**
> 최초 계정을 만든 뒤 차단을 검토하세요(13절).

---

## 11. 🖥 백업 (필수)

무료 티어라서 더 필요합니다.

```bash
mkdir -p ~/backups
cat > ~/backup.sh <<'EOF'
#!/bin/bash
set -euo pipefail
cd "$HOME/policy_manager"
TS=$(date +%F_%H%M)
U=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2-)
D=$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2-)
docker compose exec -T postgres pg_dump -U "$U" "$D" | gzip > "$HOME/backups/db_$TS.sql.gz"
docker run --rm \
  -v policy_manager_api_uploads:/u -v "$HOME/backups":/b \
  alpine tar czf "/b/uploads_$TS.tar.gz" -C /u .
find "$HOME/backups" -type f -mtime +14 -delete
EOF
chmod +x ~/backup.sh
~/backup.sh && ls -la ~/backups          # 한 번 돌려서 확인
( crontab -l 2>/dev/null; echo "0 3 * * * $HOME/backup.sh >> $HOME/backups/backup.log 2>&1" ) | crontab -
```

볼륨 이름이 다르면 `docker volume ls` 로 확인해 스크립트를 맞추세요.

### ⚠️ 같은 서버 안의 백업은 반쪽입니다

서버가 사라지면 백업도 같이 사라집니다. 주기적으로 Mac으로 내려받으세요.

```bash
scp veda:~/backups/db_*.sql.gz ~/Downloads/     # 💻 Mac에서
```

---

## 12. 완료 확인 체크리스트

- [ ] `https://<주소>` 접속 시 로그인 화면이 뜬다
- [ ] 10절에서 만든 관리자로 로그인된다
- [ ] 규정 목록·본문이 정상이다 (**내용이 두 번 반복되지 않는다**)
- [ ] `/api/policies/<id>/as-of?date=2026-01-01` 이 **401** 이다 (404면 옛 빌드)
- [ ] `docker compose logs api | grep "skipping demo seed"` 가 잡힌다
- [ ] `admin@demo.com / password123` 로그인이 **실패**한다
- [ ] `~/backups` 에 백업 파일이 생성됐다

---

## 13. 남은 보안 항목

| 항목 | 현재 상태 | 조치 |
|---|---|---|
| Swagger `/api/docs` | 무조건 공개 | 운영에서 비활성화 (코드 작업 필요) |
| `POST /auth/register` | 누구나 조직 생성 가능 | 최초 계정 생성 후 제한 검토 |
| 법제처 OPEN API | 새 서버 IP 미등록 | `open.law.go.kr` 에 새 IP 등록 |
| 접근 제한 | 주소를 아는 누구나 접속 | 도메인 확보 시 Cloudflare Access 검토 |

---

## 14. 자주 막히는 곳

| 증상 | 원인 | 조치 |
|---|---|---|
| 인스턴스 생성 실패 | A1 용량 부족 | AD 변경 → 사양 축소 → 시간대 변경 |
| SSH 접속 거부 | 키 권한 | `chmod 600 ~/.ssh/veda_oci` |
| 빌드 중 멈춤/OOM | 메모리 부족 | OCPU·메모리 상향 후 재빌드 |
| API가 부팅 거부 | 시크릿이 기본값 | `.env` 의 JWT/MinIO 값 확인 |
| DB 접속 실패 | 비밀번호 특수문자 | 7절의 `tr -d '+/='` 적용 여부 확인 |
| 터널 주소 접속 불가 | funnel 미기동 | `sudo tailscale funnel status` |
| 로그인 후 화면 깨짐 | PUBLIC_URL 불일치 | 9절 반영 후 `docker compose up -d` |

---

## 관련 문서

- `Runbook_배포롤백.md` — 일상 운영·롤백·시크릿 교체
- `재배포_작업지시서_2026-08-15.md` — 기존 서버 재배포용(현재는 접근 불가로 보류)
