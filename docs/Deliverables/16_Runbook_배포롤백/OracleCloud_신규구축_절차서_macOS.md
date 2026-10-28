# Oracle Cloud 신규 구축 — macOS / Ubuntu 24.04

## 실제 구축 상태 — 2026-10-01 구축, 2026-10-07 갱신

현재 회사 서버는 **Caddy HTTPS → 루프백 Nginx → API** 구성을 사용한다. 아래의 기존 Tailscale 절차(4·6절)는 이 서버에 적용하지 않는다.

- 회사 tenancy: `hsyoo914`, 홈 리전: `ap-chuncheon-1` (춘천)
- Compartment: `Regulation-System`, 인스턴스: `veda-app`
- Ubuntu 24.04 ARM64 / A1 2 OCPU / 메모리 12GB / 부트 볼륨 50GB
- 새 공인 IP: `<서버IP>`, 소스: `/home/ubuntu/policy_manager`
- 공개 URL: `https://veda.<서버IP>.sslip.io`
- 2026-10-01 19:54 KST 공개 검증 완료. Let's Encrypt 인증서 발급, HTTP→HTTPS 308 전환, 웹/정적 파일/헬스 200, 관리자 로그인 및 인증 API 200, 미인증 API 401, Swagger 404, 데모 로그인 거부를 확인했다.
- 앱 로그인: 조직 코드 `veda`, 이메일 `<관리자이메일>`. 최초 생성한 앱 비밀번호는 Mac의 `~/.oci/veda-production/app-login.json`에 보관되어 있으며 OCI 로그인 비밀번호와 별개다.
- SSH: `ssh -i ~/.ssh/veda_oci ubuntu@<서버IP>` (OCI SSH 허용 원본 `<허용원본IP>/32`)
- 최초 설치: `INSTALL_TAILSCALE=false bash scripts/oracle/bootstrap.sh`
- HTTPS 설정: OCI TCP 80/443를 먼저 개방한 후 `bash scripts/oracle/setup-https.sh veda.<서버IP>.sslip.io` 실행. 포트를 열기 전에 반복 발급하면 인증기관의 실패 횟수 제한에 걸릴 수 있다.
- Caddy는 Ubuntu 저장소의 서명된 패키지를 사용한다. Cloudsmith 저장소는 설치 시 만료된 서명 오류가 있어 사용하지 않았다.
- Caddy 설정: `/etc/caddy/Caddyfile`; 상태: `sudo systemctl status caddy`; 로그: `sudo journalctl -u caddy`
- 운영 시크릿·로그인 정보·리소스 기록의 Mac 보관 위치: `~/.oci/veda-production/` (디렉터리 700, 시크릿 파일 600)
- 백업: 매일 한국시간 03:00(최대 2분 분산)에 `veda-backup.timer`가 `scripts/oracle/backup-oci.py`를 실행한다. DB/첨부 일관성을 위해 웹/API를 잠시 정지한 후 자동 기동한다. 수동 배포와 동시에 실행하지 않는다.
- 비공개 Object Storage 버킷: `veda-regulation-backups`, `daily/` 접두사, 14일 보관. 서버 Instance Principal에 이 버킷 접근만 허용하며 별도의 사용자 API 키는 저장하지 않는다.
- 백업에 DB·첨부·`.env.oracle`이 포함된다. 업로드 후 다시 내려받아 SHA256을 대조하고 완료 표식을 기록한다. 외부 백업을 임시 DB에 복원하여 관리자 데이터 복구까지 검증했다.
- 무료 범위 여유를 위해 전용 백업 버킷을 5 GiB까지로 제한하며 초과 시 새 업로드를 중단한다. 성공한 로컬 자동 백업은 최근 7개를 유지한다. Mac 최초 백업 사본도 `~/.oci/veda-production/backups/`에 보관했다.
- 백업 상태: `systemctl list-timers veda-backup.timer`; 실행 로그: `sudo journalctl -u veda-backup.service`; 수동 백업: `sudo systemctl start veda-backup.service`.
- 백업 SDK: `~/.local/share/veda-backup-venv/`의 `oci==2.187.0`; 버킷 설정: `~/.config/veda-backup.json`. 새 서버로 복구할 때는 Instance Principal 동적 그룹의 인스턴스 OCID도 갱신해야 한다.
- 관리자 로그인, 규정 조회, 한글 PDF(10,860바이트), 첨부 업로드·다운로드 검증 통과. 검증용 규정·첨부는 삭제했다.
- 실제 백업을 임시 DB에 복원하여 관리자 데이터 복구를 확인하고 임시 DB를 삭제했다. 서버 재부팅 후 Docker·Caddy 및 네 서비스의 자동 기동/헬스 검증도 통과했다.
- 법제처 인증값(`LAW_GO_KR_OC`)은 2026-10-07에 로컬과 같은 값으로 설정했다. 이 서버 IP에서 법제처 검색이 성공하는 것을 서버와 API 컨테이너 안에서 각각 확인했다(추가 IP 등록이 필요 없는 상태). Google OAuth는 로컬에서도 쓰지 않아 운영도 비워 둔다.
- 2026-10-07 07:35 KST 재배포: 10-01 배포 이후 커밋된 T-113(사용자 정보 수정)·T-114(비밀번호 변경·재설정)를 반영했다. 조직의 마지막 관리자가 비밀번호를 잊었을 때 쓰는 `scripts/oracle/reset-password.sh`도 이때 들어갔다(사용법은 [Runbook_배포롤백](Runbook_배포롤백.md)). 배포 후 서버 소스가 커밋된 최신 코드와 파일 단위로 일치하고, 공개 주소 헬스·웹 200, Swagger 404, 새 API 경로(미인증 401)를 확인했다.
- 2026-10-07 재배포의 되돌리기 자료(서버): 배포 직전 DB·첨부 백업 `backups/oracle/20261006T223440Z.8xYQlt`, 배포 전 소스 `~/policy_manager-src-before-20261006T223239Z.tar.gz`, 인증값 넣기 전 설정 `.env.oracle.bak-20261006T223207Z`(권한 600). 이번 배포에는 DB 스키마 변경이 없었으므로 이전 소스로 다시 배포하는 것만으로 되돌릴 수 있다.

