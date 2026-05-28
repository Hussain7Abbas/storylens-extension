import { Button, Group, NumberInput, Paper, Stack, Text } from "@mantine/core";
import { useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { usePostWebsiteNovelBiases } from "@/api/generated/endpoints/website-novel-biases.js";
import { replaceBiasesForNovel } from "@/lib/offline/db";
import type { OfflineWebsiteNovelBias } from "@/lib/offline/types";

type Props = {
	novelId: string;
	websiteSelectorId: string;
	websiteName: string;
	currentBias: number;
	onClose: () => void;
	onSaved: (updatedBiases: OfflineWebsiteNovelBias[]) => void;
};

export function WebsiteNovelBiasForm({
	novelId,
	websiteSelectorId,
	websiteName,
	currentBias,
	onClose,
	onSaved,
}: Props) {
	const { t } = useTranslation();
	const [biasValue, setBiasValue] = useState<number>(currentBias);

	const mutation = usePostWebsiteNovelBiases({
		mutation: {
			onSuccess: async (response) => {
				const bias = response?.data ?? null;
				const updated: OfflineWebsiteNovelBias[] = bias
					? [bias as unknown as OfflineWebsiteNovelBias]
					: [];
				await replaceBiasesForNovel(novelId, updated);
				onSaved(updated);

				if (biasValue === 0) {
					toast.success(t("home.chapterBiasResetSuccessfully"));
				} else {
					toast.success(t("home.chapterBiasSavedSuccessfully"));
				}
				onClose();
			},
			onError: () => {
				toast.error(
					biasValue === 0
						? t("home.chapterBiasResetFailed")
						: t("home.chapterBiasSaveFailed"),
				);
			},
		},
	});

	const handleSave = () => {
		mutation.mutate({
			data: { websiteSelectorId, novelId, biasValue },
		});
	};

	return (
		<Paper p="xs" withBorder>
			<Stack gap="xs">
				<Group gap="xs">
					<Text size="sm" c="dimmed">
						{t("home.chapterBiasWebsite")}:
					</Text>
					<Text size="sm" fw={500}>
						{websiteName}
					</Text>
				</Group>
				<NumberInput
					label={t("home.chapterBiasValue")}
					description={t("home.chapterBiasValueHint")}
					value={biasValue}
					onChange={(v) => setBiasValue(typeof v === "number" ? v : 0)}
					allowDecimal={false}
					prefix={biasValue > 0 ? "+" : undefined}
				/>
				<Group grow>
					<Button
						variant="outline"
						onClick={onClose}
						loading={mutation.isPending}
					>
						{t("_.cancel")}
					</Button>
					<Button onClick={handleSave} loading={mutation.isPending}>
						{t("_.save")}
					</Button>
				</Group>
			</Stack>
		</Paper>
	);
}
