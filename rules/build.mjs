/**
 * Generates database.rules.json.
 *
 * RTDB rules have no functions, so every predicate would otherwise be copied by
 * hand into a dozen string literals. This file is the source of truth; the JSON
 * is generated, committed, and deployed.
 *
 *     node rules/build.mjs
 */

import { writeFileSync } from 'node:fs';

/** How long an absent player keeps their seat before a teammate may play it. */
export const GRACE_MS = 25000;
/** Latency and clock-skew allowance on a client-computed clock decrement. */
export const CLOCK_SLOP_MS = 3000;

// ---------------------------------------------------------------------------
// Path expressions. `root` is always the PRE-write tree; `newData` is post.
// ---------------------------------------------------------------------------

const G = "root.child('games').child($gid)";
const field = (name) => `${G}.child('${name}').val()`;

const toMove = field('toMove');
const status = field('status');
const seats = field('seats');
const lastMoveAt = field('lastMoveAt');

/** The seat that follows `slot` in the rotation. */
const next = (slot) => `${G}.child('rotation').child(${slot}).val()`;

/**
 * The other seat on the same army. In a four-seat cycle P1->P3->P2->P4 that is
 * two hops; in a two-seat cycle P1->P3->P1 two hops land back on the seat
 * itself, which is exactly right — there is no teammate to take over.
 */
const teammate = (slot) => next(next(slot));

const uidOf = (slot) => `${G}.child('players').child(${slot}).child('uid').val()`;
const holds = (slot) => `${uidOf(slot)} === auth.uid`;
const absent = (slot) =>
  `(${G}.child('players').child(${slot}).child('connected').val() === false` +
  ` && now - ${G}.child('players').child(${slot}).child('lastSeen').val() > ${GRACE_MS})`;

const q = (slot) => `'${slot}'`;
const seated = `(${['P1', 'P2', 'P3', 'P4'].map((s) => holds(q(s))).join(' || ')})`;

/** Decision #1 + #10: the seat on move, or its teammate once the grace lapses. */
const mayMove = `(${holds(toMove)} || (${absent(toMove)} && ${holds(teammate(toMove))}))`;

const whiteToMove = `(${toMove} === 'P1' || ${toMove} === 'P2')`;
const isActive = `${status} === 'active'`;

/**
 * Decision #5's core assertion, read from a sibling of turnIndex. Every field a
 * move touches rides on this, so authorisation is asserted in exactly one place
 * — the .write on turnIndex itself.
 */
const advanced = (depth) => {
  const up = '.parent()'.repeat(depth);
  return `newData${up}.child('turnIndex').val() === data${up}.child('turnIndex').val() + 1`;
};

const elapsed = `(now - ${lastMoveAt})`;

const allSeatsFilled =
  `${G}.child('players').child('P1').child('uid').exists()` +
  ` && ${G}.child('players').child('P3').child('uid').exists()` +
  ` && (${seats} === 2 || (${G}.child('players').child('P2').child('uid').exists()` +
  ` && ${G}.child('players').child('P4').child('uid').exists()))`;

/** The side to move has burned more wall-clock than it had left. */
const flagged = `${elapsed} >= ${G}.child('clocks').child(${whiteToMove} ? 'w' : 'b').val()`;

// --- consent (decision #3) -------------------------------------------------

const offer = (name) => `${G}.child('offer').child('${name}').val()`;
const accepted = (slot) =>
  `${G}.child('offer').child('accept').child('${slot}').val() === true`;
const soloArmy = `${seats} === 2`;
const armyAccepted = (color) =>
  color === 'w'
    ? `(${accepted('P1')} && (${soloArmy} || ${accepted('P2')}))`
    : `(${accepted('P3')} && (${soloArmy} || ${accepted('P4')}))`;

/** Resignation needs the whole resigning army; a draw needs everyone. */
const resignAgreed =
  `(${offer('kind')} === 'resign' && ((${offer('army')} === 'w' && ${armyAccepted('w')})` +
  ` || (${offer('army')} === 'b' && ${armyAccepted('b')})))`;
const drawAgreed =
  `(${offer('kind')} === 'draw' && ${armyAccepted('w')} && ${armyAccepted('b')})`;

// --- seat claims (decisions #8, #9) ----------------------------------------

const secretVal = `root.child('secrets').child($gid).child($slot).val()`;
const provenSecret =
  `(root.child('secrets').child($gid).child($slot).exists()` +
  ` && root.child('proof').child($gid).child(auth.uid).child($slot).val() === ${secretVal})`;

