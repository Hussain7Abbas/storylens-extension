/// <reference types="bun" />
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Another UI test file may have registered (and later unregisters) the DOM.
const registeredHere = !GlobalRegistrator.isRegistered;
if (registeredHere)
	GlobalRegistrator.register({ url: "https://novels.example.invalid/ch/5" });

import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import type { EnrichedKeyword, RawKeyword } from "../../src/types/content-data";
import type { TooltipEditTarget } from "../../src/utils/keyword-tooltip";
import type { Language } from "../../src/utils/translation";
import { makeUser } from "../helpers/engine";
import {
	alias,
	baseVersion,
	category,
	image,
	keyword,
	nature,
	version,
} from "../helpers/keywords";

const {
	destroyKeywordTooltipPortal,
	initKeywordTooltipPortal,
	registerKeywordTooltipAnchor,
	setTooltipActions,
	setTooltipFontSize,
	setTooltipLocale,
	setTooltipPicking,
	setTooltipTrigger,
	setTooltipUser,
} = await import("../../src/utils/keyword-tooltip");
const { enrichKeywords, resolveTooltipInfo } = await import(
	"../../src/utils/resolve-keyword-version"
);

const keywordImage = image("keyword-image");
const aliasImage = image("alias-image");
const owner = makeUser("owner");

function createAnchor(
	raw: RawKeyword,
	aliasId?: string,
	language: Language = "en",
): HTMLElement {
	const enriched = enrichKeywords([raw], 5, language).find(
		(item) => item.id === (aliasId ?? raw.id),
	) as EnrichedKeyword;
	const anchor = document.createElement("span");
	document.body.append(anchor);
	registerKeywordTooltipAnchor(
		anchor,
		enriched,
		raw,
		raw.aliases.find((item) => item.id === aliasId) ?? null,
		5,
		language,
	);
	return anchor;
}

/** Hovers a highlighted word of `raw` (its alias when `aliasId` is given). */
function hover(
	raw: RawKeyword,
	aliasId?: string,
	language: Language = "en",
): HTMLElement {
	setTooltipTrigger("hover");
	const anchor = createAnchor(raw, aliasId, language);
	anchor.dispatchEvent(new MouseEvent("mouseenter"));
	const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
	if (!tooltip) throw new Error("tooltip did not open");
	return tooltip;
}

function editKinds(_tooltip: HTMLElement): (string | undefined)[] {
	return [...document.querySelectorAll<HTMLElement>("[data-edit-kind]")]
		.sort(
			(a, b) =>
				Number(b.dataset.editKind === "keyword") -
				Number(a.dataset.editKind === "keyword"),
		)
		.map((button) => button.dataset.editKind);
}

afterEach(() => {
	destroyKeywordTooltipPortal();
	setTooltipActions(null);
	setTooltipUser(null);
	setTooltipLocale("en");
	setTooltipFontSize(null);
	setTooltipTrigger(undefined);
	setTooltipPicking(false);
	document.body.replaceChildren();
});

afterAll(async () => {
	if (registeredHere) await GlobalRegistrator.unregister();
});

describe("tooltip trigger", () => {
	const visible = () => document.querySelector('[role="tooltip"]');

	it("defaults to click and stays open after the pointer leaves", async () => {
		initKeywordTooltipPortal();
		const anchor = createAnchor(keyword());
		anchor.dispatchEvent(new MouseEvent("mouseenter"));
		expect(visible()).toBeNull();
		anchor.click();
		expect(visible()).not.toBeNull();
		expect(anchor.getAttribute("aria-expanded")).toBe("true");
		anchor.dispatchEvent(new MouseEvent("mouseleave"));
		visible()?.dispatchEvent(new MouseEvent("mouseleave"));
		await new Promise((resolve) => setTimeout(resolve, 120));
		expect(visible()).not.toBeNull();
		anchor.click();
		expect(visible()).toBeNull();
		expect(anchor.getAttribute("aria-expanded")).toBe("false");
	});

	it("keeps inner clicks open, switches words, and dismisses outside or on Escape", () => {
		initKeywordTooltipPortal();
		const first = createAnchor(keyword());
		const second = createAnchor(keyword({ nameEn: "Second" }));
		first.click();
		visible()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(visible()).not.toBeNull();
		second.click();
		expect(visible()?.textContent).toContain("Second");
		expect(first.getAttribute("aria-expanded")).toBe("false");
		document.body.click();
		expect(visible()).toBeNull();
		first.click();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(visible()).toBeNull();
	});

	it("updates existing words and resets invalid settings to click", async () => {
		const anchor = createAnchor(keyword());
		anchor.click();
		setTooltipTrigger("hover");
		expect(visible()).toBeNull();
		anchor.click();
		expect(visible()).toBeNull();
		anchor.dispatchEvent(new MouseEvent("mouseenter"));
		expect(visible()).not.toBeNull();
		anchor.dispatchEvent(new MouseEvent("mouseleave"));
		await new Promise((resolve) => setTimeout(resolve, 120));
		expect(visible()).toBeNull();
		setTooltipTrigger("invalid");
		anchor.dispatchEvent(new MouseEvent("mouseenter"));
		expect(visible()).toBeNull();
		anchor.click();
		expect(visible()).not.toBeNull();
	});

	it("supports keyboard activation and suppresses clicks while picking text", () => {
		const anchor = createAnchor(keyword());
		expect(anchor.tabIndex).toBe(0);
		anchor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		expect(visible()).not.toBeNull();
		anchor.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
		expect(visible()).toBeNull();
		setTooltipPicking(true);
		anchor.click();
		anchor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		expect(visible()).toBeNull();
		setTooltipPicking(false);
		anchor.click();
		expect(visible()).not.toBeNull();
	});
});

