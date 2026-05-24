import { cleanNovelTitle } from "@/lib/utils/novel-title";

function getRawTextFromXpath(xpath: string, document: Document): string {
	const element = document.evaluate(
		xpath,
		document,
		null,
		XPathResult.FIRST_ORDERED_NODE_TYPE,
		null,
	);
	return (
		element.singleNodeValue?.textContent
			?.replaceAll("\n", " ")
			.replace(/\s+/g, " ")
			.trim() ?? ""
	);
}

export function extractNovelNameFromXpath(
	xpath: string,
	regex: string,
	document: Document,
): string | null {
	const textContent = getRawTextFromXpath(xpath, document);
	if (!textContent) {
		return null;
	}

	try {
		const match = textContent.match(regex);
		if (match) {
			const captured = match[1] ?? match[0];
			if (captured) {
				const cleaned = cleanNovelTitle(captured);
				if (cleaned.length >= 2) {
					return cleaned;
				}
			}
		}
	} catch {
		// Fall through to cleaning the full xpath text.
	}

	const cleaned = cleanNovelTitle(textContent);
	return cleaned.length >= 2 ? cleaned : null;
}

export function extractFromXpath(
	xpath: string,
	regex: string,
	document: Document,
): string | null {
	const textContent = getRawTextFromXpath(xpath, document);
	if (!textContent) {
		return null;
	}

	const match = textContent.match(regex);
	return match ? (match[1] ?? match[0]) : null;
}

export { cleanNovelTitle };
