import { Copy, createElement } from "lucide";

export type CoverPromptLabels = {
	imageDescription: string;
	savePrompt: string;
	reloadPrompt: string;
	expandPrompt: string;
	collapsePrompt: string;
	promptHelp: string;
	copy: string;
};

export const COVER_PROMPT_EDITOR_CSS = `
.prompt-section{box-sizing:border-box;margin-block-start:8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--ink);padding:8px 12px;font:14px/1.5 system-ui,sans-serif}
.prompt-section>summary{cursor:pointer;font-weight:500;min-block-size:32px;align-content:center}
.prompt-editor{position:relative;margin-block-start:8px;min-inline-size:0}
.prompt-editor textarea{display:block;box-sizing:border-box;inline-size:100%;block-size:100px;min-block-size:100px;padding:10px;padding-inline-end:52px;padding-block-end:40px;resize:none;overflow:hidden;border:1px solid var(--border);border-radius:6px;background:var(--paper);color:var(--ink);font:14px/1.5 system-ui,sans-serif}
.prompt-editor[data-expanded=true] textarea{block-size:320px;min-block-size:160px;padding-block-end:12px;resize:vertical;overflow:auto}
.prompt-editor textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.prompt-editor .prompt-copy{position:absolute;inset-block-start:4px;inset-inline-end:4px;padding:8px;min-inline-size:44px;opacity:0;pointer-events:none;transition:opacity 150ms ease}
.prompt-copy svg{inline-size:16px;block-size:16px}
.prompt-editor:hover .prompt-copy,.prompt-editor:focus-within .prompt-copy{opacity:1;pointer-events:auto}
.prompt-fade{position:absolute;inset-inline:1px;inset-block-end:1px;block-size:44px;display:flex;align-items:flex-end;justify-content:center;background:linear-gradient(to bottom,transparent,var(--paper) 75%);pointer-events:none;border-radius:0 0 6px 6px}
.prompt-fade button{pointer-events:auto;min-block-size:36px;padding:4px 12px}
.prompt-footer{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-block-start:8px}
.prompt-footer button{border:1px solid var(--border)}
.prompt-footer .prompt-save{background:var(--accent);color:var(--on-accent)}
.prompt-help,.prompt-feedback{margin:6px 0 0;color:var(--muted);overflow-wrap:anywhere;white-space:pre-wrap}
@media(hover:none),(pointer:coarse){.prompt-editor .prompt-copy{opacity:1;pointer-events:auto}.prompt-fade button{min-block-size:44px}}
@media(prefers-reduced-motion:reduce){.prompt-editor .prompt-copy{transition:none}}
@media(forced-colors:active){.prompt-fade{background:Canvas;border-block-start:1px solid CanvasText}}
`;

/** Native counterpart of the popup's collapsible, expandable image-prompt editor. */
export function createCoverPromptEditor(text: CoverPromptLabels) {
	const section = document.createElement("details");
	section.className = "prompt-section";
	const summary = document.createElement("summary");
	summary.textContent = text.imageDescription;
	summary.id = `storylens-cover-prompt-label-${crypto.randomUUID()}`;
	const editor = document.createElement("div");
	editor.className = "prompt-editor";
	const input = document.createElement("textarea");
	input.id = `storylens-cover-prompt-${crypto.randomUUID()}`;
	input.setAttribute("aria-labelledby", summary.id);
	input.dir = "auto";
	input.maxLength = 180000;
	input.readOnly = true;
	for (const event of ["keydown", "keyup"])
		input.addEventListener(event, (event) => event.stopPropagation());
	const button = (label: string) => {
		const node = document.createElement("button");
		node.type = "button";
		node.textContent = label;
		return node;
	};
	const copy = button("");
	copy.className = "prompt-copy";
	copy.setAttribute("aria-label", text.copy);
	copy.title = text.copy;
	copy.disabled = true;
	copy.append(
		createElement(Copy, { "aria-hidden": "true", "stroke-width": 1.75 }),
	);
	const fade = document.createElement("div");
	fade.className = "prompt-fade";
	const expand = button(text.expandPrompt);
	expand.setAttribute("aria-controls", input.id);
	expand.setAttribute("aria-expanded", "false");
	fade.append(expand);
	const collapse = button(text.collapsePrompt);
	collapse.hidden = true;
	collapse.setAttribute("aria-controls", input.id);
	collapse.setAttribute("aria-expanded", "true");
	const setExpanded = (expanded: boolean) => {
		editor.dataset.expanded = String(expanded);
		fade.hidden = expanded;
		collapse.hidden = !expanded;
	};
	expand.addEventListener("click", () => {
		setExpanded(true);
		input.focus();
	});
	collapse.addEventListener("click", () => {
		setExpanded(false);
		input.focus();
	});
	editor.append(input, copy, fade);
	const help = document.createElement("p");
	help.className = "prompt-help";
	help.id = `${input.id}-help`;
	help.textContent = text.promptHelp;
	input.setAttribute("aria-describedby", help.id);
	const footer = document.createElement("div");
	footer.className = "prompt-footer";
	const save = button(text.savePrompt);
	save.className = "prompt-save";
	save.disabled = true;
	const reload = button(text.reloadPrompt);
	reload.disabled = true;
	footer.append(save, reload, collapse);
	const feedback = document.createElement("p");
	feedback.className = "prompt-feedback";
	feedback.setAttribute("role", "status");
	section.append(summary, editor, help, footer, feedback);
	return {
		promptSection: section,
		promptInput: input,
		promptCopy: copy,
		promptSave: save,
		promptReload: reload,
		promptFeedback: feedback,
	};
}