describe("tooltip font size", () => {
	const size = () =>
		document
			.getElementById("storylens-keyword-tooltip-root")
			?.style.getPropertyValue("--storylens-font-size");

	it("uses the saved size, and the 24px default for a size outside 18 to 42", () => {
		const raw = keyword({ nameEn: "Mira" });
		setTooltipFontSize(42);
		hover(raw);
		expect(size()).toBe("42px");
		setTooltipFontSize(18);
		expect(size()).toBe("18px");
		// 14 was the earlier default; it and the rest of the old range reset.
		setTooltipFontSize(14);
		expect(size()).toBe("24px");
		setTooltipFontSize(43);
		expect(size()).toBe("24px");
		setTooltipFontSize(null);
		expect(size()).toBe("");
	});
});

describe("tooltip image", () => {
	it("shows the alias's image on an alias, and the keyword's as the fallback", () => {
		const raw = keyword({
			aliases: [
				alias({ id: "alias-own", nameEn: "Own", image: aliasImage }),
				alias({ id: "alias-bare", nameEn: "Bare" }),
			],
			versions: [baseVersion({ image: keywordImage })],
		});

		const own = hover(raw, "alias-own");
		expect(
			own.querySelector<HTMLImageElement>(".storylens-keyword-image")?.src,
		).toBe(aliasImage.url);

		const bare = hover(raw, "alias-bare");
		expect(
			bare.querySelector<HTMLImageElement>(".storylens-keyword-image")?.src,
		).toBe(keywordImage.url);
	});

	it("opens the clicked image at full size in a modal and closes the tooltip", () => {
		let opened = 0;
		setTooltipActions({ onEdit: () => {}, onImageOpen: () => opened++ });
		const tooltip = hover(
			keyword({ versions: [baseVersion({ image: keywordImage })] }),
		);

		tooltip.querySelector<HTMLButtonElement>(".storylens-image-btn")?.click();

		const dialog = document.querySelector<HTMLDialogElement>(
			"dialog.storylens-image-modal",
		);
		expect(dialog?.open).toBe(true);
		expect(dialog?.querySelector("img")?.src).toBe(keywordImage.url);
		expect(dialog?.querySelector("img")?.alt).toBe("Keyword");
		expect(document.querySelector('[role="tooltip"]')).toBeNull();
		expect(opened).toBe(1);

		dialog
			?.querySelector<HTMLButtonElement>(".storylens-image-modal-close")
			?.click();
		expect(document.querySelector("dialog.storylens-image-modal")).toBeNull();
	});

	it("opens a provenance thumbnail too, and only one modal at a time", () => {
		const raw = keyword({
			aliases: [alias({ id: "alias-own", nameEn: "Own", image: aliasImage })],
			versions: [baseVersion({ image: keywordImage })],
		});
		const tooltip = hover(raw, "alias-own");
		// The Info panel: the Aliases tab beside it has its own thumbnails.
		const info = tooltip.querySelector<HTMLElement>(".storylens-tab-panel");
		const buttons =
			info?.querySelectorAll<HTMLButtonElement>(".storylens-image-btn") ??
			([] as unknown as NodeListOf<HTMLButtonElement>);
		// The alias's image, then the keyword's image it replaced.
		expect(buttons.length).toBe(2);

		buttons[1].click();
		hover(raw, "alias-own")
			.querySelector<HTMLButtonElement>(".storylens-image-btn")
			?.click();

		const dialogs = document.querySelectorAll("dialog.storylens-image-modal");
		expect(dialogs.length).toBe(1);
		expect(dialogs[0].querySelector("img")?.src).toBe(aliasImage.url);
	});

	it("keeps native image actions available when the site blocks context menus", () => {
		const blockMenu = (event: Event) => event.preventDefault();
		document.addEventListener("contextmenu", blockMenu, true);
		try {
			hover(keyword({ versions: [baseVersion({ image: keywordImage })] }))
				.querySelector<HTMLButtonElement>(".storylens-image-btn")
				?.click();
			const dialog = document.querySelector<HTMLDialogElement>(
				"dialog.storylens-image-modal",
			);
			const image = dialog?.querySelector("img");
			if (!dialog || !image) throw new Error("Image viewer is missing");
			expect(image.src).toBe(keywordImage.url);
			expect(image.draggable).toBe(true);
			const rightClick = () =>
				new MouseEvent("contextmenu", {
					bubbles: true,
					cancelable: true,
					button: 2,
				});
			expect(image.dispatchEvent(rightClick())).toBe(true);
			expect(dialog.open).toBe(true);

			// Normal page images still follow the site's handlers, including after closing.
			const pageImage = document.createElement("img");
			document.body.append(pageImage);
			expect(pageImage.dispatchEvent(rightClick())).toBe(false);
			dialog.close();
			document.body.append(image);
			expect(image.dispatchEvent(rightClick())).toBe(false);
		} finally {
			document.removeEventListener("contextmenu", blockMenu, true);
		}
	});

	it("removing the page markup closes an open modal", () => {
		hover(keyword({ versions: [baseVersion({ image: keywordImage })] }))
			.querySelector<HTMLButtonElement>(".storylens-image-btn")
			?.click();
		expect(
			document.querySelector("dialog.storylens-image-modal"),
		).not.toBeNull();

		destroyKeywordTooltipPortal();

		expect(document.querySelector("dialog.storylens-image-modal")).toBeNull();
	});
});

