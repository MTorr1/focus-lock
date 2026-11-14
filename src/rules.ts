import { patternToRegex, type Pattern } from "./pattern.ts";

export type DynamicRule = {
  id: number;
  priority: number;
  action: { type: "redirect"; redirect: { extensionPath: string } };
  condition: {
    regexFilter: string;
    resourceTypes: ["main_frame"];
    isUrlFilterCaseSensitive: false;
  };
};

export function buildDynamicRules(patterns: Pattern[]): DynamicRule[] {
  const used = new Set<number>();
  return patterns.map((pattern, index) => {
    const regexFilter = patternToRegex(pattern);
    let id = stableRuleId(`${regexFilter}:${index}`);
    while (used.has(id)) id = (id + 1) % 2_000_000_000 || 1;
    used.add(id);
    return {
      id,
      priority: 1,
      action: { type: "redirect", redirect: { extensionPath: "/blocked.html" } },
      condition: { regexFilter, resourceTypes: ["main_frame"], isUrlFilterCaseSensitive: false },
    };
  });
}

function stableRuleId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const id = (hash >>> 0) % 2_000_000_000;
  return id === 0 ? 1 : id;
}
