import {
	Accordion,
	Button,
	Group,
	NumberInput,
	PasswordInput,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";
import type {
	DesktopCapabilities,
	DesktopSettings,
} from "@/lib/desktop-client/types";
import { DESKTOP_SETTINGS_KEY } from "@/lib/desktop-client/types";

export function DesktopClientPanel() {
	const { t, i18n } = useTranslation();
	const [settings, setSettings] = useState<DesktopSettings>({
		port: 43127,
		token: "",
		model: "",
		effort: "",
	});
	const [catalog, setCatalog] = useState<DesktopCapabilities>();
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	useEffect(() => {
		void browser.storage.local.get(DESKTOP_SETTINGS_KEY).then((stored) => {
			const saved = stored[DESKTOP_SETTINGS_KEY] as
				| Partial<DesktopSettings>
				| undefined;
			if (saved) {
				setSettings({
					port: saved.port ?? 43127,
					token: saved.token ?? "",
					model: saved.model ?? "",
					effort: saved.effort ?? "",
				});
				if (saved.token)
					void sendMessage("desktopCapabilities")
						.then(setCatalog)
						.catch(() => {});
			}
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
	const summarize = async () => {
		if (!selected || !settings.effort) {
			setMessage(t("desktop.selectModel"));
			return;
		}
		setBusy(true);
		setMessage("");
		try {
			const [tab] = await browser.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (tab?.id === undefined || !/^https?:/.test(tab.url ?? ""))
				throw new Error(t("desktop.unsupportedPage"));
			const result = await sendMessage(
				"summarizePage",
				{
					model: settings.model,
					effort: settings.effort,
					locale: i18n.language,
				},
				{ tabId: tab.id },
			);
			setMessage(
				result.started
					? t("desktop.summaryStarted")
					: t("desktop.summaryRunning"),
			);
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : t("desktop.summaryFailed"),
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<Stack
			gap="xs"
			p="xs"
			style={{
				width: "100%",
				boxSizing: "border-box",
				borderBottom: "1px solid var(--mantine-color-default-border)",
			}}
		>
			<Group grow>
				<Button
					size="xs"
					loading={busy}
					onClick={() => {
						void summarize();
					}}
				>
					{t("desktop.summarize")}
				</Button>
			</Group>
			{message && (
				<Text size="xs" role="status">
					{message}
				</Text>
			)}
			<Accordion variant="contained">
				<Accordion.Item value="desktop">
					<Accordion.Control>{t("desktop.settings")}</Accordion.Control>
					<Accordion.Panel>
						<Stack gap="xs">
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
								value={settings.token}
								onChange={(event) =>
									setSettings({ ...settings, token: event.currentTarget.value })
								}
							/>
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
						</Stack>
					</Accordion.Panel>
				</Accordion.Item>
			</Accordion>
		</Stack>
	);
}