describe("tooltip list thumbnails", () => {
	const versionImage = image("version-image");

	/** The rows of the tab whose button carries `label`. */
	function rowsOf(tooltip: HTMLElement, label: string): HTMLElement[] {
		const buttons = [
			...tooltip.querySelectorAll<HTMLButtonElement>(".storylens-tab-btn"),
		];
		const index = buttons.findIndex((button) => button.textContent === label);
		if (index === -1) throw new Error(`no ${label} tab`);
		const panels = [
			...tooltip.querySelectorAll<HTMLElement>(".storylens-tab-panel"),
		];
		return [
			...panels[index].querySelectorAll<HTMLElement>(".storylens-panel-item"),
		];
	}

	function thumbOf(row: HTMLElement) {
		const button = row.querySelector<HTMLElement>(
			".storylens-panel-item-thumb-btn",
		);
		return {
			src: row.querySelector<HTMLImageElement>(".storylens-panel-item-thumb")
				?.src,
			inherited: button?.classList.contains("storylens-inherited") ?? false,
		};
	}

	it("shows each alias's image, falling back to the keyword's dimmed", () => {
		const raw = keyword({
			aliases: [
				alias({ id: "alias-own", nameEn: "Own", image: aliasImage }),
				alias({ id: "alias-bare", nameEn: "Bare" }),
			],
			versions: [baseVersion({ image: keywordImage })],
		});

		const rows = rowsOf(hover(raw), "Aliases");

		expect(thumbOf(rows[0])).toEqual({
			src: aliasImage.url,
			inherited: false,
		});
		expect(thumbOf(rows[1])).toEqual({
			src: keywordImage.url,
			inherited: true,
		});
	});

	it("shows each version's image, falling back to the keyword's dimmed", () => {
		const raw = keyword({
			versions: [
				baseVersion({ image: keywordImage, endingChapter: 9 }),
				version({ id: "version-2", startingChapter: 10 }),
				version({ id: "version-3", startingChapter: 20, image: versionImage }),
			],
		});

		const rows = rowsOf(hover(raw), "Versions");

		expect(thumbOf(rows[0])).toEqual({
			src: keywordImage.url,
			inherited: false,
		});
		// Chapter 5 is read, so the base version's image is the fallback.
		expect(thumbOf(rows[1])).toEqual({
			src: keywordImage.url,
			inherited: true,
		});
		expect(thumbOf(rows[2])).toEqual({
			src: versionImage.url,
			inherited: false,
		});
	});

	it("opens a row thumbnail at full size", () => {
		const raw = keyword({
			aliases: [alias({ id: "alias-own", nameEn: "Own", image: aliasImage })],
			versions: [baseVersion({ image: keywordImage })],
		});

		rowsOf(hover(raw), "Aliases")[0]
			.querySelector<HTMLButtonElement>(".storylens-panel-item-thumb-btn")
			?.click();

		expect(
			document
				.querySelector<HTMLDialogElement>("dialog.storylens-image-modal")
				?.querySelector("img")?.src,
		).toBe(aliasImage.url);
	});

	it("leaves rows without any image blank", () => {
		const raw = keyword({ aliases: [alias({ id: "alias-1" })] });

		expect(
			rowsOf(hover(raw), "Aliases")[0].querySelector(
				".storylens-panel-item-thumb",
			),
		).toBeNull();
	});
});

