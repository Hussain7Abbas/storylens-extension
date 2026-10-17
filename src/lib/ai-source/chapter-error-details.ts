/** Error text stays local to the chapter UI and is never interpreted as markup. */
export function createChapterErrorDetails(locale: "en" | "ar") {
	const element = document.createElement("details");
	element.className = "error-details";
	element.hidden = true;
	const summary = document.createElement("summary");
	summary.textContent = locale === "ar" ? "التفاصيل" : "Details";
	const message = document.createElement("p");
	message.dir = "auto";
	element.append(summary, message);
	return {
		element,
		show(error: unknown) {
			const value =
				error instanceof Error
					? error.message
					: typeof error === "string"
						? error
						: "";
			message.textContent =
				value.trim() ||
				(locale === "ar" ? "حدث خطأ غير معروف." : "An unknown error occurred.");
			element.hidden = false;
		},
		clear() {
			element.hidden = true;
			element.open = false;
			message.textContent = "";
		},
	};
}

export const CHAPTER_ERROR_DETAILS_CSS = `
.error-details{box-sizing:border-box;margin-block:8px;padding:12px;background:var(--surface);color:var(--ink);overflow-wrap:anywhere}
.error-details>summary{display:list-item;inline-size:fit-content;min-block-size:24px;color:var(--ink);font:inherit;cursor:pointer}
.error-details>summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.error-details>p{margin-block:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}
`;
