'use client';

import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

export function GameOverScreen({ onRestart }: { onRestart: () => void }) {
  const winner = useGameStore(s => s.winner);
  const players = useGameStore(s => s.players);
  const humanPlayerId = useGameStore(s => s.humanPlayerId);

  const winnerPlayer = players.find(p => p.id === winner);
  const isHumanWinner = winner === humanPlayerId;
  const isDraw = !winner;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center max-w-md p-8"
      >
        {isDraw ? (
          <>
            <motion.div
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <span className="text-6xl">🌑</span>
            </motion.div>
            <h2 className="text-3xl font-bold text-slate-300 mt-4">永恒黑暗</h2>
            <p className="text-sm text-slate-500 mt-2">所有文明陨落，宇宙归于沉寂</p>
          </>
        ) : isHumanWinner ? (
          <>
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <span className="text-6xl">👑</span>
            </motion.div>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-yellow-400 to-amber-400 bg-clip-text text-transparent mt-4">
              终极文明
            </h2>
            <p className="text-sm text-yellow-500 mt-2">
              {winnerPlayer?.name} 成为最后的幸存者！
            </p>
          </>
        ) : (
          <>
            <span className="text-6xl">💀</span>
            <h2 className="text-3xl font-bold text-red-400 mt-4">文明陨落</h2>
            <p className="text-sm text-slate-500 mt-2">
              你的文明被 {winnerPlayer?.name} 淘汰了
            </p>
          </>
        )}

        {/* Player rankings */}
        <div className="mt-6 space-y-2 text-left">
          {players
            .sort((a, b) => {
              // Winner first, then eliminated players
              if (a.id === winner) return -1;
              if (b.id === winner) return 1;
              return a.eliminated === b.eliminated ? 0 : a.eliminated ? 1 : -1;
            })
            .map((p, idx) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 px-4 py-2 rounded-lg border ${
                  p.id === winner
                    ? 'bg-yellow-950/30 border-yellow-800/40'
                    : 'bg-slate-900/50 border-slate-800'
                } ${p.id === humanPlayerId ? 'ring-1 ring-white/10' : ''}`}
              >
                <span className={`text-sm font-bold ${p.id === winner ? 'text-yellow-400' : 'text-slate-500'}`}>
                  #{idx + 1}
                </span>
                <span className="text-sm text-white flex-1">{p.name}</span>
                {p.id === humanPlayerId && (
                  <span className="text-[10px] text-slate-500">(你)</span>
                )}
                {p.id === winner && <span className="text-sm">👑</span>}
                {p.eliminated && <span className="text-xs text-red-400">已淘汰</span>}
              </div>
            ))}
        </div>

        <Button
          className="mt-8 w-full h-12 text-base bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white border-0"
          onClick={onRestart}
        >
          🔄 再来一局
        </Button>
      </motion.div>
    </div>
  );
}
