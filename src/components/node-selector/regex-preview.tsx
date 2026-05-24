import { Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { RegexPreviewResult } from "@/utils/selector-preview";

interface RegexPreviewProps {
	result: RegexPreviewResult;
	type?: "xpath" | "regex";
}

export function RegexPreview({ result, type = "regex" }: RegexPreviewProps) {
	const { t } = useTranslation();

	if (result.status === "idle") {
		return null;
	}

	if (result.status === "match") {
		return (
			<Text size="xs" c="teal" fw={500} style={{ wordBreak: "break-word" }}>
				{result.value}
			</Text>
		);
	}

	const message =
		result.status === "invalid-regex"
			? t("nodeSelector.regexInvalid", {
					defaultValue: "Invalid regex pattern",
				})
			: type === "xpath"
				? t("nodeSelector.xpathNoMatch", {
						defaultValue: "XPath did not match any element",
					})
				: t("nodeSelector.regexNoMatch", { defaultValue: "No match found" });

	return (
		<Text size="xs" c="red" fw={500}>
			{message}
		</Text>
	);
}
