import { defineAppConfig } from "#imports";

declare module "wxt/utils/define-app-config" {
	export interface WxtAppConfig {
		WXT_API_URL: string;
	}
}

export default defineAppConfig({
	WXT_API_URL: import.meta.env.WXT_API_URL,
});
