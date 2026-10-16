import { expect, test } from "bun:test";
import { MatchPattern } from "wxt/utils/match-patterns";
import { isWebsiteOrigin, websiteMatchPattern } from "../src/lib/website";

test("the website bridge uses patterns WXT can register and reload", () => {
	for (const website of [
		"http://localhost:3000",
		"http://127.0.0.1:4173",
		"https://storylens.iscoded.com",
	]) {
		const pattern = new MatchPattern(websiteMatchPattern(website));
		expect(pattern.includes(`${website}/en/profile/`)).toBe(true);
	}
});

test("the bridge trusts only the configured origin, including its port", () => {
	const website = "http://localhost:3000";
	expect(isWebsiteOrigin(website, website)).toBe(true);
	for (const origin of [
		"http://localhost:3030",
		"http://localhost:3050",
		"http://127.0.0.1:3000",
		"https://localhost:3000",
		"https://storylens.iscoded.com",
		"null",
	])
		expect(isWebsiteOrigin(origin, website)).toBe(false);
});
