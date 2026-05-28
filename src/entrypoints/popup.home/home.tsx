import {
	ActionIcon,
	Container,
	Group,
	Menu,
	Select,
	Skeleton,
	Stack,
	Tabs,
	Text,
	Tooltip,
} from "@mantine/core";
import {
	IconCheck,
	IconCloudDownload,
	IconDotsVertical,
	IconEdit,
	IconLink,
	IconPencil,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import { getWebsiteSelectorsByWebsite } from "@/api/generated/endpoints/website-selectors.js";
import { usePutNovelsById } from "@/api/generated/endpoints/novels.js";
import { userRoleAtom } from "@/lib/auth";
import { downloadNovel, removeDownloadedNovel } from "@/lib/offline/download";
import {
	useCachedNovelsList,
	useDownloadedNovelIds,
	useOnlineStatus,
} from "@/lib/offline/hooks";
import { getBiasesByNovelId } from "@/lib/offline/db";
import type { OfflineWebsiteNovelBias } from "@/lib/offline/types";
import type { currentNovelMeta } from "@/types";
import type { Novel } from "@/types/models";
import { isSlugInList } from "@/utils/novel-matching";
import { NovelForm, type novelFormModes } from "./novelForm";
import { WebsiteNovelBiasForm } from "./websiteNovelBiasModal";
import { ColoringTab, ReplacingTab } from "./tabs";
import { useDetectedNovel } from "./use-detected-novel";

export function HomePage() {
	const { t } = useTranslation();
	const [mode, setMode] = useState<novelFormModes>();
	const [downloading, setDownloading] = useState(false);
	const [biasFormOpen, setBiasFormOpen] = useState(false);
	const [currentHostname, setCurrentHostname] = useState<string>();
	const [biasesForNovel, setBiasesForNovel] = useState<OfflineWebsiteNovelBias[]>([]);
	const [biasSelectorId, setBiasSelectorId] = useState<string>();
	const online = useOnlineStatus();
	const role = useAtomValue(userRoleAtom);
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

	useEffect(() => {
		const getHostname = async () => {
			const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
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

	useEffect(() => {
		if (!selectedNovel?.id) {
			setBiasesForNovel([]);
			return;
		}
		void getBiasesByNovelId(selectedNovel.id).then(setBiasesForNovel);
	}, [selectedNovel?.id]);

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
		if (!selectedNovel?.id || !currentHostname) return;
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

	const handleToggleDownload = async () => {
		if (!selectedNovel?.id) {
			return;
		}

		setDownloading(true);
		try {
			if (isSelectedDownloaded) {
				await removeDownloadedNovel(selectedNovel.id);
				toast.success(t("offline.novelRemoved"));
			} else {
				if (!online) {
					toast.error(t("offline.downloadRequiresOnline"));
					return;
				}
				await downloadNovel(selectedNovel.id);
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

	return (
		<Container p="md">
			{biasFormOpen && selectedNovel?.id && biasSelectorId ? (
				<WebsiteNovelBiasForm
					novelId={selectedNovel.id}
					websiteSelectorId={biasSelectorId}
					websiteName={currentHostname ?? ""}
					currentBias={currentBiasValue}
					onClose={() => setBiasFormOpen(false)}
					onSaved={(updated) => {
						setBiasesForNovel((prev) => {
							const filtered = prev.filter(
								(b) => b.websiteSelectorId !== biasSelectorId,
							);
							return [...filtered, ...updated];
						});
					}}
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
								label={t("coloring.novel")}
								placeholder={t("home.selectNovelPlaceholder")}
								allowDeselect={false}
								flex={1}
								data={availableNovels.map((novel: Novel) => ({
									value: novel.id,
									label: novel.name,
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
												<IconCheck
													size={14}
													color="var(--mantine-color-green-7)"
												/>
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
										color={isSelectedDownloaded ? "green" : "blue"}
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
							<Group flex={1} justify="center" align="center" gap={4} wrap="nowrap">
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
								{role === "admin" && currentTabNovel && (
									<ActionIcon
										size="xs"
										variant="subtle"
										onClick={() => { void handleOpenBiasModal(); }}
										aria-label={t("home.chapterBias")}
									>
										<IconPencil size={12} />
									</ActionIcon>
								)}
							</Group>
							{role !== "guest" && (
								<NovelMenu
									currentTabNovel={currentTabNovel}
									selectedNovel={selectedNovel}
									setSelectedNovel={setSelectedNovel}
									setMode={setMode}
									refetchNovels={refreshNovelsCatalog}
									role={role}
									t={t}
								/>
							)}
						</Group>
					)}

					{selectedNovel?.id && (
						<Tabs defaultValue="coloring" variant="outline">
							<Stack
								gap="xs"
								pos="sticky"
								top={0}
								style={{
									zIndex: 2,
									["--popup-tabs-sticky-height" as string]:
										"calc(var(--mantine-spacing-xs) + 36px)",
								}}
								pt="xs"
								styles={{
									root: {
										backgroundColor: "var(--mantine-color-body)",
									},
								}}
							>
								<Tabs.List grow>
									<Tabs.Tab value="coloring">{t("tabs.coloring")}</Tabs.Tab>
									<Tabs.Tab value="replacing">{t("tabs.replacing")}</Tabs.Tab>
								</Tabs.List>
							</Stack>
							<Tabs.Panel value="coloring">
								<ColoringTab selectedNovelId={selectedNovel?.id} />
							</Tabs.Panel>
							<Tabs.Panel value="replacing">
								<ReplacingTab selectedNovelId={selectedNovel?.id} />
							</Tabs.Panel>
						</Tabs>
					)}
				</Stack>
			)}
		</Container>
	);
}

function NovelMenu({
	currentTabNovel,
	selectedNovel,
	setSelectedNovel,
	setMode,
	refetchNovels,
	role,
	t,
}: {
	currentTabNovel: currentNovelMeta | undefined;
	selectedNovel: Partial<Novel> | undefined;
	setSelectedNovel: (novel: Partial<Novel> | undefined) => void;
	setMode: (mode: novelFormModes) => void;
	refetchNovels: () => void;
	role: "user" | "admin";
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
				name: selectedNovel.name ?? "",
				description: selectedNovel.description ?? undefined,
				imageId: selectedNovel.imageId ?? undefined,
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
				<ActionIcon variant="transparent">
					<IconDotsVertical />
				</ActionIcon>
			</Menu.Target>

			<Menu.Dropdown>
				<Menu.Item
					leftSection={<IconPlus size={14} color="green" />}
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
						leftSection={<IconLink size={14} color="cyan" />}
						onClick={handleAddSlug}
					>
						{t("novels.addSlug")}
					</Menu.Item>
				)}

				{role === "admin" && (
					<>
						<Menu.Item
							leftSection={<IconEdit size={14} color="blue" />}
							onClick={() => {
								setMode("edit");
							}}
						>
							{t("novels.edit")}
						</Menu.Item>
						<Menu.Item
							leftSection={<IconTrash size={14} color="red" />}
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
