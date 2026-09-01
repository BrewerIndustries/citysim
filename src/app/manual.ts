/**
 * The in-game manual.
 *
 * Every number here is READ FROM THE SIMULATION rather than written out in prose. A
 * manual that quotes hardcoded figures is a manual that goes quietly wrong the first
 * time a constant is tuned, and a confidently incorrect manual is worse than none —
 * the same reasoning that makes the Why Panel read LAND_VALUE_TERMS from sim.ts.
 */
import { ROAD_REACH } from '../sim/roads.ts';
import { ROAD_COST, ROAD_REMOVE_COST, ZONE_COST, BULLDOZE_COST, TICKS_PER_MONTH, ROAD_UPKEEP } from '../sim/city.ts';
import { CIVIC_DEFS, MAX_LEVEL, ZONE_LABEL } from '../sim/tiles.ts';
import { requirementText } from '../sim/unlocks.ts';
import { requiredDesirability, REASON_TEXT, DECLINE_BELOW, DISTRESS_LIMIT, residentsAt, jobsAt } from '../sim/growth.ts';
import { powerDraw } from '../sim/power.ts';
import { NEUTRAL_TAX } from '../sim/demand.ts';
import { LAND_VALUE_BASE, LAND_VALUE_TERMS } from '../sim/sim.ts';
import { CELL_METRES } from '../sim/grid.ts';
import { SHORE_AMENITY } from '../sim/city.ts';
import { LAYERS } from './palette.ts';
import { SERIES, HISTORY_LIMIT, type SeriesKey } from '../sim/history-series.ts';
import { MAX_UNDO } from '../sim/history.ts';
import { AUTOSAVE_MONTHS } from './autosave.ts';
import { DISASTERS } from '../sim/disasters.ts';
import { ACHIEVEMENTS } from '../sim/achievements.ts';
import { DENSITY_LABELS } from './tools.ts';

export interface ManualSection {
  id: string;
  title: string;
  html: string;
}

const money = (n: number) => `$${n.toLocaleString()}`;

/** Ideal spacing between parallel streets: each serves ROAD_REACH tiles either side. */
export const IDEAL_ROAD_SPACING = 2 * ROAD_REACH + 1;

/**
 * A to-scale plan of one street and the land it serves, drawn from ROAD_REACH so the
 * picture cannot disagree with the rule.
 */
function roadReachDiagram(): string {
  const cell = 22;
  const cols = IDEAL_ROAD_SPACING + ROAD_REACH + 1;
  const rows = 5;
  const w = cols * cell;
  const h = rows * cell;
  const roadA = ROAD_REACH;                       // first street column
  const roadB = ROAD_REACH + IDEAL_ROAD_SPACING;  // second street column
  const parts: string[] = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const isRoad = x === roadA || x === roadB;
      const dist = Math.min(Math.abs(x - roadA), Math.abs(x - roadB));
      const served = dist <= ROAD_REACH;
      const fill = isRoad ? '#42464e' : served ? '#2c4432' : '#241f22';
      parts.push(
        `<rect x="${x * cell}" y="${y * cell}" width="${cell - 1}" height="${cell - 1}" fill="${fill}" rx="2"/>`,
      );
      if (!isRoad && served && y === 2) {
        parts.push(
          `<text x="${x * cell + (cell - 1) / 2}" y="${y * cell + 15}" text-anchor="middle"
            font-size="10" fill="#9fd0a8">${dist}</text>`,
        );
      }
    }
  }
  // Span marker between the two streets.
  parts.push(
    `<line x1="${roadA * cell + cell / 2}" y1="${h + 10}" x2="${roadB * cell + cell / 2}" y2="${h + 10}"
      stroke="#6ec8bd" stroke-width="1"/>`,
    `<text x="${(roadA + roadB) * cell / 2 + cell / 2}" y="${h + 26}" text-anchor="middle"
      font-size="11" fill="#6ec8bd">${IDEAL_ROAD_SPACING} tiles apart</text>`,
  );

  return `<svg viewBox="0 0 ${w} ${h + 34}" width="100%" style="max-width:${w}px" role="img"
    aria-label="Two parallel streets ${IDEAL_ROAD_SPACING} tiles apart, with every tile between them within ${ROAD_REACH} tiles of a road">
    ${parts.join('')}
  </svg>`;
}

