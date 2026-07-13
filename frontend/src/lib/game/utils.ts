import type { GameState, Player, LogEntry } from './types';

const MAX_LOGS = 200;

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function getCurrentPlayer(state: GameState): Player | undefined {
  return state.players[state.currentPlayerIndex];
}

export function addLog(state: GameState, message: string, type: LogEntry['type'] = 'info'): void {
  state.logs.push({
    id: generateId(),
    turn: state.totalTurn,
    phase: state.turnPhase,
    message,
    type,
  });
  if (state.logs.length > MAX_LOGS) {
    state.logs = state.logs.slice(-MAX_LOGS + 10);
  }
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 8) + Date.now().toString(36);
}