describe("tooltip generate image action", () => {
	const raw = keyword({ createdById: owner.id });
	const bar = () =>
		document.querySelector<HTMLElement>(".storylens-keyword-hover-actions");
	const button = () =>
		bar()?.querySelector<HTMLButtonElement>(
			'[data-hover-action="generate-image"]',
		);

	it("offers the action beside the tooltip, not inside it", () => {
		const requests: TooltipEditTarget[] = [];
		setTooltipActions({ onGenerateImage: (target) => requests.push(target) });
		setTooltipUser(owner);

		const tooltip = hover(raw);
		expect(
			tooltip.querySelector(".storylens-keyword-hover-actions"),
		).toBeNull();
		expect(button()?.textContent).toBe("Generate image with AI");

		button()?.click();

		// The form opens in the launcher popup, so the tooltip and its bar go.
		expect(document.querySelector('[role="tooltip"]')).toBeNull();
		expect(bar()).toBeNull();
		expect(requests).toEqual([
			{
				kind: "keyword",
				id: "keyword-1",
				keywordId: "keyword-1",
				novelId: "novel-1",
			},
		]);
	});

	it("labels the action in the tooltip's language", () => {
		setTooltipActions({ onGenerateImage: () => {} });
		setTooltipUser(owner);
		setTooltipLocale("ar");

		hover(raw);
		expect(button()?.textContent).toBe("توليد صورة بالذكاء الاصطناعي");
	});

	it("appears only with the launcher and for a keyword the reader may change", () => {
		setTooltipUser(owner);
		hover(raw);
		expect(bar()).toBeNull();

		setTooltipActions({ onGenerateImage: () => {} });
		setTooltipUser(makeUser("reader"));
		hover(raw);
		expect(bar()).toBeNull();

		setTooltipUser(makeUser("moderator", { moderator: true }));
		hover(raw);
		expect(bar()).not.toBeNull();
	});

	it("keeps the tooltip open while the pointer moves onto the action", async () => {
		setTooltipActions({ onGenerateImage: () => {} });
		setTooltipUser(owner);
		hover(raw);
		// The highlighted word this test hovered, which the helper appended.
		const anchor = document.body.querySelector("span") as HTMLElement;
		const actions = bar() as HTMLElement;

		anchor.dispatchEvent(
			new MouseEvent("mouseleave", { relatedTarget: actions }),
		);
		// Past the hide delay, so a missed hover group would have closed it.
		await new Promise((resolve) => setTimeout(resolve, 200));

		expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
		expect(bar()).not.toBeNull();

		// Leaving for the page does close both.
		anchor.dispatchEvent(new MouseEvent("mouseleave"));
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(document.querySelector('[role="tooltip"]')).toBeNull();
		expect(bar()).toBeNull();
	});
});

