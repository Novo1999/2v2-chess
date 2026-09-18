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
/** How long clicking an empty seat holds it against the rest of the table. */
export const RESERVE_MS = 2000;
/** One press of the button that hands the other team time. */
export const GIFT_MS = 15000;

// ---------------------------------------------------------------------------
// Path expressions. `root` is always the PRE-write tree; `newData` is post.
// ---------------------------------------------------------------------------

const G = "root.child('games').child($gid)";
const field = (name) => `${G}.child('${name}').val()`;

const toMove = field('toMove');
const status = field('status');
const lastMoveAt = field('lastMoveAt');

const isLobby = `${status} === 'lobby'`;
const isActive = `${status} === 'active'`;

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
const occupied = (slot) => `${G}.child('players').child(${slot}).child('uid').exists()`;
const vacant = (slot) => `!${occupied(slot)}`;
const absent = (slot) =>
  `(${G}.child('players').child(${slot}).child('connected').val() === false` +
  ` && now - ${G}.child('players').child(${slot}).child('lastSeen').val() > ${GRACE_MS})`;

const q = (slot) => `'${slot}'`;
const seated = `(${['P1', 'P2', 'P3', 'P4'].map((s) => holds(q(s))).join(' || ')})`;

/**
 * Decision #1 + #10, plus short-handed play: the seat on move, or its teammate
 * once the grace lapses.
 *
 * An EMPTY seat on move needs no grace period. The grace exists to give a
 * player who dropped the chance to come back to a turn that is theirs; nobody
 * is coming back to a seat nobody ever took, and a team playing a man down
 * would otherwise burn 25 seconds of its shared clock on every single turn.
 */
const mayMove =
  `(${holds(toMove)}` +
  ` || ((${vacant(toMove)} || ${absent(toMove)}) && ${holds(teammate(toMove))}))`;

const whiteToMove = `(${toMove} === 'P1' || ${toMove} === 'P2')`;

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

/**
 * A team needs one player, not two. Four friends become three when somebody
 * cannot make it, and the game they wanted is still playable — the remaining
 * teammate simply plays both of that army's turns (see `mayMove`). A seat left
 * open here can still be filled later, mid-game.
 */
const armyManned = (color) =>
  color === 'w'
    ? `(${occupied(q('P1'))} || ${occupied(q('P2'))})`
    : `(${occupied(q('P3'))} || ${occupied(q('P4'))})`;

const canStart = `${armyManned('w')} && ${armyManned('b')}`;

/** The side to move has burned more wall-clock than it had left. */
const flagged = `${elapsed} >= ${G}.child('clocks').child(${whiteToMove} ? 'w' : 'b').val()`;

// --- consent (decision #3) -------------------------------------------------

const offer = (name) => `${G}.child('offer').child('${name}').val()`;
const acceptedBy = (slot) =>
  `${G}.child('offer').child('accept').child(${slot}).val() === true`;

/**
 * An empty seat cannot withhold consent — it would make conceding impossible
 * for a team playing a man down. `armyManned` is what stops that from
 * collapsing into "an army with nobody in it agrees to anything".
 */
const agreedOrEmpty = (slot) => `(${acceptedBy(q(slot))} || ${vacant(q(slot))})`;

const armyAccepted = (color) =>
  color === 'w'
    ? `(${armyManned('w')} && ${agreedOrEmpty('P1')} && ${agreedOrEmpty('P2')})`
    : `(${armyManned('b')} && ${agreedOrEmpty('P3')} && ${agreedOrEmpty('P4')})`;

/** Resignation needs the whole resigning army; a draw needs everyone. */
const resignAgreed =
  `(${offer('kind')} === 'resign' && ((${offer('army')} === 'w' && ${armyAccepted('w')})` +
  ` || (${offer('army')} === 'b' && ${armyAccepted('b')})))`;
const drawAgreed =
  `(${offer('kind')} === 'draw' && ${armyAccepted('w')} && ${armyAccepted('b')})`;