회사 도메인을 연결할 때는 DNS A 레코드를 새 IP로 설정하고 `.env.oracle`의 `PUBLIC_URL`과 Caddy 호스트명을 함께 변경한 뒤 앱을 재배포한다. OAuth 사용 시 콜백 URL도 변경해야 한다.

---

갱신: 2026-09-26. 클로드 01 세션에서 정한 **새 Oracle A1 서버 + Docker Compose + Tailscale Funnel** 방식의 실행 절차입니다. 기존 타사 서버는 대상이 아닙니다.

## 1. 이번에 준비된 구성

- 운영 파일: `docker-compose.oracle.yml`, `.env.oracle` (개발 `.env`와 분리)
- 서비스: PostgreSQL 15, Redis 7, API(Node 22), 웹(Nginx)
- 외부 접속: Tailscale Funnel HTTPS → 서버 `127.0.0.1:8080` → 웹 → API
- DB·Redis·API의 호스트 포트 없음. 데모 시드와 Swagger 비활성화
- 새 DB는 Prisma migration으로 생성. 실패 시 운영에서는 자동 baseline을 수행하지 않음
- 첨부파일은 `api_uploads` 볼륨에 저장. 현재 사용하지 않는 MinIO 서버는 제외
- 서버 Node 설치 불필요. 설치·환경 생성·빌드·상태 검증·백업 스크립트 제공

`docker compose`만 실행하면 개발 구성이 선택됩니다. 운영에서는 항상 **`bash scripts/oracle/compose.sh`**를 사용하세요. 운영 프로젝트명은 `policy-manager-oracle`로 고정되므로 디렉터리명에 따라 볼륨이 달라지지 않습니다.

## 2. Oracle 콘솔에서 할 일

