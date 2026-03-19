/**
 * Blackjack (21) — TypeScript IL game spec using @engine SDK.
 *
 * Player vs Dealer card game. Standard rules:
 *   - Hit or stand to get as close to 21 as possible
 *   - Dealer hits on 16, stands on 17+
 *   - Aces count as 1 or 11 (best value)
 *   - AI mode uses basic strategy (hit on <17, stand on 17+)
 */

import { defineGame } from '@engine/core';
import { consumeAction } from '@engine/input';
import { clearCanvas, drawRoundedRect, drawLabel, drawGameOver } from '@engine/render';
import { drawTouchOverlay } from '@engine/touch';
import { createDeck, shuffle, deal, handValue, drawCardFace, drawCardBack } from '@engine/cards';

// ── Constants ───────────────────────────────────────────────────────

const W = 600;
const H = 450;
const CARD_W = 60;
const CARD_H = 84;
const CARD_GAP = 16;
const DEALER_Y = 40;
const PLAYER_Y = 300;
const CARDS_X = 140;
const CHIP_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835'];
const DEALER_HIT_LIMIT = 17;
const AI_DELAY = 800;

// ── Game Definition ─────────────────────────────────────────────────

const game = defineGame({
  display: {
    type: 'custom',
    width: 20,
    height: 15,
    cellSize: 30,
    canvasWidth: W,
    canvasHeight: H,
    offsetX: 0,
    offsetY: 0,
    background: '#1a5c2a',
  },
  input: {
    left:    { keys: ['ArrowLeft', 'a'] },
    right:   { keys: ['ArrowRight', 'd'] },
    restart: { keys: ['r', 'R'] },
  },
});

// ── Resources ───────────────────────────────────────────────────────

game.resource('state', {
  phase: 'betting',       // 'betting' | 'dealing' | 'playerTurn' | 'dealerTurn' | 'result'
  score: 0,
  gameOver: false,
  chips: 100,
  bet: 10,
  message: 'Place your bet!',
  result: '',             // 'win' | 'lose' | 'push' | 'blackjack' | 'bust'
});

game.resource('deck', {
  cards: [],
  initialized: false,
});

game.resource('playerHand', { cards: [] });
game.resource('dealerHand', { cards: [] });
game.resource('_aiTimer', { elapsed: 0 });

// ── Init System ─────────────────────────────────────────────────────

game.system('init', function initSystem(world, _dt) {
  const state = world.getResource('state');
  const deckRes = world.getResource('deck');
  const input = world.getResource('input');

  // Handle restart
  if (consumeAction(input, 'restart')) {
    resetRound(world);
    return;
  }

  // Initialize deck if needed
  if (!deckRes.initialized) {
    deckRes.cards = shuffle(createDeck());
    deckRes.initialized = true;
  }

  // Auto-deal when in betting phase
  if (state.phase === 'betting' && !state.gameOver) {
    startDeal(world);
  }
});

// ── Player Input System ─────────────────────────────────────────────

game.system('playerInput', function playerInputSystem(world, _dt) {
  const gm = world.getResource('gameMode');
  if (gm && gm.mode === 'aiVsAi') return;

  const state = world.getResource('state');
  if (state.phase !== 'playerTurn') return;

  const input = world.getResource('input');

  // Left = Hit
  if (consumeAction(input, 'left')) {
    playerHit(world);
  }

  // Right = Stand
  if (consumeAction(input, 'right')) {
    playerStand(world);
  }
});

// ── AI System ───────────────────────────────────────────────────────

game.system('ai', function aiSystem(world, dt) {
  const state = world.getResource('state');
  const gm = world.getResource('gameMode');
  const isAi = gm && gm.mode === 'aiVsAi';

  // AI plays player turn in aiVsAi mode
  if (isAi && state.phase === 'playerTurn') {
    const timer = world.getResource('_aiTimer');
    timer.elapsed += dt;
    if (timer.elapsed < AI_DELAY) return;
    timer.elapsed = 0;

    const playerHand = world.getResource('playerHand');
    const pValue = handValue(playerHand.cards);

    // Basic strategy: hit on <17, stand on 17+
    if (pValue < 17) {
      playerHit(world);
    } else {
      playerStand(world);
    }
    return;
  }

  // Dealer turn logic (both modes)
  if (state.phase === 'dealerTurn') {
    const timer = world.getResource('_aiTimer');
    timer.elapsed += dt;
    if (timer.elapsed < AI_DELAY) return;
    timer.elapsed = 0;

    dealerPlay(world);
  }
});