describe("tooltip viewport placement", () => {
	const raw = keyword({ createdById: owner.id });

	function measuredTooltip(
		y: number,
		viewportHeight: number,
		withAction = true,
	) {
		const previousHeight = window.innerHeight;
		window.innerHeight = viewportHeight;
		const bounds = spyOn(
			HTMLElement.prototype,
			"getBoundingClientRect",
		).mockImplementation(function (this: HTMLElement) {
			if (this.getAttribute("role") === "tooltip") {
				const limit = Number.parseFloat(this.style.maxHeight);
				return new DOMRect(0, 0, 330, Math.min(442, limit || 442));
			}
			if (this.classList.contains("storylens-keyword-hover-actions"))
				return new DOMRect(0, 0, 290, 52);
			return new DOMRect(500, y, 47, 28);
		});
		setTooltipUser(owner);
		setTooltipActions(withAction ? { onGenerateImage: () => {} } : null);
		initKeywordTooltipPortal();
		const tooltip = hover(raw);
		return {
			tooltip,
			actions: document.querySelector<HTMLElement>(
				".storylens-keyword-hover-actions",
			),
			restore: () => {
				bounds.mockRestore();
				window.innerHeight = previousHeight;
			},
		};
	}

	for (const { y, height } of [
		{ y: 8, height: 500 },
		{ y: 400, height: 800 },
		{ y: 765, height: 800 },
	]) {
		it(`keeps both boxes clear of the word at y=${y} in a ${height}px viewport`, () => {
			const view = measuredTooltip(y, height);
			try {
				const top = Number.parseFloat(view.tooltip.style.top);
				const bottom = top + view.tooltip.getBoundingClientRect().height;
				const actionsTop = Number.parseFloat(view.actions?.style.top ?? "");
				const actionsBottom = actionsTop + 52;
				expect(top).toBeGreaterThanOrEqual(8);
				expect(bottom).toBeLessThanOrEqual(height - 8);
				expect(actionsTop).toBeGreaterThanOrEqual(8);
				expect(actionsBottom).toBeLessThanOrEqual(height - 8);
				expect(bottom <= y - 8 || top >= y + 28 + 8).toBe(true);
				expect(actionsBottom <= y - 8 || actionsTop >= y + 28 + 8).toBe(true);
				if (view.tooltip.dataset.placement === "above") {
					expect(actionsTop).toBe(bottom + 8);
					expect(actionsBottom).toBeLessThanOrEqual(y - 8);
				} else {
					expect(top).toBe(actionsBottom + 8);
					expect(actionsTop).toBeGreaterThanOrEqual(y + 28 + 8);
				}
			} finally {
				view.restore();
			}
		});
	}

	it("constrains tall tooltips even when no action is offered", () => {
		const view = measuredTooltip(200, 500, false);
		try {
			expect(view.actions).toBeNull();
			expect(view.tooltip.style.top).toBe("236px");
			expect(view.tooltip.style.maxHeight).toBe("256px");
		} finally {
			view.restore();
		}
	});

	it("releases the height constraint when the viewport grows", () => {
		const view = measuredTooltip(8, 500);
		try {
			expect(view.tooltip.getBoundingClientRect().height).toBeLessThan(442);
			window.innerHeight = 900;
			window.dispatchEvent(new Event("resize"));
			expect(view.tooltip.getBoundingClientRect().height).toBe(442);
			expect(view.actions?.style.top).toBe("44px");
		} finally {
			view.restore();
		}
	});
});

