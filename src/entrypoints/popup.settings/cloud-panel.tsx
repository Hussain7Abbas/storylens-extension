import { Anchor, Group, Stack, Table, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { LensPrice } from "@/components/lens/lens-price";
import { useAiSnapshot } from "@/lib/ai-source/hooks";
import { openLensPage } from "@/lib/cloud-ai/top-up";
import { websitePageUrl } from "@/lib/website";
export function CloudPanel() {
	const { t, i18n } = useTranslation();
	const { pricing, balance, user } = useAiSnapshot();
	return (
		<Stack gap="xs">
			<Text size="sm">
				{t(
					!user
						? "cloud.signed-out"
						: user.isGuest
							? "cloud.guest"
							: "cloud.signedIn",
				)}
			</Text>
			<Text size="xs" role="status">
				{t(pricing?.cloudAi.enabled ? "cloud.available" : "cloud.cloud-off")}
			</Text>
			<Text size="xs">{t("cloud.disclosure")}</Text>
			<Anchor
				size="xs"
				href={websitePageUrl(i18n.language, "privacy/")}
				target="_blank"
				rel="noopener noreferrer"
			>
				{t("cloud.privacy")}
			</Anchor>
			<Group justify="space-between">
				<Text size="sm">
					{t("cloud.balance")}:{" "}
					{user?.isGuest ? (
						<LensPrice lenses={0} zeroAsFree={false} />
					) : balance === null ? (
						"—"
					) : (
						<LensPrice lenses={balance} zeroAsFree={false} />
					)}
				</Text>
				<Anchor
					component="button"
					size="xs"
					onClick={() => {
						void openLensPage({ reason: user?.isGuest ? "guest" : "settings" });
					}}
				>
					{t("cloud.getLenses")}
				</Anchor>
			</Group>
			<Table>
				<Table.Caption>{t("cloud.prices")}</Table.Caption>
				<Table.Tbody>
					{pricing?.features.map((feature) => (
						<Table.Tr key={feature.key}>
							<Table.Th scope="row">
								{i18n.language === "ar" ? feature.nameAr : feature.nameEn}
							</Table.Th>
							<Table.Td>
								<LensPrice lenses={feature.lenses} />
								{!feature.enabled && (
									<Text size="xs">{t("cloud.feature-off")}</Text>
								)}
							</Table.Td>
						</Table.Tr>
					))}
				</Table.Tbody>
			</Table>
		</Stack>
	);
}
