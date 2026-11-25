---
paths:
  - "apps/web/src/**/*.{ts,tsx,css}"
---

# 화면 (React)

- 화면 문구는 `apps/web/src/i18n/messages.ts`에 키로 등록하고 컴포넌트에 직접 쓰지 않는다. 같은 대상을 다른 이름으로 부르지 않는다.
- 서버 상태는 TanStack Query, 클라이언트·영속 상태는 zustand에 둔다. 서버 응답을 zustand에 복사하지 않는다(개발컨벤션 3절).
- 사용자 데이터를 조회하는 화면은 `PrivateRoute` 아래에 둔다. 로그아웃·다른 사용자 로그인 때 `lib/sessionReset.ts`가 캐시를 비우는데, 라우트 밖 화면은 내려가지 않아 앞 사용자의 결과를 계속 그린다(T-181). API 호출은 `api/client.ts`를 거친다 — 앞 사용자 요청을 끊고 결과를 버리는 것은 그 인터셉터가 한다. 떠나기 전 확인(`beforeunload`)은 붙이지 않는다 — 다른 탭 전환 때의 새로 열기를 막는다(`lib/authScope.ts`).
- 로딩·빈 상태·오류는 `components/ui`의 `LoadingBlock`·`EmptyState`·toast로 보여 준다. 오류 문구에는 사용자가 무엇을 하면 되는지 쓴다.
- 역할별 접근은 `App.tsx`의 `PrivateRoute`와 맞춘다. 서버도 막아야 한다 — 화면에서 숨기는 것만으로는 권한이 아니다.
- 색은 Tailwind 유틸리티와 기존 토큰(`navy-*`, `gold-*`, `.btn-*`)을 쓰고 임의 색을 하드코딩하지 않는다.
- 오래 걸리는 동작은 진행 중임을 보이고, 끝나기 전에 같은 동작을 다시 누를 수 없게 한다.
- 화면을 바꾸면 실제 Chrome에서 그 화면을 열어 확인한다. 새 화면이나 큰 구성 변경은 구성안을 사용자에게 먼저 보인다.
