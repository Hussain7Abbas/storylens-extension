import { Anchor } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useAiSnapshot } from "@/lib/ai-source/hooks";
import { openLensPage } from "@/lib/cloud-ai/top-up";
/** Keeps a failed Cloud action's form useful even after its balance tab was closed. */
export function GetLensesLink() {
	const { t } = useTranslation();
	const { source, user } = useAiSnapshot();
	return source === "cloud" ? (
		<Anchor
			component="button"
			type="button"
			size="xs"
			onClick={() => {
				void openLensPage({ reason: user?.isGuest ? "guest" : "settings" });
			}}
		>
			{t("cloud.getLenses")}
		</Anchor>
	) : null;
}
