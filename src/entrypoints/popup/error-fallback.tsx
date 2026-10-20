/** This last-resort screen must work even if the UI or translation providers failed. */
export function PopupErrorFallback() {
	let arabic = document.documentElement.lang === "ar";
	try {
		const saved = localStorage.getItem("locale");
		if (saved) arabic = JSON.parse(saved) === "ar";
	} catch {
		// Storage may be blocked in an embedded popup; keep the document language.
	}
	return (
		<main className="popup-error" dir={arabic ? "rtl" : "ltr"} role="alert">
			<h1>
				{arabic
					? "تعذر عرض Story Lens"
					: "Story Lens could not display this view"}
			</h1>
			<p>
				{arabic
					? "حدث خطأ غير متوقع. أعد التحميل للمحاولة مجددًا. قد تكون التغييرات غير المحفوظة في هذا العرض قد فُقدت."
					: "An unexpected error occurred. Reload to try again. Unsaved changes in this view may have been lost."}
			</p>
			<button type="button" onClick={() => window.location.reload()}>
				{arabic ? "إعادة التحميل" : "Reload"}
			</button>
		</main>
	);
}
