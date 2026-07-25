import "server-only";

import type { NotionDatabase, NotionPropertySchema } from "@/lib/notion/client";

// Writing to a Notion database means matching its property NAMES and TYPES
// exactly. Both are user-editable in Notion, so hardcoding either would break
// the moment a column is renamed or its type changed. Instead we fetch the live
// schema and resolve each logical field ("the product name") against it by
// accent/case-insensitive alias matching, then coerce our value to whatever
// type that property actually is.
//
// Anything we can't map is silently skipped rather than failing the write — a
// missing "Método pagamento" column should not cost you the sale record.

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // strip accents, so "Metodo" matches "Método"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Find a property by any of the given aliases. Exact-normalized first, then prefix. */
export function findProp(
  db: NotionDatabase,
  aliases: string[],
): NotionPropertySchema | null {
  const entries = Object.values(db.properties);
  const wanted = aliases.map(normalize);

  for (const w of wanted) {
    const exact = entries.find((p) => normalize(p.name) === w);
    if (exact) return exact;
  }
  for (const w of wanted) {
    const partial = entries.find((p) => {
      const n = normalize(p.name);
      return n.startsWith(w) || w.startsWith(n);
    });
    if (partial) return partial;
  }
  return null;
}

/** The database's title property — every Notion database has exactly one. */
export function findTitleProp(db: NotionDatabase): NotionPropertySchema | null {
  return Object.values(db.properties).find((p) => p.type === "title") ?? null;
}

/** Match a value against a select/status option list, ignoring case and accents. */
function matchOption(options: { name: string }[], value: string): string | null {
  const target = normalize(value);
  const hit = options.find((o) => normalize(o.name) === target);
  return hit ? hit.name : null;
}

// Read-only property types: Notion rejects writes to these.
const READ_ONLY = new Set([
  "formula",
  "rollup",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "unique_id",
]);

/**
 * Coerce `value` into the API shape for `prop`'s actual type.
 * Returns null when the value can't be represented (caller then skips it).
 */
export function toPropertyValue(
  prop: NotionPropertySchema,
  value: string | number | boolean | Date | null,
): Record<string, unknown> | null {
  if (value === null || value === "") return null;
  if (READ_ONLY.has(prop.type)) return null;

  const asText = value instanceof Date ? value.toISOString() : String(value);

  switch (prop.type) {
    case "title":
      return { title: [{ text: { content: asText.slice(0, 2000) } }] };

    case "rich_text":
      return { rich_text: [{ text: { content: asText.slice(0, 2000) } }] };

    case "number": {
      const n = typeof value === "number" ? value : Number(asText.replace(",", "."));
      return Number.isFinite(n) ? { number: n } : null;
    }

    case "checkbox":
      return { checkbox: typeof value === "boolean" ? value : asText.toLowerCase() === "true" };

    case "select":
      // Notion auto-creates a select option that doesn't exist yet, so an
      // unknown product/size name is fine — reuse the existing option's exact
      // spelling when there is one, to avoid near-duplicate options.
      return { select: { name: matchOption(prop.select?.options ?? [], asText) ?? asText } };

    case "multi_select":
      return {
        multi_select: [
          { name: matchOption(prop.multi_select?.options ?? [], asText) ?? asText },
        ],
      };

    case "status": {
      // Status options CANNOT be created via the API — only an existing one works.
      const name = matchOption(prop.status?.options ?? [], asText);
      return name ? { status: { name } } : null;
    }

    case "date": {
      const iso = value instanceof Date ? value.toISOString() : new Date(asText).toISOString();
      return { date: { start: iso } };
    }

    case "url":
      return { url: asText };
    case "email":
      return { email: asText };
    case "phone_number":
      return { phone_number: asText };

    default:
      // people / relation / files need Notion ids we don't have.
      return null;
  }
}

/**
 * Build a properties payload from logical fields.
 * Each field names its aliases and its value; unmapped fields drop out.
 */
export function buildProperties(
  db: NotionDatabase,
  fields: Array<{
    aliases: string[];
    value: string | number | boolean | Date | null;
    /** Write to the database's title property instead of matching by name. */
    isTitle?: boolean;
  }>,
): { properties: Record<string, unknown>; skipped: string[] } {
  const properties: Record<string, unknown> = {};
  const skipped: string[] = [];

  for (const field of fields) {
    const prop = field.isTitle ? findTitleProp(db) : findProp(db, field.aliases);
    if (!prop) {
      if (field.value !== null && field.value !== "") skipped.push(field.aliases[0]);
      continue;
    }
    // A field explicitly aimed at the title must not overwrite a value already
    // written there (and vice versa) — first writer wins.
    if (properties[prop.name] !== undefined) continue;

    const payload = toPropertyValue(prop, field.value);
    if (!payload) {
      if (field.value !== null && field.value !== "") skipped.push(prop.name);
      continue;
    }
    properties[prop.name] = payload;
  }

  return { properties, skipped };
}
