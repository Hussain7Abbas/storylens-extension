import { useMutation, useQueryClient } from "@tanstack/react-query";
import { t } from "i18next";
import toast from "react-hot-toast";
import { sendMessage } from "@/entrypoints/background/messaging";
import {
	type AliasValues,
	type EnqueueInput,
	type EnqueueResult,
	enqueue,
	type KeywordFields,
	type KeywordValues,
	type LookupValues,
	type QueuedImage,
	type ReplacementValues,
	type Update,
	type VersionFields,
	type VersionValues,
} from "@/lib/offline/outbox";
import { refreshContentScript } from "@/utils/refresh-content-script";
import { OFFLINE_QUERY_KEY } from "./reads";

export type {
	AliasValues,
	KeywordFields,
	KeywordValues,
	LookupValues,
	QueuedImage,
	ReplacementValues,
	Update,
	VersionFields,
	VersionValues,
};
export type CategoryFormValues = LookupValues;
export type NatureFormValues = LookupValues;

/**
 * Writes go through `enqueue` only: the change is durable in the outbox before
 * this returns, whether online or offline. Afterwards (best effort) the
 * background is kicked to send it and the active tab re-highlights.
 */
function useEnqueue<TInput>(
	toInput: (input: TInput) => EnqueueInput,
	refreshPage = true,
) {
	const queryClient = useQueryClient();
	return useMutation<EnqueueResult, Error, TInput>({
		networkMode: "always",
		mutationFn: (input) => enqueue(toInput(input)),
		onSuccess: async (result) => {
			if (result.warning === "QUEUED_IMAGES_LARGE")
				toast(t("offline.queuedImagesLarge"));
			await queryClient.invalidateQueries({ queryKey: [OFFLINE_QUERY_KEY] });
			void sendMessage("syncKick", { reason: "enqueue" }).catch(
				() => undefined,
			);
			if (refreshPage) void refreshContentScript().catch(() => false);
		},
	});
}

type WithImage<T> = T & { image?: QueuedImage };

export function useOfflineKeywordMutations(novelId: string) {
	const createMutation = useEnqueue(
		({ image, ...values }: WithImage<KeywordValues>) => ({
			entity: "keyword",
			op: "create",
			novelId,
			values,
			image,
		}),
	);
	const updateMutation = useEnqueue(
		(input: { id: string } & Update<KeywordFields>) => ({
			entity: "keyword",
			op: "update",
			...input,
		}),
	);
	const deleteMutation = useEnqueue((id: string) => ({
		entity: "keyword",
		op: "delete",
		id,
	}));
	return { createMutation, updateMutation, deleteMutation };
}

export function useOfflineKeywordAliasMutations(_novelId?: string) {
	const createMutation = useEnqueue(
		({
			keywordId,
			image,
			...values
		}: WithImage<AliasValues> & { keywordId: string }) => ({
			entity: "keywordAlias",
			op: "create",
			keywordId,
			values,
			image,
		}),
	);
	const updateMutation = useEnqueue(
		(input: { id: string; image?: QueuedImage } & Update<AliasValues>) => ({
			entity: "keywordAlias",
			op: "update",
			...input,
		}),
	);
	const deleteMutation = useEnqueue((id: string) => ({
		entity: "keywordAlias",
		op: "delete",
		id,
	}));
	return { createMutation, updateMutation, deleteMutation };
}

export function useOfflineKeywordVersionMutations(_novelId?: string) {
	const createMutation = useEnqueue(
		({
			keywordId,
			image,
			...values
		}: WithImage<VersionValues> & { keywordId: string }) => ({
			entity: "keywordVersion",
			op: "create",
			keywordId,
			values,
			image,
		}),
	);
	const updateMutation = useEnqueue(
		(input: { id: string; image?: QueuedImage } & Update<VersionFields>) => ({
			entity: "keywordVersion",
			op: "update",
			...input,
		}),
	);
	const deleteMutation = useEnqueue((id: string) => ({
		entity: "keywordVersion",
		op: "delete",
		id,
	}));
	return { createMutation, updateMutation, deleteMutation };
}

export function useOfflineReplacementMutations(novelId: string) {
	const createMutation = useEnqueue((values: ReplacementValues) => ({
		entity: "replacement",
		op: "create",
		novelId,
		values,
	}));
	const updateMutation = useEnqueue(
		(input: { id: string } & Update<ReplacementValues>) => ({
			entity: "replacement",
			op: "update",
			...input,
		}),
	);
	const deleteMutation = useEnqueue((id: string) => ({
		entity: "replacement",
		op: "delete",
		id,
	}));
	return { createMutation, updateMutation, deleteMutation };
}

function useLookupMutations(entity: "keywordCategory" | "keywordNature") {
	const createMutation = useEnqueue(
		(values: LookupValues) => ({ entity, op: "create", values }),
		false,
	);
	const updateMutation = useEnqueue(
		(input: { id: string } & Update<LookupValues>) => ({
			entity,
			op: "update",
			...input,
		}),
		false,
	);
	const deleteMutation = useEnqueue(
		(id: string) => ({ entity, op: "delete", id }),
		false,
	);
	return { createMutation, updateMutation, deleteMutation };
}

export function useOfflineCategoryMutations() {
	return useLookupMutations("keywordCategory");
}

export function useOfflineNatureMutations() {
	return useLookupMutations("keywordNature");
}