const claimable =
  `(!${G}.child('players').child($slot).child('uid').exists()` +
  ` && !root.child('secrets').child($gid).child($slot).exists())`;

const SLOT_ENUM =
  "newData.val() === 'P1' || newData.val() === 'P2'" +
  " || newData.val() === 'P3' || newData.val() === 'P4'";
const RESULT_ENUM =
  "newData.val() === '1-0' || newData.val() === '0-1' || newData.val() === '1/2-1/2'";

// ---------------------------------------------------------------------------

const clockValidate = (color) => {
  const moving = color === 'w' ? whiteToMove : `!${whiteToMove}`;
  return (
    `newData.isNumber() && newData.val() >= 0 && (!data.exists() || ` +
    `(${moving}` +
    ` ? (newData.val() <= data.val() - ${elapsed} + ${CLOCK_SLOP_MS}` +
    ` && newData.val() >= data.val() - ${elapsed} - ${CLOCK_SLOP_MS})` +
    ` : newData.val() === data.val()))`
  );
};

const statusWrite =
  `auth != null && ${seated} && (` +
  // lobby -> active, once every seat this game needs is taken
  `(${status} === 'lobby' && newData.val() === 'active' && ${allSeatsFilled})` +
  // an outcome asserted alongside a legal turn advance (the accepted risk:
  // rules cannot run chess.js, so 'checkmate' is taken on trust)
  ` || (${isActive} && ${advanced(1)} && (newData.val() === 'active'` +
  ` || newData.val() === 'checkmate' || newData.val() === 'stalemate'` +
  ` || newData.val() === 'draw'))` +
  // a flag call, which rules CAN verify against `now`
  ` || (${isActive} && newData.val() === 'timeout' && ${flagged})` +
  // consent
  ` || (${isActive} && newData.val() === 'resigned' && ${resignAgreed})` +
  ` || (${isActive} && newData.val() === 'draw' && ${drawAgreed}))`;

