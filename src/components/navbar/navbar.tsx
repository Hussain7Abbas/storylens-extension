import { ActionIcon, Group, Image, Title, Tooltip } from "@mantine/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import icon from "@/assets/icon.png";
import { useRoutes } from "@/hooks/useRoutes";
import { LensBalanceButton } from "./lens-balance-button";
import classes from "./navbar.module.css";
import { NavbarMenu } from "./navbar-menu";
import { SyncStatusButton } from "./sync-status-button";
export function Navbar() {
	const { t, i18n } = useTranslation();
	const dir = i18n.language === "ar" ? "rtl" : "ltr";
	const { canGoBack, current, back } = useRoutes();
	return (
		<Group
			justify="space-between"
			w="100%"
			px="xs"
			py="xs"
			className={classes.root}
			wrap="nowrap"
			gap={4}
			dir={dir}
		>
			<Group wrap="nowrap" gap={6} className={classes.brand}>
				<Image src={icon} alt="" w={26} h={26} />
				<Title order={4} textWrap="nowrap" className={classes.wordmark}>
					{t("extName")}
					<span className={classes.brandDot} aria-hidden>
						.
					</span>
				</Title>
			</Group>
			<Group wrap="nowrap" gap={2}>
				<LensBalanceButton />
				<SyncStatusButton t={t} />
				<NavbarMenu />
				{(canGoBack || current === "settings") && (
					<Tooltip label={t("_.back")}>
						<ActionIcon
							variant="subtle"
							color="var(--mantine-color-dimmed)"
							size="md"
							aria-label={t("_.back")}
							onClick={() => back()}
						>
							{dir === "rtl" ? (
								<ChevronRight strokeWidth={1.75} />
							) : (
								<ChevronLeft strokeWidth={1.75} />
							)}
						</ActionIcon>
					</Tooltip>
				)}
			</Group>
		</Group>
	);
}