// ── Dealer Logic System ─────────────────────────────────────────────

game.system('dealerLogic', function dealerLogicSystem(world, _dt) {
  // This system handles result phase auto-restart for AI mode
  const state = world.getResource('state');
  const gm = world.getResource('gameMode');

  if (state.phase === 'result' && gm && gm.mode === 'aiVsAi') {
    const timer = world.getResource('_aiTimer');
    timer.elapsed += _dt;
    if (timer.elapsed < AI_DELAY * 2) return;
    timer.elapsed = 0;

    if (state.chips <= 0) {
      state.gameOver = true;
      state.message = 'Out of chips! Game Over!';
      return;
    }
    resetRound(world);
  }
});

// ── Game Logic Helpers ──────────────────────────────────────────────

function ensureDeck(world) {
  const deckRes = world.getResource('deck');
  if (deckRes.cards.length < 10) {
    deckRes.cards = shuffle(createDeck());
  }
}

function startDeal(world) {
  const state = world.getResource('state');
  const deckRes = world.getResource('deck');
  const playerHand = world.getResource('playerHand');
  const dealerHand = world.getResource('dealerHand');

  ensureDeck(world);

  // Clear hands
  playerHand.cards = [];
  dealerHand.cards = [];

  // Deal 2 cards each: player face up, dealer 1 up + 1 down
  const pCards = deal(deckRes.cards, 2);
  pCards[0].faceUp = true;
  pCards[1].faceUp = true;
  playerHand.cards = pCards;

  const dCards = deal(deckRes.cards, 2);
  dCards[0].faceUp = true;
  dCards[1].faceUp = false;   // Hole card
  dealerHand.cards = dCards;

  state.phase = 'dealing';

  // Check for natural blackjack
  const pVal = handValue(playerHand.cards);
  const dVal = handValue(dealerHand.cards);

  if (pVal === 21 && dVal === 21) {
    revealDealerHand(dealerHand);
    state.phase = 'result';
    state.result = 'push';
    state.message = 'Both Blackjack — Push!';
    return;
  }

  if (pVal === 21) {
    revealDealerHand(dealerHand);
    state.phase = 'result';
    state.result = 'blackjack';
    state.chips += Math.floor(state.bet * 1.5);
    state.score += Math.floor(state.bet * 1.5);
    state.message = 'Blackjack! You win!';
    return;
  }

  state.phase = 'playerTurn';
  state.message = 'Hit (←) or Stand (→)';
}

function playerHit(world) {
  const state = world.getResource('state');
  const deckRes = world.getResource('deck');
  const playerHand = world.getResource('playerHand');

  ensureDeck(world);

  const newCards = deal(deckRes.cards, 1);
  newCards[0].faceUp = true;
  playerHand.cards.push(newCards[0]);

  const pVal = handValue(playerHand.cards);

  if (pVal > 21) {
    state.phase = 'result';
    state.result = 'bust';
    state.chips -= state.bet;
    state.score -= state.bet;
    state.message = `Bust! (${pVal}) You lose.`;
    revealDealerHand(world.getResource('dealerHand'));
    checkGameOver(state);
  } else if (pVal === 21) {
    playerStand(world);
  } else {
    state.message = `Hand: ${pVal} — Hit (←) or Stand (→)`;
  }
}

function playerStand(world) {
  const state = world.getResource('state');
  const dealerHand = world.getResource('dealerHand');

  revealDealerHand(dealerHand);
  state.phase = 'dealerTurn';
  state.message = 'Dealer reveals...';

  const timer = world.getResource('_aiTimer');
  timer.elapsed = 0;
}

