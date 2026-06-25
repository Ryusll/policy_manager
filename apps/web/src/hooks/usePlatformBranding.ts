import { useQuery } from '@tanstack/react-query';
import { platformBrandingApi } from '../api/platformBranding';

export function usePlatformBranding() {
  return useQuery({
    queryKey: ['platform-branding'],
    queryFn: () => platformBrandingApi.get(),
    staleTime: 5 * 60 * 1000,
  });
}
