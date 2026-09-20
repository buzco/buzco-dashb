// The filter/sort engine behind the Other sales table.
//
// Pure and free of React on purpose, for the same reason lib/sales/pricing.ts
// is: this is where an off-by-one in a comparison quietly hides rows someone
// is looking for, and a wrong answer here looks exactly like a right one.
//
// Modelled on the way Notion's own views work — a stack of AND-ed rules, each
// one a property + condition + value, and a stack of sorts applied in order so
// the second only breaks ties in the first.

export type FilterOperator =
  | "contains"
  | "not_contains"
  | "is"
  | "is_not"
  | "is_empty"
  | "is_not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "before"
  | "after"
  | "on_or_before"
  | "on_or_after";

export type ValueType = "text" | "select" | "number" | "date";

export type FilterRule = {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
};

export type SortRule = {
  column: string;
  descending: boolean;
};

/** The operators that make sense per property type, in menu order. */
export const OPERATORS: Record<ValueType, FilterOperator[]> = {
  text: ["contains", "not_contains", "is", "is_not", "is_empty", "is_not_empty"],
  select: ["is", "is_not", "is_empty", "is_not_empty"],
  number: ["is", "is_not", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  date: ["is", "is_not", "before", "on_or_before", "after", "on_or_after", "is_empty", "is_not_empty"],
};

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "contains",
  not_contains: "does not contain",
  is: "is",
  is_not: "is not",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  before: "before",
  after: "after",
  on_or_before: "on or before",
  on_or_after: "on or after",
};

/** Operators that need no value — the value box is hidden for these. */
export function takesNoValue(operator: FilterOperator): boolean {
  return operator === "is_empty" || operator === "is_not_empty";
}

/**
 * Empty means ABSENT, not falsy.
 *
 * A fee of €0.00 is a real, recorded zero and must not answer to "is empty" —
 * which is what would happen if this were a plain truthiness check, and would
 * quietly hide every row that was never charged a fee.
 */
function isEmpty(value: string | number | null): boolean {
  return value === null || value === undefined || value === "";
}

function normalize(value: string | number | null): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** Whether one row's value satisfies one rule. */
export function matches(
  value: string | number | null,
  rule: FilterRule,
  type: ValueType,
): boolean {
  if (rule.operator === "is_empty") return isEmpty(value);
  if (rule.operator === "is_not_empty") return !isEmpty(value);

  // A rule with nothing typed into it yet shouldn't hide anything — otherwise
  // adding a filter blanks the table before you've said what you want.
  if (rule.value === "") return true;
  if (isEmpty(value)) return false;

  if (type === "number") {
    const a = Number(value);
    const b = Number(rule.value.replace(",", "."));
    if (!Number.isFinite(b)) return true;
    switch (rule.operator) {
      case "is":
        return a === b;
      case "is_not":
        return a !== b;
      case "gt":
        return a > b;
      case "gte":
        return a >= b;
      case "lt":
        return a < b;
      case "lte":
        return a <= b;
      default:
        return true;
    }
  }

  if (type === "date") {
    // Both sides are YYYY-MM-DD, which compares correctly as a string.
    const a = String(value).slice(0, 10);
    const b = rule.value.slice(0, 10);
    switch (rule.operator) {
      case "is":
        return a === b;
      case "is_not":
        return a !== b;
      case "before":
        return a < b;
      case "on_or_before":
        return a <= b;
      case "after":
        return a > b;
      case "on_or_after":
        return a >= b;
      default:
        return true;
    }
  }

  const a = normalize(value);
  const b = normalize(rule.value);
  switch (rule.operator) {
    case "contains":
      return a.includes(b);
    case "not_contains":
      return !a.includes(b);
    case "is":
      return a === b;
    case "is_not":
      return a !== b;
    default:
      return true;
  }
}

export type ColumnLike<Row> = {
  key: string;
  type: ValueType;
  value: (row: Row) => string | number | null;
};

/** Apply every rule (AND), then every sort in order. */
export function applyView<Row>(
  rows: Row[],
  columns: ColumnLike<Row>[],
  {
    query = "",
    search,
    filters = [],
    sorts = [],
  }: {
    query?: string;
    /** Free-text haystack for the search box, built by the caller. */
    search?: (row: Row) => string;
    filters?: FilterRule[];
    sorts?: SortRule[];
  },
): Row[] {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const q = normalize(query);

  const filtered = rows.filter((row) => {
    if (q && search && !normalize(search(row)).includes(q)) return false;
    return filters.every((rule) => {
      const column = byKey.get(rule.column);
      if (!column) return true;
      return matches(column.value(row), rule, column.type);
    });
  });

  if (!sorts.length) return filtered;

  return [...filtered].sort((rowA, rowB) => {
    for (const sort of sorts) {
      const column = byKey.get(sort.column);
      if (!column) continue;
      const a = column.value(rowA);
      const b = column.value(rowB);

      // Absent values sink to the bottom whichever way the sort runs, so
      // flipping direction never fills the top of the table with blanks.
      if (isEmpty(a) && isEmpty(b)) continue;
      if (isEmpty(a)) return 1;
      if (isEmpty(b)) return -1;

      const direction = sort.descending ? -1 : 1;
      let comparison: number;
      if (column.type === "number") {
        comparison = Number(a) - Number(b);
      } else {
        comparison = String(a).localeCompare(String(b), undefined, { numeric: true });
      }
      if (comparison !== 0) return comparison * direction;
    }
    return 0;
  });
}
