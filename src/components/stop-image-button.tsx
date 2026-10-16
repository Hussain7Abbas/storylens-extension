import { Button, Tooltip } from "@mantine/core";
import { Square } from "lucide-react";
import { useTranslation } from "react-i18next";

export function StopImageButton({ onStop }: { onStop: () => void }) {
	const { t } = useTranslation();
	return (
		<Tooltip label={t("coloring.stopImageHint")} withArrow openDelay={350}>
			<Button
				type="button"
				size="xs"
				variant="outline"
				onClick={onStop}
				leftSection={<Square size={14} strokeWidth={1.75} aria-hidden="true" />}
				style={{ alignSelf: "flex-start" }}
			>
				{t("coloring.stopImage")}
			</Button>
		</Tooltip>
	);
}