/**
 * Trading seats — decision #3's machinery pointed at a third thing. Both named
 * seats have signed, so the exchange is a single update that either lands whole
 * or not at all: no window in which one player has stood up and the other has
 * not yet sat down.
 */
const swapAgreed =
  `(${offer('kind')} === 'swap'` +
  ` && ${acceptedBy(offer('by'))} && ${acceptedBy(offer('with'))})`;

/**
 * Writing `$slot` as one half of an agreed swap. The uid written must be
 * exactly the counterpart seat's current holder, which is what keeps this from
 * becoming a general "put anyone anywhere" grant.
 *
 * Lobby only: the table is settled before the clocks start, and a swap mid-game
 * would hand a player the other side's position with their clock running.
 *
 * `incomingUid` is passed in rather than hardcoded because this predicate is
 * used at two different depths, where `newData` means two different things: the
 * whole seat node on the `.write`, and the bare uid string on its `.validate`.
 */
const swapInto = (slot, incomingUid) =>
  `(${isLobby} && ${seated} && ${swapAgreed}` +
  ` && (${slot} === ${offer('by')} || ${slot} === ${offer('with')})` +
  ` && ${incomingUid} ===` +
  ` ${uidOf(`(${slot} === ${offer('by')} ? ${offer('with')} : ${offer('by')})`)})`;

const SEAT_NODE_UID = "newData.child('uid').val()";
const BARE_UID = 'newData.val()';

// --- seat claims (decisions #8, #9) ----------------------------------------

const secretVal = `root.child('secrets').child($gid).child($slot).val()`;
const provenSecret =
  `(root.child('secrets').child($gid).child($slot).exists()` +
  ` && root.child('proof').child($gid).child(auth.uid).child($slot).val() === ${secretVal})`;

/**
 * The two-second hold. Claiming was always race-safe — the loser's write simply
 * failed — but "somebody else got there first" is a worse thing to learn after
 * clicking than before, so a click reserves the seat and every other client
 * greys it out. The reservation expires on its own, so a client that dies
 * mid-claim cannot wedge a seat shut.
 */
const reserveAt = (slot) => `${G}.child('reserve').child(${slot}).child('at')`;
const reservedLive = (slot) =>
  `(${reserveAt(slot)}.exists() && now - ${reserveAt(slot)}.val() < ${RESERVE_MS})`;
const reservedByMe = (slot) =>
  `${G}.child('reserve').child(${slot}).child('uid').val() === auth.uid`;
const reserveClear = (slot) => `(!${reservedLive(slot)} || ${reservedByMe(slot)})`;

const claimable =
  `(${vacant('$slot')}` +
  ` && !root.child('secrets').child($gid).child($slot).exists()` +
  ` && ${reserveClear('$slot')})`;

/**
 * Standing up. Only ever your own seat, and the secret goes with it — the pair
 * keeps the invariant the claim rule leans on, that a secret exists for exactly
 * the seats somebody is sitting in. A seat vacated with its secret left behind
 * would be unclaimable by anyone, including the player who just left it.
 */
const vacating = `(!newData.exists() && ${holds('$slot')})`;

const SLOT_ENUM =
  "newData.val() === 'P1' || newData.val() === 'P2'" +
  " || newData.val() === 'P3' || newData.val() === 'P4'";
const RESULT_ENUM =
  "newData.val() === '1-0' || newData.val() === '0-1' || newData.val() === '1/2-1/2'";

// ---------------------------------------------------------------------------

/**
 * Handing the other team fifteen seconds. Always to the opponent, never to
 * yourself: `opponentSeat` is the whole of that guarantee, and it is why no
 * limit on how often is needed — the button can only ever cost you the game.
 *
 * `!advanced(2)` keeps it off a move update. Without it the two branches of
 * this validate would combine into "a mover may add 15s to their own clock
 * while advancing the turn", which is the one thing the decrement window exists
 * to prevent.
 */
const opponentSeat = (color) =>
  color === 'w'
    ? `(${holds(q('P3'))} || ${holds(q('P4'))})`
    : `(${holds(q('P1'))} || ${holds(q('P2'))})`;

