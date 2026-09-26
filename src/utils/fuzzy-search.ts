function normalize(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase()
		.trim()
		.replace(/\s+/g, " ");
}

// Damerau-Levenshtein also tolerates accidentally swapped adjacent letters.
function distance(a: string, b: string): number {
	const rows = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0),
	);
	for (let i = 0; i <= a.length; i++) rows[i][0] = i;
	for (let j = 0; j <= b.length; j++) rows[0][j] = j;
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			rows[i][j] = Math.min(
				rows[i - 1][j] + 1,
				rows[i][j - 1] + 1,
				rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
				rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
		}
	}
	return rows[a.length][b.length];
}

export function fuzzyMatches(
	query: string,
	values: readonly (string | null | undefined)[],
): boolean {
	const term = normalize(query);
	if (!term) return true;
	const tokens = term.split(" ");
	return values.some((value) => {
		if (!value) return false;
		const text = normalize(value);
		if (text.includes(term)) return true;
		const words = text.split(" ");
		return tokens.every((token) =>
			words.some((word) => {
				if (word.includes(token)) return true;
				const tolerance = token.length < 3 ? 0 : token.length < 7 ? 1 : 2;
				return (
					Math.abs(word.length - token.length) <= tolerance &&
					distance(token, word) <= tolerance
				);
			}),
		);
	});
}
