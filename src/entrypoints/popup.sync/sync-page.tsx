import {
	Accordion,
	Alert,
	Badge,
	Button,
	Card,
	Container,
	Group,
	Image,
	SegmentedControl,
	Stack,
	Table,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { Copy as IconCopy } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { sendMessage } from "@/entrypoints/background/messaging";
import { useRoutes } from "@/hooks/useRoutes";
import { trackEvent } from "@/lib/analytics/client";
import { currentUserAtom } from "@/lib/auth/auth-store";
import { offlineDb } from "@/lib/offline/db";
import {
	describeEntity,
	type IssueKind,
	issueKind,
} from "@/lib/offline/describe";
import { offlineErrorMessage } from "@/lib/offline/errors";
import {
	useCachedNovelsList,
	useOfflineKeywordCategories,
	useOfflineKeywordNatures,
	useOutbox,
} from "@/lib/offline/hooks";
import {
	applyResolution,
	dependantsOf,
	discardMutation,
	type Resolution,
} from "@/lib/offline/outbox";
import { tableOf } from "@/lib/offline/snapshot";
import type { Mutation } from "@/lib/offline/types";
import { websitePageUrl } from "@/lib/website";
import { localeAtom, useLanguage } from "@/store/locale";
import { showExistingAtom } from "@/store/show-existing";
import { type Language, nameIn, nameKey } from "@/utils/translation";

type Resolved =
	| "keep_mine"
	| "use_theirs"
	| "merge"
	| "edit"
	| "discard"
	| "recreate"
	| "sign_in";

function kick() {
	void sendMessage("syncKick", { reason: "enqueue" }).catch(() => undefined);
}

/** Snapshot rows of the outbox's entities, for readable names. */
function useSnapshotRows(mutations: Mutation[]) {
	return useQuery({
		networkMode: "always",
		queryKey: [
			"offline",
			"sync-page-rows",
			mutations.map((mutation) => mutation.entityId).join(","),
		],
		queryFn: async () => {
			const db = offlineDb();
			const rows = new Map<string, Record<string, unknown>>();
			for (const mutation of mutations) {
				const table = tableOf(mutation.entity);
				if (!table) continue;
				const row = await (
					db[table] as { get(id: string): Promise<unknown> }
				).get(mutation.entityId);
				if (row) rows.set(mutation.entityId, row as Record<string, unknown>);
			}
			return rows;
		},
	});
}

const CHAPTER_FIELDS = new Set(["startingChapter", "currentChapter"]);

/** The field a reader fixes when a change is refused: its name, `from`, or its start chapter. */
function editableField(mutation: Mutation, language: Language): string {
	if (mutation.entity === "replacement") return "from";
	if (mutation.entity === "keywordVersion")
		return "startingChapter" in mutation.patch
			? "startingChapter"
			: "currentChapter";
	return nameKey(language);
}

type Lookups = {
	categories: { id: string; nameAr: string | null; nameEn: string | null }[];
	natures: { id: string; nameAr: string | null; nameEn: string | null }[];
};

/** A field value as the reader knows it: lookup names, chapters and labels instead of IDs. */
function formatValue(
	field: string,
	value: unknown,
	t: TFunction,
	lookups: Lookups,
	language: Language,
): string {
	if (value === null || value === undefined || value === "")
		return t("sync.empty");
	if (field === "categoryId" || field === "natureId") {
		const rows = field === "categoryId" ? lookups.categories : lookups.natures;
		const row = rows.find((item) => item.id === value);
		return row
			? nameIn(row, language) || row.nameAr || row.nameEn || t("sync.unknown")
			: t("sync.unknown");
	}
	if (
		field === "startingChapter" ||
		field === "endingChapter" ||
		field === "currentChapter"
	)
		return `ch.${value}`;
	if (field === "imageId") return t("sync.image");
	if (value === "FULL" || value === "PARTIAL")
		return t(`sync.matching.${value}`);
	if (typeof value === "boolean") return value ? t("sync.yes") : t("sync.no");
	return String(value);
}

/** A value cell; an image the server holds shows as a thumbnail. */
function ValueCell({
	field,
	value,
	image,
	t,
	lookups,
	language,
}: {
	field: string;
	value: unknown;
	image: string | null;
	t: TFunction;
	lookups: Lookups;
	language: Language;
}) {
	if (field === "imageId" && value && image) {
		return (
			<Image
				src={image}
				alt={t("sync.image")}
				w={32}
				h={32}
				radius="sm"
				fit="cover"
			/>
		);
	}
	return <>{formatValue(field, value, t, lookups, language)}</>;
}

function StaleTable({
	mutation,
	choices,
	onChange,
	t,
	lookups,
	language,
}: {
	lookups: Lookups;
	language: Language;
	mutation: Mutation;
	choices: Record<string, "mine" | "theirs">;
	onChange: (field: string, choice: "mine" | "theirs") => void;
	t: TFunction;
}) {
	const server = mutation.conflict?.server as
		| { image?: { url?: string } | null }
		| null
		| undefined;
	const serverImage = server?.image?.url ?? null;
	return (
		<Table withTableBorder striped fz="xs" aria-label={t("sync.fieldsTable")}>
			<Table.Thead>
				<Table.Tr>
					<Table.Th>{t("sync.field")}</Table.Th>
					<Table.Th>{t("sync.yours")}</Table.Th>
					<Table.Th>{t("sync.theirs")}</Table.Th>
					<Table.Th>{t("sync.original")}</Table.Th>
					<Table.Th>{t("sync.choice")}</Table.Th>
				</Table.Tr>
			</Table.Thead>
			<Table.Tbody>
				{(mutation.conflict?.fields ?? []).map((item) => (
					<Table.Tr key={item.field}>
						<Table.Td>
							{t(`sync.fields.${item.field}`, { defaultValue: item.field })}
						</Table.Td>
						<Table.Td dir="auto">
							<ValueCell
								field={item.field}
								value={item.mine}
								image={null}
								t={t}
								lookups={lookups}
								language={language}
							/>
						</Table.Td>
						<Table.Td dir="auto">
							<ValueCell
								field={item.field}
								value={item.theirs}
								image={serverImage}
								t={t}
								lookups={lookups}
								language={language}
							/>
						</Table.Td>
						<Table.Td dir="auto">
							<ValueCell
								field={item.field}
								value={item.base}
								image={null}
								t={t}
								lookups={lookups}
								language={language}
							/>
						</Table.Td>
						<Table.Td>
							<SegmentedControl
								size="xs"
								value={choices[item.field] ?? "mine"}
								onChange={(value) =>
									onChange(item.field, value as "mine" | "theirs")
								}
								data={[
									{ value: "mine", label: t("sync.keepMine") },
									{ value: "theirs", label: t("sync.useTheirs") },
								]}
							/>
						</Table.Td>
					</Table.Tr>
				))}
			</Table.Tbody>
		</Table>
	);
}

function IssueCard({
	mutation,
	kind,
	name,
	novel,
	all,
	t,
	language,
	lookups,
	onResolved,
}: {
	mutation: Mutation;
	kind: IssueKind;
	name: string;
	novel: string;
	all: Mutation[];
	t: TFunction;
	language: Language;
	lookups: Lookups;
	onResolved: () => void;
}) {
	const { goHome } = useRoutes();
	const setShowExisting = useSetAtom(showExistingAtom);
	const queryClient = useQueryClient();
	const locale = useAtomValue(localeAtom);
	const [busy, setBusy] = useState(false);
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const [choices, setChoices] = useState<Record<string, "mine" | "theirs">>({});
	const editField = editableField(mutation, language);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(String(mutation.patch[editField] ?? ""));
	const dependants = useMemo(
		() =>
			mutation.op === "create" ? dependantsOf(all, mutation.entityId) : [],
		[all, mutation],
	);

	const act = async (resolution: Resolved, run: () => Promise<unknown>) => {
		setBusy(true);
		try {
			await run();
			trackEvent("sync_issue_resolved", { kind, resolution });
			kick();
			await queryClient.invalidateQueries({ queryKey: ["offline"] });
			onResolved();
		} catch (error) {
			toast.error(offlineErrorMessage(error, t));
		} finally {
			setBusy(false);
		}
	};
	const resolve = (resolution: Resolved, value: Resolution) =>
		act(resolution, () => applyResolution(mutation.id, value));
	const discard = () =>
		act("discard", () =>
			discardMutation(mutation.id, { withDependants: true }),
		);
	const copyText = () =>
		void navigator.clipboard
			?.writeText(name)
			.then(() => toast.success(t("sync.copied")));

	const explanation =
		kind === "duplicate" || kind === "rule"
			? (mutation.lastError?.message ?? t(`sync.kind.${kind}`))
			: t(`sync.kind.${kind}`, { user: mutation.userLabel });

	return (
		<Card
			withBorder
			p="xs"
			tabIndex={-1}
			data-issue-card
			aria-label={`${t(`sync.entity.${mutation.entity}`)} ${name}: ${t(`sync.kindTitle.${kind}`)}`}
		>
			<Stack gap={6}>
				<Group justify="space-between" wrap="nowrap" gap="xs">
					<Text size="sm" fw={600} dir="auto" lineClamp={1}>
						{name || t(`sync.entity.${mutation.entity}`)}
					</Text>
					<Badge
						size="xs"
						variant="light"
						color={kind === "other-account" ? "gray" : "red"}
					>
						{t(`sync.kindTitle.${kind}`)}
					</Badge>
				</Group>
				<Text size="xs" c="dimmed">
					{t(`sync.entity.${mutation.entity}`)}
					{novel ? ` · ${novel}` : ""}
				</Text>
				<Text size="xs">{explanation}</Text>

				{kind === "stale" && (
					<StaleTable
						mutation={mutation}
						choices={choices}
						t={t}
						lookups={lookups}
						language={language}
						onChange={(field, choice) =>
							setChoices((current) => ({ ...current, [field]: choice }))
						}
					/>
				)}

				{editing && (
					<Group gap="xs" wrap="nowrap" align="flex-end">
						<TextInput
							size="xs"
							style={{ flex: 1 }}
							dir="auto"
							label={t(`sync.fields.${editField}`, { defaultValue: editField })}
							value={draft}
							onChange={(event) => setDraft(event.currentTarget.value)}
						/>
						<Button
							size="xs"
							loading={busy}
							onClick={() =>
								void resolve("edit", {
									kind: "edit",
									patch: {
										[editField]: CHAPTER_FIELDS.has(editField)
											? Number(draft)
											: draft.trim(),
									},
								}).then(() => setEditing(false))
							}
						>
							{t("_.save")}
						</Button>
					</Group>
				)}

				{confirmDiscard ? (
					<Alert color="red" variant="light" p="xs">
						<Stack gap={4}>
							<Text size="xs">{t("sync.confirmDiscard")}</Text>
							{dependants.length > 0 && (
								<Text size="xs">
									{t("sync.discardDependants", { count: dependants.length })}
								</Text>
							)}
							<Group gap="xs">
								<Button
									size="compact-xs"
									color="red"
									loading={busy}
									onClick={() => void discard()}
								>
									{t("sync.discard")}
								</Button>
								<Button
									size="compact-xs"
									variant="default"
									onClick={() => setConfirmDiscard(false)}
								>
									{t("_.cancel")}
								</Button>
							</Group>
						</Stack>
					</Alert>
				) : (
					<Group gap="xs">
						{kind === "stale" && (
							<>
								<Button
									size="compact-xs"
									loading={busy}
									onClick={() =>
										void resolve("merge", { kind: "fields", choices })
									}
								>
									{t("sync.apply")}
								</Button>
								<Button
									size="compact-xs"
									variant="light"
									loading={busy}
									onClick={() =>
										void resolve("keep_mine", { kind: "keepAllMine" })
									}
								>
									{t("sync.keepAllMine")}
								</Button>
								<Button
									size="compact-xs"
									variant="light"
									loading={busy}
									onClick={() =>
										void resolve("use_theirs", { kind: "useAllTheirs" })
									}
								>
									{t("sync.useAllTheirs")}
								</Button>
							</>
						)}
						{kind === "deleted" && (
							<Button
								size="compact-xs"
								variant="light"
								loading={busy}
								onClick={() =>
									void resolve("recreate", { kind: "createAgain" })
								}
							>
								{t("sync.createAgain")}
							</Button>
						)}
						{mutation.conflict?.hint === "create-again" && kind === "rule" && (
							<Button
								size="compact-xs"
								variant="light"
								loading={busy}
								onClick={() =>
									void resolve("recreate", { kind: "createAgain" })
								}
							>
								{t("sync.createAgain")}
							</Button>
						)}
						{(kind === "duplicate" || kind === "rule") &&
							mutation.op !== "delete" && (
								<Button
									size="compact-xs"
									variant="light"
									loading={busy}
									onClick={() =>
										void resolve("edit", { kind: "edit", patch: {} })
									}
								>
									{t("sync.retry")}
								</Button>
							)}
						{kind === "duplicate" && mutation.entity === "keyword" && (
							<Button
								size="compact-xs"
								variant="subtle"
								onClick={() => {
									setShowExisting({
										novelId: mutation.novelId ?? undefined,
										search: name,
									});
									goHome();
								}}
							>
								{t("sync.showExisting")}
							</Button>
						)}
						{kind === "parent-missing" && name && (
							<Button
								size="compact-xs"
								variant="subtle"
								leftSection={<IconCopy size={12} />}
								onClick={copyText}
							>
								{t("sync.copy")}
							</Button>
						)}
						{kind === "other-account" && (
							<Button
								size="compact-xs"
								variant="light"
								component="a"
								href={websitePageUrl(locale, "profile/login/")}
								target="_blank"
								rel="noopener noreferrer"
								onClick={() =>
									trackEvent("sync_issue_resolved", {
										kind,
										resolution: "sign_in",
									})
								}
							>
								{t("sync.signIn")}
							</Button>
						)}
						<Button
							size="compact-xs"
							variant="subtle"
							color="red"
							onClick={() => setConfirmDiscard(true)}
						>
							{t("sync.discard")}
						</Button>
					</Group>
				)}
			</Stack>
		</Card>
	);
}

/** Everything that did not sync automatically, explained, with one- or two-click fixes (phase 7). */
export function SyncPage() {
	const { t } = useTranslation();
	const language = useLanguage();
	const userId = useAtomValue(currentUserAtom)?.id;
	const { mutations } = useOutbox();
	const { novels } = useCachedNovelsList();
	const rows = useSnapshotRows(mutations).data ?? new Map();
	const lookups = {
		categories: useOfflineKeywordCategories().data,
		natures: useOfflineKeywordNatures().data,
	};
	const container = useRef<HTMLDivElement>(null);
	/** After a resolution, focus the card that took its place (or the one before). */
	const focusAfter = (index: number) => () => {
		requestAnimationFrame(() => {
			const cards =
				container.current?.querySelectorAll<HTMLElement>("[data-issue-card]") ??
				[];
			(cards[index] ?? cards[index - 1])?.focus();
		});
	};
	const novelName = (novelId: string | null) => {
		const novel = novels.find((item) => item.id === novelId);
		return novel ? nameIn(novel, language) : "";
	};
	const issues = mutations.filter(
		(mutation) =>
			mutation.entity !== "file" &&
			issueKind(mutation, userId) &&
			issueKind(mutation, userId) !== "other-account",
	);
	const otherAccount = mutations.filter(
		(mutation) => mutation.userId !== userId && mutation.entity !== "file",
	);
	const waiting = mutations.filter(
		(mutation) => mutation.userId === userId && !issueKind(mutation, userId),
	);
	const card = (mutation: Mutation, index: number) => {
		const kind = issueKind(mutation, userId) ?? "rule";
		return (
			<IssueCard
				key={mutation.id}
				mutation={mutation}
				kind={kind}
				name={describeEntity(mutation, language, rows.get(mutation.entityId))}
				novel={novelName(mutation.novelId)}
				all={mutations}
				t={t}
				language={language}
				lookups={lookups}
				onResolved={focusAfter(index)}
			/>
		);
	};

	return (
		<Container p="md" ref={container}>
			<Stack gap="sm">
				<Title order={4}>{t("sync.title")}</Title>
				{!issues.length && !otherAccount.length && !waiting.length && (
					<Text size="sm" c="dimmed">
						{t("sync.allSynced")}
					</Text>
				)}
				{issues.length > 0 && (
					<Stack
						gap="xs"
						role="list"
						aria-label={t("sync.needsAttentionTitle")}
					>
						<Text size="sm" fw={600}>
							{t("sync.needsAttentionTitle")} ({issues.length})
						</Text>
						{issues.map(card)}
					</Stack>
				)}
				{otherAccount.length > 0 && (
					<Stack gap="xs">
						<Text size="sm" fw={600}>
							{t("sync.otherAccountTitle", {
								user: otherAccount[0]?.userLabel ?? "",
							})}
						</Text>
						{otherAccount.map((mutation, index) =>
							card(mutation, issues.length + index),
						)}
					</Stack>
				)}
				{waiting.length > 0 && (
					<Accordion variant="contained">
						<Accordion.Item value="waiting">
							<Accordion.Control>
								{t("sync.waitingTitle")} ({waiting.length})
							</Accordion.Control>
							<Accordion.Panel>
								<Stack gap={4}>
									{waiting.map((mutation) => (
										<Group
											key={mutation.id}
											justify="space-between"
											wrap="nowrap"
											gap="xs"
										>
											<Text size="xs" dir="auto" lineClamp={1}>
												{t(`sync.entity.${mutation.entity}`)} ·{" "}
												{describeEntity(
													mutation,
													language,
													rows.get(mutation.entityId),
												)}
											</Text>
											<Text size="xs" c="dimmed">
												{mutation.status === "inflight"
													? t("sync.sending")
													: mutation.lastError
														? t("sync.nextAttempt", {
																time: new Date(
																	mutation.nextAttemptAt,
																).toLocaleTimeString(language),
																error: mutation.lastError.message,
															})
														: t("sync.waiting")}
											</Text>
										</Group>
									))}
								</Stack>
							</Accordion.Panel>
						</Accordion.Item>
					</Accordion>
				)}
			</Stack>
		</Container>
	);
}
