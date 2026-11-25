#!/usr/bin/env bash
# 서버에서 사용자 비밀번호를 직접 재설정한다.
# 화면의 "비밀번호 재설정"은 로그인한 다른 관리자가 필요하다. 조직의 마지막 관리자가
# 비밀번호를 잊었을 때만 이 스크립트를 쓴다. 비밀번호는 입력을 화면·셸 기록에 남기지 않는다.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG="${1:?사용법: bash scripts/oracle/reset-password.sh <조직코드> <이메일>}"
EMAIL="${2:?사용법: bash scripts/oracle/reset-password.sh <조직코드> <이메일>}"
read -rs -p "새 비밀번호 (8자 이상): " PW; echo
read -rs -p "한 번 더: " PW2; echo
[ "$PW" = "$PW2" ] || { echo '두 값이 다릅니다.' >&2; exit 1; }

printf '%s' "$PW" | bash "$SCRIPT_DIR/compose.sh" exec -T \
  -e RESET_SLUG="$SLUG" -e RESET_EMAIL="$EMAIL" api node -e '
let pw = "";
process.stdin.on("data", (c) => (pw += c));
process.stdin.on("end", async () => {
  const { PrismaClient } = require("@prisma/client");
  const bcrypt = require("bcrypt");
  const prisma = new PrismaClient();
  try {
    if (pw.length < 8) throw new Error("비밀번호는 8자 이상이어야 합니다.");
    if (Buffer.byteLength(pw, "utf8") > 72) throw new Error("비밀번호가 72바이트를 넘습니다(한글은 글자당 3바이트).");
    const slug = process.env.RESET_SLUG.trim().toLowerCase();
    const email = process.env.RESET_EMAIL.trim().toLowerCase();
    const user = await prisma.user.findFirst({ where: { email, tenant: { slug } } });
    if (!user) throw new Error("해당 조직·이메일의 사용자가 없습니다.");
    await prisma.user.update({
      where: { id: user.id },
      // 다른 사람이 정한 비밀번호다 — 본인이 다음 로그인 때 바꾸게 한다(T-122)
      data: { passwordHash: await bcrypt.hash(pw, 10), refreshToken: null, mustChangePassword: true },
    });
    await prisma.auditLog.create({
      data: { tenantId: user.tenantId, action: "user.password_reset", entityType: "user", entityId: user.id, details: { via: "server-script" } },
    });
    console.log("재설정 완료: " + user.email + " (모든 기기에서 로그아웃됩니다. 다음 로그인 때 비밀번호를 바꾸게 됩니다)");
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
});
'
