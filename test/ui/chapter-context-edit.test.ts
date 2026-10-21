import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { coverContext, readyCoverContext } from "../helpers/cover-context";
import "../helpers/fake-browser";
import type { ChapterContextRecord } from "../../src/lib/chapter-context/schema";
import type { ContextEdit } from "../../src/lib/chapter-context/transport";

const registeredHere = !GlobalRegistrator.isRegistered;
if (registeredHere)
	GlobalRegistrator.register({ url: "https://novel.test/chapter/12" });
const { createContextView } = await import(
	"../../src/lib/chapter-context/view"
);
const views: ReturnType<typeof createContextView>[] = [];
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
type Edit = Pick<ContextEdit, "path" | "value" | "baseUpdatedAt">;
function fixture(
	locale: "en" | "ar" = "en",
	override?: (change: Edit) => Promise<ChapterContextRecord>,
) {
	let record: ChapterContextRecord = {
		...readyCoverContext(),
		canEdit: true,
		updatedAt: new Date(1000).toISOString(),
	};
	const edits: Edit[] = [];
	const view = createContextView(
		locale,
		() => {},
		() => {},
		async (change) => {
			edits.push(change);
			if (override) return override(change);
			const context = structuredClone(record.context);
			let parent: unknown = context;
			for (const key of change.path.slice(0, -1))
				parent = Reflect.get(parent as object, key);
			Reflect.set(
				parent as object,
				change.path.at(-1) as string | number,
				change.value,
			);
			record = { ...record, context, updatedAt: new Date(2000).toISOString() };
			return record;
		},
	);
	views.push(view);
	document.body.append(view.host);
	view.update(record);
	const root = view.host.shadowRoot as ShadowRoot;
	const details = root.querySelector("details");
	if (details) details.open = true;
	const pencil = (path: (string | number)[]) =>
		[...root.querySelectorAll<HTMLButtonElement>("[data-edit-context]")].find(
			(button) => button.dataset.editContext === JSON.stringify(path),
		);
	const editor = () =>
		root.querySelector<HTMLInputElement | HTMLTextAreaElement>(
			".context-editor input,.context-editor textarea",
		);
	const save = () =>
		root
			.querySelector<HTMLButtonElement>('.context-editor button[type="submit"]')
			?.click();
	return { view, root, edits, pencil, editor, save, record };
}
afterEach(() => {
	for (const view of views.splice(0)) {
		view.dispose();
		view.host.remove();
	}
});
afterAll(() => {
	if (registeredHere) GlobalRegistrator.unregister();
});

test.each(["en", "ar"] as const)(
	"%s context properties edit inline and save the underlying JSON path",
	async (locale) => {
		const f = fixture(locale);
		const pencil = f.pencil(["summary"]);
		expect(pencil?.querySelector("svg")).toBeTruthy();
		pencil?.click();
		expect(f.editor()?.value).toBe(f.record.context?.summary);
		expect(f.root.querySelectorAll(".context-editor button")).toHaveLength(2);
		expect(f.view.editing()).toBe(true);
		expect(f.pencil(["scenes", 0, "title"])?.disabled).toBe(true);
		const input = f.editor();
		if (!input) throw new Error("Missing editor");
		input.value = "<img src=x onerror=alert(1)> Revised summary";
		f.save();
		await tick();
		expect(f.edits).toEqual([
			{
				path: ["summary"],
				value: input.value,
				baseUpdatedAt: new Date(1000).toISOString(),
			},
		]);
		expect(f.editor()).toBeNull();
		expect(f.root.textContent).toContain("Revised summary");
		expect(f.root.querySelector("img")).toBeNull();
		expect(f.view.editing()).toBe(false);
		expect(f.root.activeElement).toBe(f.pencil(["summary"]) ?? null);
	},
);

test("Cancel and Escape discard the draft and restore focus without saving", () => {
	const f = fixture();
	for (const method of ["button", "escape"]) {
		f.pencil(["scenes", 0, "environment", "lighting"])?.click();
		const input = f.editor();
		if (!input) throw new Error("Missing editor");
		expect(input.value).toBe("Blue fire");
		input.value = "Orange fire";
		if (method === "button")
			f.root
				.querySelector<HTMLButtonElement>(
					'.context-editor button[type="button"]',
				)
				?.click();
		else
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		expect(f.editor()).toBeNull();
		expect(f.root.textContent).toContain("Blue fire");
	}
	expect(f.edits).toHaveLength(0);
});