function dealerPlay(world) {
  const state = world.getResource('state');
  const deckRes = world.getResource('deck');
  const dealerHand = world.getResource('dealerHand');
  const playerHand = world.getResource('playerHand');

  ensureDeck(world);

  const dVal = handValue(dealerHand.cards);

  if (dVal < DEALER_HIT_LIMIT) {
    // Dealer hits
    const newCards = deal(deckRes.cards, 1);
    newCards[0].faceUp = true;
    dealerHand.cards.push(newCards[0]);

    const newVal = handValue(dealerHand.cards);
    state.message = `Dealer draws... (${newVal})`;

    if (newVal > 21) {
      state.phase = 'result';
      state.result = 'win';
      state.chips += state.bet;
      state.score += state.bet;
      state.message = `Dealer busts! (${newVal}) You win!`;
    }
    return;
  }

  // Dealer stands — compare hands
  const pVal = handValue(playerHand.cards);

  state.phase = 'result';

  if (dVal > 21) {
    state.result = 'win';
    state.chips += state.bet;
    state.score += state.bet;
    state.message = `Dealer busts! (${dVal}) You win!`;
  } else if (pVal > dVal) {
    state.result = 'win';
    state.chips += state.bet;
    state.score += state.bet;
    state.message = `You win! ${pVal} vs ${dVal}`;
  } else if (dVal > pVal) {
    state.result = 'lose';
    state.chips -= state.bet;
    state.score -= state.bet;
    state.message = `Dealer wins. ${dVal} vs ${pVal}`;
  } else {
    state.result = 'push';
    state.message = `Push! Both ${pVal}`;
  }

  checkGameOver(state);
}

function revealDealerHand(dealerHand) {
  for (const card of dealerHand.cards) {
    card.faceUp = true;
  }
}

function checkGameOver(state) {
  if (state.chips <= 0) {
    state.gameOver = true;
    state.chips = 0;
    state.message = 'Out of chips! Game Over!';
  }
}

function resetRound(world) {
  const state = world.getResource('state');
  const deckRes = world.getResource('deck');
  const playerHand = world.getResource('playerHand');
  const dealerHand = world.getResource('dealerHand');
  const timer = world.getResource('_aiTimer');

  playerHand.cards = [];
  dealerHand.cards = [];
  timer.elapsed = 0;

  if (state.gameOver) {
    state.chips = 100;
    state.score = 0;
    state.gameOver = false;
  }

  state.phase = 'betting';
  state.result = '';
  state.message = 'Place your bet!';
  state.bet = Math.min(10, state.chips);

  // Reshuffle if low
  if (deckRes.cards.length < 15) {
    deckRes.cards = shuffle(createDeck());
  }
}

// ── Render Helpers ──────────────────────────────────────────────────

function drawChip(ctx, x, y, radius, color, label) {
  ctx.save();

  // Outer ring
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Inner dashes
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const inner = radius * 0.6;
    const outer = radius * 0.85;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    ctx.stroke();
  }

  // Label
  if (label) {
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(radius * 0.7)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
  }

  ctx.restore();
}

function drawHand(ctx, cards, x, y, hideHole) {
  for (let i = 0; i < cards.length; i++) {
    const cx = x + i * (CARD_W + CARD_GAP);
    const card = cards[i];
    if (!card.faceUp && hideHole) {
      drawCardBack(ctx, cx, y, CARD_W, CARD_H);
    } else {
      drawCardFace(ctx, cx, y, CARD_W, CARD_H, card);
    }
  }
}

function drawHandValue(ctx, cards, x, y, hidden) {
  if (cards.length === 0) return;
  const val = hidden ? '?' : String(handValue(cards));
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(val, x, y);
  ctx.restore();
}

// ── Render System ───────────────────────────────────────────────────

