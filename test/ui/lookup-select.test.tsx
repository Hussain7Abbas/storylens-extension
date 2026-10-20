import { GlobalRegistrator } from "@happy-dom/global-registrator";

const registeredHere = !GlobalRegistrator.isRegistered;
if (registeredHere)
	GlobalRegistrator.register({ url: "https://extension.test/popup.html" });

import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";

const { MantineProvider } = await import("@mantine/core");
const { useForm } = await import("@mantine/form");
const { Component, useState } = await import("react");
const { cleanup, fireEvent, render, waitFor } = await import(
	"@testing-library/react"
);
const { LookupSelect } = await import("../../src/components/lookup-select");
const { RenderErrorBoundary } = await import(
	"../../src/components/render-error-boundary"
);
const { PopupErrorFallback } = await import(
	"../../src/entrypoints/popup/error-fallback"
);
const { createInstance } = await import("i18next");
const { I18nextProvider } = await import("react-i18next");
const i18n = createInstance();
await i18n.init({
	lng: "en",
	resources: {
		en: {
			translation: {
				lookupSelect: {
					recovered: "Choose an option below",
					savedValue: "Saved selection",
				},
			},
		},
	},
});

afterEach(() => {
	cleanup();
	localStorage.clear();
});
afterAll(async () => {
	if (registeredHere) await GlobalRegistrator.unregister();
});

const rows = [
	{ id: "hero", nameEn: "Hero" },
	{ id: "place", nameEn: "Place" },
];

describe("lookup failure isolation", () => {
	it("opens with duplicate or malformed cached rows without replacing the menu", () => {
		const view = render(
			<I18nextProvider i18n={i18n}>
				<MantineProvider>
					<LookupSelect
						label="Category"
						language="en"
						rows={[
							null,
							{ id: 7, nameEn: "Invalid" },
							...rows,
							rows[0],
							{ id: "bad-label", nameEn: { text: "Invalid" } },
						]}
					/>
				</MantineProvider>
			</I18nextProvider>,
		);
		fireEvent.click(view.getByLabelText("Category", { selector: "input" }));
		expect(
			view.getAllByRole("option", { name: "Hero", hidden: true }),
		).toHaveLength(1);
		expect(
			view.getByRole("option", { name: "Place", hidden: true }),
		).toBeTruthy();
		expect(view.queryByRole("status")).toBeNull();
	});

	it("keeps required selections and their validation when the menu falls back", () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		const blur = spyOn({ blur: () => {} }, "blur");
		try {
			const view = render(
				<I18nextProvider i18n={i18n}>
					<MantineProvider>
						<LookupSelect
							label="Category"
							placeholder="Choose category"
							language="en"
							rows={rows}
							value="missing-from-cache"
							required
							error="Choose an available category"
							onBlur={blur}
							renderOption={() => {
								throw new Error("menu failure");
							}}
						/>
					</MantineProvider>
				</I18nextProvider>,
			);
			const select = view.getByLabelText(/^Category/, {
				selector: "select",
			}) as HTMLSelectElement;
			expect(select.value).toBe("missing-from-cache");
			expect(select.required).toBe(true);
			expect(select.getAttribute("aria-invalid")).toBe("true");
			expect(
				select.querySelector<HTMLOptionElement>('option[value=""]')?.disabled,
			).toBe(true);
			fireEvent.blur(select);
			expect(blur).toHaveBeenCalled();
		} finally {
			logged.mockRestore();
			blur.mockRestore();
		}
	});

	it("keeps the form, its dirty values and image mounted after a menu render fails", async () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		let saved:
			| { name: string; categoryId: string | null; image: File | null }
			| undefined;
		function Form() {
			const form = useForm({
				initialValues: { name: "Sunny", categoryId: "hero" as string | null },
			});
			const [image, setImage] = useState<File | null>(null);
			const [fail, setFail] = useState(false);
			return (
				<form
					onSubmit={form.onSubmit((values) => {
						saved = { ...values, image };
					})}
				>
					<label>
						Name
						<input {...form.getInputProps("name")} />
					</label>
					<label>
						Image
						<input
							type="file"
							onChange={(event) => setImage(event.target.files?.[0] ?? null)}
						/>
					</label>
					<LookupSelect
						label="Category"
						placeholder="Choose category"
						rows={rows}
						language="en"
						clearable
						{...form.getInputProps("categoryId")}
						onDropdownOpen={() => setFail(true)}
						renderOption={({ option }) => {
							if (fail) throw new Error("menu render failure");
							return option.label;
						}}
					/>
					<span data-dirty>{String(form.isDirty())}</span>
					<button type="submit">Save</button>
				</form>
			);
		}
		try {
			const view = render(
				<I18nextProvider i18n={i18n}>
					<MantineProvider>
						<Form />
					</MantineProvider>
				</I18nextProvider>,
			);
			const input = view.getByLabelText("Name") as HTMLInputElement;
			fireEvent.change(input, { target: { value: "Sunny edited" } });
			expect(input.value).toBe("Sunny edited");
			expect(view.container.querySelector("[data-dirty]")?.textContent).toBe(
				"true",
			);
			const image = new File(["image"], "character.png", { type: "image/png" });
			fireEvent.change(view.getByLabelText("Image"), {
				target: { files: [image] },
			});
			fireEvent.click(view.getByLabelText("Category", { selector: "input" }));
			await waitFor(() =>
				expect(
					view.getByLabelText("Category", { selector: "select" }),
				).toBeTruthy(),
			);
			expect(view.getByLabelText("Name")).toBe(input);
			expect(view.container.querySelector("[data-dirty]")?.textContent).toBe(
				"true",
			);
			expect(view.getByRole("status").textContent).toBe(
				"Choose an option below",
			);
			expect(view.getByRole("combobox").getAttribute("aria-invalid")).not.toBe(
				"true",
			);
			const select = view.getByLabelText("Category", {
				selector: "select",
			}) as HTMLSelectElement;
			expect(select.value).toBe("hero");
			fireEvent.change(select, { target: { value: "place" } });
			fireEvent.click(view.getByRole("button", { name: "Save" }));
			expect(saved).toEqual({
				name: "Sunny edited",
				categoryId: "place",
				image,
			});
			expect(view.getByRole("status").textContent).toBe(
				"Choose an option below",
			);
			fireEvent.change(select, { target: { value: "" } });
			fireEvent.click(view.getByRole("button", { name: "Save" }));
			expect(saved?.categoryId).toBeNull();
			expect(logged).toHaveBeenCalled();
		} finally {
			logged.mockRestore();
		}
	});

	it("renders a reload screen outside Mantine/i18n when another view fails", () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		class Broken extends Component {
			render(): never {
				throw new Error("view failure");
			}
		}
		try {
			localStorage.setItem("locale", JSON.stringify("ar"));
			const view = render(
				<RenderErrorBoundary fallback={<PopupErrorFallback />}>
					<Broken />
				</RenderErrorBoundary>,
			);
			expect(view.getByRole("alert").getAttribute("dir")).toBe("rtl");
			expect(view.getByRole("button", { name: "إعادة التحميل" })).toBeTruthy();
		} finally {
			logged.mockRestore();
		}
	});
});
