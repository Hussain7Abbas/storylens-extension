import {
	ActionIcon,
	Alert,
	Button,
	Container,
	Group,
	Menu,
	Modal,
	Select,
	Skeleton,
	Stack,
	Tabs,
	Text,
	Tooltip,
} from "@mantine/core";
import type { TFunction } from "i18next";
import { useAtom, useAtomValue } from "jotai";
import {
	Check as IconCheck,
	CloudDownload as IconCloudDownload,
	EllipsisVertical as IconDotsVertical,
	SquarePen as IconEdit,
	Link as IconLink,
	Pencil as IconPencil,
	Plus as IconPlus,
	Trash2 as IconTrash,
} from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { usePutNovelsById } from "@/api/generated/endpoints/novels.js";
import { getWebsiteSelectorsByWebsite } from "@/api/generated/endpoints/website-selectors.js";
import { sendMessage } from "@/entrypoints/background/messaging";
import { userAccessAtom } from "@/lib/auth";
import {
	useCachedNovelsList,
	useDownloadedNovelIds,
	useDownloadedNovelsList,
	useNovelBiases,
	useOnlineStatus,
} from "@/lib/offline/hooks";
import { useLanguage } from "@/store/locale";
import { showExistingAtom } from "@/store/show-existing";
import type { currentNovelMeta } from "@/types";
import type { Novel } from "@/types/models";
import { isSlugInList } from "@/utils/novel-matching";
import { nameIn } from "@/utils/translation";
import { NovelForm, type novelFormModes } from "./novelForm";
import { ColoringTab, ReplacingTab } from "./tabs";
import { useDetectedNovel } from "./use-detected-novel";
import { WebsiteNovelBiasForm } from "./websiteNovelBiasModal";