// The parentheses around `advanced` are load-bearing: `!` binds tighter than
// `===`, so `!a === b` negates the left operand — a number — rather than the
// comparison, and the rules compiler rejects it.
const giftTo = (color) =>
  `(${isActive} && !(${advanced(2)}) && data.exists()` +
  ` && newData.val() === data.val() + ${GIFT_MS} && ${opponentSeat(color)})`;

const clockValidate = (color) => {
  const moving = color === 'w' ? whiteToMove : `!${whiteToMove}`;
  return (
    `newData.isNumber() && newData.val() >= 0 && (!data.exists() || ${giftTo(color)} || ` +
    `(${moving}` +
    ` ? (newData.val() <= data.val() - ${elapsed} + ${CLOCK_SLOP_MS}` +
    ` && newData.val() >= data.val() - ${elapsed} - ${CLOCK_SLOP_MS})` +
    ` : newData.val() === data.val()))`
  );
};

const clockWrite = (color) =>
  `auth != null && (${advanced(2)} || (${seated} && ${giftTo(color)}))`;

const statusWrite =
  `auth != null && ${seated} && (` +
  // lobby -> active, once each army has somebody in it
  `(${isLobby} && newData.val() === 'active' && ${canStart})` +
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

/** Offers are opened in the lobby (swap) or in play (resign, draw). */
const offerWrite = `auth != null && ${seated} && (${isActive} || ${isLobby})`;

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
            ` || (${isLobby} && newData.parent().child('status').val() === 'active'))`,
          '.validate': 'newData.val() === now',
        },

        clocks: {
          w: { '.write': clockWrite('w'), '.validate': clockValidate('w') },
          b: { '.write': clockWrite('b'), '.validate': clockValidate('b') },
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
              `auth != null && (${vacating}` +
              ` || (newData.child('uid').val() === auth.uid` +
              ` && (${claimable} || ${holds('$slot')} || ${provenSecret}))` +
              ` || ${swapInto('$slot', SEAT_NODE_UID)})`,
            '.validate': "newData.hasChildren(['uid','connected','lastSeen'])",
            // Normally your own uid and nobody else's. The exception is the
            // settling half of an agreed swap, where one client writes both
            // seats at once and each carries the other player's uid.
            uid: {
              '.validate': `newData.val() === auth.uid || ${swapInto('$slot', BARE_UID)}`,
            },
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

        // Advisory, self-expiring, and never the thing that actually decides a
        // contested seat — `claimable` still does that.
        reserve: {
          $slot: {
            '.write':
              `auth != null && ((!newData.exists() && ${reservedByMe('$slot')})` +
              ` || (${vacant('$slot')} && ${reserveClear('$slot')}))`,
            '.validate': "newData.hasChildren(['uid','at'])",
            uid: { '.validate': 'newData.val() === auth.uid' },
            at: { '.validate': 'newData.val() === now' },
            $other: { '.validate': false },
          },
        },

        offer: {
          // No .write here: granting it would cascade onto `accept` and let an
          // offerer forge their opponents' consent in the same update.
          kind: {
            '.write': offerWrite,
            '.validate':
              "newData.val() === 'resign' || newData.val() === 'draw'" +
              " || newData.val() === 'swap'",
          },
          army: {
            '.write': offerWrite,
            '.validate': "newData.val() === 'w' || newData.val() === 'b'",
          },
          by: { '.write': offerWrite, '.validate': SLOT_ENUM },
          // The counterpart seat of a swap. Unused by resign and draw.
          with: { '.write': offerWrite, '.validate': SLOT_ENUM },
          at: { '.write': offerWrite, '.validate': 'newData.val() === now' },
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
          // Only ever by whoever holds the seat right now, which is the whole
          // of the protection: to hold a seat you either found it empty or
          // proved this very secret. That a holder may also REPLACE it is what
          // lets a swapped-in player take ownership of their new seat, and
          // clear it on the way out.
          '.write': `auth != null && ${holds('$slot')}`,
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