game.system('render', function renderSystem(world, _dt) {
  const renderer = world.getResource('renderer');
  if (!renderer) return;

  const { ctx } = renderer;
  const state = world.getResource('state');
  const playerHand = world.getResource('playerHand');
  const dealerHand = world.getResource('dealerHand');

  // ── Background ──
  clearCanvas(ctx, '#1a5c2a');

  // Felt texture lines
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < H; i += 12) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(W, i);
    ctx.stroke();
  }
  ctx.restore();

  // ── Title bar ──
  drawRoundedRect(ctx, 0, 0, W, 30, 0, '#145224');
  drawLabel(ctx, 'BLACKJACK', 10, 20, { color: '#ffd700', fontSize: 16 });
  drawLabel(ctx, `Chips: ${state.chips}`, W - 140, 20, { color: '#fff', fontSize: 14 });

  // ── Dealer area ──
  drawLabel(ctx, 'DEALER', 20, DEALER_Y + 20, { color: '#aaddaa', fontSize: 13 });

  const dealerHidden = state.phase === 'playerTurn' || state.phase === 'dealing';
  if (dealerHand.cards.length > 0) {
    drawHand(ctx, dealerHand.cards, CARDS_X, DEALER_Y, dealerHidden);

    // Show value
    const valX = CARDS_X + dealerHand.cards.length * (CARD_W + CARD_GAP) + 10;
    if (dealerHidden) {
      // Show only the face-up card value
      const visibleCards = dealerHand.cards.filter(c => c.faceUp);
      drawHandValue(ctx, visibleCards, valX, DEALER_Y + CARD_H / 2, false);
      drawLabel(ctx, '+ ?', valX + 24, DEALER_Y + CARD_H / 2, { color: '#aaa', fontSize: 14 });
    } else {
      drawHandValue(ctx, dealerHand.cards, valX, DEALER_Y + CARD_H / 2, false);
    }
  }

  // ── Divider ──
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(20, DEALER_Y + CARD_H + 30);
  ctx.lineTo(W - 20, DEALER_Y + CARD_H + 30);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // ── Message area ──
  const msgY = DEALER_Y + CARD_H + 60;
  ctx.save();
  ctx.fillStyle = getMessageColor(state);
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(state.message, W / 2, msgY);
  ctx.restore();

  // ── Bet display ──
  const betY = msgY + 30;
  drawChip(ctx, W / 2 - 40, betY, 14, CHIP_COLORS[0], '');
  drawLabel(ctx, `Bet: $${state.bet}`, W / 2 - 18, betY + 4, { color: '#ffd700', fontSize: 14 });

  // ── Player area ──
  drawLabel(ctx, 'PLAYER', 20, PLAYER_Y + 20, { color: '#aaddaa', fontSize: 13 });

  if (playerHand.cards.length > 0) {
    drawHand(ctx, playerHand.cards, CARDS_X, PLAYER_Y, false);

    // Show value
    const valX = CARDS_X + playerHand.cards.length * (CARD_W + CARD_GAP) + 10;
    drawHandValue(ctx, playerHand.cards, valX, PLAYER_Y + CARD_H / 2, false);
  }

  // ── Controls hint ──
  if (state.phase === 'playerTurn') {
    const hintY = PLAYER_Y + CARD_H + 18;

    drawRoundedRect(ctx, CARDS_X - 10, hintY - 12, 100, 24, 6, 'rgba(0,0,0,0.3)');
    drawLabel(ctx, '← HIT', CARDS_X + 2, hintY + 4, { color: '#fff', fontSize: 12 });

    drawRoundedRect(ctx, CARDS_X + 110, hintY - 12, 120, 24, 6, 'rgba(0,0,0,0.3)');
    drawLabel(ctx, '→ STAND', CARDS_X + 122, hintY + 4, { color: '#fff', fontSize: 12 });
  }

  // ── Chips display ──
  const chipAreaX = W - 100;
  const chipAreaY = PLAYER_Y + 10;
  drawChipStack(ctx, chipAreaX, chipAreaY, state.chips);

  // ── Result phase hint ──
  if (state.phase === 'result') {
    const gm = world.getResource('gameMode');
    const isAi = gm && gm.mode === 'aiVsAi';
    if (!isAi) {
      drawLabel(ctx, 'Press R to play again', W / 2 - 70, H - 20, { color: '#aaa', fontSize: 12 });
    }
  }

  // ── Game over overlay ──
  if (state.gameOver) {
    drawGameOver(ctx, 0, 0, W, H, {
      title: 'GAME OVER',
      titleColor: '#e53935',
      subtitle: 'Out of chips! Press R to restart.',
    });
  }

  drawTouchOverlay(ctx, W, H);
});

// ── Render Utility Helpers ──────────────────────────────────────────

function getMessageColor(state) {
  switch (state.result) {
    case 'win':
    case 'blackjack':
      return '#4caf50';
    case 'lose':
    case 'bust':
      return '#e53935';
    case 'push':
      return '#ffd700';
    default:
      return '#fff';
  }
}

function drawChipStack(ctx, x, y, chips) {
  const stackCount = Math.min(Math.floor(chips / 10), 10);
  for (let i = 0; i < stackCount; i++) {
    const cy = y + 60 - i * 6;
    const colorIdx = i % CHIP_COLORS.length;
    drawChip(ctx, x, cy, 12, CHIP_COLORS[colorIdx], '');
  }
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`$${chips}`, x, y + 78);
  ctx.restore();
}

export default game;
