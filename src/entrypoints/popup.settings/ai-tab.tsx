import {
	Button,
	NumberInput,
	PasswordInput,
	Select,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";
import {
	desktopSettings,
	parseDesktopSettings,
} from "@/lib/desktop-client/settings";
import type {
	DesktopCapabilities,
	DesktopSettings,
} from "@/lib/desktop-client/types";
import { DESKTOP_SETTINGS_KEY } from "@/lib/desktop-client/types";

export function AiTab() {
	const { t } = useTranslation();
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
			<Text fw={600}>{t("desktop.settings")}</Text>
			<Text size="xs">{t("desktop.disclosure")}</Text>
			<NumberInput
				label={t("desktop.port")}
				min={1024}
				max={65535}
				value={settings.port}
				onChange={(value) => setSettings({ ...settings, port: Number(value) })}
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
							const model = catalog.models.find((item) => item.id === value);
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
		</Stack>
	);
}