describe("tooltip edit buttons", () => {
	it("floats Edit below the tooltip, above Generate image", () => {
		setTooltipUser(owner);
		setTooltipActions({ onEdit: () => {}, onGenerateImage: () => {} });
		const tooltip = hover(keyword({ createdById: owner.id }));
		const bar = document.querySelector(".storylens-keyword-hover-actions");
		expect(tooltip.querySelector('[data-edit-kind="keyword"]')).toBeNull();
		expect(
			[...(bar?.querySelectorAll("button") ?? [])].map(
				(button) => button.textContent,
			),
		).toEqual(["Edit", "Generate image with AI"]);
	});
	const raw = keyword({
		createdById: owner.id,
		aliases: [alias({ id: "alias-1", createdById: owner.id })],
		versions: [
			baseVersion({ endingChapter: 9, createdById: owner.id }),
			version({ id: "version-2", startingChapter: 10, createdById: owner.id }),
		],
	});

	it("offers Edit for the character and for each alias and version", () => {
		const requests: TooltipEditTarget[] = [];
		setTooltipActions({ onEdit: (target) => requests.push(target) });
		setTooltipUser(owner);

		expect(editKinds(hover(raw))).toEqual([
			"keyword",
			"alias",
			"version",
			"version",
		]);

		for (const kind of ["keyword", "alias"]) {
			hover(raw);
			document
				.querySelector<HTMLButtonElement>(`[data-edit-kind="${kind}"]`)
				?.click();
			// Opening the form closes the tooltip.
			expect(document.querySelector('[role="tooltip"]')).toBeNull();
		}
		hover(raw)
			.querySelectorAll<HTMLButtonElement>('[data-edit-kind="version"]')[1]
			.click();

		expect(requests).toEqual([
			{
				kind: "keyword",
				id: "keyword-1",
				keywordId: "keyword-1",
				novelId: "novel-1",
			},
			{
				kind: "alias",
				id: "alias-1",
				keywordId: "keyword-1",
				novelId: "novel-1",
			},
			{
				kind: "version",
				id: "version-2",
				keywordId: "keyword-1",
				novelId: "novel-1",
			},
		]);
	});

	it("labels the button in the tooltip's language", () => {
		setTooltipActions({ onEdit: () => {} });
		setTooltipUser(owner);
		setTooltipLocale("ar");

		hover(raw);
		expect(document.querySelector(".storylens-edit-btn")?.textContent).toBe(
			"تعديل",
		);
	});

	it("has no Edit button without the launcher, for guests or when signed out", () => {
		setTooltipUser(owner);
		expect(editKinds(hover(raw))).toEqual([]);

		// A hidden launcher still counts image views but cannot open a form.
		setTooltipActions({ onImageOpen: () => {} });
		expect(editKinds(hover(raw))).toEqual([]);

		setTooltipActions({ onEdit: () => {} });
		setTooltipUser(null);
		expect(editKinds(hover(raw))).toEqual([]);

		setTooltipUser(makeUser("guest", { guest: true }));
		expect(editKinds(hover(raw))).toEqual([]);
	});

	it("follows the per-row rules: own rows only, moderators everything", () => {
		setTooltipActions({ onEdit: () => {} });
		const mixed = keyword({
			createdById: owner.id,
			aliases: [
				alias({ id: "alias-theirs", createdById: owner.id }),
				alias({ id: "alias-mine", nameEn: "Mine", createdById: "reader" }),
			],
		});

		setTooltipUser(makeUser("reader"));
		const tooltip = hover(mixed);
		expect(editKinds(tooltip)).toEqual(["alias"]);
		const items = tooltip.querySelectorAll(".storylens-panel-item");
		expect(items[0].querySelector(".storylens-edit-btn")).toBeNull();
		expect(items[1].querySelector(".storylens-edit-btn")).not.toBeNull();

		setTooltipUser(makeUser("moderator", { moderator: true }));
		expect(editKinds(hover(mixed))).toEqual(["keyword", "alias", "alias"]);
	});
});

