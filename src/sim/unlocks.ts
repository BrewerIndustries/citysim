/**
 * Building unlocks.
 *
 * Progression is measured against PEAK population, not current: a recession shouldn't
 * confiscate something the city already earned. Prerequisites are measured against
 * buildings ever built, for the same reason — bulldozing your only school should not
 * un-invent the university.
 */
import { CIVIC_DEFS, CIVIC_BY_KEY, type CivicDef } from './tiles.ts';
import { WORKS_IDS, siblingOf } from './works.ts';

export interface UnlockState {
  peakPopulation: number;
  everBuilt: Set<number>;
}

/** World works standing or ever built. A demolished work still counts as spent. */
export function worksBuilt(state: UnlockState): number {
  let n = 0;
  for (const id of state.everBuilt) if (WORKS_IDS.has(id)) n++;
  return n;
}

/** Null when available; otherwise a plain-language statement of what's missing. */
export function lockReason(def: CivicDef, state: UnlockState): string | null {
  // A world work is spent the moment it is built, and so is the branch it sits on.
  // Both are checked against everBuilt rather than what is standing, so demolishing one
  // never gives the decision back — a choice you can walk back is not a choice.
  if (def.works) {
    if (state.everBuilt.has(def.id)) return `Already built — there is only one ${def.label}`;
    const sibling = siblingOf(def);
    if (sibling && state.everBuilt.has(sibling.id)) {
      return `You built the ${sibling.label} instead`;
    }
  }

  const rule = def.unlock;
  if (!rule) return null;

  const missing: string[] = [];
  if (rule.worksBuilt !== undefined && worksBuilt(state) < rule.worksBuilt) {
    const short = rule.worksBuilt - worksBuilt(state);
    missing.push(`${short} more world work${short === 1 ? '' : 's'}`);
  }
  if (rule.population !== undefined && state.peakPopulation < rule.population) {
    missing.push(`${rule.population.toLocaleString()} residents`);
  }
  for (const key of rule.requires ?? []) {
    const dep = CIVIC_BY_KEY.get(key);
    if (dep && !state.everBuilt.has(dep.id)) missing.push(article(dep.label));
  }
  if (missing.length === 0) return null;
  return `Needs ${listPhrase(missing)}`;
}

export function isUnlocked(def: CivicDef, state: UnlockState): boolean {
  return lockReason(def, state) === null;
}

export function unlockedIds(state: UnlockState): Set<number> {
  const out = new Set<number>();
  for (const d of CIVIC_DEFS) if (isUnlocked(d, state)) out.add(d.id);
  return out;
}

/**
 * "an oil power plant", but "a university".
 *
 * The article follows the SOUND, not the spelling: "university" opens with a /juː/,
 * which is a consonant sound, so a naive vowel-letter test produces "an university".
 * The exceptions below cover the /juː/ openings that appear in building names.
 */
const SOUNDS_LIKE_CONSONANT = /^(uni|use|usu|uti|ubi|eu|one)/;

function article(label: string): string {
  const lower = label.toLowerCase();
  const vowelSound = /^[aeiou]/.test(lower) && !SOUNDS_LIKE_CONSONANT.test(lower);
  // Lowercased for the vowel test only. Printing the lowercased label gave "a police hq"
  // and "the green belt" — the label knows its own casing better than this function does.
  const name = /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
  return `${vowelSound ? 'an' : 'a'} ${name}`;
}

/** "a school", "8,000 residents and a school", "x, y and z" */
function listPhrase(items: string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Requirement text for the manual, whether or not it's currently met. */
export function requirementText(def: CivicDef): string {
  const rule = def.unlock;
  if (!rule) return 'Available from the start';
  const parts: string[] = [];
  if (rule.population !== undefined) parts.push(`${rule.population.toLocaleString()} residents`);
  if (rule.worksBuilt !== undefined) parts.push(`${rule.worksBuilt} other world works`);
  for (const key of rule.requires ?? []) {
    const dep = CIVIC_BY_KEY.get(key);
    if (dep) parts.push(article(dep.label));
  }
  return listPhrase(parts);
}
