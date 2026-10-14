// Free of React so content scripts can share the setting and its default.
export const TOOLTIP_TRIGGER_KEY = "storylens-tooltip-trigger";
export type TooltipTrigger = "hover" | "click";

export function parseTooltipTrigger(value: unknown): TooltipTrigger {
	return value === "hover" ? "hover" : "click";
}