export function HomePage() {
	const { t } = useTranslation();
	const language = useLanguage();
	const [mode, setMode] = useState<novelFormModes>();
	const [downloading, setDownloading] = useState(false);
	const [biasFormOpen, setBiasFormOpen] = useState(false);
	const [currentHostname, setCurrentHostname] = useState<string>();
	/** Unsynced changes that block removing the selected download. */
	const [removeBlocked, setRemoveBlocked] = useState<number>();
	const [biasSelectorId, setBiasSelectorId] = useState<string>();
	const online = useOnlineStatus();
	const access = useAtomValue(userAccessAtom);
	const { downloadedIds, refresh: refreshDownloadedIds } =
		useDownloadedNovelIds();
	const {
		novels: availableNovels,
		isLoading: novelListLoading,
		refresh: refreshNovelsCatalog,
	} = useCachedNovelsList();

	const { selectedNovel, setSelectedNovel, currentTabNovel } = useDetectedNovel(
		availableNovels,
		availableNovels,
	);
	const [showExisting, setShowExisting] = useAtom(showExistingAtom);
	useEffect(() => {
		const novel = availableNovels.find(
			(item) => item.id === showExisting.novelId,
		);
		if (!novel) return;
		setSelectedNovel(novel);
		setShowExisting((current) => ({ ...current, novelId: undefined }));
	}, [
		availableNovels,
		showExisting.novelId,
		setSelectedNovel,
		setShowExisting,
	]);

	useEffect(() => {
		const getHostname = async () => {
			const [tab] = await browser.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (tab?.url) {
				try {
					setCurrentHostname(new URL(tab.url).hostname);
				} catch {
					// invalid URL
				}
			}
		};
		void getHostname();
	}, []);

	const { biases: biasesForNovel } = useNovelBiases(selectedNovel?.id);
	const { novels: downloadedNovels } = useDownloadedNovelsList();
	const removedOnServer = downloadedNovels.some(
		(novel) => novel.id === selectedNovel?.id && novel.removedOnServer,
	);

	const currentBiasEntry = currentHostname
		? biasesForNovel.find((b) => b.websiteSelector.website === currentHostname)
		: undefined;
	const currentBiasValue = Number(currentBiasEntry?.biasValue ?? 0);
	const detectedChapter = currentTabNovel?.chapter;
	const biasedChapter =
		detectedChapter !== undefined && currentBiasValue !== 0
			? detectedChapter + currentBiasValue
			: undefined;

	const handleOpenBiasModal = async () => {
		if (!selectedNovel?.id || !currentHostname || !online) return;
		if (currentBiasEntry) {
			setBiasSelectorId(currentBiasEntry.websiteSelectorId);
			setBiasFormOpen(true);
			return;
		}
		try {
			const response = await getWebsiteSelectorsByWebsite(currentHostname);
			setBiasSelectorId(response.data.id);
			setBiasFormOpen(true);
		} catch {
			// no selector for this website
		}
	};

	const isSelectedDownloaded = selectedNovel?.id
		? downloadedIds.has(selectedNovel.id)
		: false;

	const removeDownload = async (discardPending: boolean) => {
		if (!selectedNovel?.id) return;
		const result = await sendMessage("removeDownload", {
			novelId: selectedNovel.id,
			discardPending,
		});
		if ("blocked" in result) {
			setRemoveBlocked(result.blocked);
			return;
		}
		setRemoveBlocked(undefined);
		if ("error" in result) {
			if (result.error === "other-account-changes") {
				toast.error(t("offline.otherAccountChanges"));
				return;
			}
			throw new Error(result.error);
		}
		toast.success(t("offline.novelRemoved"));
	};

	const handleToggleDownload = async () => {
		if (!selectedNovel?.id) {
			return;
		}

		setDownloading(true);
		try {
			if (isSelectedDownloaded) {
				await removeDownload(false);
			} else {
				if (!online) {
					toast.error(t("offline.downloadRequiresOnline"));
					return;
				}
				const result = await sendMessage("downloadNovel", selectedNovel.id);
				if ("error" in result) throw new Error(result.error);
				toast.success(t("offline.novelDownloaded"));
			}
			refreshDownloadedIds();
		} catch {
			toast.error(
				isSelectedDownloaded
					? t("offline.novelRemoveFailed")
					: t("offline.novelDownloadFailed"),
			);
		} finally {
			setDownloading(false);
		}
	};

	const handleBlockedRemoval = async (choice: "sync" | "discard") => {
		setDownloading(true);
		try {
			if (choice === "sync") {
				setRemoveBlocked(undefined);
				await sendMessage("syncNow");
				await removeDownload(false);
			} else {
				await removeDownload(true);
			}
			refreshDownloadedIds();
		} catch {
			toast.error(t("offline.novelRemoveFailed"));
		} finally {
			setDownloading(false);
		}
	};

	return (
		<Container p="md">
			{biasFormOpen && selectedNovel?.id && biasSelectorId ? (
				<WebsiteNovelBiasForm
					novelId={selectedNovel.id}
					websiteSelectorId={biasSelectorId}
					websiteName={currentHostname ?? ""}
					currentBias={currentBiasValue}
					onClose={() => setBiasFormOpen(false)}
				/>
			) : mode !== undefined ? (
				<NovelForm
					refetchNovels={refreshNovelsCatalog}
					selectedNovel={selectedNovel}
					currentTabNovel={currentTabNovel}
					mode={mode}
					onClose={() => {
						setMode(undefined);
					}}
				/>
			) : (
				<Stack gap={0}>
					{!online && (
						<Text size="xs" c="orange" mb="xs">
							{t("offline.banner")}
						</Text>
					)}
					{novelListLoading ? (
						<Skeleton height={40} animate />
					) : (
						<Group gap="xs" align="end">
							<Select
								aria-label={t("coloring.novel")}
								placeholder={t("home.selectNovelPlaceholder")}
								allowDeselect={false}
								flex={1}
								data={availableNovels.map((novel: Novel) => ({
									value: novel.id,
									label: nameIn(novel, language),
								}))}
								value={selectedNovel?.id}
								onChange={(value) =>
									setSelectedNovel(
										availableNovels.find((novel: Novel) => novel.id === value),
									)
								}
								required
								searchable
								renderOption={({ option }) => {
									const downloaded = downloadedIds.has(String(option.value));
									return (
										<Group justify="space-between" wrap="nowrap" w="100%">
											<Text size="sm">{option.label}</Text>
											{downloaded && (
												<IconCheck size={14} color="var(--sl-success)" />
											)}
										</Group>
									);
								}}
							/>
							{selectedNovel?.id && (
								<Tooltip
									label={
										isSelectedDownloaded
											? t("offline.removeDownload")
											: t("offline.downloadForOffline")
									}
								>
									<ActionIcon
										variant={isSelectedDownloaded ? "light" : "default"}
										color={isSelectedDownloaded ? "sage" : undefined}
										size="lg"
										loading={downloading}
										aria-label={
											isSelectedDownloaded
												? t("offline.removeDownload")
												: t("offline.downloadForOffline")
										}
										onClick={() => {
											void handleToggleDownload();
										}}
									>
										{isSelectedDownloaded ? (
											<IconCheck size={18} />
										) : (
											<IconCloudDownload size={18} />
										)}
									</ActionIcon>
								</Tooltip>
							)}
							<Group
								style={{ flexShrink: 0 }}
								justify="center"
								align="center"
								gap={4}
								wrap="nowrap"
							>
								{biasedChapter !== undefined ? (
									<>
										<Text size="xs" td="line-through" c="dimmed">
											{detectedChapter}
										</Text>
										<Text>{biasedChapter}</Text>
									</>
								) : (
									<Text>{detectedChapter}</Text>
								)}
								{access === "moderator" && currentTabNovel && (
									<Tooltip
										label={
											online
												? t("home.chapterBias")
												: t("offline.requiresConnection")
										}
										withArrow
										openDelay={350}
									>
										<ActionIcon
											size="xs"
											variant="subtle"
											data-disabled={!online || undefined}
											onClick={() => {
												void handleOpenBiasModal();
											}}
											aria-label={t("home.chapterBias")}
										>
											<IconPencil size={12} />
										</ActionIcon>
									</Tooltip>
								)}
							</Group>
							{access !== "guest" && (
								<NovelMenu
									currentTabNovel={currentTabNovel}
									selectedNovel={selectedNovel}
									setSelectedNovel={setSelectedNovel}
									setMode={setMode}
									refetchNovels={refreshNovelsCatalog}
									access={access}
									online={online}
									t={t}
								/>
							)}
						</Group>
					)}

					{removedOnServer && (
						<Alert color="orange" variant="light" mt="xs" p="xs">
							<Group justify="space-between" wrap="nowrap" gap="xs">
								<Text size="xs">{t("offline.removedOnServer")}</Text>
								<Button
									size="compact-xs"
									variant="light"
									color="orange"
									onClick={() => void handleBlockedRemoval("discard")}
								>
									{t("offline.removeDownload")}
								</Button>
							</Group>
						</Alert>
					)}

					<Modal
						opened={removeBlocked !== undefined}
						onClose={() => setRemoveBlocked(undefined)}
						title={t("offline.removeBlockedTitle")}
						size="sm"
					>
						<Stack gap="sm">
							<Text size="sm">
								{t("offline.removeBlocked", { count: removeBlocked ?? 0 })}
							</Text>
							<Button
								loading={downloading}
								disabled={!online}
								onClick={() => void handleBlockedRemoval("sync")}
							>
								{t("offline.syncNow")}
							</Button>
							<Button
								color="red"
								variant="light"
								loading={downloading}
								onClick={() => void handleBlockedRemoval("discard")}
							>
								{t("offline.discardAndRemove")}
							</Button>
							<Button
								variant="default"
								onClick={() => setRemoveBlocked(undefined)}
							>
								{t("_.cancel")}
							</Button>
						</Stack>
					</Modal>

					<Tabs defaultValue="coloring" variant="pills">
						<Stack
							gap="xs"
							pos="sticky"
							top={0}
							style={{
								zIndex: 2,
							}}
							pt="xs"
							styles={{
								root: {
									backgroundColor: "var(--mantine-color-body)",
								},
							}}
						>
							<Tabs.List grow>
								<Tabs.Tab value="coloring" disabled={!selectedNovel?.id}>
									{t("tabs.coloring")}
								</Tabs.Tab>
								<Tabs.Tab value="replacing" disabled={!selectedNovel?.id}>
									{t("tabs.replacing")}
								</Tabs.Tab>
							</Tabs.List>
						</Stack>
						<Tabs.Panel value="coloring">
							<ColoringTab
								selectedNovelId={selectedNovel?.id}
								currentChapter={detectedChapter}
							/>
						</Tabs.Panel>
						<Tabs.Panel value="replacing">
							{selectedNovel?.id && (
								<ReplacingTab selectedNovelId={selectedNovel.id} />
							)}
						</Tabs.Panel>
					</Tabs>
				</Stack>
			)}
		</Container>
	);
}

