import { defineConfig } from 'orval';
import './src/api/load-env';
import { env } from './src/api/env';

export default defineConfig({
  'storylens-api': {
    input: `${env.API_URL}/openapi.json`,
    output: {
      mode: 'tags',
      target: './src/api/endpoints',
      schemas: './src/api/schemas',
      client: 'react-query',
      httpClient: 'axios',
      biome: true,
      baseUrl: env.API_URL,
      override: {
        mutator: {
          path: './src/api/axios-instance.ts',
          name: 'customInstance',
        },
      },
    },
  },
});
