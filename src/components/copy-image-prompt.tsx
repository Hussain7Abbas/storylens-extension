import { Button, Stack, Text, Textarea } from "@mantine/core";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "@/lib/analytics/client";

/** Keeps the exact submitted brief available above the form's image preview. */
export function CopyImagePrompt({ prompt }: { prompt: string }) {
	const { t } = useTranslation();
	const [copiedPrompt, setCopiedPrompt] = useState<string>();
	const [failedPrompt, setFailedPrompt] = useState<string>();
	const copied = copiedPrompt === prompt;
	const failed = failedPrompt === prompt;
	return (
		<Stack gap={4}>
			<Button
				type="button"
				size="xs"
				variant="subtle"
				style={{ alignSelf: "flex-start" }}
				leftSection={
					copied ? (
						<Check size={14} strokeWidth={1.75} aria-hidden="true" />
					) : (
						<Copy size={14} strokeWidth={1.75} aria-hidden="true" />
					)
				}
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(prompt);
						setCopiedPrompt(prompt);
						setFailedPrompt(undefined);
						trackEvent("ai_image_prompt_copied");
					} catch {
						setCopiedPrompt(undefined);
						setFailedPrompt(prompt);
					}
				}}
			>
				{t("coloring.copyImagePrompt")}
			</Button>
			<Text size="xs" role="status">
				{copied
					? t("coloring.imagePromptCopied")
					: failed
						? t("coloring.imagePromptCopyFailed")
						: ""}
			</Text>
			{failed && (
				<Textarea
					label={t("desktop.imagePrompt")}
					value={prompt}
					readOnly
					autosize
					maxRows={8}
					onFocus={(event) => event.currentTarget.select()}
				/>
			)}
		</Stack>
	);
}
