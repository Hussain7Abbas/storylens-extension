import { ActionIcon, Button, Stack, Text, Textarea } from "@mantine/core";
import { Check, Copy, Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trackEvent } from "@/lib/analytics/client";
import classes from "./image-prompt.module.css";

/** Editable saved prompt. Copy never prepares or replaces an empty prompt. */
export function CopyImagePrompt({
	value,
	onChange,
	onBusyChange,
	disabled = false,
	readOnly = false,
	focusRequest = 0,
}: {
	value: string;
	onChange: (value: string) => void;
	onBusyChange?: (busy: boolean) => void;
	disabled?: boolean;
	readOnly?: boolean;
	focusRequest?: number;
}) {
	const { t } = useTranslation();
	const id = useId();
	const details = useRef<HTMLDetailsElement>(null);
	const input = useRef<HTMLTextAreaElement>(null);
	const [expanded, setExpanded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<{ value: string; copied: boolean }>();
	const current = result?.value === value ? result : undefined;
	useEffect(() => {
		if (!focusRequest) return;
		if (details.current) details.current.open = true;
		setExpanded(true);
		input.current?.focus();
	}, [focusRequest]);
	return (
		<details ref={details}>
			<summary>{t("desktop.imageDescription")}</summary>
			<Stack gap={4} maw="100%" mt="xs">
				<div className={classes.editor} data-expanded={expanded}>
					<Textarea
						id={id}
						ref={input}
						aria-label={t("desktop.imageDescription")}
						dir="auto"
						value={value}
						onChange={(event) => onChange(event.currentTarget.value)}
						disabled={disabled || busy}
						readOnly={readOnly}
						classNames={{ input: classes.textarea }}
						maxLength={180000}
					/>
					<ActionIcon
						type="button"
						variant="default"
						className={classes.copy}
						aria-label={t("coloring.copyImagePrompt")}
						title={t("coloring.copyImagePrompt")}
						disabled={disabled || !value.trim()}
						loading={busy}
						onClick={async () => {
							setBusy(true);
							onBusyChange?.(true);
							try {
								await navigator.clipboard.writeText(value);
								setResult({ value, copied: true });
								trackEvent("ai_image_prompt_copied");
							} catch {
								setResult({ value, copied: false });
							} finally {
								setBusy(false);
								onBusyChange?.(false);
							}
						}}
					>
						{current?.copied ? (
							<Check size={16} strokeWidth={1.75} aria-hidden />
						) : (
							<Copy size={16} strokeWidth={1.75} aria-hidden />
						)}
					</ActionIcon>
					{!expanded && (
						<div className={classes.fade}>
							<Button
								type="button"
								variant="subtle"
								size="compact-xs"
								className={classes.expand}
								aria-controls={id}
								aria-expanded={false}
								leftSection={
									<Maximize2 size={14} strokeWidth={1.75} aria-hidden />
								}
								onClick={() => setExpanded(true)}
							>
								{t("coloring.expandPrompt")}
							</Button>
						</div>
					)}
				</div>
				{expanded && (
					<Button
						type="button"
						variant="subtle"
						size="compact-xs"
						style={{ alignSelf: "flex-end" }}
						aria-controls={id}
						aria-expanded={true}
						leftSection={<Minimize2 size={14} strokeWidth={1.75} aria-hidden />}
						onClick={() => setExpanded(false)}
					>
						{t("coloring.collapsePrompt")}
					</Button>
				)}
				<Text size="xs" c="dimmed">
					{t("coloring.savedImagePromptHelp")}
				</Text>
				{current && (
					<Text size="xs" role="status">
						{t(
							current.copied
								? "coloring.imageDescriptionCopied"
								: "coloring.imageDescriptionCopyFailed",
						)}
					</Text>
				)}
			</Stack>
		</details>
	);
}
