import {
	AxiosError,
	type AxiosResponse,
	type InternalAxiosRequestConfig,
} from "axios";

/**
 * In-memory reader API following the offline-first contract (backend phase 2):
 * required client IDs with replays, required `baseUpdatedAt` with 409
 * `STALE_WRITE` and `current`, partial updates, error codes, alias
 * `nameAr`/`nameEn`, the D12 ownership rule, version rules and auto-close, the
 * replacement chain rewrite, lookups "in use", `updatedAt` bumps, paginated
 * lists, `Accept-Language` filtering, change feeds and the protocol endpoint.
 * Failures can be injected per request.
 */

type Row = Record<string, unknown> & { id: string };
type User = {
	id: string;
	username: string;
	moderator: boolean;
	isGuest: boolean;
};

export type Failure =
	| { kind: "network" }
	| { kind: "timeout" }
	/** The request never resolves (until aborted). */
	| { kind: "hang" }
	| { kind: "status"; status: number; code?: string; retryAfter?: number }
	/** The server applies the write, then the response is lost. */
	| { kind: "lostResponse" };

type Rule = {
	match: (method: string, path: string) => boolean;
	failure: Failure;
	times: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpFailure extends Error {
	constructor(
		readonly status: number,
		readonly body: Record<string, unknown>,
		readonly headers: Record<string, string> = {},
	) {
		super(String(body.message ?? status));
	}
}

function fail(
	status: number,
	code: string | undefined,
	message: string,
	extra: Record<string, unknown> = {},
): never {
	throw new HttpFailure(status, {
		message,
		...(code ? { code } : {}),
		...extra,
	});
}

const clone = <T>(value: T): T => structuredClone(value);

export class FakeApi {
	users = new Map<string, User>();
	novels = new Map<string, Row>();
	keywords = new Map<string, Row>();
	aliases = new Map<string, Row>();
	versions = new Map<string, Row>();
	replacements = new Map<string, Row>();
	categories = new Map<string, Row>();
	natures = new Map<string, Row>();
	biases = new Map<string, Row>();
	files = new Map<string, Row>();
	changes: {
		seq: number;
		entity: string;
		id: string;
		novelId: string | null;
	}[] = [];
	requests: {
		method: string;
		path: string;
		body?: unknown;
		params?: unknown;
		token?: string;
	}[] = [];
	uploads = 0;
	/** An API from before this release: no protocol endpoint (404). */
	oldApi = false;
	/** Rows older than this feed `seq` were pruned (410 for older cursors). */
	prunedBefore = 0;
	private rules: Rule[] = [];
	private clock = Date.parse("2026-01-01T00:00:00.000Z");
	private seq = 0;

	now(): string {
		this.clock += 1000;
		return new Date(this.clock).toISOString();
	}

	addUser(id: string, options: Partial<User> = {}): string {
		const token = `token-${id}`;
		this.users.set(token, {
			id,
			username: options.username ?? id,
			moderator: false,
			isGuest: false,
			...options,
		});
		return token;
	}

	failNext(
		failure: Failure,
		match: (method: string, path: string) => boolean = () => true,
		times = 1,
	): void {
		this.rules.push({ match, failure, times });
	}

	clearFailures(): void {
		this.rules = [];
	}

	private record(entity: string, id: string, novelId: string | null): void {
		this.changes.push({ seq: ++this.seq, entity, id, novelId });
	}

	// -------------------------------------------------------------------------
	// Seeds (server-side writes, as another device or the dashboard would make)
	// -------------------------------------------------------------------------

	seedNovel(values: Partial<Row> = {}): Row {
		const now = this.now();
		const novel: Row = {
			id: crypto.randomUUID(),
			nameAr: null,
			nameEn: "Novel",
			descriptionAr: null,
			descriptionEn: null,
			context: null,
			slugs: [],
			imageId: null,
			createdById: null,
			createdAt: now,
			updatedAt: now,
			...values,
		};
		this.novels.set(novel.id, novel);
		this.record("novel", novel.id, novel.id);
		return novel;
	}

	seedLookup(kind: "category" | "nature", values: Partial<Row> = {}): Row {
		const now = this.now();
		const row: Row = {
			id: crypto.randomUUID(),
			nameAr: null,
			nameEn: kind,
			color: "#112233",
			description: null,
			createdAt: now,
			updatedAt: now,
			...values,
		};
		(kind === "category" ? this.categories : this.natures).set(row.id, row);
		this.record(
			kind === "category" ? "keywordCategory" : "keywordNature",
			row.id,
			null,
		);
		return row;
	}

	seedKeyword(
		novelId: string,
		values: Partial<Row> & { categoryId: string; natureId: string },
		createdById: string | null = null,
	): Row {
		const { categoryId, natureId, description = null, ...rest } = values;
		const now = this.now();
		const keyword: Row = {
			id: crypto.randomUUID(),
			nameAr: null,
			nameEn: null,
			matchingType: "FULL",
			novelId,
			createdById,
			createdAt: now,
			updatedAt: now,
			...rest,
		};
		this.keywords.set(keyword.id, keyword);
		this.record("keyword", keyword.id, novelId);
		this.insertVersion({
			id: crypto.randomUUID(),
			keywordId: keyword.id,
			description,
			categoryId,
			natureId,
			imageId: null,
			startingChapter: 0,
			endingChapter: null,
			createdById,
		});
		return keyword;
	}

	/** Another device or a moderator changes a row. */
	editRow(
		table: Map<string, Row>,
		id: string,
		changes: Record<string, unknown>,
		entity: string,
	): Row {
		const row = table.get(id);
		if (!row) throw new Error(`No row ${id}`);
		const next = { ...row, ...changes, updatedAt: this.now() };
		table.set(id, next);
		this.record(entity, id, this.novelOf(entity, next));
		return next;
	}

	/** Another device or the dashboard deletes a row (keywords cascade). */
	deleteRow(
		entity:
			| "keyword"
			| "keywordAlias"
			| "keywordVersion"
			| "replacement"
			| "novel"
			| "keywordCategory"
			| "keywordNature",
		id: string,
	): void {
		if (entity === "keyword") this.deleteKeyword(id);
		else if (entity === "novel") {
			for (const keyword of [...this.keywords.values()])
				if (keyword.novelId === id) this.deleteKeyword(keyword.id);
			for (const row of [...this.replacements.values()])
				if (row.novelId === id) this.replacements.delete(row.id);
			this.novels.delete(id);
			this.record("novel", id, id);
		} else {
			const table = this.tableOf(entity);
			const row = table.get(id);
			table.delete(id);
			this.record(entity, id, row ? this.novelOf(entity, row) : null);
		}
	}

	private tableOf(entity: string): Map<string, Row> {
		const tables: Record<string, Map<string, Row>> = {
			keyword: this.keywords,
			keywordAlias: this.aliases,
			keywordVersion: this.versions,
			replacement: this.replacements,
			keywordCategory: this.categories,
			keywordNature: this.natures,
			novel: this.novels,
		};
		return tables[entity] as Map<string, Row>;
	}

	private novelOf(entity: string, row: Row): string | null {
		if (entity === "novel") return row.id;
		if (entity === "keyword" || entity === "replacement")
			return row.novelId as string;
		if (entity === "keywordAlias" || entity === "keywordVersion") {
			return (
				(this.keywords.get(row.keywordId as string)?.novelId as
					| string
					| undefined) ?? null
			);
		}
		return null;
	}

	private deleteKeyword(id: string): void {
		const keyword = this.keywords.get(id);
		for (const alias of [...this.aliases.values()])
			if (alias.keywordId === id) this.aliases.delete(alias.id);
		for (const version of [...this.versions.values()])
			if (version.keywordId === id) this.versions.delete(version.id);
		for (const row of this.replacements.values())
			if (row.keywordId === id) row.keywordId = null;
		this.keywords.delete(id);
		this.record("keyword", id, (keyword?.novelId as string) ?? null);
	}

	private insertVersion(values: Row): Row {
		const now = this.now();
		const version: Row = { createdAt: now, updatedAt: now, ...values };
		this.versions.set(version.id, version);
		this.record(
			"keywordVersion",
			version.id,
			this.novelOf("keywordVersion", version),
		);
		return version;
	}

	// -------------------------------------------------------------------------
	// Shapes
	// -------------------------------------------------------------------------

	private style(row: Row): Row {
		return {
			...row,
			category: row.categoryId
				? clone(this.categories.get(row.categoryId as string) ?? null)
				: null,
			nature: row.natureId
				? clone(this.natures.get(row.natureId as string) ?? null)
				: null,
			image: row.imageId
				? clone(this.files.get(row.imageId as string) ?? null)
				: null,
		};
	}

	private keywordShape(keyword: Row): Row {
		return {
			...clone(keyword),
			aliases: [...this.aliases.values()]
				.filter((alias) => alias.keywordId === keyword.id)
				.map((alias) => this.style(clone(alias))),
			versions: [...this.versions.values()]
				.filter((version) => version.keywordId === keyword.id)
				.sort(
					(left, right) =>
						(left.startingChapter as number) -
						(right.startingChapter as number),
				)
				.map((version) => this.style(clone(version))),
		};
	}

	private replacementShape(row: Row): Row {
		const keyword = row.keywordId
			? this.keywords.get(row.keywordId as string)
			: undefined;
		return { ...clone(row), keyword: keyword ? clone(keyword) : null };
	}

	// -------------------------------------------------------------------------
	// Request handling
	// -------------------------------------------------------------------------

	adapter = async (
		config: InternalAxiosRequestConfig,
	): Promise<AxiosResponse> => {
		const method = (config.method ?? "get").toUpperCase();
		const url = new URL(config.url ?? "/", "http://localhost");
		const path = url.pathname.replace(/^\/api\/user/, "");
		const auth = String(
			config.headers?.Authorization ??
				config.headers?.get?.("Authorization") ??
				"",
		);
		const token = auth.replace(/^Bearer /, "") || undefined;
		const language = String(
			config.headers?.["Accept-Language"] ??
				config.headers?.get?.("Accept-Language") ??
				"en",
		);
		const body =
			typeof config.data === "string" ? JSON.parse(config.data) : config.data;
		const params = {
			...(config.params ?? {}),
			...Object.fromEntries(url.searchParams),
		};
		this.requests.push({ method, path, body, params, token });

		const rule = this.rules.find((item) => item.match(method, path));
		if (rule) {
			rule.times -= 1;
			if (rule.times <= 0) this.rules.splice(this.rules.indexOf(rule), 1);
		}
		const failure = rule?.failure;
		if (failure?.kind === "network")
			throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config);
		if (failure?.kind === "timeout")
			throw new AxiosError("timeout exceeded", AxiosError.ECONNABORTED, config);
		if (failure?.kind === "hang") {
			return new Promise((_, reject) => {
				config.signal?.addEventListener?.("abort", () =>
					reject(new AxiosError("canceled", AxiosError.ERR_CANCELED, config)),
				);
			});
		}

		const respond = (
			status: number,
			data: unknown,
			headers: Record<string, string> = {},
		): AxiosResponse => ({
			status,
			statusText: String(status),
			headers,
			config,
			data,
		});
		const reject = (
			status: number,
			data: Record<string, unknown>,
			headers: Record<string, string> = {},
		): never => {
			throw new AxiosError(
				`Request failed with status code ${status}`,
				"ERR_BAD_RESPONSE",
				config,
				undefined,
				respond(status, data, headers),
			);
		};

		if (failure?.kind === "status") {
			reject(
				failure.status,
				{
					message: "Injected failure",
					...(failure.code ? { code: failure.code } : {}),
				},
				failure.retryAfter ? { "retry-after": String(failure.retryAfter) } : {},
			);
		}

		const user = token ? this.users.get(token) : undefined;
		if (!user) reject(401, { message: "Authentication required" });
		try {
			const data = this.route(
				method,
				path,
				body,
				params,
				user as User,
				language,
				config,
			);
			if (failure?.kind === "lostResponse")
				throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config);
			return respond(200, data);
		} catch (error) {
			if (error instanceof HttpFailure)
				return reject(error.status, error.body, error.headers);
			throw error;
		}
	};

	private page(
		rows: Row[],
		params: Record<string, unknown>,
	): { data: Row[]; total: number } {
		const pagination = (params.pagination ?? {}) as {
			page?: number;
			pageSize?: number;
		};
		const page = Number(pagination.page ?? params["pagination[page]"] ?? 1);
		const size = Number(
			pagination.pageSize ?? params["pagination[pageSize]"] ?? 10,
		);
		return {
			data: rows.slice((page - 1) * size, page * size),
			total: rows.length,
		};
	}

	private query(
		params: Record<string, unknown>,
		field: string,
	): string | undefined {
		const nested = params.query as Record<string, unknown> | undefined;
		return (nested?.[field] ?? params[`query[${field}]`] ?? params[field]) as
			| string
			| undefined;
	}

	private requireUuid(id: unknown): void {
		if (typeof id !== "string" || !UUID.test(id))
			fail(422, undefined, "Expected string to match 'uuid' format");
	}

	private requireBase(body: Record<string, unknown>): void {
		if (typeof body?.baseUpdatedAt !== "string")
			fail(422, undefined, "Expected property 'baseUpdatedAt' to be string");
	}

	private assertFresh(
		row: Row,
		baseUpdatedAt: string,
		current: () => unknown,
	): void {
		if (Date.parse(row.updatedAt as string) > Date.parse(baseUpdatedAt)) {
			fail(409, "STALE_WRITE", "This item changed since you edited it", {
				current: current(),
			});
		}
	}

	private assertOwns(user: User, ...owners: unknown[]): void {
		if (user.moderator) return;
		if (owners.some((owner) => owner && owner === user.id)) return;
		fail(403, "NOT_OWNER", "You can only modify resources you created");
	}

	private replay(
		table: Map<string, Row>,
		id: unknown,
		matches: (row: Row) => boolean,
		shape: (row: Row) => Row,
	): Row | null {
		this.requireUuid(id);
		const existing = table.get(id as string);
		if (!existing) return null;
		if (matches(existing)) return shape(existing);
		fail(409, "ID_CONFLICT", "This ID is already used by another item");
	}

	private namesTaken(
		rows: Row[],
		names: Record<string, unknown>,
		exceptId?: string,
	): boolean {
		return (["nameAr", "nameEn"] as const).some(
			(field) =>
				!!names[field] &&
				rows.some((row) => row.id !== exceptId && row[field] === names[field]),
		);
	}

	private assertName(names: Record<string, unknown>): void {
		if (
			!String(names.nameAr ?? "").trim() &&
			!String(names.nameEn ?? "").trim()
		) {
			fail(422, "NAME_REQUIRED", "An Arabic or English name is required");
		}
	}

	private route(
		method: string,
		path: string,
		body: Record<string, unknown>,
		params: Record<string, unknown>,
		user: User,
		language: string,
		config: InternalAxiosRequestConfig,
	): unknown {
		const segments = path.split("/").filter(Boolean);
		const [resource, id, sub] = segments;
		const nameField = language.startsWith("ar") ? "nameAr" : "nameEn";

		if (resource === "sync") {
			if (id === "protocol") {
				if (this.oldApi) fail(404, "NOT_FOUND", "NOT_FOUND");
				return { version: 2 };
			}
			if (this.oldApi) fail(404, "NOT_FOUND", "NOT_FOUND");
			if (id === "snapshot") return this.snapshot(segments);
			return this.feed(segments, params);
		}

		if (resource === "novels" && method === "GET") {
			if (id) {
				const novel = this.novels.get(id);
				if (!novel) fail(404, "NOT_FOUND", "Novel not found");
				return { ...clone(novel), image: null, chapters: [] };
			}
			return this.page(
				[...this.novels.values()]
					.filter((novel) => novel[nameField])
					.map(clone),
				params,
			);
		}

		if (resource === "website-novel-biases" && method === "GET") {
			const novelId = this.query(params, "novelId");
			return [...this.biases.values()]
				.filter((row) => row.novelId === novelId)
				.map(clone);
		}

		if (resource === "keywords")
			return this.keywordsRoute(method, id, body, params, user, nameField);
		if (resource === "keyword-aliases")
			return this.aliasesRoute(method, id, body, params, user);
		if (resource === "keyword-versions")
			return this.versionsRoute(method, id, body, params, user);
		if (resource === "replacements")
			return this.replacementsRoute(method, id, body, params, user);
		if (resource === "keyword-categories")
			return this.lookupsRoute(
				"keywordCategory",
				this.categories,
				method,
				id,
				body,
				params,
				user,
			);
		if (resource === "keyword-natures")
			return this.lookupsRoute(
				"keywordNature",
				this.natures,
				method,
				id,
				body,
				params,
				user,
			);
		if (resource === "files" && id === "upload")
			return this.upload(config.data as FormData, user);
		void sub;
		fail(404, "NOT_FOUND", "NOT_FOUND");
	}

	private keywordsRoute(
		method: string,
		id: string | undefined,
		body: Record<string, unknown>,
		params: Record<string, unknown>,
		user: User,
		nameField: string,
	): unknown {
		if (method === "GET") {
			const novelId = this.query(params, "novelId");
			const rows = [...this.keywords.values()].filter(
				(row) => (!novelId || row.novelId === novelId) && row[nameField],
			);
			return this.page(
				rows.map((row) => this.keywordShape(row)),
				params,
			);
		}
		if (method === "POST") {
			const replay = this.replay(
				this.keywords,
				body.id,
				(row) => row.createdById === user.id && row.novelId === body.novelId,
				(row) => this.keywordShape(row),
			);
			if (replay) return replay;
			this.requireUuid(body.versionId);
			this.assertName(body);
			if (!this.categories.has(body.categoryId as string))
				fail(404, "PARENT_NOT_FOUND", "Category not found");
			if (!this.natures.has(body.natureId as string))
				fail(404, "PARENT_NOT_FOUND", "Nature not found");
			if (!this.novels.has(body.novelId as string))
				fail(404, "PARENT_NOT_FOUND", "Novel not found");
			const siblings = [...this.keywords.values()].filter(
				(row) => row.novelId === body.novelId,
			);
			if (this.namesTaken(siblings, body))
				fail(
					409,
					"KEYWORD_NAME_TAKEN",
					"Keyword name already exists for this novel",
				);
			if (this.versions.has(body.versionId as string))
				fail(
					409,
					"UNIQUE_VIOLATION",
					"A record with these values already exists",
				);
			const now = this.now();
			const keyword: Row = {
				id: body.id as string,
				nameAr: body.nameAr ?? null,
				nameEn: body.nameEn ?? null,
				matchingType: body.matchingType ?? "FULL",
				novelId: body.novelId,
				createdById: user.id,
				createdAt: now,
				updatedAt: now,
			};
			this.keywords.set(keyword.id, keyword);
			this.record("keyword", keyword.id, keyword.novelId as string);
			this.insertVersion({
				id: body.versionId as string,
				keywordId: keyword.id,
				description: body.description ?? null,
				categoryId: body.categoryId,
				natureId: body.natureId,
				imageId: body.imageId ?? null,
				startingChapter: 0,
				endingChapter: null,
				createdById: user.id,
			});
			return this.keywordShape(keyword);
		}
		this.requireUuid(id);
		const keyword = this.keywords.get(id as string);
		if (!keyword) fail(404, "NOT_FOUND", "Keyword not found");
		if (method === "PUT") {
			this.requireBase(body);
			this.assertOwns(user, keyword.createdById);
			this.assertFresh(keyword, body.baseUpdatedAt as string, () =>
				this.keywordShape(keyword),
			);
			const names = {
				nameAr: body.nameAr === undefined ? keyword.nameAr : body.nameAr,
				nameEn: body.nameEn === undefined ? keyword.nameEn : body.nameEn,
			};
			this.assertName(names);
			const siblings = [...this.keywords.values()].filter(
				(row) => row.novelId === keyword.novelId,
			);
			const changed = {
				nameAr: body.nameAr !== keyword.nameAr ? body.nameAr : undefined,
				nameEn: body.nameEn !== keyword.nameEn ? body.nameEn : undefined,
			};
			if (this.namesTaken(siblings, changed, keyword.id))
				fail(
					409,
					"KEYWORD_NAME_TAKEN",
					"Keyword name already exists for this novel",
				);
			const next = {
				...keyword,
				...names,
				...(body.matchingType ? { matchingType: body.matchingType } : {}),
				updatedAt: this.now(),
			};
			this.keywords.set(keyword.id, next);
			this.record("keyword", keyword.id, keyword.novelId as string);
			return this.keywordShape(next);
		}
		this.assertOwns(user, keyword.createdById);
		this.deleteKeyword(keyword.id);
		return clone(keyword);
	}

	private aliasesRoute(
		method: string,
		id: string | undefined,
		body: Record<string, unknown>,
		params: Record<string, unknown>,
		user: User,
	): unknown {
		if (method === "GET") {
			const keywordId = this.query(params, "keywordId");
			return this.page(
				[...this.aliases.values()]
					.filter((row) => !keywordId || row.keywordId === keywordId)
					.map((row) => this.style(clone(row))),
				params,
			);
		}
		const fields = [
			"nameAr",
			"nameEn",
			"description",
			"matchingType",
			"overrideStyle",
			"categoryId",
			"natureId",
			"imageId",
		];
		if (method === "POST") {
			const replay = this.replay(
				this.aliases,
				body.id,
				(row) =>
					row.createdById === user.id && row.keywordId === body.keywordId,
				(row) => this.style(clone(row)),
			);
			if (replay) return replay;
			this.assertName(body);
			if (!this.keywords.has(body.keywordId as string))
				fail(404, "PARENT_NOT_FOUND", "Keyword not found");
			const siblings = [...this.aliases.values()].filter(
				(row) => row.keywordId === body.keywordId,
			);
			if (this.namesTaken(siblings, body))
				fail(
					409,
					"ALIAS_NAME_TAKEN",
					"Alias name already exists for this keyword",
				);
			const now = this.now();
			const alias: Row = {
				id: body.id as string,
				nameAr: null,
				nameEn: null,
				description: null,
				matchingType: "FULL",
				overrideStyle: false,
				categoryId: null,
				natureId: null,
				imageId: null,
				...Object.fromEntries(
					fields
						.filter((field) => body[field] !== undefined)
						.map((field) => [field, body[field]]),
				),
				keywordId: body.keywordId,
				createdById: user.id,
				createdAt: now,
				updatedAt: now,
			};
			this.aliases.set(alias.id, alias);
			this.record(
				"keywordAlias",
				alias.id,
				this.novelOf("keywordAlias", alias),
			);
			return this.style(clone(alias));
		}
		this.requireUuid(id);
		const alias = this.aliases.get(id as string);
		if (!alias) fail(404, "NOT_FOUND", "Alias not found");
		const parent = this.keywords.get(alias.keywordId as string);
		if (method === "PUT") {
			this.requireBase(body);
			this.assertOwns(user, alias.createdById, parent?.createdById);
			this.assertFresh(alias, body.baseUpdatedAt as string, () =>
				this.style(clone(alias)),
			);
			const siblings = [...this.aliases.values()].filter(
				(row) => row.keywordId === alias.keywordId,
			);
			if (
				this.namesTaken(
					siblings,
					{ nameAr: body.nameAr, nameEn: body.nameEn },
					alias.id,
				)
			)
				fail(
					409,
					"ALIAS_NAME_TAKEN",
					"Alias name already exists for this keyword",
				);
			const next = {
				...alias,
				...Object.fromEntries(
					fields
						.filter((field) => body[field] !== undefined)
						.map((field) => [field, body[field]]),
				),
				updatedAt: this.now(),
			};
			this.assertName(next);
			this.aliases.set(alias.id, next);
			this.record("keywordAlias", alias.id, this.novelOf("keywordAlias", next));
			return this.style(clone(next));
		}
		this.assertOwns(user, alias.createdById, parent?.createdById);
		this.aliases.delete(alias.id);
		this.record("keywordAlias", alias.id, this.novelOf("keywordAlias", alias));
		return clone(alias);
	}

	private versionsRoute(
		method: string,
		id: string | undefined,
		body: Record<string, unknown>,
		params: Record<string, unknown>,
		user: User,
	): unknown {
		if (method === "GET") {
			const keywordId = this.query(params, "keywordId");
			return this.page(
				[...this.versions.values()]
					.filter((row) => !keywordId || row.keywordId === keywordId)
					.map((row) => this.style(clone(row))),
				params,
			);
		}
		if (method === "POST") {
			const replay = this.replay(
				this.versions,
				body.id,
				(row) =>
					row.createdById === user.id && row.keywordId === body.keywordId,
				(row) => this.style(clone(row)),
			);
			if (replay) return replay;
			if (!this.keywords.has(body.keywordId as string))
				fail(404, "PARENT_NOT_FOUND", "Keyword not found");
			const siblings = [...this.versions.values()].filter(
				(row) => row.keywordId === body.keywordId,
			);
			const latest = siblings
				.filter((row) => row.endingChapter === null)
				.sort(
					(left, right) =>
						(right.startingChapter as number) -
						(left.startingChapter as number),
				)[0];
			let start: number;
			let end: number | null = null;
			if (user.moderator) {
				start = (body.startingChapter ?? body.currentChapter ?? 0) as number;
				end = (body.endingChapter ?? null) as number | null;
			} else {
				if (body.currentChapter == null)
					fail(
						400,
						"VERSION_CHAPTER_REQUIRED",
						"currentChapter is required to add a version",
					);
				start = body.currentChapter as number;
			}
			if (latest && start <= (latest.startingChapter as number))
				fail(
					400,
					"VERSION_NOT_AFTER_LATEST",
					"startingChapter must be greater than the current latest version",
				);
			if (latest) {
				this.versions.set(latest.id, {
					...latest,
					endingChapter: start - 1,
					updatedAt: this.now(),
				});
				this.record(
					"keywordVersion",
					latest.id,
					this.novelOf("keywordVersion", latest),
				);
			}
			const version = this.insertVersion({
				id: body.id as string,
				keywordId: body.keywordId,
				description: body.description ?? null,
				categoryId: body.categoryId ?? null,
				natureId: body.natureId ?? null,
				imageId: body.imageId ?? null,
				startingChapter: start,
				endingChapter: end,
				createdById: user.id,
			});
			return this.style(clone(version));
		}
		this.requireUuid(id);
		const version = this.versions.get(id as string);
		if (!version) fail(404, "NOT_FOUND", "Version not found");
		const parent = this.keywords.get(version.keywordId as string);
		if (method === "PUT") {
			this.requireBase(body);
			this.assertOwns(user, version.createdById, parent?.createdById);
			this.assertFresh(version, body.baseUpdatedAt as string, () =>
				this.style(clone(version)),
			);
			const fields = [
				"description",
				"categoryId",
				"natureId",
				"imageId",
				...(user.moderator ? ["startingChapter", "endingChapter"] : []),
			];
			const next = {
				...version,
				...Object.fromEntries(
					fields
						.filter((field) => body[field] !== undefined)
						.map((field) => [field, body[field]]),
				),
				updatedAt: this.now(),
			};
			this.versions.set(version.id, next);
			this.record(
				"keywordVersion",
				version.id,
				this.novelOf("keywordVersion", next),
			);
			return this.style(clone(next));
		}
		this.assertOwns(user, version.createdById, parent?.createdById);
		const siblings = [...this.versions.values()].filter(
			(row) => row.keywordId === version.keywordId,
		);
		if (siblings.length <= 1)
			fail(
				400,
				"VERSION_ONLY_PROTECTED",
				"Cannot delete the only version of a keyword",
			);
		const base = siblings.sort(
			(left, right) =>
				(left.startingChapter as number) - (right.startingChapter as number),
		)[0];
		if (base?.id === version.id)
			fail(
				400,
				"VERSION_BASE_PROTECTED",
				"Cannot delete the base version of a keyword",
			);
		this.versions.delete(version.id);
		this.record(
			"keywordVersion",
			version.id,
			this.novelOf("keywordVersion", version),
		);
		return this.style(clone(version));
	}

	private validateReplacement(
		values: { from: string; to: string; novelId: string },
		exceptId: string,
	): void {
		const rows = [...this.replacements.values()].filter(
			(row) => row.novelId === values.novelId && row.id !== exceptId,
		);
		if (rows.some((row) => row.from === values.from))
			fail(
				409,
				"REPLACEMENT_EXISTS",
				"Replacement already exists for this keyword",
			);
		if (rows.some((row) => row.from === values.to && row.to === values.from))
			fail(
				400,
				"REPLACEMENT_BIDIRECTIONAL",
				"There is a bidirectional replacement",
			);
	}

	private rewriteChain(values: {
		from: string;
		to: string;
		novelId: string;
	}): string | null {
		const keyword = [...this.keywords.values()].find(
			(row) =>
				row.novelId === values.novelId &&
				(row.nameAr === values.to || row.nameEn === values.to),
		);
		for (const row of [...this.replacements.values()]) {
			if (row.novelId === values.novelId && row.to === values.from) {
				this.replacements.set(row.id, {
					...row,
					to: values.to,
					keywordId: keyword?.id ?? null,
					updatedAt: this.now(),
				});
				this.record("replacement", row.id, values.novelId);
			}
		}
		return keyword?.id ?? null;
	}

	private replacementsRoute(
		method: string,
		id: string | undefined,
		body: Record<string, unknown>,
		params: Record<string, unknown>,
		user: User,
	): unknown {
		if (method === "GET") {
			const novelId = this.query(params, "novelId");
			return this.page(
				[...this.replacements.values()]
					.filter((row) => !novelId || row.novelId === novelId)
					.map((row) => this.replacementShape(row)),
				params,
			);
		}
		if (method === "POST") {
			const replay = this.replay(
				this.replacements,
				body.id,
				(row) => row.createdById === user.id && row.novelId === body.novelId,
				(row) => this.replacementShape(row),
			);
			if (replay) return replay;
			if (!this.novels.has(body.novelId as string))
				fail(404, "PARENT_NOT_FOUND", "Novel not found");
			const values = {
				from: body.from as string,
				to: body.to as string,
				novelId: body.novelId as string,
			};
			this.validateReplacement(values, body.id as string);
			const keywordId = this.rewriteChain(values);
			const now = this.now();
			const row: Row = {
				id: body.id as string,
				...values,
				matchingType: body.matchingType ?? "FULL",
				keywordId,
				createdById: user.id,
				createdAt: now,
				updatedAt: now,
			};
			this.replacements.set(row.id, row);
			this.record("replacement", row.id, values.novelId);
			return this.replacementShape(row);
		}
		this.requireUuid(id);
		const row = this.replacements.get(id as string);
		if (!row) fail(404, "NOT_FOUND", "Replacement not found");
		if (method === "PUT") {
			this.requireBase(body);
			this.assertOwns(user, row.createdById);
			this.assertFresh(row, body.baseUpdatedAt as string, () =>
				this.replacementShape(row),
			);
			const merged = {
				from: (body.from ?? row.from) as string,
				to: (body.to ?? row.to) as string,
				novelId: row.novelId as string,
			};
			this.validateReplacement(merged, row.id);
			const keywordId = this.rewriteChain(merged);
			const next = {
				...row,
				from: merged.from,
				to: merged.to,
				...(body.matchingType ? { matchingType: body.matchingType } : {}),
				keywordId,
				updatedAt: this.now(),
			};
			this.replacements.set(row.id, next);
			this.record("replacement", row.id, merged.novelId);
			return this.replacementShape(next);
		}
		this.assertOwns(user, row.createdById);
		this.replacements.delete(row.id);
		this.record("replacement", row.id, row.novelId as string);
		return clone(row);
	}

	private lookupsRoute(
		entity: string,
		table: Map<string, Row>,
		method: string,
		id: string | undefined,
		body: Record<string, unknown>,
		params: Record<string, unknown>,
		user: User,
	): unknown {
		if (method === "GET")
			return this.page([...table.values()].map(clone), params);
		if (!user.moderator) fail(403, undefined, "Missing permission");
		const names = (values: Record<string, unknown>) => ({
			nameAr: String(values.nameAr ?? "").trim() || null,
			nameEn: String(values.nameEn ?? "").trim() || null,
		});
		if (method === "POST") {
			const replay = this.replay(
				table,
				body.id,
				(row) =>
					row.color === body.color &&
					row.nameAr === names(body).nameAr &&
					row.nameEn === names(body).nameEn,
				clone,
			);
			if (replay) return replay;
			this.assertName(names(body));
			if (this.namesTaken([...table.values()], names(body)))
				fail(409, "LOOKUP_NAME_TAKEN", "Name already exists");
			const now = this.now();
			const row: Row = {
				id: body.id as string,
				...names(body),
				color: body.color,
				description: body.description ?? null,
				createdAt: now,
				updatedAt: now,
			};
			table.set(row.id, row);
			this.record(entity, row.id, null);
			return clone(row);
		}
		this.requireUuid(id);
		const row = table.get(id as string);
		if (!row) fail(404, "NOT_FOUND", "Not found");
		if (method === "PUT") {
			this.requireBase(body);
			this.assertFresh(row, body.baseUpdatedAt as string, () => clone(row));
			const next = {
				...row,
				...Object.fromEntries(
					["nameAr", "nameEn", "color", "description"]
						.filter((field) => body[field] !== undefined)
						.map((field) => [field, body[field]]),
				),
				updatedAt: this.now(),
			};
			table.set(row.id, next);
			this.record(entity, row.id, null);
			return clone(next);
		}
		const field = entity === "keywordCategory" ? "categoryId" : "natureId";
		const used = [...this.versions.values(), ...this.aliases.values()].some(
			(item) => item[field] === row.id,
		);
		if (used)
			fail(
				400,
				entity === "keywordCategory" ? "CATEGORY_IN_USE" : "NATURE_IN_USE",
				"In use",
			);
		table.delete(row.id);
		this.record(entity, row.id, null);
		return clone(row);
	}

	private upload(form: FormData, user: User): unknown {
		const id = form.get("id");
		this.requireUuid(id);
		const existing = this.files.get(id as string);
		if (existing) {
			if (existing.userId === user.id) return clone(existing);
			fail(409, "ID_CONFLICT", "This ID is already used by another item");
		}
		this.uploads += 1;
		const now = this.now();
		const file: Row = {
			id: id as string,
			url: `https://img.example/${id}.png`,
			type: "Image",
			provider_image_id: String(id),
			delete_url: "-",
			userId: user.id,
			createdAt: now,
			updatedAt: now,
		};
		this.files.set(file.id, file);
		return clone(file);
	}

	private snapshot(segments: string[]): unknown {
		const scope = segments[2];
		const cursor = this.seq;
		if (scope === "catalogue") {
			return {
				novels: [...this.novels.values()].map((row) => ({
					...clone(row),
					image: null,
				})),
				cursor,
			};
		}
		if (scope === "lookups") {
			return {
				categories: [...this.categories.values()].map(clone),
				natures: [...this.natures.values()].map(clone),
				cursor,
			};
		}
		const novelId = segments[3];
		const novel = this.novels.get(novelId as string);
		if (!novel) fail(404, "NOT_FOUND", "Novel not found");
		return {
			novel: { ...clone(novel), image: null },
			keywords: [...this.keywords.values()]
				.filter((row) => row.novelId === novelId)
				.map((row) => this.keywordShape(row)),
			replacements: [...this.replacements.values()]
				.filter((row) => row.novelId === novelId)
				.map((row) => this.replacementShape(row)),
			biases: [...this.biases.values()]
				.filter((row) => row.novelId === novelId)
				.map(clone),
			cursor,
		};
	}

	private feed(segments: string[], params: Record<string, unknown>): unknown {
		const since = params.since === undefined ? undefined : Number(params.since);
		const limit = Number(params.limit ?? 1000);
		const cursorNow = this.seq;
		const scope = segments[1];
		const novelId = scope === "novels" ? segments[2] : undefined;
		const inScope = (change: (typeof this.changes)[number]) =>
			scope === "novels"
				? change.novelId === novelId
				: scope === "lookups"
					? change.entity === "keywordCategory" ||
						change.entity === "keywordNature"
					: change.entity === "novel";
		const empty =
			scope === "novels"
				? {
						keywords: [],
						aliases: [],
						versions: [],
						replacements: [],
						biases: [],
						deleted: [],
					}
				: scope === "lookups"
					? { categories: [], natures: [], deleted: [] }
					: { novels: [], deleted: [] };
		if (since === undefined)
			return { ...empty, cursor: cursorNow, hasMore: false };
		if (since < this.prunedBefore)
			fail(410, "CURSOR_EXPIRED", "Sync cursor expired");
		const rows = this.changes.filter(
			(change) => change.seq > since && inScope(change),
		);
		const page = rows.slice(0, limit);
		const ids = (entity: string) => [
			...new Set(
				page
					.filter((change) => change.entity === entity)
					.map((change) => change.id),
			),
		];
		const deleted: { entity: string; id: string }[] = [];
		const load = (
			entity: string,
			table: Map<string, Row>,
			shape: (row: Row) => Row,
		) =>
			ids(entity).flatMap((id) => {
				const row = table.get(id);
				if (!row) {
					deleted.push({ entity, id });
					return [];
				}
				return [shape(row)];
			});
		const cursor = page.at(-1)?.seq ?? since;
		if (scope === "novels") {
			const novel = ids("novel").includes(novelId as string)
				? this.novels.get(novelId as string)
				: undefined;
			if (ids("novel").includes(novelId as string) && !novel)
				deleted.push({ entity: "novel", id: novelId as string });
			return {
				...(novel ? { novel: { ...clone(novel), image: null } } : {}),
				keywords: load("keyword", this.keywords, clone),
				aliases: load("keywordAlias", this.aliases, (row) =>
					this.style(clone(row)),
				),
				versions: load("keywordVersion", this.versions, (row) =>
					this.style(clone(row)),
				),
				replacements: load("replacement", this.replacements, (row) =>
					this.replacementShape(row),
				),
				biases: [],
				deleted,
				cursor,
				hasMore: rows.length > limit,
			};
		}
		if (scope === "lookups") {
			return {
				categories: load("keywordCategory", this.categories, clone),
				natures: load("keywordNature", this.natures, clone),
				deleted,
				cursor,
				hasMore: rows.length > limit,
			};
		}
		return {
			novels: load("novel", this.novels, (row) => ({
				...clone(row),
				image: null,
			})),
			deleted,
			cursor,
			hasMore: rows.length > limit,
		};
	}
}
