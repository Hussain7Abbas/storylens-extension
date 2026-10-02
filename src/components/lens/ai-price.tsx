import { useAiSnapshot } from "@/lib/ai-source/hooks";
import type { AiFeature } from "@/lib/ai-source/source";
import { LensPrice } from "./lens-price";
export function AiPrice({
	feature,
	filled = false,
}: {
	feature: AiFeature;
	filled?: boolean;
}) {
	const { source, pricing } = useAiSnapshot();
	const lenses = pricing?.features.find((row) => row.key === feature)?.lenses;
	return source === "cloud" && lenses !== undefined && lenses > 0 ? (
		<LensPrice
			lenses={lenses}
			hideFree
			tone={filled ? "on-brand" : "default"}
		/>
	) : null;
}
