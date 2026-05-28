import { ActionIcon, Button, Group, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconSparkles, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
	useDeleteWebsiteSelectorsByWebsite,
	useGetWebsiteSelectorsByWebsite,
	usePostWebsiteSelectors,
	usePutWebsiteSelectorsByWebsite,
} from "@/api/generated/endpoints/website-selectors.js";
import type {
	PostWebsiteSelectorsBodyOne,
	PutWebsiteSelectorsByWebsiteBodyOne,
} from "@/api/generated/schemas";
import { detectChapterSelectors } from "@/utils/detect-chapter-selectors";
import { getActiveTabPageContext } from "@/utils/get-active-tab-page-context";
import {
	computeSelectorPreviews,
	extractXpathText,
	type SelectorPreviewInput,
} from "@/utils/selector-preview";
import { RegexPreview } from "./regex-preview";

interface NodeSelectorFormProps {
	onClose: () => void;
	editedWebsite?: string;
}

type PageContext = {
	url: string;
	html: string;
};

function getPageContextErrorMessage(
	error: "no-tab" | "unsupported-url" | "no-content-script",
	t: (key: string) => string,
): string {
	switch (error) {
		case "no-tab":
			return t("nodeSelector.detectFailedNoTab");
		case "unsupported-url":
			return t("nodeSelector.detectFailedUnsupportedTab");
		case "no-content-script":
			return t("nodeSelector.detectFailedNoContentScript");
		default:
			return t("nodeSelector.detectFailed");
	}
}

const INITIAL_FORM_VALUES: SelectorPreviewInput & { website: string } = {
	website: "",
	novelXpath: "",
	novelXpathRegex: "(.*)",
	novelUrlRegex: "/novel/([^/]+)/",
	chapterXpath: "",
	chapterXpathRegex: "\\d+",
	chapterUrlRegex: "(\\d+)(?!.*\\d)",
};

function buildSelectorPayload(
	values: typeof INITIAL_FORM_VALUES,
): PostWebsiteSelectorsBodyOne {
	return {
		website: values.website,
		novel: {
			xpath: values.novelXpath
				? { value: values.novelXpath, regex: values.novelXpathRegex }
				: null,
			url: values.novelUrlRegex.trim() ? { regex: values.novelUrlRegex } : null,
		},
		chapter: {
			xpath: values.chapterXpath
				? { value: values.chapterXpath, regex: values.chapterXpathRegex }
				: null,
			url: values.chapterUrlRegex.trim()
				? { regex: values.chapterUrlRegex }
				: null,
		},
	};
}

function buildSelectorUpdatePayload(
	values: typeof INITIAL_FORM_VALUES,
): PutWebsiteSelectorsByWebsiteBodyOne {
	const payload = buildSelectorPayload(values);
	return {
		novel: payload.novel,
		chapter: payload.chapter,
	};
}

