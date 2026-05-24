import { configureApiClient } from '@/api/axios-instance';
import { env } from '@/env';

export function setupApiClient(): void {
  configureApiClient(env.WXT_API_URL);
}