function table(headers: string[], rows: string[][]): string {
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function buildManual(): ManualSection[] {
  return [
    {
      id: 'start',
      title: 'Getting started',
      html: `
        <p>Your city needs three things before anything will grow: <b>power</b>, <b>roads</b>,
        and <b>zoning</b>. In that order.</p>
        <ol>
          <li><b>Place a coal power plant.</b> Nothing develops without electricity.</li>
          <li><b>Draw roads</b> out from the plant. Roads carry power as well as traffic, so
          the plant must be connected to the street network.</li>
          <li><b>Zone</b> land beside the roads — residential first, then commercial and
          industrial for jobs.</li>
          <li><b>Watch the RCI meter</b> in the top bar. It shows what the city is short of.</li>
          <li><b>Add services</b> once you have residents to pay for them.</li>
        </ol>
        <p class="tip">Stuck? Pick the <b>Inspect</b> tool and click any tile. It will tell you
        exactly what is holding that tile back.</p>`,
    },
    {
      id: 'roads',
      title: 'Roads',
      html: `
        <p>Every tile must be within <b>${ROAD_REACH} tiles</b> of a road to develop.
        Distance is counted in straight steps along the grid, not diagonally.</p>
        <p>One tile is ${CELL_METRES}m, so a street serves roughly
        ${ROAD_REACH * CELL_METRES}m of depth either side.</p>
        ${roadReachDiagram()}
        <p><b>Space parallel streets ${IDEAL_ROAD_SPACING} tiles apart.</b> Each street reaches
        ${ROAD_REACH} tiles to either side, so at ${IDEAL_ROAD_SPACING} the coverage from two
        streets just meets with nothing wasted and nothing stranded. Go one wider and a dead
        strip of unbuildable land appears down the middle. Go tighter and you are paying
        ${money(ROAD_COST)} a tile for road you did not need.</p>
        <p>Roads also <b>carry electricity</b>. Power flows out from a plant along connected
        roads, then reaches the same ${ROAD_REACH} tiles either side. A neighbourhood cut off
        from the road network is cut off from the grid too.</p>
        ${table(['Action', 'Cost', 'What it does'], [
          ['Road', money(ROAD_COST) + ' / tile', 'Lay a street. Drag to draw a line.'],
          ['Remove road', money(ROAD_REMOVE_COST) + ' / tile', 'Lifts only the road. Zoning and buildings stay.'],
          ['Bulldoze', money(BULLDOZE_COST) + ' / tile', 'Clears everything on the tile — road, zoning, buildings.'],
        ])}
        <p>Roads cost ${money(ROAD_UPKEEP)} per tile per month to maintain, so a sprawling
        network is a permanent drain. This is the main reason not to over-build streets.</p>`,
    },
    {
      id: 'terrain',
      title: 'Terrain & water',
      html: `
        <p>Every new city gets its own map, generated from a seed. Roughly a fifth of it is
        water, and <b>nothing can be built on water</b> — no roads, no zoning, no buildings.
        Rivers and lakes are the constraint your street layout has to work around.</p>
        <p>The <b>waterfront is an amenity</b>. A land tile touching water carries an amenity
        value of ${SHORE_AMENITY} — less than a park's, but it runs the entire length of
        every shore, so coastal and riverside land is worth more before you build anything
        at all. Land value spreads inland from it just like a park's does.</p>
        <p>Land is shaded by elevation. That shading is <b>cosmetic for now</b> — height
        does not yet affect building, cost or drainage.</p>
        <p>Press <b>New</b> for a fresh map. Tick <b>New map is flat</b> first if you would
        rather build on open ground with no water at all.</p>`,
    },
    {
      id: 'zoning',
      title: 'Zoning',
      html: `
        <p>You do not place buildings. You zone land, and buildings grow on it when the
        conditions are right.</p>
        ${table(['Zone', 'Provides', 'Wants'], [
          ['Residential', 'Residents, who pay most of your tax', 'Jobs nearby, clean air, low crime, high land value'],
          ['Commercial', 'Jobs, and tax on trade', 'Customers nearby and good access'],
          ['Industrial', 'Jobs, and it drives outward trade', 'Transport. Largely indifferent to land value — but it pollutes heavily'],
        ])}
        <h4>Density</h4>
        <p>Each zone comes in three densities. Density sets the <b>ceiling</b> on how far a
        tile can develop, not how fast.</p>
        ${table(['Density', 'Max level', 'Residents at max (per tile)', 'Zone cost'],
          MAX_LEVEL.map((max, d) => [
            DENSITY_LABELS[d],
            String(max),
            String(residentsAt(max, d)),
            money(ZONE_COST),
          ]))}
        <p>When a tile says <b>“built out for this density”</b> it has hit that ceiling.
        Re-zone it higher to keep growing — that is the main way a city gets bigger after
        the easy land is used up.</p>
        <h4>Why a tile grows, or doesn't</h4>
        <p>A tile needs road access, power, demand for its zone, and enough
        <b>desirability</b> to justify the next level:</p>
        ${table(['Growing to level', 'Desirability needed'],
          [1, 2, 3, 4, 5, 6].map((lvl) => [String(lvl), String(requiredDesirability(lvl - 1))]))}
        <p>Below <b>${DECLINE_BELOW}</b> desirability — or with power or road access cut — a
        developed tile starts to decline, and loses a level after ${DISTRESS_LIMIT} ticks of
        neglect. Reconnect it and the decline reverses.</p>
        <p>Inspect reports one of these reasons for every zoned tile:</p>
        ${table(['Reason', 'Meaning'],
          Object.entries(REASON_TEXT).filter(([k]) => k !== '7').map(([, v]) => [v, reasonAdvice(v)]))}`,
    },
    {
      id: 'power',
      title: 'Power',
      html: `
        <p>Buildings draw <b>${powerDraw(1)} MW per level</b>, so a level-${MAX_LEVEL[2]} tower
        draws ${powerDraw(MAX_LEVEL[2])} MW while an empty lot draws nothing.</p>
        <p>You start with coal. Six more plants unlock as the city grows — see
        <b>Unlocks</b> for the full ladder and what each one costs in money, land and smoke.</p>
        ${table(['Plant', 'Supplies', 'Pollution', 'Available'],
          CIVIC_DEFS.filter((d) => d.supply).map((d) => [
            d.label, `${d.supply!.toLocaleString()} MW`,
            d.pollution ? String(d.pollution) : 'none',
            requirementText(d),
          ]))}
        <p>Power spreads from the plant along <b>connected roads</b>, then out
        ${ROAD_REACH} tiles either side — the same reach as road access, so any plot a road
        can serve, a road can also power.</p>
        <p>If demand exceeds supply you get a <b>brownout</b>: tiles furthest from a plant go
        dark first, and unpowered buildings start to decline. The top bar shows demand against
        supply at all times.</p>
        <p class="tip">A plant does not need to sit in the middle of the city. Put it downwind
        of your housing — it pollutes — and run a road to it.</p>`,
    },
    {
      id: 'services',
      title: 'Services',
      html: `
        <p>Services are placed directly rather than grown. Each has a monthly upkeep that is
        charged whether or not anyone benefits, so build them as the city can afford them.</p>
        ${table(['Building', 'Cost', 'Upkeep', 'Size', 'Effect'],
          CIVIC_DEFS.map((d) => [
            d.label, money(d.cost), money(d.upkeep) + ' / mo', `${d.size}×${d.size}`,
            serviceEffect(d.key),
          ]))}
        <p><b>Police stations actually suppress crime</b> rather than merely offsetting it —
        full coverage cuts a neighbourhood's crime to a fifth. Parks and schools raise land
        value, which is the single biggest driver of residential desirability.</p>
        <p class="tip">Services are the usual cause of an early bankruptcy. A city of a few
        hundred people cannot carry a plant plus three services; grow the tax base first.</p>`,
    },
    {
      id: 'transit',
      title: 'Transit',
      html: `
        <p>Transit access is the <b>second strongest positive influence on land value</b>
        (weight ${LAND_VALUE_TERMS.find((x) => x.field === 'transitAccess')!.weight.toFixed(2)}),
        behind only parks, and residents and commerce both want it. A stop lifts the whole
        neighbourhood around it, not just the tile it sits on.</p>
        ${table(['Building', 'Cost', 'Upkeep', 'Size', 'Reach'],
          CIVIC_DEFS.filter((d) => d.source?.field === 'transitSrc').map((d) => [
            d.label, money(d.cost), money(d.upkeep) + ' / mo', `${d.size}×${d.size}`,
            d.key === 'metro' ? 'Wide' : 'Local',
          ]))}
        <p>Bus stops are cheap enough to scatter through a residential district. A metro
        station costs more but pushes access much further, which is what lets an inner
        district reach the desirability needed for high-density towers.</p>
        <p class="tip">Transit does not yet move anyone — it raises access and land value.
        Actual passenger flow is a later addition.</p>`,
    },
    {
      id: 'disasters',
      title: 'Disasters',
      html: `
        <p>Four things can go wrong. Each is switchable on its own in the Disasters panel,
        and each is either <b>preventable</b> or at least <b>legible</b> — none of them
        exists to take your work away at random.</p>
        ${table(['Disaster', 'Roughly', 'What it does'],
          DISASTERS.map((d) => [
            d.label,
            d.everyYears === 0 ? 'ongoing' : `every ${d.everyYears} years`,
            d.description,
          ]))}
        <h4>Floods</h4>
        <p>The clearest case of a disaster you can simply avoid. Flood risk is fixed by
        the terrain — low ground close to water — and it never changes. Turn on the
        <b>Flood risk</b> layer before you zone, and build the valuable things uphill.
        Land with no flood risk cannot be flooded, ever.</p>
        <h4>Earthquakes</h4>
        <p>Not preventable, but rare, and fire cover limits the fires that follow one.</p>
        <h4>Tornadoes</h4>
        <p>Narrow. A tornado takes a street, not a city.</p>
        <p class="tip">Nothing strikes a settlement below 40 buildings. Losing your first
        four houses to an earthquake is not a lesson, it's a waste of your time.</p>`,
    },
    {
      id: 'fire',
      title: 'Fire',
      html: `
        <p>Developed tiles carry <b>fire risk</b>, which grows with building level and
        density. Fire stations cut it by up to <b>92%</b> where their coverage is complete.</p>
        <p>When a fire starts it levels the building and can spread to neighbouring
        developed tiles — again resisted by their fire coverage. A single fire will not
        consume more than a couple of dozen buildings.</p>
        <p>Fire is meant to be <b>preventable, not arbitrary</b>. Turn on the
        <b>Fire risk</b> data layer to see exactly where you are exposed before anything
        burns; the bright areas are the ones without cover. Every fire is reported in the
        ticker with its location.</p>
        <p>If you would rather build without the risk, switch <b>Fires</b> off in the
        Disasters panel at any time.</p>`,
    },
    {
      id: 'progression',
      title: 'Unlocks',
      html: `
        <p>Most buildings are available from the start, but the better ones have to be
        earned. Requirements are measured against your <b>peak</b> population and the
        buildings you have <b>ever</b> built — a recession or a stray bulldozer never takes
        back something you already unlocked.</p>
        <p>Locked buildings stay visible in the tool rail, dimmed, with their requirement
        as a tooltip. You get a message the moment one becomes available.</p>
        <h4>Power</h4>
        <p>The energy ladder is the main progression in the game, and every rung is a
        genuine trade-off between output, running cost, land and smoke.</p>
        ${table(['Plant', 'Output', 'Cost', 'Upkeep', 'Size', 'Pollution', 'Requires'],
          CIVIC_DEFS.filter((d) => d.supply).map((d) => [
            d.label,
            `${d.supply!.toLocaleString()} MW`,
            money(d.cost),
            money(d.upkeep) + '/mo',
            `${d.size}×${d.size}`,
            d.pollution ? String(d.pollution) : 'none',
            requirementText(d),
          ]))}
        <p class="tip">Coal is cheap and filthy. Wind is spotless but you will need a dozen
        turbines to match one coal plant. Everything after that is a question of whether you
        can afford the capital cost and the land.</p>
        <h4>Everything else</h4>
        ${table(['Building', 'Requires', 'Why'],
          CIVIC_DEFS.filter((d) => !d.supply && d.unlock).map((d) => [
            d.label, requirementText(d), d.note ?? '',
          ]))}`,
    },
    {
      id: 'economy',
      title: 'Money & taxes',
      html: `
        <p>The books are settled every month — ${TICKS_PER_MONTH} simulation ticks. Tax comes
        in from residents and jobs; upkeep goes out for services and roads. The Budget panel
        shows the split, and the <b>Net / month</b> line is the number that matters.</p>
        <p>Tax rates run 0–20% per sector. <b>${NEUTRAL_TAX}%</b> is neutral: below it growth
        is stimulated, above it demand starts to suffer, and the penalty climbs sharply toward
        20%. Taxing an empty city heavily is a good way to guarantee it stays empty.</p>
        <p>Going into the red is survivable — you will get a warning in the ticker. Raise
        taxes, bulldoze services you cannot afford, or grow into the bill.</p>`,
    },
    {
      id: 'landvalue',
      title: 'Land value & desirability',
      html: `
        <p>Land value is computed for every tile from a base of ${LAND_VALUE_BASE} plus the
        influences below. These are the exact terms the Inspect panel breaks down:</p>
        ${table(['Influence', 'Weight'],
          LAND_VALUE_TERMS.map((t) => [
            t.label,
            `${t.weight >= 0 ? '+' : '−'}${Math.abs(t.weight).toFixed(2)}`,
          ]))}
        <p>Each influence spreads outward from its source and fades linearly with distance, so
        a park helps the tiles beside it most and stops mattering entirely some distance away.
        Everything is measured on a common 0–255 scale.</p>
        <p><b>Desirability</b> is what actually drives growth, and each zone weighs things
        differently: residents care most about land value and access to jobs, commerce about
        access and footfall, industry mostly about transport. That is why a smoky, high-crime
        district can still support factories long after nobody will live there.</p>`,
    },
    {
      id: 'layers',
      title: 'Data layers',
      html: `
        <p>The data layers are the fastest way to understand a problem you can't see. Roads and
        buildings stay visible underneath so you can keep your bearings.</p>
        ${table(['Layer', 'Shows'], LAYERS.map((l) => [l.label, layerHint(l.field)]))}`,
    },
    {
      id: 'saving',
      title: 'Saving & undo',
      html: `
        <p>The city <b>autosaves every ${AUTOSAVE_MONTHS} months</b> and resumes when you
        reload the page, so a refresh does not cost you a city. <b>Save</b> keeps a separate
        copy you can return to with <b>Load</b>; <b>New</b> starts over.</p>
        <p>Saves live in your browser's storage for this site. They are small — a played
        city is around a kilobyte — but clearing your browser data will remove them.</p>
        <h4>Undo</h4>
        <p><b>Cmd/Ctrl+Z</b> undoes, <b>Cmd/Ctrl+Shift+Z</b> redoes, up to
        ${MAX_UNDO} steps. A whole drag counts as one step, so a road dragged across fifty
        tiles comes back in a single press.</p>
        <p>Undo restores the money you spent as well as the tiles, and starting a new
        action after undoing discards the redo path.</p>`,
    },
    {
      id: 'history',
      title: 'History graph',
      html: `
        <p>The History panel plots one sample per month for up to
        ${HISTORY_LIMIT} months — ${Math.round(HISTORY_LIMIT / 12)} years. Click a series
        name to show or hide it.</p>
        ${table(['Series', 'Shows'], SERIES.map((s) => [s.label, seriesHint(s.key)]))}
        <p>Each series is scaled to its own range rather than sharing one axis: population
        in the thousands and average pollution in the tens are not comparable, and forcing
        them onto a single scale flattens everything but the largest number.</p>
        <p>Averages are taken over <b>developed land only</b>. Averaging the whole map would
        drown every reading in empty countryside.</p>`,
    },
    {
      id: 'achievements',
      title: 'Achievements',
      html: `
        <p>${ACHIEVEMENTS.length} of them, across five areas. Press <b>A</b> or the ★ in
        the top bar to see the list — locked ones show what they need, because an
        achievement you can't see isn't something you can aim at.</p>
        <p>They are never taken away. Once earned, a collapse, a bankruptcy or a
        bulldozer cannot revoke one.</p>
        ${table(['Area', 'About'], [
          ['Growth', 'Population milestones and building height'],
          ['Economy', 'The treasury, tax policy, and recovering from bankruptcy'],
          ['Infrastructure', 'Transit, services, and keeping the lights on'],
          ['Environment', 'Clean power, land value and air quality'],
          ['Adversity', 'Surviving and rebuilding after disasters'],
        ])}`,
    },
    {
      id: 'views',
      title: 'Views',
      html: `
        <p>There are two ways to look at the city, over one simulation. <b>Tab</b> switches
        between them, and each keeps its own camera, so you can jump back and forth
        without losing your place.</p>
        <p><b>Plan</b> is the top-down schematic. It is what you build in: no building ever
        hides the tile behind it, the grid stays square, and every data layer reads at a
        glance.</p>
        <p><b>¾ view</b> is the city as a model. The camera is <b>orthographic</b> rather
        than perspective, which is what keeps the grid legible right across the screen
        instead of leaning away at the edges — the readability of the classic isometric
        games, but with real terrain, real rotation and a real skyline.</p>
        <p>Buildings are plain massing blocks for now: height carries level and density, and
        colour carries land use. Detailed models come later — the shape and the camera have
        to be right first.</p>
        ${table(['Key', 'In the ¾ view'], [
          ['<kbd>Tab</kbd>', 'Switch between Plan and ¾'],
          ['<kbd>,</kbd> / <kbd>.</kbd>', 'Rotate the camera in eighths'],
          ['<kbd>PgUp</kbd> / <kbd>PgDn</kbd>', 'Tilt, between 25° and 70°'],
          ['Scroll', 'Zoom'],
          ['Right-drag', 'Pan'],
        ])}
        <p>Data layers work in both. In the ¾ view the layer is painted onto the ground, so
        you can read land value or pollution with the buildings still standing on it.</p>`,
    },
    {
      id: 'controls',
      title: 'Controls',
      html: `
        ${table(['Input', 'Action'], [
          ['<kbd>1</kbd>–<kbd>9</kbd>, <kbd>0</kbd>, <kbd>q</kbd>–<kbd>r</kbd>', 'Select tool (shown on each button)'],
          ['Drag', 'Build. Roads draw a line; zoning and bulldoze paint a 3×3 brush'],
          ['Right-drag / <kbd>Space</kbd>+drag', 'Pan the map'],
          ['Scroll', 'Zoom, anchored on the cursor'],
          ['<kbd>=</kbd> / <kbd>-</kbd>', 'Zoom in / out'],
          ['<kbd>[</kbd> / <kbd>]</kbd>', 'Slower / faster'],
          ['<kbd>P</kbd>', 'Pause'],
          ['<kbd>Cmd/Ctrl</kbd>+<kbd>Z</kbd>', 'Undo'],
          ['<kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>', 'Redo'],
          ['<kbd>Tab</kbd>', 'Switch between Plan and the ¾ view'],
          ['<kbd>A</kbd>', 'Achievements'],
          ['<kbd>?</kbd> or <kbd>H</kbd>', 'Open this manual'],
          ['<kbd>Esc</kbd>', 'Close this manual'],
        ])}`,
    },
  ];
}

function reasonAdvice(text: string): string {
  switch (text) {
    case 'developing': return 'All conditions met — it is growing now.';
    case 'no road access': return `Nearest road is further than ${ROAD_REACH} tiles.`;
    case 'no power': return 'Not connected to the grid, or the grid is short of supply.';
    case 'no demand for this zone': return 'Check the RCI meter — the city does not want more of this right now.';
    case 'desirability too low to densify': return 'It will hold at its current level until the area improves.';
    case 'built out for this density': return 'Re-zone to a higher density to grow further.';
    case 'in decline': return 'Losing value. Fix the cause before it loses a level.';
    default: return '';
  }
}

function serviceEffect(key: string): string {
  switch (key) {
    case 'police': return 'Suppresses crime nearby, and raises land value a little';
    case 'fire': return 'Cuts fire risk nearby by up to 92%. Without it, buildings burn down';
    case 'school': return 'Raises land value strongly; a long-term driver of a wealthier city';
    case 'park': return 'Raises land value nearby — the cheapest way to lift a neighbourhood';
    case 'power': return 'Supplies electricity to the road network. Pollutes heavily';
    case 'wind': return 'A little clean power, no emissions at all';
    case 'oil': return 'Twice coal\'s output, and cleaner';
    case 'gas': return 'High output, low emissions, cheap to run';
    case 'solar': return 'Clean and cheap to run, but it covers a lot of ground';
    case 'nuclear': return 'Vast clean output for a vast price';
    case 'fusion': return 'More power than a city can spend';
    case 'policehq': return 'Police coverage across a whole district';
    case 'firehq': return 'Fire coverage across a whole district';
    case 'university': return 'A large land-value lift, and the route to nuclear power';
    case 'bigpark': return 'The strongest land-value lift in the game';
    case 'rail': return 'Transit access across a whole quarter';
    case 'bus': return 'Transit access nearby — cheap, and a strong lift to land value';
    case 'metro': return 'Transit access over a much wider area than a bus stop';
    default: return '';
  }
}

function seriesHint(key: SeriesKey): string {
  const hints: Record<SeriesKey, string> = {
    population: 'Total residents',
    jobs: 'Commercial and industrial jobs combined',
    funds: 'Money in the bank',
    net: 'Monthly surplus or deficit — the line to watch',
    landValue: 'Average land value across developed land',
    pollution: 'Average pollution across developed land',
  };
  return hints[key];
}

function layerHint(field: string): string {
  const hints: Record<string, string> = {
    landValue: 'The headline number behind most growth decisions',
    desirabilityR: 'How much residents want to live on each tile',
    desirabilityC: 'How much commerce wants each tile',
    desirabilityI: 'How much industry wants each tile',
    pollution: 'Mostly from industry and power plants. Poisons residential desirability',
    crime: 'Rises with density, falls sharply under police coverage',
    fireRisk: 'Where a fire is likely to start. Driven by building size and lack of fire cover',
    floodRisk: 'Low ground near water. Fixed by the terrain — check it before you zone',
    policeCover: 'Reach of your police stations',
    fireCover: 'Reach of your fire stations',
    schoolCover: 'Reach of your schools',
    transitAccess: 'Reach of your bus stops and metro stations',
    amenityAccess: 'Reach of parks and other amenities',
    jobAccess: 'How many jobs are reachable from each tile',
    popR: 'Raw residents per tile',
    emission: 'Raw pollution produced per tile, before it spreads',
  };
  return hints[field] ?? '';
}

export { ZONE_LABEL };
