import {
	Button,
	Group,
	NumberInput,
	PasswordInput,
	SegmentedControl,
	Select,
	Stack,
	Switch,
	Text,
	Tooltip,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { AiPrice } from "@/components/lens/ai-price";
import { sendMessage } from "@/entrypoints/background/messaging";
import { useAiSnapshot } from "@/lib/ai-source/hooks";
import type { AiSource } from "@/lib/ai-source/source";
import { saveAiSource } from "@/lib/ai-source/storage";
import { trackEvent } from "@/lib/analytics/client";
import { AUTO_CHAPTER_CONTEXT_KEY } from "@/lib/chapter-context/prompt";
import { AUTO_CHAPTER_COVER_KEY } from "@/lib/chapter-cover/types";
import {
	desktopSettings,
	parseDesktopSettings,
} from "@/lib/desktop-client/settings";
import type {
	DesktopCapabilities,
	DesktopSettings,
} from "@/lib/desktop-client/types";
import { DESKTOP_SETTINGS_KEY } from "@/lib/desktop-client/types";
import { CloudPanel } from "./cloud-panel";

export function AiTab() {
	const { t } = useTranslation();
	const { source, imageSource, loaded } = useAiSnapshot();
	const [settings, setSettings] = useState<DesktopSettings>(() =>
		parseDesktopSettings(undefined),
	);
	const [catalog, setCatalog] = useState<DesktopCapabilities>();
	const [autoCover, setAutoCover] = useState(false);
	const [autoContext, setAutoContext] = useState(false);
	const [autoLoaded, setAutoLoaded] = useState(false);
	useEffect(() => {
		void browser.storage.local
			.get([AUTO_CHAPTER_COVER_KEY, AUTO_CHAPTER_CONTEXT_KEY])
			.then((stored) => {
				setAutoCover(stored[AUTO_CHAPTER_COVER_KEY] === true);
				setAutoContext(stored[AUTO_CHAPTER_CONTEXT_KEY] === true);
				setAutoLoaded(true);
			});
	}, []);
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
			<Text fw={600}>{t("cloud.textSource")}</Text>
			<SegmentedControl
				fullWidth
				aria-label={t("cloud.textSource")}
				disabled={!loaded}
				value={source}
				data={[
					{ value: "cloud", label: t("cloud.name") },
					{ value: "desktop", label: t("cloud.desktop") },
				]}
				onChange={(value) => {
					const next = value as AiSource;
					void saveAiSource(next, "text");
					trackEvent("ai_source_changed", { source: next });
				}}
			/>
			<Text size="xs">
				{t(source === "cloud" ? "cloud.cloudHelp" : "cloud.desktopHelp")}
			</Text>
			<Select
				label={t("cloud.imageSource")}
				description={t("cloud.imageSourceHelp")}
				value={imageSource}
				disabled={!loaded}
				allowDeselect={false}
				data={[
					{ value: "cloud", label: t("cloud.name") },
					{ value: "desktop", label: t("cloud.desktopImages") },
				]}
				onChange={(value) => {
					if (value !== "cloud" && value !== "desktop") return;
					void saveAiSource(value, "image");
					trackEvent("ai_image_source_changed", { source: value });
				}}
			/>
			{(source === "cloud" || imageSource === "cloud") && <CloudPanel />}
			{(source === "desktop" || imageSource === "desktop") && (
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
					{catalog && source === "desktop" && (
						<>
							<Select
								label={t("cloud.textModel")}
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
			<Switch
				label={
					<Group gap="xs">
						<span>{t("desktop.autoChapterContext")}</span>
						<AiPrice feature="chapter_context" />
					</Group>
				}
				description={t("desktop.autoChapterContextHelp")}
				checked={autoContext}
				disabled={!autoLoaded}
				onChange={(event) => {
					const enabled = event.currentTarget.checked;
					setAutoContext(enabled);
					void browser.storage.local.set({
						[AUTO_CHAPTER_CONTEXT_KEY]: enabled,
					});
					trackEvent("ai_auto_chapter_context_changed", { enabled });
				}}
			/>
			<Switch
				label={t("desktop.autoChapterCover")}
				description={t("desktop.autoChapterCoverHelp")}
				checked={autoCover}
				disabled={!autoLoaded}
				onChange={(event) => {
					const enabled = event.currentTarget.checked;
					setAutoCover(enabled);
					void browser.storage.local.set({ [AUTO_CHAPTER_COVER_KEY]: enabled });
					trackEvent("ai_auto_chapter_cover_changed", { enabled });
				}}
			/>
		</Stack>
	);
}
