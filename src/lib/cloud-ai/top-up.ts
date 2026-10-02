import type { TFunction } from "i18next";
import { sendMessage } from "@/entrypoints/background/messaging";
import type { AiAvailability } from "../ai-source/availability";
import type { AiFeature } from "../ai-source/source";
import { CloudAiError } from "./errors";
export async function openLensPage(data: {
	need?: number;
	have?: number;
	feature?: AiFeature;
	reason: "insufficient" | "navbar" | "settings" | "guest";
}): Promise<void> {
	await sendMessage("openLensPage", data);
}
/** Localized errors and redirects stay in the UI, so research can quietly skip an unaffordable optional action. */
export async function aiErrorMessage(
	error: unknown,
	feature: AiFeature,
	t: TFunction,
): Promise<string> {
	if (!(error instanceof CloudAiError))
		return error instanceof Error ? error.message : t("cloud.failed");
	if (error.code === "INSUFFICIENT_LENSES") {
		const need =
			typeof error.details.required === "number" ? error.details.required : 0;
		const have =
			typeof error.details.balance === "number" ? error.details.balance : 0;
		await openLensPage({ need, have, feature, reason: "insufficient" }).catch(
			() => {},
		);
		return t("cloud.insufficient", { need, have });
	}
	if (error.code === "REGISTERED_ACCOUNT_REQUIRED") {
		await openLensPage({ reason: "guest" }).catch(() => {});
		return t("cloud.guest");
	}
	const key: Record<string, string> = {
		SIGNED_OUT: "signed-out",
		AI_UNAVAILABLE: "cloud-off",
		AI_FEATURE_DISABLED: "feature-off",
		CLOUD_NOT_READY: "notReady",
		PROMPT_TOO_LARGE: "tooLarge",
		AI_RATE_LIMITED: "rateLimited",
		UPGRADE_REQUIRED: "upgrade",
		NETWORK_ERROR: "network",
		AI_CANCELLED: "cancelled",
	};
	const text = key[error.code]
		? t(`cloud.${key[error.code]}`, error.details)
		: t("cloud.failed");
	return error.details.refunded === true
		? `${text} ${t("cloud.refunded")}`
		: text;
}

/** Disabled controls still offer account creation when Cloud needs a registered reader. */
export function handleUnavailableAi(value: AiAvailability): void {
	if (!value.ok && (value.reason === "guest" || value.reason === "signed-out"))
		void openLensPage({
			reason: value.reason === "guest" ? "guest" : "settings",
		}).catch(() => {});
}