const rules = {
  rules: {
    '.read': false,
    '.write': false,

    games: {
      $gid: {
        // The room code is the capability: anyone signed in who knows it watches.
        '.read': 'auth != null',
        // Creation only. Never grants again, and never permits deletion.
        '.write': 'auth != null && !data.exists() && newData.exists()',
        '.validate':
          "newData.hasChildren(['fen','turnIndex','toMove','rotation','status','seats','clocks'])",

        turnIndex: {
          // The single authorisation site for a move.
          '.write': `auth != null && ${isActive} && ${mayMove} && newData.val() === data.val() + 1`,
          '.validate': 'newData.isNumber() && newData.val() >= 0',
        },

        toMove: {
          '.write': `auth != null && ${advanced(1)}`,
          '.validate':
            `(${SLOT_ENUM})` +
            // On creation there is no previous seat to take a successor from.
            ` && (!data.exists()` +
            ` || newData.val() === ${G}.child('rotation').child(data.val()).val())`,
        },

        fen: {
          '.write': `auth != null && ${advanced(1)}`,
          '.validate':
            'newData.isString() && newData.val().length > 10 && newData.val().length < 120',
        },

        lastMoveAt: {
          // Advances on a move, and is set once when the game leaves the lobby
          // so the first clock tick has something to measure from.
          '.write':
            `auth != null && (${advanced(1)}` +
            ` || (${status} === 'lobby' && newData.parent().child('status').val() === 'active'))`,
          '.validate': 'newData.val() === now',
        },

        clocks: {
          w: { '.write': `auth != null && ${advanced(2)}`, '.validate': clockValidate('w') },
          b: { '.write': `auth != null && ${advanced(2)}`, '.validate': clockValidate('b') },
          $other: { '.validate': false },
        },

        status: {
          '.write': statusWrite,
          '.validate':
            "newData.val() === 'lobby' || newData.val() === 'active'" +
            " || newData.val() === 'checkmate' || newData.val() === 'stalemate'" +
            " || newData.val() === 'draw' || newData.val() === 'resigned'" +
            " || newData.val() === 'timeout'",
        },

        result: {
          // Rides along with whatever write is allowed to end the game.
          '.write':
            `auth != null && ${seated}` +
            ` && (${advanced(1)} || newData.parent().child('status').val() !== ${status})`,
          '.validate':
            `(${RESULT_ENUM}) && (newData.parent().child('status').val() !== 'resigned'` +
            ` || newData.val() === (${offer('army')} === 'w' ? '0-1' : '1-0'))`,
        },

        moves: {
          $pushId: {
            // Append-only: existing entries can be neither edited nor removed.
            '.write': `auth != null && !data.exists() && ${advanced(2)}`,
            '.validate':
              "newData.hasChildren(['index','san','from','to','by','fenAfter','ts'])" +
              ` && newData.child('index').val() === ${G}.child('turnIndex').val()` +
              ` && newData.child('by').val() === ${toMove}` +
              " && newData.child('fenAfter').val() === newData.parent().parent().child('fen').val()",
            index: { '.validate': 'newData.isNumber()' },
            san: { '.validate': 'newData.isString() && newData.val().length <= 10' },
            from: { '.validate': 'newData.isString() && newData.val().length === 2' },
            to: { '.validate': 'newData.isString() && newData.val().length === 2' },
            by: { '.validate': SLOT_ENUM },
            fenAfter: { '.validate': 'newData.isString()' },
            captured: { '.validate': 'newData.isString() && newData.val().length === 1' },
            ts: { '.validate': 'newData.val() === now' },
            $other: { '.validate': false },
          },
        },

        players: {
          $slot: {
            '.write':
              'auth != null && newData.child(\'uid\').val() === auth.uid && (' +
              `${claimable} || ${holds('$slot')} || ${provenSecret})`,
            '.validate': "newData.hasChildren(['uid','connected','lastSeen'])",
            uid: { '.validate': 'newData.val() === auth.uid' },
            name: { '.validate': 'newData.isString() && newData.val().length <= 24' },
            // Presence writes, including the onDisconnect that fires with no
            // client left to run it. Scoped so a heartbeat need not re-prove.
            connected: {
              '.write': `auth != null && ${holds('$slot')}`,
              '.validate': 'newData.isBoolean()',
            },
            lastSeen: {
              '.write': `auth != null && ${holds('$slot')}`,
              '.validate': 'newData.isNumber()',
            },
            $other: { '.validate': false },
          },
        },

        offer: {
          // No .write here: granting it would cascade onto `accept` and let an
          // offerer forge their opponents' consent in the same update.
          kind: {
            '.write': `auth != null && ${seated} && ${isActive}`,
            '.validate': "newData.val() === 'resign' || newData.val() === 'draw'",
          },
          army: {
            '.write': `auth != null && ${seated} && ${isActive}`,
            '.validate': "newData.val() === 'w' || newData.val() === 'b'",
          },
          by: {
            '.write': `auth != null && ${seated} && ${isActive}`,
            '.validate': SLOT_ENUM,
          },
          at: {
            '.write': `auth != null && ${seated} && ${isActive}`,
            '.validate': 'newData.val() === now',
          },
          accept: {
            $slot: {
              // Set only by the seat's own holder — a takeover does not get to
              // consent on an absent player's behalf. Anyone seated may clear.
              '.write':
                `auth != null && ${seated} && (!newData.exists()` +
                ` || (${holds('$slot')} && newData.val() === true))`,
              '.validate': 'newData.isBoolean()',
            },
          },
          $other: { '.validate': false },
        },

        rotation: { $slot: { '.validate': SLOT_ENUM } },
        seats: { '.validate': 'newData.val() === 2 || newData.val() === 4' },
        initialClock: { '.validate': 'newData.isNumber() && newData.val() > 0' },
        createdAt: { '.validate': 'newData.val() === now' },
        $other: { '.validate': false },
      },
    },

    // Never readable at any depth — which is why these live outside /games.
    // An RTDB read grant cascades, so a `.read` on the game node would have
    // exposed a secrets child sitting underneath it.
    secrets: {
      $gid: {
        $slot: {
          // Write-once, and only by whoever already holds the seat, so nobody
          // can mint a secret for a seat they do not occupy and lock it shut.
          '.write': `auth != null && !data.exists() && ${holds('$slot')}`,
          '.validate': 'newData.isString() && newData.val().length >= 20',
        },
      },
    },

    proof: {
      $gid: {
        $uid: {
          $slot: {
            '.write': 'auth != null && auth.uid === $uid',
            '.validate': 'newData.isString() && newData.val().length >= 20',
          },
        },
      },
    },
  },
};

writeFileSync(
  new URL('../database.rules.json', import.meta.url),
  JSON.stringify(rules, null, 2) + '\n',
);
console.log('wrote database.rules.json');
