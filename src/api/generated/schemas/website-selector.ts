import type { websiteSelector } from "@/types/configs";

export type WebsiteSelectorResponse = websiteSelector & {
	id: string;
	createdAt: string;
	updatedAt: string;
};

export type GetWebsiteSelectors200 = {
	data: WebsiteSelectorResponse[];
};

export type WebsiteSelectorBody = websiteSelector;

export type WebsiteSelectorUpdateBody = Omit<WebsiteSelectorBody, "website">;
