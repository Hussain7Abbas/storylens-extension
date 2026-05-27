import { Container, Stack, Tabs } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useIsAdmin } from "@/lib/auth";
import { AppearanceTab } from "./appearance-tab";
import { CategoryTab } from "./category-tab";
import { GeneralTab } from "./general-tab";
import { NatureTab } from "./nature-tab";

export function SettingsPage() {
	const { t } = useTranslation();
	const isAdmin = useIsAdmin();

	return (
		<Container p="md">
			<Tabs defaultValue={isAdmin ? "general" : "appearance"} variant="outline">
				<Stack
					gap="xs"
					pos="sticky"
					top={0}
					style={{
						zIndex: 2,
						["--popup-tabs-sticky-height" as string]:
							"calc(var(--mantine-spacing-xs) + 36px)",
					}}
					pt="xs"
					bg="var(--mantine-color-body)"
				>
					<Tabs.List grow>
						{isAdmin && (
							<Tabs.Tab value="general">{t("tabs.general")}</Tabs.Tab>
						)}
						{isAdmin && (
							<Tabs.Tab value="category">{t("tabs.category")}</Tabs.Tab>
						)}
						{isAdmin && (
							<Tabs.Tab value="nature">{t("tabs.nature")}</Tabs.Tab>
						)}
						<Tabs.Tab value="appearance">{t("tabs.appearance")}</Tabs.Tab>
					</Tabs.List>
				</Stack>
				{isAdmin && (
					<Tabs.Panel value="general">
						<GeneralTab />
					</Tabs.Panel>
				)}
				{isAdmin && (
					<Tabs.Panel value="category">
						<CategoryTab />
					</Tabs.Panel>
				)}
				{isAdmin && (
					<Tabs.Panel value="nature">
						<NatureTab />
					</Tabs.Panel>
				)}
				<Tabs.Panel value="appearance">
					<AppearanceTab />
				</Tabs.Panel>
			</Tabs>
		</Container>
	);
}
