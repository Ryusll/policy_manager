import client from './client';

export const integrationsApi = {
  getApiAccess: () => client.get('/integrations/api-access').then((r) => r.data),
};
