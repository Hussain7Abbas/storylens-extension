const REMOVABLE_TAGS = [
	"script",
	"style",
	"noscript",
	"svg",
	"iframe",
] as const;

export function sanitizePageHtml(
	root: HTMLElement = document.documentElement,
): string {
	const clone = root.cloneNode(true) as HTMLElement;

	for (const tag of REMOVABLE_TAGS) {
		for (const element of clone.querySelectorAll(tag)) {
			element.remove();
		}
	}

	return clone.outerHTML;
}
