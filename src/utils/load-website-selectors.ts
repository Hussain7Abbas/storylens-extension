import { WEBSITES_SELECTORS_KEY } from '@/components/node-selector/constants';
import { getConfigsByKey } from '@/api/endpoints/configs.js';

export async function loadWebsiteSelectorsValue(): Promise<string | undefined> {
  try {
    const response = await getConfigsByKey(WEBSITES_SELECTORS_KEY);
    return response.data.value;
  } catch (error) {
    console.error('Failed to load website selectors', error);
    return undefined;
  }
}
