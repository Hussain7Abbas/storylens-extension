import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	runtimeEnv: import.meta.env,
	emptyStringAsUndefined: true,
	clientPrefix: "WXT_",

	client: {
		WXT_API_URL: z.coerce.string(),
		// Google Analytics 4 is disabled unless both values are set.
		WXT_GA_MEASUREMENT_ID: z.string().optional(),
		WXT_GA_API_SECRET: z.string().optional(),
	},
});
