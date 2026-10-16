import { Button, Stack, Text, Textarea } from "@mantine/core";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "@/lib/analytics/client";

/** Copies a submitted brief or prepares one without starting an AI request. */
export function CopyImagePrompt({
	prompt,
	promptKey,
	disabled = false,
}: {
	prompt: string | (() => Promise<string>);
	/** Identifies the form inputs when the prompt is prepared on click. */
	promptKey?: string;
	disabled?: boolean;
}) {
	const { t } = useTranslation();
	const source = promptKey ?? prompt;
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<{
		source: typeof prompt;
		value: string;
		copied: boolean;
	}>();
	const current = result?.source === source ? result : undefined;
	const copied = current?.copied;
	const failed = current && !current.copied;
	return (
		<Stack gap={4} maw="100%">
			<Button
				type="button"
				size="xs"
				variant="default"
				disabled={disabled}
				loading={busy}
				style={{ alignSelf: "flex-start" }}
				leftSection={
					copied ? (
						<Check size={14} strokeWidth={1.75} aria-hidden="true" />
					) : (
						<Copy size={14} strokeWidth={1.75} aria-hidden="true" />
					)
				}
				onClick={async () => {
					setBusy(true);
					let value = typeof prompt === "string" ? prompt : "";
					try {
						if (typeof prompt === "function") value = await prompt();
						await navigator.clipboard.writeText(value);
						setResult({ source, value, copied: true });
						trackEvent("ai_image_prompt_copied");
					} catch {
						setResult({ source, value, copied: false });
					} finally {
						setBusy(false);
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
			{failed && current.value && (
				<Textarea
					label={t("desktop.imagePrompt")}
					value={current.value}
					readOnly
					autosize
					maxRows={8}
					onFocus={(event) => event.currentTarget.select()}
				/>
			)}
		</Stack>
	);
}
