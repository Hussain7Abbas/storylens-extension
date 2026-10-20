import { Alert, Select } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getKeywordCategoriesById } from "@/api/generated/endpoints/keyword-categories";
import { getKeywordNaturesById } from "@/api/generated/endpoints/keyword-natures";
import { MultiButtonsModal } from "@/components/multi-buttons-modal";
import { trackEvent } from "@/lib/analytics/client";
import { getStoredAuth } from "@/lib/auth/auth-storage";
import { isOfflineUnavailable, offlineDb } from "@/lib/offline/db";
import { offlineErrorMessage } from "@/lib/offline/errors";
import {
	useOfflineCategoryMutations,
	useOfflineKeywordCategories,
	useOfflineKeywordNatures,
	useOfflineNatureMutations,
} from "@/lib/offline/hooks";
import { isOnline } from "@/lib/offline/online-status";
import { useLanguage } from "@/store/locale";
import { displayNameIn } from "@/utils/translation";

type Props = {
	kind: "category" | "nature";
	id: string;
	onClose: () => void;
	onDeleted: () => void | Promise<void>;
};

async function lookupUsage(kind: Props["kind"], id: string) {
	const { user, token } = await getStoredAuth();
	const field = kind === "category" ? "categoryId" : "natureId";
	let localUsed = false,
		unsent = false;
	if (!isOfflineUnavailable()) {
		const db = offlineDb();
		const [versions, aliases, mutations] = await Promise.all([
			db.keywordVersions.toArray(),
			db.keywordAliases.toArray(),
			db.mutations.toArray(),
		]);
		localUsed =
			[...versions, ...aliases].some((row) => row[field] === id) ||
			mutations.some(
				(row) =>
					row.userId === user?.id &&
					row.op !== "delete" &&
					row.patch[field] === id,
			);
		unsent = mutations.some(
			(row) =>
				row.userId === user?.id && row.entityId === id && row.op === "create",
		);
	}
	if (unsent) return { used: localUsed, known: true };
	if (!isOnline()) return { used: localUsed, known: false };
	try {
		const options = {
			headers: { Authorization: `Bearer ${token}` },
			timeout: 8000,
		};
		const response =
			kind === "category"
				? await getKeywordCategoriesById(id, options)
				: await getKeywordNaturesById(id, options);
		return {
			used:
				localUsed ||
				response.data._count.keywordVersions > 0 ||
				response.data._count.keywordAliases > 0,
			known: true,
		};
	} catch {
		return { used: localUsed, known: false };
	}
}

export function LookupDeleteDialog({ kind, id, onClose, onDeleted }: Props) {
	const { t } = useTranslation();
	const language = useLanguage();
	const categories = useOfflineKeywordCategories();
	const natures = useOfflineKeywordNatures();
	const categoryMutations = useOfflineCategoryMutations();
	const natureMutations = useOfflineNatureMutations();
	const mutation =
		kind === "category"
			? categoryMutations.deleteMutation
			: natureMutations.deleteMutation;
	const rows = (kind === "category" ? categories.data : natures.data).filter(
		(row) => row.id !== id,
	);
	const choicesLoading =
		kind === "category" ? categories.isLoading : natures.isLoading;
	const usage = useQuery({
		queryKey: ["lookup-delete-usage", kind, id],
		queryFn: () => lookupUsage(kind, id),
		networkMode: "always",
		retry: false,
		staleTime: 0,
	});
	const [replacementId, setReplacementId] = useState<string | null>(null);
	const [selectionError, setSelectionError] = useState(false);
	const needsReplacement =
		!usage.isPending && (!usage.data || usage.data.used || !usage.data.known);
	const error = mutation.isError
		? offlineErrorMessage(mutation.error, t)
		: undefined;

	return (
		<MultiButtonsModal
			opened
			title={t(
				kind === "category"
					? "settings.deleteCategory"
					: "settings.deleteNature",
			)}
			busy={mutation.isPending}
			error={error}
			onClose={onClose}
			message={
				usage.isPending
					? t("settings.checkingLinkedData")
					: needsReplacement
						? t(
								usage.data?.known
									? "settings.migrateLinkedData"
									: "settings.migrateUnknownData",
							)
						: t("settings.deleteUnusedLookup")
			}
			buttons={[
				{
					id: "cancel",
					label: t("_.cancel"),
					variant: "default",
					autoFocus: true,
					onClick: onClose,
					disabled: choicesLoading,
				},
				{
					id: "delete",
					label: t(needsReplacement ? "settings.migrateAndDelete" : "_.delete"),
					type: "submit",
					color: "red",
					loading: mutation.isPending,
					disabled: usage.isPending || (needsReplacement && !rows.length),
				},
			]}
			onSubmit={(event) => {
				event.preventDefault();
				if (usage.isPending || (needsReplacement && !replacementId)) {
					setSelectionError(true);
					return;
				}
				mutation.mutate(
					{ id, ...(replacementId ? { replacementId } : {}) },
					{
						onSuccess: () => {
							trackEvent("lookup_deleted", { kind, migrated: !!replacementId });
							void onDeleted();
						},
					},
				);
			}}
		>
			{needsReplacement && (
				<Select
					label={t(
						kind === "category"
							? "settings.replacementCategory"
							: "settings.replacementNature",
					)}
					placeholder={t("settings.chooseReplacement")}
					data={rows.map((row) => ({
						value: row.id,
						label: displayNameIn(row, language),
					}))}
					searchable
					value={replacementId}
					onChange={(value) => {
						setReplacementId(value);
						setSelectionError(false);
					}}
					required
					disabled={mutation.isPending || choicesLoading}
					error={selectionError ? t("settings.chooseReplacement") : undefined}
				/>
			)}
			{needsReplacement && !rows.length && !choicesLoading && (
				<Alert color="yellow">{t("settings.noReplacementAvailable")}</Alert>
			)}
		</MultiButtonsModal>
	);
}
