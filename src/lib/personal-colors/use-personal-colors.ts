import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { browser } from "#imports";
import { sendMessage } from "@/entrypoints/background/messaging";
import { currentUserAtom } from "@/lib/auth";
import {
	type ColorChange,
	lookupColor,
	parseColorPreferences,
	personalColorsKey,
} from "./types";

export function usePersonalColors() {
	const user = useAtomValue(currentUserAtom);
	const userId = user?.id;
	const client = useQueryClient();
	const key = personalColorsKey(userId ?? "");
	const queryKey = ["personal-colors", userId];
	const query = useQuery({
		queryKey,
		networkMode: "always",
		queryFn: async () => {
			const data = userId ? await browser.storage.local.get(key) : {};
			return parseColorPreferences(data[key]);
		},
	});
	useEffect(() => {
		const onChanged: Parameters<
			typeof browser.storage.onChanged.addListener
		>[0] = (changes, area) => {
			if (area === "local" && key in changes)
				client.setQueryData(
					["personal-colors", userId],
					parseColorPreferences(changes[key].newValue),
				);
		};
		browser.storage.onChanged.addListener(onChanged);
		return () => browser.storage.onChanged.removeListener(onChanged);
	}, [client, key, userId]);
	const state = query.data ?? parseColorPreferences(undefined);
	return {
		...state,
		isLoading: query.isLoading,
		userId,
		colorFor: (kind: ColorChange["kind"], row: { id: string; color: string }) =>
			lookupColor(state.colors, kind, row),
		save: async (change: ColorChange) => {
			if (!userId) throw new Error("Sign in first");
			await sendMessage("savePersonalColor", { userId, ...change });
			await client.invalidateQueries({ queryKey });
		},
	};
}
