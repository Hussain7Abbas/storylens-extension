/// <reference types="bun" />
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Another UI test file may have registered (and later unregisters) the DOM.
const registeredHere = !GlobalRegistrator.isRegistered;
if (registeredHere)
	GlobalRegistrator.register({ url: "https://novels.example.invalid/ch/5" });

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import type { EnrichedKeyword, RawKeyword } from "../../src/types/content-data";
import type { TooltipEditTarget } from "../../src/utils/keyword-tooltip";
import { makeUser } from "../helpers/engine";
import {
	alias,
	baseVersion,
	image,
	keyword,
	version,
} from "../helpers/keywords";

const {
	destroyKeywordTooltipPortal,
	registerKeywordTooltipAnchor,
	setTooltipActions,
	setTooltipFontSize,
	setTooltipLocale,
	setTooltipUser,
} = await import("../../src/utils/keyword-tooltip");
const { enrichKeywords } = await import(
	"../../src/utils/resolve-keyword-version"
);

const keywordImage = image("keyword-image");
const aliasImage = image("alias-image");
const owner = makeUser("owner");

/** Hovers a highlighted word of `raw` (its alias when `aliasId` is given). */
function hover(raw: RawKeyword, aliasId?: string): HTMLElement {
	const enriched = enrichKeywords([raw], 5, "en").find(
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
		"en",
	);
	anchor.dispatchEvent(new MouseEvent("mouseenter"));
	const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
	if (!tooltip) throw new Error("tooltip did not open");
	return tooltip;
}

function editKinds(tooltip: HTMLElement): (string | undefined)[] {
	return [...tooltip.querySelectorAll<HTMLElement>(".storylens-edit-btn")].map(
		(button) => button.dataset.editKind,
	);
}

afterEach(() => {
	destroyKeywordTooltipPortal();
	setTooltipActions(null);
	setTooltipUser(null);
	setTooltipLocale("en");
	setTooltipFontSize(null);
	document.body.replaceChildren();
});

afterAll(async () => {
	if (registeredHere) await GlobalRegistrator.unregister();
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
		const buttons = tooltip.querySelectorAll<HTMLButtonElement>(
			".storylens-image-btn",
		);
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

describe("tooltip edit buttons", () => {
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
			hover(raw)
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

		expect(hover(raw).querySelector(".storylens-edit-btn")?.textContent).toBe(
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
