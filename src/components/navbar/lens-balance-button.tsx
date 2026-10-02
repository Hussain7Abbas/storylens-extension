import { Button, Tooltip } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { LensCoin } from "@/components/lens/lens-coin";
import { useLensLabel } from "@/components/lens/lens-price";
import { useAiSnapshot } from "@/lib/ai-source/hooks";
import { openLensPage } from "@/lib/cloud-ai/top-up";
import classes from "./navbar.module.css";
export function LensBalanceButton() {
	const { t, i18n } = useTranslation();
	const { user, pricing, balance, notices } = useAiSnapshot();
	const label = useLensLabel();
	if (!user) return null;
	const value = user.isGuest ? 0 : balance;
	const trial = pricing?.trialLenses ?? 0;
	const hint = user.isGuest
		? trial > 0
			? t("navbar.guestLenses", { lenses: label(trial) })
			: t("navbar.guestBuyLenses")
		: t("navbar.addLenses");
	return (
		<Tooltip label={hint} withArrow>
			<Button
				size="compact-xs"
				variant="subtle"
				color="var(--mantine-color-text)"
				px={4}
				className={notices.length ? classes.balancePulse : undefined}
				aria-label={value === null ? hint : `${label(value)}. ${hint}`}
				onClick={() => {
					void openLensPage({ reason: user.isGuest ? "guest" : "navbar" });
				}}
			>
				<LensCoin size={16} />
				<span style={{ marginInlineStart: 4 }}>
					{value === null
						? "—"
						: new Intl.NumberFormat(i18n.language, {
								notation: value >= 10_000 ? "compact" : "standard",
								maximumFractionDigits: 1,
							}).format(value)}
				</span>
			</Button>
		</Tooltip>
	);
}
