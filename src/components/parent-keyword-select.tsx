import { Loader, Select } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GetKeywords200DataItem } from "@/api/generated/schemas";
import { useNovelKeywords } from "@/hooks/use-novel-keywords";
import { useLanguage } from "@/store/locale";
import { fuzzyMatches } from "@/utils/fuzzy-search";
import { nameIn } from "@/utils/translation";

/** Async database catalogue, including downloaded novels, with debounced fuzzy search. */
export function ParentKeywordSelect({
	novelId,
	value,
	onChange,
}: {
	novelId: string;
	value: string | null;
	onChange: (parent: GetKeywords200DataItem | undefined) => void;
}) {
	const { t } = useTranslation();
	const language = useLanguage();
	const [search, setSearch] = useState("");
	const [term] = useDebouncedValue(search, 250);
	const { keywords, isLoading } = useNovelKeywords(novelId);
	return (
		<Select
			label={t("selection.parent")}
			placeholder={t("selection.searchParent")}
			searchable
			comboboxProps={{ withinPortal: false, position: "top" }}
			maxDropdownHeight={140}
			clearable
			searchValue={search}
			onSearchChange={setSearch}
			value={value}
			onChange={(id) => onChange(keywords.find((item) => item.id === id))}
			data={keywords
				.filter(
					(item) =>
						item.id === value ||
						fuzzyMatches(term, [
							nameIn(item, language),
							...item.aliases.map((alias) => alias.name),
						]),
				)
				.map((item) => ({ value: item.id, label: nameIn(item, language) }))}
			filter={({ options }) => options}
			rightSection={isLoading ? <Loader size={16} /> : undefined}
			nothingFoundMessage={
				isLoading ? t("selection.loading") : t("selection.noParents")
			}
			disabled={!novelId}
			required
		/>
	);
}
