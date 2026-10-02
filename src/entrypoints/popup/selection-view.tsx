import {
	Button,
	Group,
	Select,
	Stack,
	Switch,
	Text,
	Tooltip,
} from "@mantine/core";
import { History, Link, Tag, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetKeywords200DataItem } from "@/api/generated/schemas";
import { AiPrice } from "@/components/lens/ai-price";
import { GetLensesLink } from "@/components/lens/get-lenses-link";
import { ParentKeywordSelect } from "@/components/parent-keyword-select";
import { availabilityKey } from "@/lib/ai-source/availability";
import { useAiAvailability } from "@/lib/ai-source/hooks";
import { useCanMutateKeywords } from "@/lib/auth";
import { useCachedNovelsList } from "@/lib/offline/hooks";
import { useLanguage } from "@/store/locale";
import { nameIn } from "@/utils/translation";
import { useDetectedNovel } from "../popup.home/use-detected-novel";

export function SelectionView() {
	const { t } = useTranslation();
	const language = useLanguage();
	const root = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = root.current;
		if (!element) return;
		const observer = new ResizeObserver(() =>
			window.parent.postMessage(
				{
					type: "storylens-selection-resize",
					height: Math.ceil(element.getBoundingClientRect().height) + 2,
				},
				"*",
			),
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const canMutate = useCanMutateKeywords();
	const availability = useAiAvailability("keyword_suggestion");
	const configured = availability.ok;
	const { novels } = useCachedNovelsList();
	const { selectedNovel, setSelectedNovel } = useDetectedNovel(novels, novels);
	const [ai, setAi] = useState(false);
	const [kind, setKind] = useState<"keyword" | "alias" | "version">("keyword");
	const [parent, setParent] = useState<GetKeywords200DataItem>();
	function choose(action: typeof kind) {
		setKind(action);
		setParent(undefined);
		if (action === "keyword" && selectedNovel?.id && canMutate) submit(action);
	}
	function submit(action = kind) {
		if (!selectedNovel?.id || !canMutate || (action !== "keyword" && !parent))
			return;
		window.parent.postMessage(
			{
				type: "storylens-selection-create",
				kind: action,
				novelId: selectedNovel.id,
				parentId: parent?.id,
				ai: ai && configured,
			},
			"*",
		);
	}
	return (
		<Stack ref={root} p="sm" gap="xs">
			<Group justify="space-between">
				<Text size="sm" fw={600} lineClamp={1}>
					{new URLSearchParams(window.location.search).get("search")}
				</Text>
				<Tooltip label={t("selection.close")} withArrow openDelay={350}>
					<Button
						variant="subtle"
						size="compact-sm"
						aria-label={t("selection.close")}
						onClick={() =>
							window.parent.postMessage(
								{ type: "storylens-selection-close" },
								"*",
							)
						}
					>
						<X size={16} />
					</Button>
				</Tooltip>
			</Group>
			<Select
				label={t("coloring.novel")}
				value={selectedNovel?.id ?? null}
				data={novels.map((novel) => ({
					value: novel.id,
					label: nameIn(novel, language),
				}))}
				searchable
				onChange={(id) => {
					setSelectedNovel(novels.find((novel) => novel.id === id));
					setParent(undefined);
				}}
			/>
			<Group grow gap="xs">
				{(["keyword", "alias", "version"] as const).map((action) => {
					const Icon =
						action === "keyword" ? Tag : action === "alias" ? Link : History;
					return (
						<Tooltip key={action} label={t(`selection.${action}`)}>
							<Button
								variant={action === kind ? "filled" : "default"}
								size="xs"
								px={6}
								leftSection={<Icon size={14} />}
								disabled={!canMutate || !selectedNovel?.id}
								onClick={() => choose(action)}
							>
								{t(`selection.${action}`)}
							</Button>
						</Tooltip>
					);
				})}
			</Group>
			<Tooltip
				label={
					configured ? t("selection.aiHelp") : t(availabilityKey(availability))
				}
			>
				<Switch
					label={
						<>
							{t("selection.ai")} <AiPrice feature="keyword_suggestion" />
						</>
					}
					checked={ai}
					onChange={(event) => setAi(event.currentTarget.checked)}
				/>
			</Tooltip>
			{ai && !configured && (
				<Text size="xs" c="dimmed">
					{t(availabilityKey(availability))} <GetLensesLink />
				</Text>
			)}
			{!canMutate && (
				<Text size="xs" c="dimmed">
					{t("auth.guestReadOnly")}
				</Text>
			)}
			{kind !== "keyword" && (
				<>
					<ParentKeywordSelect
						novelId={selectedNovel?.id ?? ""}
						value={parent?.id ?? null}
						onChange={setParent}
					/>
					<Tooltip label={t("selection.continue")} withArrow openDelay={350}>
						<Button disabled={!parent || !canMutate} onClick={() => submit()}>
							{t("selection.continue")}
						</Button>
					</Tooltip>
				</>
			)}
		</Stack>
	);
}
