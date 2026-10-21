import { Check, createElement, Pencil, X } from "lucide";

const labels = {
	en: {
		edit: "Edit",
		save: "Save",
		cancel: "Cancel",
		json: "Enter valid JSON for this value.",
		failed: "Could not save this property. Your draft is kept.",
		stale:
			"The context changed or is being generated. Cancel to load the latest version, then try again.",
	},
	ar: {
		edit: "تعديل",
		save: "حفظ",
		cancel: "إلغاء",
		json: "أدخل قيمة JSON صالحة لهذا الحقل.",
		failed: "تعذر حفظ هذا الحقل. تم الاحتفاظ بتعديلك.",
		stale:
			"تغيّر السياق أو يجري توليده. ألغِ التعديل لتحميل أحدث نسخة ثم حاول مجدداً.",
	},
};

export const INLINE_CONTEXT_EDIT_CSS = `
.context-property{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:4px;min-inline-size:0}
.context-value{min-inline-size:0;white-space:pre-wrap}
button.context-icon{display:inline-flex;justify-content:center;align-items:center;min-inline-size:44px;min-block-size:44px;padding:8px;flex:none}
.context-icon svg{inline-size:18px;block-size:18px}
button.context-edit-trigger{opacity:0}
.context-property:hover>.context-edit-trigger,.context-property:focus-within>.context-edit-trigger{opacity:1}
.context-label{display:flex;align-items:start;gap:4px}
.context-label:hover>.context-edit-trigger,.context-label:focus-within>.context-edit-trigger,.context-label:has(+dd:hover)>.context-edit-trigger{opacity:1}
[data-context-editing="true"] .context-edit-trigger{visibility:hidden}
.context-field-value{grid-template-columns:minmax(0,1fr)}
.context-editor{grid-column:1/-1;display:flex;align-items:start;gap:8px;flex-wrap:wrap;min-inline-size:0}
.context-editor input,.context-editor textarea{box-sizing:border-box;flex:1 1 140px;min-inline-size:0;inline-size:100%;min-block-size:44px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
.context-editor textarea{resize:vertical}
.context-editor :focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.context-edit-error{flex-basis:100%;color:var(--ink);white-space:pre-wrap;margin:0}
@media(hover:none){button.context-edit-trigger{opacity:1}}
`;

export function contextEditError(error: unknown, locale: "en" | "ar"): string {
	const response =
		error && typeof error === "object"
			? Reflect.get(error, "response")
			: undefined;
	if (response && typeof response === "object") {
		if (Reflect.get(response, "status") === 409) return labels[locale].stale;
		const data = Reflect.get(response, "data");
		if (
			data &&
			typeof data === "object" &&
			typeof Reflect.get(data, "message") === "string"
		)
			return Reflect.get(data, "message");
	}
	if (error instanceof Error && error.message === "CONTEXT_EDIT_STALE")
		return labels[locale].stale;
	if (
		error instanceof Error &&
		error.message.startsWith("CONTEXT_EDIT_INVALID: ")
	)
		return error.message.slice("CONTEXT_EDIT_INVALID: ".length);
	return error instanceof SyntaxError
		? labels[locale].json
		: labels[locale].failed;
}

export function inlineContextProperty(options: {
	locale: "en" | "ar";
	label: string;
	path: (string | number)[];
	value: unknown;
	display: HTMLElement;
	start: () => boolean;
	finish: () => void;
	save: (value: unknown) => Promise<void>;
	alive: () => boolean;
}): HTMLElement {
	const text = labels[options.locale];
	const host = document.createElement("div");
	host.className = "context-property";
	const display = document.createElement("div");
	display.className = "context-value";
	display.append(options.display);
	const icon = (kind: typeof Pencil, label: string) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "context-icon";
		button.title = label;
		button.setAttribute("aria-label", label);
		button.append(
			createElement(kind, { "aria-hidden": "true", "stroke-width": 1.75 }),
		);
		return button;
	};
	const edit = icon(Pencil, `${text.edit} ${options.label}`);
	edit.classList.add("context-edit-trigger");
	edit.dataset.editContext = JSON.stringify(options.path);
	host.append(display, edit);
	edit.addEventListener("click", () => {
		if (!options.start()) return;
		const form = document.createElement("form");
		form.className = "context-editor";
		const value =
			typeof options.value === "string"
				? options.value
				: (JSON.stringify(options.value) ?? "");
		const input = document.createElement(
			typeof options.value === "string" && value.includes("\n")
				? "textarea"
				: "input",
		);
		input.value = value;
		input.setAttribute("aria-label", options.label);
		const save = icon(Check, `${text.save} ${options.label}`);
		save.type = "submit";
		const cancel = icon(X, `${text.cancel} ${options.label}`);
		const error = document.createElement("p");
		error.className = "context-edit-error";
		error.setAttribute("role", "alert");
		error.id = `context-edit-${crypto.randomUUID()}`;
		input.setAttribute("aria-describedby", error.id);
		form.append(input, save, cancel, error);
		display.hidden = true;
		edit.hidden = true;
		host.append(form);
		let saving = false;
		const finish = () => {
			form.remove();
			display.hidden = false;
			edit.hidden = false;
			options.finish();
		};
		cancel.addEventListener("click", finish);
		input.addEventListener("keydown", (event) => {
			event.stopPropagation();
			if (!(event instanceof KeyboardEvent)) return;
			if (event.isComposing || event.keyCode === 229) return;
			if (event.key === "Escape" && !saving) {
				event.preventDefault();
				finish();
			}
			if (
				event.key === "Enter" &&
				input instanceof HTMLTextAreaElement &&
				(event.ctrlKey || event.metaKey)
			) {
				event.preventDefault();
				form.requestSubmit();
			}
		});
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			if (saving) return;
			void (async () => {
				try {
					const next =
						typeof options.value === "string"
							? input.value
							: options.value === null && input.value !== "null"
								? input.value
								: JSON.parse(input.value);
					saving = true;
					input.disabled = save.disabled = cancel.disabled = true;
					form.setAttribute("aria-busy", "true");
					error.textContent = "";
					input.removeAttribute("aria-invalid");
					await options.save(next);
					if (options.alive()) finish();
				} catch (cause) {
					if (!options.alive()) return;
					error.textContent = contextEditError(cause, options.locale);
					input.setAttribute("aria-invalid", "true");
					input.disabled = false;
					input.focus();
				} finally {
					saving = false;
					input.disabled = save.disabled = cancel.disabled = false;
					form.removeAttribute("aria-busy");
				}
			})();
		});
		input.focus();
		input.select();
	});
	return host;
}
