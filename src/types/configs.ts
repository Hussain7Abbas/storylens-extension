export interface websiteSelector {
	website: string;
	novel: {
		xpath?: {
			value: string;
			regex: string;
		} | null;
		url?: {
			regex: string;
			value?: string;
		} | null;
	};
	chapter: {
		xpath?: {
			value: string;
			regex: string;
		} | null;
		url?: {
			regex: string;
			value?: string;
		} | null;
	};
}

export interface websiteSelectors {
	[key: string]: websiteSelector;
}
