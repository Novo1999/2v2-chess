/**
 * Generates src/game/openings.data.json from the lichess ECO tables.
 *
 * Openings are keyed by POSITION, not by move sequence. The source data lists
 * each opening as a PGN line, but two different move orders reaching the same
 * position are the same opening — 1.e4 e6 2.d4 d5 and 1.d4 d5 2.e4 e6 are both
 * the French. Replaying each line and storing the position it arrives at makes
 * transpositions fall out for free, and turns naming an opening into a map
 * lookup per ply rather than a prefix search.
 *
 * The key is an EPD: the first four FEN fields, dropping the halfmove and
 * fullmove counters so a position is not distinguished from itself by how long
 * the game took to reach it. Both sides of this comparison run through
 * chess.js, so the en-passant field agrees by construction.
 *
 *     node scripts/build-openings.mjs
 */

import { writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const SOURCE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const VOLUMES = ['a', 'b', 'c', 'd', 'e'];

/** The first four FEN fields. See the note above on why the counters go. */
function epdOf(chess) {
  return chess.fen().split(' ').slice(0, 4).join(' ');
}

/** "1. e4 e6 2. d4 d5" -> ["e4","e6","d4","d5"] */
function sansOf(pgn) {
  return pgn
    .replace(/\d+\.(\.\.)?/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const openings = {};
let lines = 0;
let collisions = 0;
let failed = 0;

for (const volume of VOLUMES) {
  const response = await fetch(`${SOURCE}${volume}.tsv`);
  if (!response.ok) {
    throw new Error(`${volume}.tsv: HTTP ${response.status}`);
  }
  const rows = (await response.text()).split('\n').slice(1);

  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    if (!eco || !name || !pgn) continue;
    lines++;

    const chess = new Chess();
    try {
      for (const san of sansOf(pgn)) chess.move(san);
    } catch {
      // A line the parser and chess.js disagree about. Skipping one name is
      // better than emitting a position mapped to the wrong opening.
      failed++;
      continue;
    }

    const epd = epdOf(chess);
    // Volumes are processed in order and each file is sorted by depth, so the
    // first name to reach a position is the most general one for it. Later
    // duplicates are alternate spellings of the same line, not new openings.
    if (openings[epd]) {
      collisions++;
      continue;
    }
    openings[epd] = `${eco} ${name}`;
  }
}

writeFileSync(
  new URL('../src/game/openings.data.json', import.meta.url),
  JSON.stringify(openings) + '\n',
);

console.log(
  `wrote src/game/openings.data.json — ${Object.keys(openings).length} positions` +
    ` from ${lines} lines (${collisions} duplicate positions, ${failed} unparsed)`,
);
