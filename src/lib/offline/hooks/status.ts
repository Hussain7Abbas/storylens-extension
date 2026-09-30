import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { sendMessage } from "@/entrypoints/background/messaging";
import { currentUserAtom } from "@/lib/auth/auth-store";
import { listMutations } from "@/lib/offline/outbox";
import type { SyncStatus } from "@/lib/offline/sync/status";
import type { Mutation } from "@/lib/offline/types";
import { OFFLINE_QUERY_KEY } from "./reads";

/** Every mutation in the outbox (all accounts), for the status page and counts. */
export function useOutbox(): { mutations: Mutation[]; isLoading: boolean } {
	const query = useQuery({
		networkMode: "always",
		queryKey: [OFFLINE_QUERY_KEY, "outbox"],
		queryFn: () => listMutations(),
	});
	return { mutations: query.data ?? [], isLoading: query.isLoading };
}

/** Runner state, counts and last sync times from the background. */
export function useSyncStatus(): SyncStatus | undefined {
	const query = useQuery({
		networkMode: "always",
		queryKey: [OFFLINE_QUERY_KEY, "sync-status"],
		queryFn: () => sendMessage("getSyncStatus"),
		refetchInterval: 10_000,
	});
	return query.data;
}

/** Unsent changes of the signed-in account. */
export function usePendingSyncCount(): number {
	const userId = useAtomValue(currentUserAtom)?.id;
	const { mutations } = useOutbox();
	return mutations.filter((mutation) => mutation.userId === userId).length;
}

/** IDs of entities with unresolved changes of the signed-in account (list badges). */
export function usePendingEntityIds(): Set<string> {
	const userId = useAtomValue(currentUserAtom)?.id;
	const { mutations } = useOutbox();
	return useMemo(
		() =>
			new Set(
				mutations
					.filter((mutation) => mutation.userId === userId)
					.map((mutation) => mutation.entityId),
			),
		[mutations, userId],
	);
}
