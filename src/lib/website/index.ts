// The website hosts account pages (sign-in, registration, profile) so browser
// password managers can fill them; extension pages are off-limits to them.
// Without WXT_WEBSITE_URL, development builds use the local website so they
// never send the account flow to production.
const DEFAULT_WEBSITE_URL = import.meta.env.DEV
	? "http://localhost:3000"
	: "https://storylens.iscoded.com";

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