test("nested array values and previously empty fields are editable with their real paths", async () => {
	const f = fixture();
	for (const [path, value] of [
		[["scenes", 0, "entities", 0, "equipment", 0], "Bow"],
		[["scenes", 0, "environment", "details"], ""],
	] as [(string | number)[], string][]) {
		f.pencil(path)?.click();
		const input = f.editor();
		if (!input) throw new Error("Missing editor");
		input.value = value;
		f.save();
		await tick();
		expect(f.edits.at(-1)?.path).toEqual(path);
		expect(f.edits.at(-1)?.value).toBe(value);
	}
});

test("collection properties preserve JSON types and syntax errors keep the input open", async () => {
	const f = fixture();
	f.pencil(["scenes", 0, "entities", 0, "equipment"])?.click();
	const input = f.editor();
	if (!input) throw new Error("Missing editor");
	expect(input.value).toBe('["Sword"]');
	input.value = "invalid JSON";
	f.save();
	await tick();
	expect(f.edits).toHaveLength(0);
	expect(input.value).toBe("invalid JSON");
	expect(input.getAttribute("aria-invalid")).toBe("true");
	input.value = '["Bow","Quiver"]';
	f.save();
	await tick();
	expect(f.edits[0]?.value).toEqual(["Bow", "Quiver"]);
	expect(f.root.textContent).toContain("Quiver");
});

test("failed and stale saves preserve the draft; Cancel loads queued updates and the next edit uses their revision", async () => {
	const pending = Promise.withResolvers<ChapterContextRecord>();
	const f = fixture("en", () => pending.promise);
	f.pencil(["summary"])?.click();
	const input = f.editor();
	if (!input) throw new Error("Missing editor");
	input.value = "My draft";
	f.save();
	expect(input.disabled).toBe(true);
	expect(
		[
			...f.root.querySelectorAll<HTMLButtonElement>(".context-editor button"),
		].every((button) => button.disabled),
	).toBe(true);
	const latest = {
		...f.record,
		context: {
			...coverContext(),
			summary: "Other reader's revision",
		},
		updatedAt: new Date(3000).toISOString(),
	};
	f.view.update(latest);
	expect(f.editor()).toBe(input);
	pending.reject(new Error("CONTEXT_EDIT_STALE"));
	await tick();
	expect(input.value).toBe("My draft");
	expect(input.disabled).toBe(false);
	expect(f.root.querySelector('[role="alert"]')?.textContent).toContain(
		"Cancel to load",
	);
	f.root
		.querySelector<HTMLButtonElement>('.context-editor button[type="button"]')
		?.click();
	expect(f.root.textContent).toContain("Other reader's revision");
	f.pencil(["summary"])?.click();
	f.save();
	await tick();
	expect(f.edits[1]?.baseUpdatedAt).toBe(new Date(3000).toISOString());
});

test("read-only and older API replies have no pencils, and active generation locks editing", () => {
	const f = fixture();
	f.view.update({ ...f.record, canEdit: false });
	expect(f.root.querySelectorAll("[data-edit-context]")).toHaveLength(0);
	f.view.update({ ...readyCoverContext() });
	expect(f.root.querySelectorAll("[data-edit-context]")).toHaveLength(0);
	f.view.update({ ...f.record, generating: true });
	expect(f.pencil(["summary"])?.disabled).toBe(true);
	f.pencil(["summary"])?.click();
	expect(f.editor()).toBeNull();
});

test("multiline values preserve newlines, IME confirmation does not save, and late saves cannot revive a disposed view", async () => {
	const pending = Promise.withResolvers<ChapterContextRecord>();
	const f = fixture("en", () => pending.promise);
	f.view.update({
		...f.record,
		context: {
			...coverContext(),
			summary: "First line\nSecond line",
		},
	});
	f.pencil(["summary"])?.click();
	const input = f.editor();
	expect(input instanceof HTMLTextAreaElement).toBe(true);
	expect(input?.value).toContain("\n");
	input?.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Enter",
			ctrlKey: true,
			isComposing: true,
			bubbles: true,
		}),
	);
	expect(f.edits).toHaveLength(0);
	f.save();
	f.view.dispose();
	f.view.host.remove();
	pending.resolve(f.record);
	await tick();
	expect(f.view.host.isConnected).toBe(false);
});
