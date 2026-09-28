import {
	Alert,
	Button,
	FileInput,
	Group,
	Paper,
	Stack,
	TagsInput,
	Text,
	Textarea,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useAtomValue } from "jotai";
import { Link as IconLink } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import {
	useDeleteNovelsById,
	usePostNovels,
	usePutNovelsById,
} from "@/api/generated/endpoints/novels.js";
import { FormPage } from "@/components/form-page";
import { sendMessage } from "@/entrypoints/background/messaging";
import { userAccessAtom } from "@/lib/auth";
import { decodeStoredText } from "@/lib/desktop-client/novel-context-prompt";
import type { currentNovelMeta } from "@/types";
import type { Novel } from "@/types/models";
import { loadWebsiteSelector } from "@/utils/load-website-selectors";
import { isSlugInList } from "@/utils/novel-matching";
import { previewXpathRegexResultFromHtml } from "@/utils/selector-preview";

async function getNovelNameFromRegex(tabId: number): Promise<string | null> {
	try {
		const detected = await sendMessage("getCurrentNovel", undefined, { tabId });
		if (detected?.novelName) {
			return detected.novelName;
		}
	} catch {
		// Content script may still be initializing.
	}

	try {
		const page = await sendMessage("getPageHtml", undefined, { tabId });
		const hostname = page?.url ? new URL(page.url).hostname : undefined;
		const selector = hostname ? await loadWebsiteSelector(hostname) : undefined;

		if (!page?.html || !selector?.novel?.xpath?.value) {
			return null;
		}

		const result = previewXpathRegexResultFromHtml(
			page.html,
			selector.novel.xpath.value,
			selector.novel.xpath.regex || "(.*)",
			{ cleanNovelTitle: true },
		);

		return result.status === "match" ? result.value : null;
	} catch {
		return null;
	}
}

export type novelFormModes = "add" | "edit" | "delete" | undefined;