export function NovelMenu({
	currentTabNovel,
	selectedNovel,
	setSelectedNovel,
	setMode,
	refetchNovels,
	access,
	online,
	t,
}: {
	currentTabNovel: currentNovelMeta | undefined;
	selectedNovel: Partial<Novel> | undefined;
	setSelectedNovel: (novel: Partial<Novel> | undefined) => void;
	setMode: (mode: novelFormModes) => void;
	refetchNovels: () => void;
	access: "reader" | "moderator";
	/** Novels, slugs and biases are online-only (D6): disabled offline. */
	online: boolean;
	t: TFunction;
}) {
	const addSlugMutation = usePutNovelsById({
		mutation: {
			onSuccess: () => {
				toast.success(t("auth.addSlugSuccess"));
				refetchNovels();
			},
			onError: () => {
				toast.error(t("auth.addSlugFailed"));
			},
		},
	});

	const handleAddSlug = () => {
		if (!currentTabNovel?.novelSlug) {
			toast.error(t("auth.noSlugDetected"));
			return;
		}
		if (!selectedNovel?.id) {
			return;
		}

		const existingSlugs = selectedNovel.slugs ?? [];
		if (isSlugInList(currentTabNovel.novelSlug, existingSlugs)) {
			return;
		}

		addSlugMutation.mutate({
			id: selectedNovel.id,
			data: {
				slugs: [...existingSlugs, currentTabNovel.novelSlug],
			},
		});
	};

	const currentSlug = currentTabNovel?.novelSlug;
	const canAddCurrentSlug =
		!!currentSlug &&
		!!selectedNovel?.id &&
		!isSlugInList(currentSlug, selectedNovel.slugs ?? []);

	return (
		<Menu shadow="md" width={200}>
			<Menu.Target>
				<Tooltip label={t("novels.actions")} withArrow openDelay={350}>
					<ActionIcon
						variant="subtle"
						color="var(--mantine-color-dimmed)"
						aria-label={t("novels.actions")}
					>
						<IconDotsVertical />
					</ActionIcon>
				</Tooltip>
			</Menu.Target>

			<Menu.Dropdown>
				{!online && <Menu.Label>{t("offline.requiresConnection")}</Menu.Label>}
				<Menu.Item
					leftSection={<IconPlus size={14} />}
					disabled={!online}
					onClick={() => {
						setSelectedNovel(
							currentTabNovel
								? {
										slugs: [currentTabNovel.novelSlug],
									}
								: undefined,
						);
						setMode("add");
					}}
				>
					{t("novels.add")}
				</Menu.Item>

				{canAddCurrentSlug && (
					<Menu.Item
						leftSection={<IconLink size={14} />}
						disabled={!online}
						onClick={handleAddSlug}
					>
						{t("novels.addSlug")}
					</Menu.Item>
				)}

				{access === "moderator" && (
					<>
						<Menu.Item
							leftSection={<IconEdit size={14} />}
							disabled={!online}
							onClick={() => {
								setMode("edit");
							}}
						>
							{t("novels.edit")}
						</Menu.Item>
						<Menu.Item
							leftSection={
								<IconTrash size={14} color="var(--mantine-color-red-text)" />
							}
							disabled={!online}
							onClick={() => {
								setMode("delete");
							}}
						>
							{t("novels.delete")}
						</Menu.Item>
					</>
				)}
			</Menu.Dropdown>
		</Menu>
	);
}
