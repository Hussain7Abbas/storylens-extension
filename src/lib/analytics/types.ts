export type AnalyticsParamValue = string | number | boolean;

export type AnalyticsEvent = {
	name: string;
	params?: Record<string, AnalyticsParamValue>;
};

export const ANALYTICS_ENABLED_KEY = "storylens-analytics-enabled";