function NovelFormContent({
	selectedNovel,
	currentTabNovel,
	refetchNovels,
	mode = "add",
	onClose,
}: {
	selectedNovel?: Partial<Novel>;
	currentTabNovel?: currentNovelMeta;
	mode?: novelFormModes;
	refetchNovels?: () => void;
	onClose?: () => void;
}) {
	const { t } = useTranslation();
	const isModerator = useAtomValue(userAccessAtom) === "moderator";
	const [detectedName, setDetectedName] = useState<string | null>(null);
	const [detectingName, setDetectingName] = useState(false);

	const form = useForm({
		initialValues: {
			name: "",
			description: "",
			context: "",
			imageId: "",
			slugs: [] as string[],
		},
	});
	const { setValues, setFieldValue } = form;

	useEffect(() => {
		if (mode === "edit") {
			setValues({
				name: selectedNovel?.name || "",
				description: selectedNovel?.description || "",
				context: decodeStoredText(selectedNovel?.context || ""),
				imageId: selectedNovel?.imageId || "",
				slugs: selectedNovel?.slugs || [],
			});
			return;
		}

		if (mode === "add") {
			setValues({
				name: "",
				description: "",
				context: "",
				imageId: "",
				slugs: selectedNovel?.slugs || [],
			});
		}
	}, [mode, selectedNovel, setValues]);

	useEffect(() => {
		if (mode !== "add") {
			return;
		}

		setDetectingName(true);
		void (async () => {
			const [tab] = await browser.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (!tab?.id) {
				setDetectingName(false);
				return;
			}

			const novelName = await getNovelNameFromRegex(tab.id);
			if (novelName) {
				setDetectedName(novelName);
				setFieldValue("name", novelName);
			}
			setDetectingName(false);
		})();
	}, [mode, setFieldValue]);

	const createNovelMutation = usePostNovels({
		mutation: {
			onSuccess: () => {
				toast.success(t("home.novelAddedSuccessfully"));
				form.reset();
				refetchNovels?.();
				onClose?.();
			},
			onError: () => {
				toast.error(t("home.novelAddedFailed"));
			},
		},
	});

	const updateNovelMutation = usePutNovelsById({
		mutation: {
			onSuccess: () => {
				toast.success(t("home.novelUpdatedSuccessfully"));
				form.reset();
				refetchNovels?.();
				onClose?.();
			},
			onError: () => {
				toast.error(t("home.novelUpdatedFailed"));
			},
		},
	});

	const deleteNovelMutation = useDeleteNovelsById({
		mutation: {
			onSuccess: () => {
				toast.success(t("home.novelDeletedSuccessfully"));
				refetchNovels?.();
				onClose?.();
			},
			onError: () => {
				toast.error(t("home.novelDeletedFailed"));
			},
		},
	});

	// Users may write a missing context; only admins can change an existing one.
	const contextLocked =
		mode === "edit" && !isModerator && !!selectedNovel?.context?.trim();

	const currentSlug = currentTabNovel?.novelSlug;
	const showAddCurrentSlugButton =
		!!currentSlug && !isSlugInList(currentSlug, form.values.slugs);

	const handleAddCurrentSlug = () => {
		if (!currentSlug) {
			toast.error(t("auth.noSlugDetected"));
			return;
		}

		if (isSlugInList(currentSlug, form.values.slugs)) {
			return;
		}

		setFieldValue("slugs", [...form.values.slugs, currentSlug]);
	};

	const handleSubmit = (values: typeof form.values) => {
		const nameToUse =
			mode === "add" && !isModerator ? detectedName || "" : values.name;

		if (!nameToUse) {
			toast.error(t("auth.cannotDetectNovel"));
			return;
		}

		if (mode === "add") {
			createNovelMutation.mutate({
				data: {
					name: nameToUse,
					description: values.description || undefined,
					context: values.context.trim() || undefined,
					imageId: values.imageId || undefined,
					slugs: values.slugs,
				},
			});
		} else if (mode === "edit") {
			updateNovelMutation.mutate({
				id: selectedNovel?.id || "",
				data: {
					name: values.name,
					description: values.description || undefined,
					context: values.context.trim() || undefined,
					imageId: values.imageId || undefined,
					slugs: values.slugs,
				},
			});
		}
	};

	const handleDelete = () => {
		if (!selectedNovel?.id) {
			toast.error(t("novels.notFound"));
			return;
		}
		deleteNovelMutation.mutate({
			id: selectedNovel?.id,
		});
	};

	if (mode === "delete") {
		return (
			<Paper p="xs" withBorder>
				<Stack gap="xs">
					<Alert title={t("novels.confirmDelete")} color="red" />
					<Group grow>
						<Tooltip label={t("_.cancel")} withArrow openDelay={350}>
							<Button
								variant="outline"
								onClick={onClose}
								loading={deleteNovelMutation.isPending}
							>
								{t("_.cancel")}
							</Button>
						</Tooltip>
						<Tooltip label={t("_.delete")} withArrow openDelay={350}>
							<Button
								variant="outline"
								color="red"
								onClick={handleDelete}
								loading={deleteNovelMutation.isPending}
							>
								{t("_.delete")}
							</Button>
						</Tooltip>
					</Group>
				</Stack>
			</Paper>
		);
	}

	return (
		<Paper p="xs" withBorder>
			<form onSubmit={form.onSubmit(handleSubmit)}>
				<Stack gap="xs">
					{mode === "add" && !isModerator ? (
						<>
							{detectingName ? (
								<Text size="sm" c="dimmed">
									{t("auth.cannotDetectNovel")}...
								</Text>
							) : detectedName ? (
								<Text size="sm" fw={500}>
									{detectedName}
								</Text>
							) : (
								<Alert color="orange" variant="light">
									{t("auth.cannotDetectNovel")}
								</Alert>
							)}
						</>
					) : (
						<TextInput
							label={t("novels.name")}
							{...form.getInputProps("name")}
						/>
					)}

					<Stack gap={4}>
						<TagsInput
							label={t("novels.slugs")}
							placeholder={t("novels.slugsPlaceholder")}
							{...form.getInputProps("slugs")}
						/>
						{showAddCurrentSlugButton && (
							<Tooltip label={t("novels.addSlug")} withArrow openDelay={350}>
								<Button
									type="button"
									variant="light"
									size="xs"
									leftSection={<IconLink size={14} />}
									onClick={handleAddCurrentSlug}
								>
									{t("novels.addSlug")}
								</Button>
							</Tooltip>
						)}
					</Stack>
					<TextInput
						label={t("novels.description")}
						{...form.getInputProps("description")}
					/>
					<Textarea
						label={t("novels.context")}
						description={
							contextLocked
								? t("novels.contextLocked")
								: t("novels.contextHelp")
						}
						autosize
						minRows={3}
						maxRows={10}
						maxLength={20000}
						disabled={contextLocked}
						{...form.getInputProps("context")}
					/>
					<FileInput
						label={t("novels.image")}
						{...form.getInputProps("imageId")}
					/>

					<Group grow>
						<Tooltip label={t("_.cancel")} withArrow openDelay={350}>
							<Button
								type="button"
								variant="outline"
								loading={createNovelMutation.isPending}
								onClick={onClose}
							>
								{t("_.cancel")}
							</Button>
						</Tooltip>
						<Tooltip label={t("_.save")} withArrow openDelay={350}>
							<Button
								type="submit"
								loading={createNovelMutation.isPending}
								disabled={mode === "add" && !isModerator && !detectedName}
							>
								{t("_.save")}
							</Button>
						</Tooltip>
					</Group>
				</Stack>
			</form>
		</Paper>
	);
}

export function NovelForm(props: Parameters<typeof NovelFormContent>[0]) {
	return (
		<FormPage title="NovelForm" onClose={props.onClose ?? (() => {})}>
			<NovelFormContent {...props} />
		</FormPage>
	);
}
