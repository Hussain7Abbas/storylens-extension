import {
	Button,
	Divider,
	Group,
	NumberInput,
	PasswordInput,
	SegmentedControl,
	Select,
	Stack,
	Text,
	Textarea,
	Tooltip,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";
import { useAiSnapshot } from "@/lib/ai-source/hooks";
import { AI_SOURCE_KEY, type AiSource } from "@/lib/ai-source/source";
import { trackEvent } from "@/lib/analytics/client";
import {
	type AiPrompts,
	DEFAULT_AI_PROMPTS,
} from "@/lib/desktop-client/ai-prompts";
import {
	aiPrompts,
	desktopSettings,
	parseDesktopSettings,
	saveAiPrompts,
} from "@/lib/desktop-client/settings";
import type {
	DesktopCapabilities,
	DesktopSettings,
} from "@/lib/desktop-client/types";
import { DESKTOP_SETTINGS_KEY } from "@/lib/desktop-client/types";
import { CloudPanel } from "./cloud-panel";

/**
 * Editable AI instructions. Each prompt is sent first and marked as taking
 * priority over the chapter and novel context added by the extension.
 */
function AiPromptsSection() {
	const { t } = useTranslation();
	const [prompts, setPrompts] = useState<AiPrompts>(DEFAULT_AI_PROMPTS);
	const [saved, setSaved] = useState<AiPrompts>(DEFAULT_AI_PROMPTS);
	const [status, setStatus] = useState("");
	useEffect(() => {
		void aiPrompts().then((stored) => {
			setPrompts(stored);
			setSaved(stored);
		});
	}, []);
	const dirty =
		prompts.keywordPrompt !== saved.keywordPrompt ||
		prompts.imagePrompt !== saved.imagePrompt;
	const save = async () => {
		const next: AiPrompts = {
			keywordPrompt:
				prompts.keywordPrompt.trim() || DEFAULT_AI_PROMPTS.keywordPrompt,
			imagePrompt: prompts.imagePrompt.trim() || DEFAULT_AI_PROMPTS.imagePrompt,
		};
		await saveAiPrompts(next);
		setPrompts(next);
		setSaved(next);
		setStatus(t("desktop.promptsSaved"));
		trackEvent("ai_prompts_saved", {
			keyword_custom: next.keywordPrompt !== DEFAULT_AI_PROMPTS.keywordPrompt,
			image_custom: next.imagePrompt !== DEFAULT_AI_PROMPTS.imagePrompt,
		});
	};
	const field = (key: keyof AiPrompts, label: string, description: string) => (
		<Stack gap={4}>
			<Textarea
				label={label}
				description={description}
				autosize
				minRows={4}
				maxRows={12}
				value={prompts[key]}
				onChange={(event) => {
					const value = event.currentTarget.value;
					setStatus("");
					setPrompts((current) => ({ ...current, [key]: value }));
				}}
			/>
			<Tooltip label={t("desktop.resetPromptHint")} withArrow openDelay={350}>
				<Button
					size="compact-xs"
					variant="subtle"
					style={{ alignSelf: "flex-start" }}
					disabled={prompts[key] === DEFAULT_AI_PROMPTS[key]}
					onClick={() => {
						setStatus("");
						setPrompts((current) => ({
							...current,
							[key]: DEFAULT_AI_PROMPTS[key],
						}));
					}}
				>
					{t("desktop.resetPrompt")}
				</Button>
			</Tooltip>
		</Stack>
	);
	return (
		<Stack gap="xs">
			<Text fw={600}>{t("desktop.prompts")}</Text>
			<Text size="xs">{t("desktop.promptsHelp")}</Text>
			{field(
				"keywordPrompt",
				t("desktop.keywordPrompt"),
				t("desktop.keywordPromptHelp"),
			)}
			{field(
				"imagePrompt",
				t("desktop.imagePrompt"),
				t("desktop.imagePromptHelp"),
			)}
			<Group justify="space-between" gap="xs">
				<Text size="xs" role="status">
					{status}
				</Text>
				<Tooltip label={t("desktop.savePrompts")} withArrow openDelay={350}>
					<Button
						size="xs"
						disabled={!dirty}
						onClick={() => {
							void save();
						}}
					>
						{t("desktop.savePrompts")}
					</Button>
				</Tooltip>
			</Group>
		</Stack>
	);
}

export function AiTab() {
	const { t } = useTranslation();
	const { source } = useAiSnapshot();
	const [settings, setSettings] = useState<DesktopSettings>(() =>
		parseDesktopSettings(undefined),
	);
	const [catalog, setCatalog] = useState<DesktopCapabilities>();
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	useEffect(() => {
		void desktopSettings().then((saved) => {
			setSettings(saved);
			if (saved.token)
				void sendMessage("desktopCapabilities")
					.then(setCatalog)
					.catch(() => {});
		});
	}, []);
	const save = async (next: DesktopSettings) => {
		setSettings(next);
		await browser.storage.local.set({ [DESKTOP_SETTINGS_KEY]: next });
	};
	const connect = async () => {
		setBusy(true);
		setMessage("");
		try {
			await save(settings);
			const available = await sendMessage("desktopCapabilities");
			setCatalog(available);
			const selection = available.models.find(
				(item) => item.id === settings.model,
			);
			if (!selection && !settings.model) {
				const first =
					available.models.find((item) => item.provider === "claude") ??
					available.models[0];
				if (first)
					await save({
						...settings,
						model: first.id,
						effort: first.defaultEffort,
					});
			} else if (!selection) {
				await save({ ...settings, model: "", effort: "" });
				setMessage(t("desktop.modelUnavailable"));
				return;
			}
			setMessage(`${t("desktop.connected")} (${available.models.length})`);
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : t("desktop.connectionFailed"),
			);
		} finally {
			setBusy(false);
		}
	};
	const selected = catalog?.models.find((item) => item.id === settings.model);
	return (
		<Stack gap="xs" p="xs">
			<SegmentedControl
				fullWidth
				aria-label={t("cloud.source")}
				value={source}
				data={[
					{ value: "cloud", label: t("cloud.name") },
					{ value: "desktop", label: t("cloud.desktop") },
				]}
				onChange={(value) => {
					const next = value as AiSource;
					void browser.storage.local.set({ [AI_SOURCE_KEY]: next });
					trackEvent("ai_source_changed", { source: next });
				}}
			/>
			<Text size="xs">
				{t(source === "cloud" ? "cloud.cloudHelp" : "cloud.desktopHelp")}
			</Text>
			{source === "cloud" ? (
				<CloudPanel />
			) : (
				<>
					<Text fw={600}>{t("desktop.settings")}</Text>
					<Text size="xs">{t("desktop.disclosure")}</Text>
					<NumberInput
						label={t("desktop.port")}
						min={1024}
						max={65535}
						value={settings.port}
						onChange={(value) =>
							setSettings({ ...settings, port: Number(value) })
						}
					/>
					<PasswordInput
						label={t("desktop.token")}
						autoComplete="off"
						value={settings.token}
						onChange={(event) =>
							setSettings({ ...settings, token: event.currentTarget.value })
						}
					/>
					<Tooltip label={t("desktop.connect")} withArrow openDelay={350}>
						<Button
							size="xs"
							variant="light"
							loading={busy}
							onClick={() => {
								void connect();
							}}
						>
							{t("desktop.connect")}
						</Button>
					</Tooltip>
					{catalog && (
						<>
							<Select
								label={t("desktop.model")}
								searchable
								data={catalog.models.map((model) => ({
									value: model.id,
									label: `${model.provider}: ${model.label}`,
								}))}
								value={settings.model || null}
								onChange={(value) => {
									const model = catalog.models.find(
										(item) => item.id === value,
									);
									if (model)
										void save({
											...settings,
											model: model.id,
											effort: model.defaultEffort,
										});
								}}
							/>
							<Select
								label={t("desktop.effort")}
								data={(selected?.efforts ?? []).map((value) => ({
									value,
									label: value,
								}))}
								value={settings.effort || null}
								onChange={(value) => {
									if (value) void save({ ...settings, effort: value });
								}}
							/>
						</>
					)}
					{message && (
						<Text size="xs" role="status">
							{message}
						</Text>
					)}
				</>
			)}
			<Divider my="xs" />
			<AiPromptsSection />
		</Stack>
	);
}
