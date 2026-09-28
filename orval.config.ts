import { defineConfig } from "orval";
import "./src/api/load-env";
import { env } from "./src/api/env";

// The reader API lives under `/api/user`; drop that prefix from Elysia's
// operation IDs and camel-case them as Orval does by default
// (`getApiUserKeyword-aliases` -> `getKeywordAliases`) so generated names stay
// stable. Dashboard (`Admin: …`) endpoints are not generated here.
const operationName = (operation: { operationId?: string }): string =>
	(operation.operationId ?? "")
		.replace(/^(get|post|put|patch|delete)ApiUser/, "$1")
		.replace(/-([a-z0-9])/gi, (_, letter: string) => letter.toUpperCase());

export default defineConfig({
	"storylens-api": {
		input: {
			target: `${env.WXT_API_URL}/openapi.json`,
			filters: { mode: "exclude", tags: [/^Admin: /] },
		},
		output: {
			mode: "tags",
			target: "./src/api/generated/endpoints",
			schemas: "./src/api/generated/schemas",
			client: "react-query",
			httpClient: "axios",
			biome: true,
			clean: true,
			baseUrl: env.WXT_API_URL,
			override: {
				operationName,
				mutator: {
					path: "./src/api/axios-instance.ts",
					name: "customInstance",
				},
			},
		},
	},
});
