import { VisuallyHidden } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { formatLenses } from "@/lib/lens-coin";
import { LensCoin } from "./lens-coin";

/** "3 lenses" / "3 عدسات" in the UI language, for accessible names and tooltips. */
export function useLensLabel(): (lenses: number) => string {
	const { t, i18n } = useTranslation();
	return (lenses) =>
		t("lens.count", {
			count: lenses,
			formatted: formatLenses(lenses, i18n.language),
		});
}

/**
 * A coin and an amount, the only way the extension shows a price. `0` reads
 * "Free" unless `hideFree`, for buttons of free features; account balances pass `zeroAsFree={false}`. `on-brand` uses the
 * line coin in the text color, for filled iris buttons.
 */
export function LensPrice({
	lenses,
	tone = "default",
	size = 16,
	hideFree = false,
	zeroAsFree = true,
}: {
	lenses: number;
	tone?: "default" | "on-brand";
	size?: number;
	hideFree?: boolean;
	zeroAsFree?: boolean;
}) {
	const { t, i18n } = useTranslation();
	const label = useLensLabel();
	if (lenses === 0 && zeroAsFree)
		return hideFree ? null : <span>{t("lens.free")}</span>;
	return (
		<span
			title={label(lenses)}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				fontVariantNumeric: "tabular-nums",
			}}
		>
			<LensCoin size={size} variant={tone === "on-brand" ? "mono" : "color"} />
			<span aria-hidden="true">{formatLenses(lenses, i18n.language)}</span>
			<VisuallyHidden>{label(lenses)}</VisuallyHidden>
		</span>
	);
}
