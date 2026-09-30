import {
	ActionIcon,
	Alert,
	Anchor,
	Badge,
	Button,
	Popover,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import {
	CloudAlert as IconCloudAlert,
	CloudCheck as IconCloudCheck,
	CloudOff as IconCloudOff,
	CloudUpload as IconCloudUpload,
	RefreshCw as IconRefresh,
} from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";
import { useRoutes } from "@/hooks/useRoutes";
import { trackEvent } from "@/lib/analytics/client";
import { useSyncStatus } from "@/lib/offline/hooks";
import { syncIndicator } from "@/lib/offline/sync/indicator";
import { websitePageUrl } from "@/lib/website";
import { localeAtom } from "@/store/locale";

const ICONS = {
	synced: IconCloudCheck,
	pending: IconCloudUpload,
	sending: IconRefresh,
	offline: IconCloudOff,
	attention: IconCloudAlert,
	paused: IconCloudAlert,
} as const;

function formatTime(
	time: number | undefined,
	locale: string,
	t: TFunction,
): string {
	if (!time) return t("sync.never");
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "short",
		timeStyle: "short",
	}).format(time);
}

/** Always-visible sync state with a popover: last sync, counts, pauses and Sync now (U8). */
export function SyncStatusButton({ t }: { t: TFunction }) {
	const status = useSyncStatus();
	const locale = useAtomValue(localeAtom);
	const queryClient = useQueryClient();
	const { push } = useRoutes();
	const [opened, setOpened] = useState(false);
	const [syncing, setSyncing] = useState(false);
	if (!status) return null;
	const indicator = syncIndicator(status);
	const Icon = ICONS[indicator.icon];
	const color =
		indicator.icon === "attention"
			? "red"
			: indicator.icon === "pending"
				? "orange"
				: "var(--mantine-color-dimmed)";

	const handleSyncNow = async () => {
		setSyncing(true);
		trackEvent("sync_manual_requested");
		try {
			const { summary, status: after } = await sendMessage("syncNow");
			await queryClient.invalidateQueries({ queryKey: ["offline"] });
			if (after.attention) {
				toast.error(
					t("sync.summaryAttention", {
						sent: summary?.sent ?? 0,
						count: after.attention,
					}),
					{ duration: 8000 },
				);
			} else if (after.pending) {
				toast(
					t("sync.summaryIncomplete", {
						sent: summary?.sent ?? 0,
						count: after.pending,
					}),
				);
			} else if (!summary?.ran || summary.state !== "idle") {
				toast(t(syncIndicator(after).message));
			} else if (summary?.failedPulls) {
				toast.error(t("sync.summaryPullFailed"));
			} else {
				toast.success(
					(summary?.sent ?? 0) > 0
						? t("sync.summaryDone", { sent: summary?.sent })
						: t("sync.summaryUpToDate"),
				);
			}
		} catch {
			toast.error(t("offline.syncFailed"));
		} finally {
			setSyncing(false);
		}
	};

	return (
		<Popover
			opened={opened}
			onChange={setOpened}
			position="bottom-end"
			withArrow
			shadow="md"
			width={260}
		>
			<Popover.Target>
				<Tooltip
					label={t(indicator.message, { count: indicator.count })}
					withArrow
					disabled={opened}
				>
					<ActionIcon
						variant="subtle"
						color={color}
						radius="sm"
						size="lg"
						pos="relative"
						aria-label={`${t("sync.title")}: ${t(indicator.message, { count: indicator.count })}`}
						loading={syncing}
						onClick={() => setOpened((value) => !value)}
					>
						<Icon strokeWidth={1.75} />
						{indicator.count > 0 && (
							<Badge
								size="xs"
								circle
								color={color === "red" ? "red" : "orange"}
								pos="absolute"
								top={-2}
								right={-2}
							>
								{indicator.count > 99 ? "99+" : indicator.count}
							</Badge>
						)}
					</ActionIcon>
				</Tooltip>
			</Popover.Target>
			<Popover.Dropdown>
				<Stack gap="xs">
					<Text size="sm" fw={600}>
						{t(indicator.message, { count: indicator.count })}
					</Text>
					<Text size="xs" c="dimmed">
						{t("sync.lastSynced", {
							time: formatTime(
								status.lastPullAt ?? status.lastPushAt,
								locale,
								t,
							),
						})}
					</Text>
					{(status.pending > 0 || status.sending > 0) && (
						<Text size="xs">
							{t("sync.counts", {
								pending: status.pending,
								sending: status.sending,
							})}
						</Text>
					)}
					{!status.online && <Text size="xs">{t("sync.offlineHint")}</Text>}
					{indicator.troubled && (
						<Alert color="orange" variant="light" p="xs">
							<Text size="xs">{t("sync.troubled")}</Text>
						</Alert>
					)}
					{indicator.action === "signIn" && (
						<Anchor
							size="xs"
							href={websitePageUrl(locale, "login/")}
							target="_blank"
							rel="noopener noreferrer"
						>
							{t("sync.signInAgain")}
						</Anchor>
					)}
					{indicator.action === "update" && (
						<Anchor
							size="xs"
							component="button"
							type="button"
							onClick={() => void browser.runtime.requestUpdateCheck?.()}
						>
							{t("sync.updateRequired")}
						</Anchor>
					)}
					{(status.attention > 0 || status.otherAccount > 0) && (
						<Anchor
							size="xs"
							component="button"
							type="button"
							c="red"
							onClick={() => {
								setOpened(false);
								push("sync");
							}}
						>
							{t("sync.needsAttention", {
								count: status.attention + status.otherAccount,
							})}
						</Anchor>
					)}
					<Button
						size="xs"
						leftSection={<IconRefresh size={14} />}
						loading={syncing}
						disabled={!indicator.canSyncNow}
						onClick={() => void handleSyncNow()}
					>
						{t("offline.syncNow")}
					</Button>
				</Stack>
			</Popover.Dropdown>
		</Popover>
	);
}
