/** Remove interactive/private nodes before either source sees a page. */
export function cleanSummaryBody(body: HTMLElement): HTMLElement {
	const clone = body.cloneNode(true) as HTMLElement;
	const originals = Array.from(body.querySelectorAll("*"));
	const copies = Array.from(clone.querySelectorAll("*"));
	for (let index = 0; index < originals.length; index++) {
		const style = body.ownerDocument.defaultView?.getComputedStyle(
			originals[index],
		);
		if (style?.display === "none" || style?.visibility === "hidden")
			copies[index]?.remove();
	}
	for (const element of clone.querySelectorAll(
		"#storylens-page-summary, #storylens-page-launcher, script, style, noscript, iframe, frame, object, embed, form, input, textarea, select, button, template, [hidden], [aria-hidden='true'], [style*='display: none'], [style*='display:none'], [style*='visibility: hidden']",
	))
		element.remove();
	for (const element of clone.querySelectorAll("*"))
		for (const attribute of Array.from(element.attributes))
			if (
				/^on/i.test(attribute.name) ||
				attribute.name === "value" ||
				attribute.name === "contenteditable"
			)
				element.removeAttribute(attribute.name);
	return clone;
}
export function summaryBodyText(body: HTMLElement): string {
	const clone = cleanSummaryBody(body);
	for (const element of clone.querySelectorAll(
		"p, div, section, article, main, h1, h2, h3, h4, h5, h6, li, tr, blockquote, br, hr",
	)) {
		element.before("\n");
		element.after("\n");
	}
	return (clone.textContent ?? "")
		.replace(/[\t ]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
