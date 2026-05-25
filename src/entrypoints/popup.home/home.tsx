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
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useGetNovels, usePutNovelsById } from "@/api/endpoints/novels.js";
import { userRoleAtom } from "@/lib/auth";
import { downloadNovel, removeDownloadedNovel } from "@/lib/offline/download";
import {
	useDownloadedNovelIds,
	useDownloadedNovelsList,
	useOnlineStatus,
} from "@/lib/offline/hooks";
import type { currentNovelMeta } from "@/types";
import type { Novel } from "@/types/models";
import { isSlugInList } from "@/utils/novel-matching";
import { NovelForm, type novelFormModes } from "./novelForm";
import { ColoringTab, ReplacingTab } from "./tabs";
import { useDetectedNovel } from "./use-detected-novel";

export function HomePage() {
	const { t } = useTranslation();
	const [mode, setMode] = useState<novelFormModes>();
	const [downloading, setDownloading] = useState(false);
	const online = useOnlineStatus();
	const role = useAtomValue(userRoleAtom);
	const { downloadedIds, refresh: refreshDownloadedIds } =
		useDownloadedNovelIds();
	const {
		novels: downloadedNovels,
		isLoading: downloadedNovelsLoading,
		refresh: refreshDownloadedNovels,
	} = useDownloadedNovelsList();

	const {
		data: novelsData,
		isLoading: novelsLoading,
		refetch: refetchNovels,
	} = useGetNovels<{
		data: { data: Novel[] };
	}>(
		{
			pagination: { page: 1, pageSize: 100 },
			sorting: { column: "name", direction: "asc" },
		},
		{
			query: {
				enabled: online,
				retry: false,
			},
		},
	);

	const availableNovels = useMemo(() => {
		const apiNovels = novelsData?.data?.data;
		if (apiNovels?.length) {
			return apiNovels;
		}
		return downloadedNovels;
	}, [novelsData?.data?.data, downloadedNovels]);

	const novelListLoading = online ? novelsLoading : downloadedNovelsLoading;

	const { selectedNovel, setSelectedNovel, currentTabNovel } = useDetectedNovel(
		novelsData?.data?.data,
		downloadedNovels,
	);

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
			refreshDownloadedNovels();
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
			{mode !== undefined ? (
				<NovelForm
					refetchNovels={refetchNovels}
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
							<Text flex={1} ta="center">
								{currentTabNovel?.chapter}
							</Text>
							{role !== "guest" && (
								<NovelMenu
									currentTabNovel={currentTabNovel}
									selectedNovel={selectedNovel}
									setSelectedNovel={setSelectedNovel}
									setMode={setMode}
									refetchNovels={refetchNovels}
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
