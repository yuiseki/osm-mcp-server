import { endpoints } from "./config.js";
import { jsonErrorDetail, request } from "./http.js";

const elementTypes = ["node", "way", "area", "relation"] as const;

export type KeySearch = {
  dataUntil: string | null;
  total: number;
  keys: {
    key: string;
    count: number;
    nodes: number;
    ways: number;
    relations: number;
    values: number;
  }[];
};

export type KeyValues = {
  dataUntil: string | null;
  key: string;
  total: number;
  values: { value: string; count: number; fraction: number }[];
};

export type TagSearch = {
  dataUntil: string | null;
  total: number;
  tags: { key: string; value: string; count: number }[];
};

export type WikiPage = {
  lang: string;
  title: string;
  description: string;
  status?: string;
  usedOn: (typeof elementTypes)[number][];
};

export type TagDescription = {
  dataUntil: string | null;
  key: string;
  value: string | null;
  count: { all: number; nodes: number; ways: number; relations: number };
  wiki: WikiPage[];
  combinations: { key: string; value: string | null; count: number; fraction: number }[];
};

type Page<T> = { data_until?: string; total?: number; data: T[] };

const get = async <T>(path: string, params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const response = await request(
    "taginfo",
    `${endpoints().taginfo}/api/4/${path}?${search}`,
    {},
    jsonErrorDetail
  );
  return (await response.json()) as Page<T>;
};

// taginfo refuses unpaged lists of popular keys, so always ask for page 1.
const paged = (limit: number, sortname: string) => ({
  page: "1",
  rp: limit.toString(),
  sortname,
  sortorder: "desc",
});

/** Keys whose name contains query, most used first. */
export const searchKeys = async (
  query: string,
  { limit = 10 }: { limit?: number } = {}
): Promise<KeySearch> => {
  const page = await get<{
    key: string;
    count_all: number;
    count_nodes: number;
    count_ways: number;
    count_relations: number;
    values_all: number;
  }>("keys/all", { query, ...paged(limit, "count_all") });
  return {
    dataUntil: page.data_until ?? null,
    total: page.total ?? page.data.length,
    keys: page.data.map((k) => ({
      key: k.key,
      count: k.count_all,
      nodes: k.count_nodes,
      ways: k.count_ways,
      relations: k.count_relations,
      values: k.values_all,
    })),
  };
};

/** Values of key, optionally only those containing query, most used first. */
export const keyValues = async (
  key: string,
  { query, limit = 20 }: { query?: string; limit?: number } = {}
): Promise<KeyValues> => {
  const page = await get<{ value: string; count: number; fraction: number }>("key/values", {
    key,
    query,
    ...paged(limit, "count"),
  });
  return {
    dataUntil: page.data_until ?? null,
    key,
    total: page.total ?? page.data.length,
    values: page.data.map(({ value, count, fraction }) => ({ value, count, fraction })),
  };
};

/**
 * taginfo hands the search text to SQLite FTS5 unchanged and answers a syntax
 * error (from ;, -, " and the like) with 0 results instead of an error. As
 * one quoted phrase, any text is valid.
 */
export const ftsPhrase = (text: string) => `"${text.replace(/"/g, '""')}"`;

/**
 * Tags of any key whose value contains query as whole words, most used
 * first.
 */
export const searchTags = async (
  query: string,
  { limit = 20 }: { limit?: number } = {}
): Promise<TagSearch> => {
  const page = await get<{ key: string; value: string; count_all: number }>("search/by_value", {
    query: ftsPhrase(query),
    ...paged(limit, "count_all"),
  });
  return {
    dataUntil: page.data_until ?? null,
    total: page.total ?? page.data.length,
    tags: page.data.map((t) => ({ key: t.key, value: t.value, count: t.count_all })),
  };
};

type RawWikiPage = {
  lang: string;
  title: string;
  description: string;
  status?: string;
} & Partial<Record<`on_${(typeof elementTypes)[number]}`, boolean>>;

/** English first, then the requested language ("ja-JP" also matches "ja"). */
const pickWikiPages = (pages: RawWikiPage[], language?: string): WikiPage[] => {
  const wanted = ["en"];
  if (language) {
    const lang = language.toLowerCase();
    wanted.push(lang, lang.split("-")[0]);
  }
  return [...new Set(wanted)]
    .map((lang) => pages.find((p) => p.lang === lang))
    .filter((p) => p !== undefined)
    .map((p) => ({
      lang: p.lang,
      title: p.title,
      description: p.description,
      ...(p.status ? { status: p.status } : {}),
      usedOn: elementTypes.filter((type) => p[`on_${type}`]),
    }));
};

/**
 * Usage of a tag (key=value) or, without a value, of a key: how often it is
 * used on each element type, its wiki description, and the tags most often
 * found with it.
 */
export const describeTag = async (
  key: string,
  value?: string,
  { language }: { language?: string } = {}
): Promise<TagDescription> => {
  const kind = value === undefined ? "key" : "tag";
  const params = { key, value };
  const [stats, wiki, combinations] = await Promise.all([
    get<{ type: string; count: number }>(`${kind}/stats`, params),
    get<RawWikiPage>(`${kind}/wiki_pages`, params),
    get<{ other_key: string; other_value?: string; together_count: number; to_fraction: number }>(
      `${kind}/combinations`,
      { ...params, ...paged(10, "together_count") }
    ),
  ]);
  const count = (type: string) => stats.data.find((s) => s.type === type)?.count ?? 0;
  return {
    dataUntil: stats.data_until ?? null,
    key,
    value: value ?? null,
    count: {
      all: count("all"),
      nodes: count("nodes"),
      ways: count("ways"),
      relations: count("relations"),
    },
    wiki: pickWikiPages(wiki.data, language),
    combinations: combinations.data.map((c) => ({
      key: c.other_key,
      value: c.other_value || null,
      count: c.together_count,
      fraction: c.to_fraction,
    })),
  };
};