describe("tooltip contextual details", () => {
	it("shows the UI language's description for keywords and aliases", () => {
		const raw = keyword({
			versions: [
				baseVersion({
					descriptionEn: "English keyword",
					descriptionAr: "وصف الكلمة",
				}),
			],
			aliases: [
				alias({
					id: "alias-localized",
					descriptionEn: "English alias",
					descriptionAr: "وصف الاسم البديل",
				}),
			],
		});
		expect(
			hover(raw).querySelector('[role="tabpanel"]')?.textContent,
		).toContain("English keyword");
		expect(
			hover(raw).querySelector('[role="tabpanel"]')?.textContent,
		).not.toContain("وصف الكلمة");
		expect(
			hover(raw, "alias-localized").querySelector('[role="tabpanel"]')
				?.textContent,
		).toContain("English alias");
		// Tooltip's content language comes from anchor data, independent of translated labels.
		const anchor = document.createElement("span");
		document.body.append(anchor);
		const enriched = enrichKeywords([raw], 5, "en")[0];
		registerKeywordTooltipAnchor(
			anchor,
			enriched,
			raw,
			raw.aliases[0],
			5,
			"ar",
		);
		anchor.dispatchEvent(new MouseEvent("mouseenter"));
		expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain(
			"وصف الاسم البديل",
		);
		expect(
			document.querySelector('[role="tabpanel"]')?.textContent,
		).not.toContain("English alias");
	});

	it("shows the alias's own data even without a style override, and keeps the Original tab", () => {
		const raw = keyword({
			nameEn: "Mira",
			versions: [
				baseVersion({ description: "Original history" }),
				version({
					id: "v2",
					startingChapter: 3,
					description: "Current version history",
				}),
			],
			aliases: [
				alias({
					id: "alias-own",
					nameEn: "The Scholar",
					description: "Alias history",
					overrideStyle: false,
				}),
			],
		});
		const tooltip = hover(raw, "alias-own");
		const info = tooltip.querySelector('[role="tabpanel"]');
		expect(info?.textContent).toContain("Alias history");
		expect(info?.textContent).not.toContain("Original history");
		expect(info?.textContent).not.toContain("Current version history");
		const original = tooltip.querySelector(
			'[role="tabpanel"][aria-label="Original"]',
		);
		expect(original?.textContent).toContain("Original history");
		expect(original?.textContent).toContain("Mira");
	});

	for (const kind of ["alias", "version"] as const) {
		it(`fills null ${kind} fields from the original keyword while keeping its own fields`, () => {
			const ownCategory = {
				...category,
				id: "own-category",
				nameEn: "Own category",
			};
			const own = {
				category: ownCategory,
				categoryId: ownCategory.id,
				nature: null,
				natureId: null,
				descriptionEn: null,
				image: null,
				imageId: null,
			};
			const raw = keyword({
				nameEn: "Mira",
				versions: [
					baseVersion({
						descriptionEn: "Original history",
						image: keywordImage,
						endingChapter: 2,
					}),
					version({
						id: "v2",
						startingChapter: 3,
						...(kind === "version"
							? own
							: { descriptionEn: "Current history", image: aliasImage }),
					}),
				],
				aliases: [
					alias({ id: "alias-fallback", nameEn: "The Scholar", ...own }),
				],
			});
			const info = resolveTooltipInfo(
				raw,
				kind === "alias" ? raw.aliases[0] : null,
				5,
				"en",
			);
			expect(info.description.value).toBe("Original history");
			expect(info.description.source).toBe("keyword");
			expect(info.category.value).toEqual(ownCategory);
			expect(info.category.source).toBe(kind);
			expect(info.nature.value).toEqual(nature);
			expect(info.image.value?.url).toBe(keywordImage.url);
			const tooltip = hover(
				raw,
				kind === "alias" ? "alias-fallback" : undefined,
			);
			const panel = tooltip.querySelector('[role="tabpanel"]');
			expect(panel?.textContent).toContain("Original history");
			expect(panel?.textContent).toContain("Own category");
			expect(panel?.textContent).toContain("Ally");
			expect(panel?.querySelector("img")?.getAttribute("src")).toBe(
				keywordImage.url,
			);
			expect(panel?.textContent).not.toContain("Current history");
		});
	}

	it("inherits only the selected language and leaves fields empty when the original is empty too", () => {
		const raw = keyword({
			nameEn: "Mira",
			nameAr: "ميرا",
			versions: [
				baseVersion({
					descriptionEn: "English original",
					descriptionAr: "الوصف الأصلي",
					nature: null,
					natureId: null,
				}),
			],
			aliases: [
				alias({ id: "alias-null", nameEn: null, nameAr: "الاسم البديل" }),
			],
		});
		const english = resolveTooltipInfo(raw, raw.aliases[0], 5, "en");
		expect(english.name.value).toBe("Mira");
		expect(english.description.value).toBe("English original");
		expect(english.nature.value).toBeNull();
		expect(english.image.value).toBeNull();
		const arabic = resolveTooltipInfo(raw, raw.aliases[0], 5, "ar");
		expect(arabic.name.value).toBe("الاسم البديل");
		expect(arabic.description.value).toBe("الوصف الأصلي");
	});
	it("shows active version details with a separate original tab", () => {
		const tooltip = hover(
			keyword({
				versions: [
					baseVersion({ description: "Original history", endingChapter: 2 }),
					version({
						id: "v2",
						startingChapter: 3,
						description: "Current version history",
					}),
				],
			}),
		);
		expect(tooltip.querySelector('[role="tabpanel"]')?.textContent).toContain(
			"Current version history",
		);
		expect(
			tooltip.querySelector('[role="tabpanel"]')?.textContent,
		).not.toContain("Original history");
		expect(
			tooltip.querySelector('[aria-label="Original"]')?.textContent,
		).toContain("Original history");
	});
	it("has no Original tab for the base keyword, and exposes keyboard tabs outside the scrolling content", () => {
		const tooltip = hover(keyword({ aliases: [alias({ id: "alias" })] }));
		expect(tooltip.querySelector('[aria-label="Original"]')).toBeNull();
		const tabs = tooltip.querySelector('[role="tablist"]');
		expect(tabs?.parentElement).toBe(tooltip);
		const first = tabs?.querySelector<HTMLButtonElement>('[role="tab"]');
		first?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
		);
		expect(
			tooltip.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
		).toBe("Aliases");
	});
	it("offers creation actions on another reader's keyword and gates them for guests", () => {
		const requests: string[] = [];
		setTooltipUser(makeUser("reader"));
		setTooltipActions({
			onCreate: (kind) => requests.push(kind),
			onPick: (kind) => requests.push(`pick-${kind}`),
		});
		hover(keyword({ nameEn: "Mira", createdById: owner.id }));
		const bar = document.querySelector(".storylens-keyword-hover-actions");
		expect(bar?.querySelector('[data-edit-kind="keyword"]')).toBeNull();
		expect(
			bar?.querySelector('[data-hover-action="add-alias"]'),
		).not.toBeNull();
		document
			.querySelector<HTMLButtonElement>('[data-hover-action="pick-alias"]')
			?.click();
		expect(requests).toEqual(["pick-alias"]);
		setTooltipUser(makeUser("guest", { guest: true }));
		hover(keyword());
		expect(
			document.querySelector(".storylens-keyword-hover-actions"),
		).toBeNull();
	});
});

