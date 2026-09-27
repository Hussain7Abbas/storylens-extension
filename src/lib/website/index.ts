// The website hosts account pages (sign-in, registration, profile) so browser
// password managers can fill them; extension pages are off-limits to them.
const DEFAULT_WEBSITE_URL = "https://storylens.iscoded.com";

export const WEBSITE_URL = (
	import.meta.env.WXT_WEBSITE_URL || DEFAULT_WEBSITE_URL
).replace(/\/+$/, "");

export function websiteMatchPattern(url: string = WEBSITE_URL): string {
	const { protocol, host } = new URL(url);
	return `${protocol}//${host}/*`;
}

export function websitePageUrl(locale: string, path = ""): string {
	const lang = locale === "ar" ? "ar" : "en";
	return `${WEBSITE_URL}/${lang}/${path}`;
}
