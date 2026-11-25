import { QueryClient } from '@tanstack/react-query';
import { installSessionReset } from './sessionReset';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30000 },
  },
});

// 로그아웃·다른 사용자 로그인 때 앞 사용자의 응답이 다음 사용자에게 보이지 않게(T-181)
installSessionReset(queryClient);