이미 계정이 있으므로 [Oracle 콘솔](https://cloud.oracle.com)에 로그인합니다.

| 항목 | 설정 |
|---|---|
| 인스턴스 이름 | `veda-app` |
| 이미지 | Canonical Ubuntu 24.04 |
| Shape | VM.Standard.A1.Flex |
| CPU / 메모리 | 2 OCPU / 12GB |
| 부트 볼륨 | 50GB부터 시작 |
| 네트워크 | 인터넷 게이트웨이가 있는 퍼블릭 서브넷, 퍼블릭 IPv4 할당 |
| SSH | 아래 공개키 등록, TCP 22는 관리자의 공인 IP에서 허용 |
| 웹 / DB 인바운드 | 추가 개방 불필요. 서버의 인터넷 아웃바운드는 허용 |

**비용은 생성 화면의 Always Free 적격 표시와 계정 전체 사용량으로 확인합니다.** 이전 답변의 “4 OCPU/24GB 무료”, “PAYG이면 회수 제외”, “7일 접속 없으면 회수”를 보장으로 사용하지 마세요. 현재 공식 문서는 A1 무료 사용량을 월 1,500 OCPU 시간 / 9,000GB 시간(상시 약 2 OCPU / 12GB)으로 안내하며, 유휴 판정은 접속 여부가 아니라 CPU·네트워크·메모리 사용률 기준입니다. PAYG 전환은 계정 관리자가 결정하고, 예산 알림은 지출을 차단하지 않습니다. [Oracle Always Free 공식 문서](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

용량 부족이면 홈 리전 내 다른 가용성 도메인(제공되는 경우), 작은 사양, 나중에 재시도를 검토합니다.

## 3. Mac: SSH 키와 배포 묶음

기존 키가 없을 때만 생성합니다. 개인키는 Mac에 두고 공개키만 콘솔에 등록합니다.

```bash
test -f ~/.ssh/veda_oci || ssh-keygen -t ed25519 -C veda-oci -f ~/.ssh/veda_oci
pbcopy < ~/.ssh/veda_oci.pub
```

서버 생성 후 공인 IP로 접속합니다.

```bash
ssh -i ~/.ssh/veda_oci ubuntu@<새서버IP>
```

현재 작업 폴더의 변경사항까지 서버에 옮기려면 Mac에서:

```bash
cd ~/Develop/policy_manager-main
python3 scripts/oracle/package.py /tmp/veda-oracle.tar.gz
scp -i ~/.ssh/veda_oci /tmp/veda-oracle.tar.gz ubuntu@<새서버IP>:~/
```

압축에는 배포 소스와 운영 환경 **예제**만 들어갑니다. `.env`, 개인키, `node_modules`, 로컬 Docker override는 제외합니다. 같은 출력 파일이 있으면 덮어쓰지 않으므로 새 파일명을 사용하세요. GitHub에 커밋·푸시하지 않은 최신 작업도 포함됩니다.

서버에서:

```bash
tar xzf ~/veda-oracle.tar.gz -C ~
cd ~/policy_manager
bash scripts/oracle/bootstrap.sh
exit
```

SSH로 재접속한 뒤 `docker compose version`을 확인합니다. 설치 스크립트는 [Docker 공식 apt 저장소](https://docs.docker.com/engine/install/ubuntu/)와 [Tailscale 공식 패키지 저장소](https://pkgs.tailscale.com/stable/)를 사용합니다. Compose는 `up --wait`를 지원하는 버전이 필요합니다.

이미 배포 변경이 GitHub에 올라갔다면, 읽기 전용 Deploy key로 저장소를 clone해도 됩니다. 로컬 변경은 push하기 전까지 clone에 포함되지 않습니다.

## 4. 서버: Tailscale 로그인과 주소 확인

```bash
sudo tailscale up --hostname=veda-app
```

출력되는 로그인 URL을 Mac 브라우저에서 열어 로그인합니다. 실제 할당된 호스트명을 확인합니다.

```bash
tailscale status --json | python3 -c 'import json,sys; print("https://" + json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'
```

`https://veda-app.<tailnet>.ts.net`처럼 나온 **실제 주소**를 다음 단계에 사용합니다. 아직 Funnel로 앱을 공개하지 않은 상태입니다.

## 5. 서버: 운영 환경 생성과 첫 배포

```bash
cd ~/policy_manager
python3 scripts/oracle/init-env.py https://<실제할당주소>.ts.net
# 선택: Google OAuth, 법제처 OC, 회사 표기는 nano .env.oracle 로 입력
bash scripts/oracle/deploy.sh
```

- 시크릿은 서로 다른 난수로 생성되며 파일 권한은 600입니다. 기존 `.env.oracle`은 덮어쓰지 않습니다.
- DB 비밀번호를 나중에 파일에서만 변경하면 기존 DB와 불일치하므로 임의 재생성하지 마세요.
- 로컬의 LAW_GO_KR_OC/Google 자격증명을 자동 복사하지 않습니다. 운영에 쓸 값을 직접 입력합니다.
- Google OAuth redirect URI: `PUBLIC_URL` + `/api/auth/google/callback`
- 새 서버에서 법제처 검색을 한 번 돌려 봅니다. `사용자 정보 검증에 실패`가 나올 때만 법제처에 서버 IP를 등록합니다(지금 서버는 등록 없이 통과했고, "API인증키관리" 화면에는 IP 칸이 없습니다).

`deploy.sh`는 운영값 검사 → 순차 이미지 빌드 → DB/Redis 이미지 준비 → 기존 서버라면 쓰기 중지와 백업 → 서비스 기동 → HTTP 검증을 수행합니다. 최초 빌드는 네트워크와 사양에 따라 수 분 이상 걸립니다.

완료 메시지:

```text
검증 통과: 웹 200 / API 헬스 200 / 미인증 규정 조회 401 / Swagger 404
```

## 6. 서버: 최초 조직 생성 후 HTTPS 공개

데모 계정은 생성되지 않습니다. 공개 전에 서버 내부에서 첫 관리자를 등록합니다. 아래 명령은 비밀번호를 화면이나 셸 기록에 남기지 않습니다.

```bash
python3 -c '
import getpass, json, urllib.request
payload = {
    "tenantSlug": input("조직 코드 (예: veda): "),
    "tenantName": input("회사명: "),
    "email": input("관리자 이메일: "),
    "name": input("관리자 이름: "),
    "password": getpass.getpass("관리자 비밀번호: "),
}
req = urllib.request.Request("http://127.0.0.1:8080/api/auth/register",
    data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req) as res:
    print("조직 생성 완료:", res.status)
'
sudo tailscale funnel --bg http://127.0.0.1:8080
sudo tailscale funnel status
```

Funnel은 인터넷에 공개하는 기능입니다. Tailnet의 Funnel/HTTPS/MagicDNS 허용이 필요할 수 있으며 CLI가 보여주는 안내를 따릅니다. 앱의 신규 조직 등록 기능은 유지됩니다. [Funnel 공식 명령 문서](https://tailscale.com/docs/reference/tailscale-cli/funnel)

Mac에서 실제 주소로 웹 로그인과 `/api/health`를 확인합니다. Funnel은 호스트명이 유지되는 동안 같은 주소를 사용합니다. 호스트명이나 tailnet 이름이 바뀌면 `.env.oracle`의 PUBLIC_URL도 변경 후 재배포하세요.

## 7. 백업

DB와 첨부파일을 함께 백업해야 합니다. 배포 전 로컬 백업은 자동으로 `backups/oracle/<스탬프>/`에 생깁니다. 수동 실행:

```bash
bash scripts/oracle/backup-local.sh
```

`db.sql.gz`, `uploads.tar.gz`, `COMPLETE`가 모두 있어야 완료된 백업입니다. 중요한 수동 백업은 작업자가 편집하지 않는 시간에 실행합니다. 배포 스크립트는 웹/API를 중지한 상태에서 백업합니다. `.env.oracle`도 별도의 비밀번호 관리 도구 등에 보관하세요.

서버 소실에도 대비하려면 Oracle Object Storage 등에 **비공개 버킷**을 만들고, 해당 버킷에 읽기·쓰기 권한이 있는 **Customer Secret Key(S3용)**를 생성합니다. `.env.oracle`에 입력:

```dotenv
BACKUP_S3_ENDPOINT=https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
BACKUP_S3_BUCKET=<비공개버킷이름>
BACKUP_S3_ACCESS_KEY=<S3접근키>
BACKUP_S3_SECRET_KEY=<S3시크릿>
BACKUP_S3_REGION=ap-seoul-1
BACKUP_S3_PREFIX=policy-manager-oracle
```

리전은 실제 버킷 리전으로 바꿉니다. 스크립트는 컨테이너의 공식 AWS CLI로 S3 호환 API를 호출합니다. 업로드 후 크기를 확인하고, SHA256SUMS를 마지막에 올려 완료 표시로 사용합니다. [Oracle S3 호환 API 설정](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi_topic-Amazon_S3_Compatibility_API_Support.htm)

```bash
bash scripts/oracle/backup-offsite.sh
# 출력된 스탬프를 넣어 해시·첨부 압축·임시 DB 복원까지 검증
bash scripts/oracle/backup-offsite.sh --verify <백업스탬프>
```

검증은 임시 DB에서 수행하며 운영 DB를 덮어쓰지 않습니다. 저장소 자격증명이 없는 상태에서는 업로드/복원 검증이 완료된 것으로 간주하지 않습니다.

`crontab -e`에 한 번만 추가(서버 시간 기준):

```cron
0 3 * * * cd /home/ubuntu/policy_manager && bash scripts/oracle/backup-offsite.sh >> /home/ubuntu/policy-backup.log 2>&1
```

보관 기간은 버킷 수명주기 규칙으로 설정하세요(예: 해당 접두사의 객체를 30일 후 삭제). 로컬 백업은 자동 삭제하지 않으므로, 외부 복원 검증 후 오래된 묶음을 정리합니다. 서버 내부에만 있는 백업은 서버 소실에 대응하지 못합니다.

## 8. 상태 확인 / 재배포 / 복구

```bash
bash scripts/oracle/compose.sh ps
bash scripts/oracle/compose.sh logs --tail=100 api
bash scripts/oracle/smoke.sh
# 새 소스를 같은 디렉터리에 반영한 후
bash scripts/oracle/deploy.sh
```

재배포는 잠깐의 서비스 중단이 있습니다. `.env.oracle`과 프로젝트명을 유지해야 같은 볼륨을 사용합니다. `down -v`는 데이터를 삭제하므로 사용하지 않습니다.

배포 실패 시 API 로그와 `backups/oracle`의 직전 백업을 먼저 확인합니다. 이전 소스/이미지와 현재 DB 스키마가 호환될 때만 이전 버전을 빌드해 다시 올립니다. 스키마까지 복구해야 한다면 서비스를 중지하고 검증된 DB와 첨부 백업을 함께 복원해야 합니다. 자동 baseline이나 `db push --accept-data-loss`로 오류를 넘기지 않습니다.

## 9. 완료 확인

- [ ] 실제 HTTPS 주소에서 웹과 API가 열린다
- [ ] 새 조직 관리자로 로그인된다
- [ ] 규정 조회·첨부 업로드·PDF 출력이 동작한다
- [ ] 기본 데모 관리자 로그인은 실패한다
- [ ] `/api/docs`는 404, 미인증 `/api/policies`는 401이다
- [ ] 새 서버에서 법제처 검색이 되는지와 Google OAuth redirect URI를 확인했다(사용 시)
- [ ] 외부 백업 업로드와 `--verify` 임시 복원이 성공했다
- [ ] 새 서버 재부팅 후 Docker와 Funnel이 다시 서비스한다

## 10. 설정 작성 시 검증 기록 (2026-09-26)

- 별도 ARM64 Docker 프로젝트에서 API/웹 이미지 빌드, 빈 DB migration, 최초 기동 및 재배포 성공
- 운영 설정 회귀 테스트 5개, 기존 단위 테스트 395개, 인증·규정·첨부·HWPX 통합 테스트 34개 통과
- TypeScript 타입 검사와 변경한 API 파일의 lint 통과
- 로컬 DB/첨부 백업 생성, 재배포 후 사용자 유지, 기본 데모 관리자 미생성 확인
- 외부 백업 흐름은 모의 S3와 실제 임시 PostgreSQL 복원으로 검증: 크기·해시 검증 및 손상된 백업 거부
- 실제 Oracle 서버 설치, Funnel 공개 HTTPS, 실제 Object Storage 업로드는 서버/계정 설정 후 확인 필요
- 전체 로컬 lint에는 기존 임시 파일 `__law.mjs`, `__law2.mjs`, `__law3.mjs`의 오류 6건이 남아 있음. 이 파일들은 배포 묶음에서 제외
