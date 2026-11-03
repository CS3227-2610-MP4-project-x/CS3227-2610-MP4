// Model output parsing (LLM Gateway Decisions G9): trim, remove one surrounding Markdown
// code fence if present, then parse JSON. Internal to the AI module.

export type OutputValidation<T> = { ok: true; value: T } | { ok: false };

export type OutputValidator<T> = (value: unknown) => OutputValidation<T>;

const SURROUNDING_FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;

type Parsed = { ok: true; value: unknown } | { ok: false };

function parseJson(text: string): Parsed {
  const trimmed = text.trim();
  const fenced = SURROUNDING_FENCE.exec(trimmed);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false };
  }
}

// Parses and validates one response; output that does not parse is schema-invalid.
export function validateOutput<T>(text: string, validate: OutputValidator<T>): OutputValidation<T> {
  const parsed = parseJson(text);
  return parsed.ok ? validate(parsed.value) : { ok: false };
}
