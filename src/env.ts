import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	runtimeEnv: import.meta.env,
	emptyStringAsUndefined: true,
	clientPrefix: "WXT_",

	client: {
		WXT_API_URL: z.coerce.string(),
	},
});
