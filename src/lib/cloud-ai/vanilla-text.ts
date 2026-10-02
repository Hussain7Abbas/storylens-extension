import type { TFunction } from "i18next";
import ar from "../../../public/locales/ar.json";
import en from "../../../public/locales/en.json";
/** The content script has no i18next HTTP backend: it uses the bundled localized messages. */
export function vanillaAiText(locale: string): TFunction {
	const strings = (locale.startsWith("ar") ? ar : en) as Record<
		string,
		unknown
	>;
	return ((key: string, values?: Record<string, unknown>) => {
		let value: unknown = strings;
		const pluralKey =
			typeof values?.count === "number"
				? `${key}_${new Intl.PluralRules(locale).select(values.count)}`
				: key;
		for (const part of pluralKey.split("."))
			value =
				value && typeof value === "object"
					? (value as Record<string, unknown>)[part]
					: undefined;
		return (typeof value === "string" ? value : key).replace(
			/{{(\w+)}}/g,
			(_, name: string) => String(values?.[name] ?? ""),
		);
	}) as TFunction;
}
