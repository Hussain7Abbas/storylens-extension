import { defineAppConfig } from "#imports";
import { env } from "./src/env";

declare module "wxt/utils/define-app-config" {
	export interface WxtAppConfig {
		WXT_API_URL: string;
	}
}

export default defineAppConfig({
	WXT_API_URL: env.WXT_API_URL,
});
