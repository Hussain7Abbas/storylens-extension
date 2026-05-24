import { ActionIcon, Button, Group, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconSparkles, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { browser } from "#imports";
import { useGetConfigsByKey, usePutConfigs } from "@/api/endpoints/configs.js";
import { sendMessage } from "@/entrypoints/background/messaging";
import type { websiteSelectors } from "@/types/configs";
import { detectChapterSelectors } from "@/utils/detect-chapter-selectors";
import {
	computeSelectorPreviews,
	extractXpathText,
	type SelectorPreviewInput,
} from "@/utils/selector-preview";
import { WEBSITES_SELECTORS_KEY } from "./constants";
import { RegexPreview } from "./regex-preview";

interface NodeSelectorFormProps {
	onClose: () => void;
	editedWebsite?: string;
}

type PageContext = {
	url: string;
	html: string;
};

const INITIAL_FORM_VALUES: SelectorPreviewInput & { website: string } = {
	website: "",
	novelXpath: "",
	novelXpathRegex: "(.*)",
	novelUrlRegex: "/novel/([^/]+)/",
	chapterXpath: "",
	chapterXpathRegex: "\\d+",
	chapterUrlRegex: "(\\d+)(?!.*\\d)",
};

export function NodeSelectorForm({
	onClose,
	editedWebsite,
}: NodeSelectorFormProps) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [isDetecting, setIsDetecting] = useState(false);
	const [pageContext, setPageContext] = useState<PageContext | null>(null);

	const isEdit = !!editedWebsite;

	const { data: configData } = useGetConfigsByKey<{
		data: { key: string; value: string };
	}>(WEBSITES_SELECTORS_KEY);

	const existingSelectors: websiteSelectors = useMemo(
		() => (configData?.data?.value ? JSON.parse(configData.data.value) : {}),
		[configData?.data?.value],
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

	const updateConfig = usePutConfigs({
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

	const deleteConfig = usePutConfigs({
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

	async function loadPageContext(): Promise<PageContext | null> {
		const [tab] = await browser.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (!tab?.id) {
			return null;
		}

		const page = await sendMessage("getPageHtml", undefined, { tabId: tab.id });
		if (!page?.url || !page.html) {
			return null;
		}

		return page;
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
		const currentSelectors = { ...existingSelectors };
		delete currentSelectors[website];

		deleteConfig.mutate({
			data: {
				key: WEBSITES_SELECTORS_KEY,
				value: JSON.stringify(currentSelectors),
			},
		});
	}

	async function handleAutoDetect() {
		setIsDetecting(true);

		try {
			const page = await loadPageContext();
			if (!page) {
				toast.error(t("nodeSelector.detectFailed"));
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
		} catch {
			toast.error(t("nodeSelector.detectFailed"));
		} finally {
			setIsDetecting(false);
		}
	}

	function handleSubmit(values: typeof form.values) {
		const newSelectors: websiteSelectors = {
			...existingSelectors,
			[values.website]: {
				website: values.website,
				novel: {
					xpath: values.novelXpath
						? { value: values.novelXpath, regex: values.novelXpathRegex }
						: null,
					url: values.novelUrlRegex.trim()
						? { regex: values.novelUrlRegex }
						: null,
				},
				chapter: {
					xpath: values.chapterXpath
						? { value: values.chapterXpath, regex: values.chapterXpathRegex }
						: null,
					url: values.chapterUrlRegex.trim()
						? { regex: values.chapterUrlRegex }
						: null,
				},
			},
		};

		updateConfig.mutate({
			data: {
				key: WEBSITES_SELECTORS_KEY,
				value: JSON.stringify(newSelectors),
			},
		});
	}

	useEffect(() => {
		if (!editedWebsite) {
			return;
		}

		const existingSelector = {
			...existingSelectors[editedWebsite],
		};

		form.setValues({
			website: existingSelector.website,
			novelXpath: existingSelector.novel?.xpath?.value ?? "",
			novelXpathRegex: existingSelector.novel?.xpath?.regex ?? "(.*)",
			novelUrlRegex: existingSelector.novel?.url?.regex ?? "",
			chapterXpath: existingSelector.chapter?.xpath?.value ?? "",
			chapterXpathRegex: existingSelector.chapter?.xpath?.regex ?? "\\d+",
			chapterUrlRegex: existingSelector.chapter?.url?.regex ?? "",
		});
	}, [configData?.data?.value, editedWebsite, existingSelectors]);

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
					<Button
						onClick={() => handleSubmit(form.values)}
						loading={updateConfig.isPending}
					>
						{t("_.save")}
					</Button>
				</Group>
			</Group>
		</Stack>
	);
}
