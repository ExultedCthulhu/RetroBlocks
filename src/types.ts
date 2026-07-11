/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type TetrominoType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

export interface Point {
  x: number;
  y: number;
}

export type Board = (string | null)[][];

export interface LeaderboardEntry {
  name: string;
  score: number;
  lines: number;
  date: string;
}

export type GameStatus = 'MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

export interface Tetromino {
  id?: string;
  type: TetrominoType;
  matrix: number[][];
  color: string;
  position: Point;
}

export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;

// Tetromino definitions with grid size and rotation matrices
export const TETROMINOS: Record<TetrominoType, { matrix: number[][]; color: string }> = {
  I: {
    matrix: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    color: '#06b6d4', // Cyan (Tailwind cyan-500)
  },
  O: {
    matrix: [
      [1, 1],
      [1, 1],
    ],
    color: '#eab308', // Yellow (Tailwind yellow-500)
  },
  T: {
    matrix: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    color: '#a855f7', // Purple (Tailwind purple-500)
  },
  S: {
    matrix: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
    color: '#22c55e', // Green (Tailwind green-500)
  },
  Z: {
    matrix: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
    color: '#ef4444', // Red (Tailwind red-500)
  },
  J: {
    matrix: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    color: '#3b82f6', // Blue (Tailwind blue-500)
  },
  L: {
    matrix: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
    color: '#f97316', // Orange (Tailwind orange-500)
  },
};