export function NodeSelectorForm({
	onClose,
	editedWebsite,
}: NodeSelectorFormProps) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [isDetecting, setIsDetecting] = useState(false);
	const [pageContext, setPageContext] = useState<PageContext | null>(null);

	const isEdit = !!editedWebsite;

	const { data: selectorData } = useGetWebsiteSelectorsByWebsite(
		editedWebsite ?? "",
		{
			query: {
				enabled: !!editedWebsite,
			},
		},
	);

	const form = useForm({
		mode: "controlled",
		initialValues: INITIAL_FORM_VALUES,
	});

	const xpathTexts = useMemo(() => {
		if (!pageContext) {
			return { novel: null, chapter: null };
		}

		return {
			novel: extractXpathText(pageContext.html, form.values.novelXpath),
			chapter: extractXpathText(pageContext.html, form.values.chapterXpath),
		};
	}, [pageContext, form.values.novelXpath, form.values.chapterXpath]);

	const previews = useMemo(
		() => computeSelectorPreviews(form.values, { pageContext, xpathTexts }),
		[form.values, pageContext, xpathTexts],
	);

	const createSelector = usePostWebsiteSelectors({
		mutation: {
			onSuccess: () => {
				navigate(0);
				toast.success(t("nodeSelector.websiteSavedSuccess"));
				onClose();
			},
			onError: () => {
				toast.error(t("nodeSelector.websiteSavedFailed"));
			},
		},
	});

	const updateSelector = usePutWebsiteSelectorsByWebsite({
		mutation: {
			onSuccess: () => {
				navigate(0);
				toast.success(t("nodeSelector.websiteSavedSuccess"));
				onClose();
			},
			onError: () => {
				toast.error(t("nodeSelector.websiteSavedFailed"));
			},
		},
	});

	const deleteSelector = useDeleteWebsiteSelectorsByWebsite({
		mutation: {
			onSuccess: () => {
				navigate(0);
				toast.success(t("nodeSelector.websiteDeleteSuccess"));
			},
			onError: () => {
				toast.error(t("nodeSelector.websiteDeleteFailed"));
			},
		},
	});

	async function loadPageContext(
		fallback?: PageContext | null,
	): Promise<PageContext | null> {
		const result = await getActiveTabPageContext();
		if (result.ok) {
			return result.page;
		}

		return fallback ?? null;
	}

	useEffect(() => {
		if (isEdit) {
			return;
		}

		void loadPageContext().then((page) => {
			if (!page) {
				return;
			}

			setPageContext(page);
			form.setFieldValue("website", new URL(page.url).hostname);
		});
	}, [isEdit]);

	useEffect(() => {
		void loadPageContext().then((page) => {
			if (page) {
				setPageContext(page);
			}
		});
	}, []);

	function handleDelete(website: string) {
		deleteSelector.mutate({ website });
	}

	async function handleAutoDetect() {
		setIsDetecting(true);

		try {
			const tabResult = await getActiveTabPageContext();
			const page = tabResult.ok ? tabResult.page : pageContext;

			if (!page) {
				toast.error(
					tabResult.ok
						? t("nodeSelector.detectFailed")
						: getPageContextErrorMessage(tabResult.error, t),
				);
				return;
			}

			setPageContext(page);

			const detection = await detectChapterSelectors({
				url: page.url,
				html: page.html,
			});

			form.setValues(detection.nodeSelectorForm);

			if (detection.validation.errors.length > 0) {
				toast.error(
					`${t("nodeSelector.detectPartial")}: ${detection.validation.errors.join(", ")}`,
				);
				return;
			}

			toast.success(
				`${t("nodeSelector.detectSuccess")} (${detection.result.confidence})`,
			);
		} catch (error) {
			console.error("[StoryLens] Auto-detect selectors failed", error);
			const message =
				error instanceof Error && error.message
					? error.message
					: t("nodeSelector.detectFailed");
			toast.error(message);
		} finally {
			setIsDetecting(false);
		}
	}

	function handleSubmit(values: typeof form.values) {
		if (isEdit) {
			updateSelector.mutate({
				website: values.website,
				data: buildSelectorUpdatePayload(values),
			});
			return;
		}

		createSelector.mutate({ data: buildSelectorPayload(values) });
	}

	useEffect(() => {
		if (!editedWebsite || !selectorData?.data) {
			return;
		}

		const existingSelector = selectorData.data;

		form.setValues({
			website: existingSelector.website,
			novelXpath: existingSelector.novel?.xpath?.value ?? "",
			novelXpathRegex: existingSelector.novel?.xpath?.regex ?? "(.*)",
			novelUrlRegex: existingSelector.novel?.url?.regex ?? "",
			chapterXpath: existingSelector.chapter?.xpath?.value ?? "",
			chapterXpathRegex: existingSelector.chapter?.xpath?.regex ?? "\\d+",
			chapterUrlRegex: existingSelector.chapter?.url?.regex ?? "",
		});
	}, [editedWebsite, selectorData?.data]);

	const isSaving = createSelector.isPending || updateSelector.isPending;

	return (
		<Stack p="sm" gap="xs">
			<TextInput
				key={form.key("website")}
				label={t("nodeSelector.website")}
				placeholder="example.com"
				{...form.getInputProps("website")}
				disabled={isEdit}
			/>
			<Button
				variant="light"
				leftSection={<IconSparkles size={16} />}
				onClick={handleAutoDetect}
				loading={isDetecting}
			>
				{t("nodeSelector.autoDetect")}
			</Button>

			<TextInput
				key={form.key("novelXpath")}
				label={t("nodeSelector.novelXpath")}
				placeholder="/html/body/div[1]/main"
				{...form.getInputProps("novelXpath")}
			/>
			<RegexPreview result={previews.novelXpathExtract} type="xpath" />
			<TextInput
				key={form.key("novelXpathRegex")}
				label={t("nodeSelector.novelXpathRegex")}
				placeholder="(.*)"
				{...form.getInputProps("novelXpathRegex")}
			/>
			<RegexPreview result={previews.novelXpathRegex} />

			<TextInput
				key={form.key("novelUrlRegex")}
				label={t("nodeSelector.novelUrlRegex")}
				placeholder="/novel/([^/]+)/"
				{...form.getInputProps("novelUrlRegex")}
			/>
			<RegexPreview result={previews.novelUrl} />

			<TextInput
				key={form.key("chapterXpath")}
				label={t("nodeSelector.chapterXpath")}
				placeholder={t("nodeSelector.chapterXpath")}
				{...form.getInputProps("chapterXpath")}
			/>
			<RegexPreview result={previews.chapterXpathExtract} type="xpath" />
			<TextInput
				key={form.key("chapterXpathRegex")}
				label={t("nodeSelector.chapterXpathRegex")}
				placeholder="\\d+"
				{...form.getInputProps("chapterXpathRegex")}
			/>
			<RegexPreview result={previews.chapterXpathRegex} />

			<TextInput
				key={form.key("chapterUrlRegex")}
				label={t("nodeSelector.chapterUrlRegex")}
				placeholder="(\\d+)(?!.*\\d)"
				{...form.getInputProps("chapterUrlRegex")}
			/>
			<RegexPreview result={previews.chapterUrl} />

			<Group justify="space-between" mt="md">
				<ActionIcon
					variant="transparent"
					color="red"
					size="lg"
					onClick={() => handleDelete(form.values.website)}
				>
					<IconTrash />
				</ActionIcon>
				<Group>
					<Button variant="outline" onClick={onClose}>
						{t("_.cancel")}
					</Button>
					<Button onClick={() => handleSubmit(form.values)} loading={isSaving}>
						{t("_.save")}
					</Button>
				</Group>
			</Group>
		</Stack>
	);
}
