/**
 * Traffic control at a junction.
 *
 * A crossing is where a road's capacity goes to die — two streams of traffic trying to
 * occupy one square of tarmac, taking it in turns. That is already the stated reason
 * roundabouts and grade separation exist (junctions.ts), and this is the cheap end of the
 * same idea: the devices you put on an ordinary crossroads when you cannot justify
 * rebuilding it.
 *
 * The model is deliberately one number. An UNCONTROLLED crossing loses throughput,
 * because nobody knows whose turn it is. Every device claws some of that back, and
 * signals more than claw it back on a busy road because they can platoon traffic through
 * in phases rather than one vehicle at a time. What that buys you is a ladder with a real
 * decision at every rung: a give-way sign is nearly free and helps a little, signals cost
 * money every month and help a lot, and a roundabout costs a great deal once and beats
 * all of them.
 *
 * Controls only do anything AT a crossing. A stop sign in the middle of a straight road
 * is not a traffic measure, it is street furniture, so the simulation ignores it there
 * rather than pretending otherwise.
 */

export interface TrafficControl {
  id: number;
  key: string;
  label: string;
  /** Multiplier on the capacity of the crossing it stands at. */
  throughput: number;
  cost: number;
  /** Per month. Signs do not need power; signals do. */
  upkeep: number;
  colour: string;
  note: string;
}

/**
 * What an uncontrolled crossing keeps of its road's capacity.
 *
 * Below 1 on purpose. This is the number that makes every device worth buying, and it is
 * why a grid of unsigned crossroads jams before its roads are anywhere near full.
 */
export const UNCONTROLLED = 0.62;

export const CONTROLS: readonly TrafficControl[] = [
  { id: 1, key: 'giveway', label: 'Give way', throughput: 0.82, cost: 90, upkeep: 1,
    colour: '#d8d2c4',
    note: 'Nearly free. Settles who goes first, which is most of the problem' },
  { id: 2, key: 'stop', label: 'Stop sign', throughput: 0.9, cost: 160, upkeep: 2,
    colour: '#c8564a',
    note: 'Everyone stops, so everyone gets through — slowly, but in order' },
  { id: 3, key: 'signals', label: 'Traffic signals', throughput: 1.25, cost: 1400, upkeep: 34,
    colour: '#5fb08a',
    note: 'Sends traffic through in phases. The only control that beats no crossing at all' },
];

export const CONTROL_BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));
export const CONTROL_BY_KEY = new Map(CONTROLS.map((c) => [c.key, c]));

/**
 * Throughput by control id, flat for the same reason the road tables are: the traffic
 * relaxation asks four times per road tile per pass. Index 0 is an uncontrolled crossing.
 */
const THROUGHPUT: number[] = (() => {
  const out = new Array<number>(Math.max(0, ...CONTROLS.map((c) => c.id)) + 1).fill(UNCONTROLLED);
  out[0] = UNCONTROLLED;
  for (const c of CONTROLS) out[c.id] = c.throughput;
  return out;
})();

/**
 * What this control does to a crossing's capacity.
 *
 * Only meaningful where `crossing` is true — away from a junction a sign changes nothing,
 * and pretending otherwise would let a player pave a straight road with stop signs to
 * make it faster.
 */
export function controlFactor(control: number, crossing: boolean): number {
  if (!crossing) return 1;
  return THROUGHPUT[control] ?? UNCONTROLLED;
}
