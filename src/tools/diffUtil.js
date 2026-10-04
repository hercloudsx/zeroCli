import { structuredPatch } from 'diff';

export function makeDiff(oldText, newText, context = 3) {
  const patch = structuredPatch('a', 'b', oldText, newText, '', '', { context });
  let additions = 0;
  let removals = 0;
  for (const h of patch.hunks) {
    for (const l of h.lines) {
      if (l.startsWith('+')) additions++;
      else if (l.startsWith('-')) removals++;
    }
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (additions) parts.push(plural(additions, 'addition'));
  if (removals) parts.push(plural(removals, 'removal'));
  return {
    hunks: patch.hunks.map((h) => ({
      oldStart: h.oldStart,
      newStart: h.newStart,
      lines: h.lines.filter((l) => !l.startsWith('\\')),
    })),
    additions,
    removals,
    summary: parts.join(' and ') || 'no changes',
  };
}
