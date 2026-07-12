/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { LeaderboardEntry } from '../types';
import { Trophy, Star } from 'lucide-react';

const LOCAL_STORAGE_KEY = 'retroblocks_high_scores_v2';

const DEFAULT_SCORES: LeaderboardEntry[] = [
  { name: 'GEMINI', score: 50000, lines: 100, date: '2026-07-11' },
  { name: 'TRON', score: 40000, lines: 80, date: '2026-05-15' },
  { name: 'LOVELACE', score: 30000, lines: 60, date: '2026-03-22' },
  { name: 'HAL9000', score: 20000, lines: 40, date: '2026-02-01' },
  { name: 'WOPR', score: 10000, lines: 20, date: '2026-01-10' },
];

export function getHighScores(): LeaderboardEntry[] {
  if (typeof window === 'undefined') return DEFAULT_SCORES;
  const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!stored) {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(DEFAULT_SCORES));
    return DEFAULT_SCORES;
  }
  try {
    return JSON.parse(stored);
  } catch (e) {
    return DEFAULT_SCORES;
  }
}

export function saveHighScore(name: string, score: number, lines: number): void {
  if (typeof window === 'undefined') return;
  const scores = getHighScores();
  const cleanName = name.trim().substring(0, 10).toUpperCase() || 'ANON';
  const newEntry: LeaderboardEntry = {
    name: cleanName,
    score,
    lines,
    date: new Date().toISOString().split('T')[0],
  };

  const updated = [...scores, newEntry]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5); // Remain at exactly top 5 scores

  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
}

export function checkIsHighScore(score: number): boolean {
  if (score <= 0) return false;
  const scores = getHighScores();
  if (scores.length < 5) return true;
  return score > scores[scores.length - 1].score;
}

export default function Leaderboard() {
  const [scores, setScores] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    setScores(getHighScores());
  }, []);

  const clearLeaderboard = () => {
    if (window.confirm('Are you sure you want to clear all high scores?')) {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
      setScores(getHighScores());
    }
  };

  return (
    <div className="w-full bg-slate-900/80 p-6 rounded-xl border-2 border-slate-800 font-retro text-xs text-white shadow-[0_0_15px_rgba(0,0,0,0.8)] relative overflow-hidden flex flex-col">
      {/* Retro background pattern */}
      <div className="absolute inset-0 bg-grid-white/[0.02] pointer-events-none" />

      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
        <div className="flex items-center gap-2 text-blue-400 font-bold uppercase tracking-[0.15em]">
          <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
          <h2>TOP PLAYERS</h2>
        </div>
        <button
          onClick={clearLeaderboard}
          className="text-[9px] text-slate-500 hover:text-red-400 transition-colors font-sans uppercase tracking-widest"
        >
          [ Reset ]
        </button>
      </div>

      <div className="divide-y divide-slate-800/60">
        {scores.map((entry, index) => {
          const rankColor = index === 0
            ? 'text-blue-400'
            : 'text-slate-500';
          const scoreColor = index === 0
            ? 'text-blue-400'
            : 'text-slate-300';

          return (
            <div
              key={index}
              className="flex items-center justify-between py-2.5 px-1 transition-all duration-300 gap-2 hover:bg-white/[0.01]"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className={`text-sm font-bold shrink-0 ${rankColor} w-6`}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="font-bold text-white tracking-widest text-[11px] truncate" title={entry.name}>
                  {entry.name}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-slate-500 flex items-center gap-0.5 w-9 justify-end text-[10px]">
                  <Star className="w-3 h-3 text-yellow-500 shrink-0" /> {entry.lines}L
                </span>
                <span className={`font-mono text-xs font-bold ${scoreColor} w-14 text-right`}>
                  {entry.score.toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
