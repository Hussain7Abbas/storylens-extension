import {
	Alert,
	Button,
	FileInput,
	Group,
	Paper,
	Stack,
	TagsInput,
	TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useEffect } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { browser } from "#imports";
import {
	useDeleteNovelsById,
	usePostNovels,
	usePutNovelsById,
} from "@/api/endpoints/novels.js";
import { sendMessage } from "@/entrypoints/background/messaging";
import type { Novel } from "@/types/models";
import { loadWebsiteSelectorsValue } from "@/utils/load-website-selectors";
import { previewXpathRegexResultFromHtml } from "@/utils/selector-preview";
import { getWebsiteSelector } from "@/utils/site-detection";

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
		const selectorsValue = await loadWebsiteSelectorsValue();
		const hostname = page?.url ? new URL(page.url).hostname : undefined;
		const selector = getWebsiteSelector(selectorsValue, hostname);

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

export function NovelForm({
	selectedNovel,
	refetchNovels,
	mode = "add",
	onClose,
}: {
	selectedNovel?: Partial<Novel>;
	mode?: novelFormModes;
	refetchNovels?: () => void;
	onClose?: () => void;
}) {
	const { t } = useTranslation();
	const form = useForm({
		initialValues: {
			name: "",
			description: "",
			imageId: "",
			slugs: [] as string[],
		},
	});

	useEffect(() => {
		if (mode === "edit") {
			form.setValues({
				name: selectedNovel?.name || "",
				description: selectedNovel?.description || "",
				imageId: selectedNovel?.imageId || "",
				slugs: selectedNovel?.slugs || [],
			});
			return;
		}

		if (mode === "add") {
			form.setValues({
				name: "",
				description: "",
				imageId: "",
				slugs: selectedNovel?.slugs || [],
			});
		}
	}, [mode, selectedNovel]);

	useEffect(() => {
		if (mode !== "add") {
			return;
		}

		void (async () => {
			const [tab] = await browser.tabs.query({
				active: true,
				currentWindow: true,
			});
			if (!tab?.id) {
				return;
			}

			const novelName = await getNovelNameFromRegex(tab.id);
			if (novelName) {
				form.setFieldValue("name", novelName);
			}
		})();
	}, [mode]);

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

	const handleSubmit = (values: typeof form.values) => {
		if (mode === "add") {
			createNovelMutation.mutate({
				data: {
					name: values.name,
					description: values.description || undefined,
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
					<Alert
						title="Are you sure you want to delete this novel?"
						color="red"
					/>
					<Group grow>
						<Button
							variant="outline"
							onClick={onClose}
							loading={deleteNovelMutation.isPending}
						>
							{t("_.cancel")}
						</Button>
						<Button
							variant="outline"
							color="red"
							onClick={handleDelete}
							loading={deleteNovelMutation.isPending}
						>
							{t("_.delete")}
						</Button>
					</Group>
				</Stack>
			</Paper>
		);
	}

	return (
		<Paper p="xs" withBorder>
			<form onSubmit={form.onSubmit(handleSubmit)}>
				<Stack gap="xs">
					<TextInput label={t("novels.name")} {...form.getInputProps("name")} />
					<TagsInput
						label={t("novels.slugs")}
						placeholder={t("novels.slugsPlaceholder")}
						{...form.getInputProps("slugs")}
					/>
					<TextInput
						label={t("novels.description")}
						{...form.getInputProps("description")}
					/>
					<FileInput
						label={t("novels.image")}
						{...form.getInputProps("imageId")}
					/>

					<Group grow>
						<Button
							type="button"
							variant="outline"
							loading={createNovelMutation.isPending}
							onClick={onClose}
						>
							{t("_.cancel")}
						</Button>
						<Button type="submit" loading={createNovelMutation.isPending}>
							{t("_.save")}
						</Button>
					</Group>
				</Stack>
			</form>
		</Paper>
	);
}
