import {
	emptyColors,
	type LookupKind,
	lookupColor,
	parsePersonalColors,
} from "@/lib/personal-colors/types";

let colors = emptyColors();
/** Remember original values on display nodes so live changes never rebuild text or tooltips. */
export function applyLookupColor(
	element: HTMLElement,
	kind: LookupKind,
	row: { id: string; color: string },
	property: "color" | "background-color" = "color",
): void {
	element.dataset.storylensColorKind = kind;
	element.dataset.storylensColorId = row.id;
	element.dataset.storylensOriginalColor = row.color;
	element.dataset.storylensColorProperty = property;
	element.style.setProperty(
		property,
		lookupColor(colors, kind, row),
		"important",
	);
}
export function setPersonalColors(value: unknown): void {
	colors = parsePersonalColors(value);
	for (const element of document.querySelectorAll<HTMLElement>(
		"[data-storylens-color-kind]",
	)) {
		const {
			storylensColorKind: kind,
			storylensColorId: id,
			storylensOriginalColor: color,
			storylensColorProperty: property,
		} = element.dataset;
		if ((kind === "category" || kind === "nature") && id && color)
			applyLookupColor(
				element,
				kind,
				{ id, color },
				property === "background-color" ? property : "color",
			);
	}
}
