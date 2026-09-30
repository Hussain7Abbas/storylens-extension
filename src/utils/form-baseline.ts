/**
 * Writes values a form loads by itself (saved data, a detected name). They
 * become the form's baseline, so they do not count as unsaved changes. Once
 * the reader has edited the form the baseline stays, and their changes remain
 * marked as unsaved.
 */
export function loadFormValues(
	form: { isDirty: () => boolean; resetDirty: () => void },
	write: () => void,
): void {
	const edited = form.isDirty();
	write();
	if (!edited) form.resetDirty();
}
