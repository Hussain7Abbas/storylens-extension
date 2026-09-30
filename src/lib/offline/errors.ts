import type { TFunction } from "i18next";
import {
	NotSignedIn,
	PermissionDenied,
	StorageUnavailable,
	ValidationFailed,
} from "@/lib/offline/outbox";

/** A localized message for a change `enqueue` refused; nothing was written. */
export function offlineErrorMessage(error: unknown, t: TFunction): string {
	if (error instanceof StorageUnavailable)
		return t("offline.storageUnavailable");
	if (error instanceof NotSignedIn) return t("offline.errors.notSignedIn");
	if (error instanceof PermissionDenied) return t("offline.errors.permission");
	if (error instanceof ValidationFailed)
		return t(`offline.errors.${error.code}`, {
			defaultValue: t("offline.errors.invalid"),
		});
	return error instanceof Error ? error.message : String(error);
}