describe("tooltip language visibility", () => {
	const aliases = [
		alias({ id: "english", nameEn: "English alias", nameAr: null }),
		alias({ id: "arabic", nameEn: null, nameAr: "الاسم العربي" }),
		alias({ id: "both", nameEn: "Bilingual alias", nameAr: "الاسم باللغتين" }),
		alias({ id: "blank", nameEn: "  ", nameAr: null }),
	];
	for (const language of ["en", "ar"] as const) {
		it(`shows only ${language} alias names, including bilingual aliases`, () => {
			setTooltipLocale(language);
			const raw = keyword({ nameEn: "Keyword", nameAr: "الشخصية", aliases });
			const tooltip = hover(raw, undefined, language);
			const names = [
				...tooltip.querySelectorAll(
					".storylens-panel-item-name > span:first-child",
				),
			].map((element) => element.textContent);
			expect(names).toEqual(
				language === "en"
					? ["English alias", "Bilingual alias"]
					: ["الاسم العربي", "الاسم باللغتين"],
			);
			expect(raw.aliases).toHaveLength(4);
		});
		it(`omits the aliases tab when none are named in ${language}`, () => {
			setTooltipLocale(language);
			const raw = keyword({
				nameEn: "Keyword",
				nameAr: "الشخصية",
				aliases: [aliases[language === "en" ? 1 : 0]],
			});
			const tooltip = hover(raw, undefined, language);
			expect(tooltip.querySelector('[role="tablist"]')).toBeNull();
			expect(tooltip.querySelector(".storylens-panel-item")).toBeNull();
		});
		it(`hides other-language-only version rows and retains bilingual and shared ${language} versions`, () => {
			setTooltipLocale(language);
			const raw = keyword({
				nameEn: "Keyword",
				nameAr: "الشخصية",
				versions: [
					baseVersion({
						descriptionEn: "Base English",
						descriptionAr: "الوصف الأصلي",
					}),
					version({
						id: "english",
						startingChapter: 10,
						descriptionEn: "English version",
						descriptionAr: null,
					}),
					version({
						id: "arabic",
						startingChapter: 20,
						descriptionEn: null,
						descriptionAr: "الوصف العربي",
					}),
					version({
						id: "both",
						startingChapter: 30,
						descriptionEn: "Bilingual version",
						descriptionAr: "الوصف باللغتين",
					}),
					version({ id: "shared", startingChapter: 40, image: aliasImage }),
				],
			});
			const tooltip = hover(raw, undefined, language);
			const rows = [...tooltip.querySelectorAll(".storylens-panel-item")];
			expect(
				rows.map(
					(row) =>
						row.querySelector(".storylens-panel-item-name > span")?.textContent,
				),
			).toEqual(
				language === "en"
					? ["ch.0+", "ch.10+", "ch.30+", "ch.40+"]
					: ["ch.0+", "ch.20+", "ch.30+", "ch.40+"],
			);
			expect(rows.map((row) => row.textContent).join(" ")).not.toContain(
				language === "en" ? "الوصف العربي" : "English version",
			);
			expect(rows.at(-1)?.querySelector("img")?.src).toBe(aliasImage.url);
			expect(raw.versions).toHaveLength(5);
		});
	}
	it("omits the versions tab when only the base remains in the selected language, including legacy descriptions", () => {
		const raw = keyword({
			versions: [
				baseVersion(),
				version({
					id: "legacy-ar",
					startingChapter: 10,
					description: "وصف قديم",
					descriptionEn: undefined,
					descriptionAr: undefined,
				}),
			],
		});
		const tooltip = hover(raw);
		expect(tooltip.querySelector('[role="tablist"]')).toBeNull();
	});
});
