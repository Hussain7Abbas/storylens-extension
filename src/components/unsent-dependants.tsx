import { Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { currentUserAtom } from "@/lib/auth/auth-store";
import { planDelete } from "@/lib/offline/outbox";

/**
 * Before deleting a row, lists the unsent changes made under it (aliases and
 * versions of a keyword created offline) that the delete also discards.
 */
export function UnsentDependants({ entityId }: { entityId: string }) {
	const { t } = useTranslation();
	const userId = useAtomValue(currentUserAtom)?.id;
	const { data } = useQuery({
		networkMode: "always",
		queryKey: ["offline", "plan-delete", entityId, userId],
		queryFn: () => planDelete(entityId, { userId }),
	});
	if (!data?.length) return null;
	return (
		<Text size="xs" c="red">
			{t("sync.deleteDiscardsUnsent", { count: data.length })}
		</Text>
	);
}
