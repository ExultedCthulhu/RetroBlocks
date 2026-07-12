/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  TETROMINOS,
  Tetromino,
  TetrominoType,
  Board,
  GameStatus,
  Point,
} from '../types';
import { checkIsHighScore, saveHighScore } from './Leaderboard';
import { audioEngine } from '../lib/audio';
import OnScreenControls from './OnScreenControls';
import Leaderboard from './Leaderboard';
import {
  Volume2,
  VolumeX,
  Music,
  Music4,
  Play,
  RotateCcw,
  Pause,
  Award,
  Zap,
  Sliders,
  HelpCircle,
  Hash,
  Settings,
  X,
} from 'lucide-react';

export type SpeedMode = 'REGULAR' | 'FAST' | 'EXTREME' | 'INCREMENTAL';

export interface Keybindings {
  moveLeft: [string, string];
  moveRight: [string, string];
  rotateCW: [string, string];
  rotateCCW: [string, string];
  softDrop: [string, string];
  hardDrop: [string, string];
  hold: [string, string];
  pause: [string, string];
}

const DEFAULT_KEYBINDINGS: Keybindings = {
  moveLeft: ['ArrowLeft', 'j'],
  moveRight: ['ArrowRight', 'l'],
  rotateCW: ['ArrowUp', 'i'],
  rotateCCW: ['z', 'u'],
  softDrop: ['ArrowDown', 'k'],
  hardDrop: [' ', ' '],
  hold: ['x', 'o'],
  pause: ['Escape', 'p'],
};

const getFallSpeed = (mode: SpeedMode, linesCleared: number): number => {
  switch (mode) {
    case 'REGULAR': return 800;
    case 'FAST': return 400;
    case 'EXTREME': return 200;
    case 'INCREMENTAL': {
      const level = Math.floor(linesCleared / 10);
      return Math.max(100, 800 - (level * 50));
    }
  }
};

const getIncrementalMultiplierString = (linesCleared: number): string => {
  const level = Math.floor(linesCleared / 10);
  const speed = Math.max(100, 800 - (level * 50));
  const multiplier = 800 / speed;
  return `${multiplier.toFixed(1)}x`;
};

// Helper to create an empty board matrix
const createEmptyBoard = (): Board =>
  Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(null));

// Helper to get a random Tetromino shape
const getRandomTetromino = (): Tetromino => {
  const keys = Object.keys(TETROMINOS) as TetrominoType[];
  const randomType = keys[Math.floor(Math.random() * keys.length)];
  const { matrix, color } = TETROMINOS[randomType];
  
  // Center the tetromino in the board
  const width = matrix[0].length;
  const startX = Math.floor((BOARD_WIDTH - width) / 2);
  
  return {
    id: Math.random().toString(36).substring(2, 9),
    type: randomType,
    matrix: JSON.parse(JSON.stringify(matrix)),
    color,
    position: { x: startX, y: randomType === 'I' ? -1 : 0 },
  };
};

export default function RetroBlocksGame() {
  // Game States
  const [board, setBoard] = useState<Board>(createEmptyBoard());
  const [currentPiece, setCurrentPiece] = useState<Tetromino | null>(null);
  const [nextPieces, setNextPieces] = useState<Tetromino[]>([]);
  const [previewCount, setPreviewCount] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('retroblocks_preview_count');
      if (stored) return parseInt(stored, 10);
    }
    return 1;
  });
  const [status, setStatus] = useState<GameStatus>('MENU');
  
  // Scoring & Stats
  const [score, setScore] = useState<number>(0);
  const [lines, setLines] = useState<number>(0);
  const [hasNewHighScore, setHasNewHighScore] = useState<boolean>(false);
  const [playerName, setPlayerName] = useState<string>('');
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [leaderboardKey, setLeaderboardKey] = useState<number>(0);

  // New Custom States
  const [speedMode, setSpeedMode] = useState<SpeedMode>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('retroblocks_speed_mode');
      if (stored && ['REGULAR', 'FAST', 'EXTREME', 'INCREMENTAL'].includes(stored)) {
        return stored as SpeedMode;
      }
    }
    return 'REGULAR';
  });
  
  const [keybindings, setKeybindings] = useState<Keybindings>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('retroblocks_keybindings');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const migrated = { ...DEFAULT_KEYBINDINGS };
          Object.keys(DEFAULT_KEYBINDINGS).forEach((key) => {
            const k = key as keyof Keybindings;
            if (parsed[k]) {
              if (Array.isArray(parsed[k])) {
                migrated[k] = parsed[k] as [string, string];
              } else if (typeof parsed[k] === 'string') {
                migrated[k] = [parsed[k], DEFAULT_KEYBINDINGS[k][1]];
              }
            }
          });
          return migrated;
        } catch (_) {}
      }
    }
    return DEFAULT_KEYBINDINGS;
  });

  const [listeningAction, setListeningAction] = useState<{ action: keyof Keybindings; index: number } | null>(null);
  const [heldPiece, setHeldPiece] = useState<TetrominoType | null>(null);
  const [hasSwappedThisTurn, setHasSwappedThisTurn] = useState<boolean>(false);
  const [clearingRows, setClearingRows] = useState<number[]>([]);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  // Audio settings states (to force re-render upon toggle)
  const [soundEnabled, setSoundEnabled] = useState<boolean>(audioEngine.getSFXEnabled());
  const [musicEnabled, setMusicEnabled] = useState<boolean>(audioEngine.getMusicEnabled());
  const [sfxVolume, setSfxVolumeState] = useState<number>(audioEngine.getSFXVolume());
  const [musicVolume, setMusicVolumeState] = useState<number>(audioEngine.getMusicVolume());
  const [musicStyle, setMusicStyle] = useState<'A' | 'B' | 'C' | 'D'>(() => {
    return audioEngine.getMusicStyle();
  });
  const [musicInGameOnly, setMusicInGameOnly] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('retroblocks_bgm_ingame_only');
      if (stored !== null) return stored === 'true';
    }
    return true; // checked by default
  });

  // Refs for the game loop interval
  const nextStepTimeRef = useRef<number>(0);
  const statusRef = useRef<GameStatus>('MENU');
  const keysPressedRef = useRef<{ left: boolean; right: boolean; down: boolean }>({
    left: false,
    right: false,
    down: false,
  });
  const lastMoveTimeRef = useRef<{ left: number; right: number; down: number }>({
    left: 0,
    right: 0,
    down: 0,
  });
  const lastHardDropTimeRef = useRef<number>(0);
  const lastPauseToggleTimeRef = useRef<number>(0);

  // Refs and synchronizations for high-performance game loop reads and lock delay
  const lockTimeRef = useRef<number>(0);
  const lockResetsRef = useRef<number>(0);
  const currentPieceRef = useRef<Tetromino | null>(null);
  const boardRef = useRef<Board>(board);
  const linesRef = useRef<number>(lines);

  useEffect(() => {
    currentPieceRef.current = currentPiece;
  }, [currentPiece]);

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  const hasNewHighScoreRef = useRef<boolean>(false);
  const isSavedRef = useRef<boolean>(false);
  const playerNameRef = useRef<string>('');
  const scoreRef = useRef<number>(0);

  // Touchscreen Support Refs
  const touchStartXRef = useRef<number>(0);
  const touchStartYRef = useRef<number>(0);
  const touchStartTimeRef = useRef<number>(0);
  const lastMiddleTapTimeRef = useRef<number>(0);
  const isSwipingRef = useRef<boolean>(false);
  const swipeHoldIntervalRef = useRef<any>(null);
  const hasTriggeredSwipeRef = useRef<boolean>(false);
  const hasTriggeredHardDropRef = useRef<boolean>(false);

  // Refs for callbacks to prevent stale closures in touch event intervals
  const moveLeftRef = useRef<() => void>(() => {});
  const moveRightRef = useRef<() => void>(() => {});
  const moveDownRef = useRef<() => void>(() => {});
  const hardDropRef = useRef<() => void>(() => {});
  const holdPieceRef = useRef<() => void>(() => {});
  const rotateRef = useRef<() => void>(() => {});
  const togglePauseRef = useRef<() => void>(() => {});

  useEffect(() => {
    moveLeftRef.current = moveLeft;
    moveRightRef.current = moveRight;
    moveDownRef.current = moveDown;
    hardDropRef.current = hardDrop;
    holdPieceRef.current = holdPiece;
    rotateRef.current = rotate;
    togglePauseRef.current = togglePause;
  });

  useEffect(() => {
    hasNewHighScoreRef.current = hasNewHighScore;
  }, [hasNewHighScore]);

  useEffect(() => {
    isSavedRef.current = isSaved;
  }, [isSaved]);

  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  const triggerLockDelayReset = useCallback(() => {
    if (lockTimeRef.current !== 0) {
      if (lockResetsRef.current < 15) {
        lockResetsRef.current++;
        lockTimeRef.current = performance.now() + 500;
      }
    }
  }, []);

  // Keep ref of status synced so keyboard listener doesn't refer to stale state
  useEffect(() => {
    statusRef.current = status;
    if (status !== 'PLAYING') {
      keysPressedRef.current = { left: false, right: false, down: false };
    }
  }, [status]);

  // Rotates a grid matrix 90deg clockwise
  const rotateMatrix = (matrix: number[][]): number[][] => {
    const n = matrix.length;
    const result = Array.from({ length: n }, () => Array(n).fill(0));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        result[c][n - 1 - r] = matrix[r][c];
      }
    }
    return result;
  };

  // Rotates a grid matrix 90deg counter-clockwise
  const rotateMatrixCCW = (matrix: number[][]): number[][] => {
    const n = matrix.length;
    const result = Array.from({ length: n }, () => Array(n).fill(0));
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        result[n - 1 - c][r] = matrix[r][c];
      }
    }
    return result;
  };

  // Checks collision for a given piece matrix at a specific board position
  const checkCollision = useCallback((
    matrix: number[][],
    position: Point,
    currentBoard: Board
  ): boolean => {
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (matrix[r][c] !== 0) {
          const boardX = position.x + c;
          const boardY = position.y + r;

          // Out of horizontal bounds
          if (boardX < 0 || boardX >= BOARD_WIDTH) {
            return true;
          }

          // Out of bottom bounds
          if (boardY >= BOARD_HEIGHT) {
            return true;
          }

          // Colliding with fixed blocks (only check valid Y ranges)
          if (boardY >= 0 && currentBoard[boardY][boardX] !== null) {
            return true;
          }
        }
      }
    }
    return false;
  }, []);

  // Compute ghost piece Y position (shadow landing preview)
  const getGhostY = useCallback((piece: Tetromino, currentBoard: Board): number => {
    let ghostY = piece.position.y;
    while (!checkCollision(piece.matrix, { x: piece.position.x, y: ghostY + 1 }, currentBoard)) {
      ghostY++;
    }
    return ghostY;
  }, [checkCollision]);

  // Start/restart the game
  const startGame = () => {
    setBoard(createEmptyBoard());
    const firstPiece = getRandomTetromino();
    const queue = [getRandomTetromino(), getRandomTetromino(), getRandomTetromino(), getRandomTetromino()];
    setCurrentPiece(firstPiece);
    setNextPieces(queue);
    setHeldPiece(null);
    setClearingRows([]);
    setScore(0);
    setLines(0);
    setHasNewHighScore(false);
    setIsSaved(false);
    setPlayerName('');
    setStatus('PLAYING');
    lockTimeRef.current = 0;
    lockResetsRef.current = 0;
    nextStepTimeRef.current = performance.now() + getFallSpeed(speedMode, 0);
    
    // Auto start music if enabled
    if (musicEnabled) {
      audioEngine.startMusic();
    }
  };

  // Toggle Sound Effects
  const toggleSound = () => {
    const newVal = audioEngine.toggleSoundEffects();
    setSoundEnabled(newVal);
  };

  // Toggle Music
  const toggleMusic = () => {
    const newVal = audioEngine.toggleMusic();
    setMusicEnabled(newVal);
    if (newVal && status === 'PLAYING') {
      audioEngine.startMusic();
    } else {
      audioEngine.stopMusic();
    }
  };

  // Toggle speed modes Regular > Fast > Extreme > Incremental
  const toggleSpeedMode = () => {
    const modes: SpeedMode[] = ['REGULAR', 'FAST', 'EXTREME', 'INCREMENTAL'];
    const nextIdx = (modes.indexOf(speedMode) + 1) % modes.length;
    const nextMode = modes[nextIdx];
    setSpeedMode(nextMode);
    window.localStorage.setItem('retroblocks_speed_mode', nextMode);
    audioEngine.playRotate();
    if (statusRef.current === 'PLAYING') {
      nextStepTimeRef.current = performance.now() + getFallSpeed(nextMode, lines);
    }
  };

  // Format key names nicely for displaying in UI
  const formatKeyName = (key: string): string => {
    if (!key) return '';
    if (key === ' ') return 'SPACE';
    if (key === 'ArrowLeft') return '←';
    if (key === 'ArrowRight') return '→';
    if (key === 'ArrowUp') return '↑';
    if (key === 'ArrowDown') return '↓';
    if (key.length === 1) return key.toUpperCase();
    return key.toUpperCase();
  };

  // Get nicely formatted label for key action
  const getActionLabel = (action: string): string => {
    if (action === 'rotateCW') return 'ROTATE CW';
    if (action === 'rotateCCW') return 'ROTATE CCW';
    return action.replace(/([A-Z])/g, ' $1').trim();
  };

  // Save High Score form submit
  const handleSaveScore = useCallback((e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const finalName = playerNameRef.current.trim() || 'PLAYER 1';
    saveHighScore(finalName, scoreRef.current, linesRef.current);
    setIsSaved(true);
    setStatus('MENU');
    setLeaderboardKey((prev) => prev + 1);
  }, []);

  // Move current piece left
  const moveLeft = useCallback(() => {
    if (statusRef.current !== 'PLAYING' || !currentPiece) return;
    const newPos = { ...currentPiece.position, x: currentPiece.position.x - 1 };
    if (!checkCollision(currentPiece.matrix, newPos, board)) {
      setCurrentPiece({ ...currentPiece, position: newPos });
      audioEngine.playMove();
      triggerLockDelayReset();
    }
  }, [currentPiece, board, checkCollision, triggerLockDelayReset]);

  // Move current piece right
  const moveRight = useCallback(() => {
    if (statusRef.current !== 'PLAYING' || !currentPiece) return;
    const newPos = { ...currentPiece.position, x: currentPiece.position.x + 1 };
    if (!checkCollision(currentPiece.matrix, newPos, board)) {
      setCurrentPiece({ ...currentPiece, position: newPos });
      audioEngine.playMove();
      triggerLockDelayReset();
    }
  }, [currentPiece, board, checkCollision, triggerLockDelayReset]);

  // Rotate current piece clockwise (with basic wall-kick fallback)
  const rotate = useCallback(() => {
    if (statusRef.current !== 'PLAYING' || !currentPiece) return;
    const rotatedMatrix = rotateMatrix(currentPiece.matrix);
    
    // Check if rotation fits. If not, try shifting left or right (wall kick)
    const kicks = [0, -1, 1, -2, 2];
    for (const offset of kicks) {
      const testPos = { ...currentPiece.position, x: currentPiece.position.x + offset };
      if (!checkCollision(rotatedMatrix, testPos, board)) {
        setCurrentPiece({
          ...currentPiece,
          matrix: rotatedMatrix,
          position: testPos,
        });
        audioEngine.playRotate();
        triggerLockDelayReset();
        return;
      }
    }
  }, [currentPiece, board, checkCollision, triggerLockDelayReset]);

  // Rotate current piece counter-clockwise (with basic wall-kick fallback)
  const rotateCCW = useCallback(() => {
    if (statusRef.current !== 'PLAYING' || !currentPiece) return;
    const rotatedMatrix = rotateMatrixCCW(currentPiece.matrix);
    
    // Check if rotation fits. If not, try shifting left or right (wall kick)
    const kicks = [0, -1, 1, -2, 2];
    for (const offset of kicks) {
      const testPos = { ...currentPiece.position, x: currentPiece.position.x + offset };
      if (!checkCollision(rotatedMatrix, testPos, board)) {
        setCurrentPiece({
          ...currentPiece,
          matrix: rotatedMatrix,
          position: testPos,
        });
        audioEngine.playRotate();
        triggerLockDelayReset();
        return;
      }
    }
  }, [currentPiece, board, checkCollision, triggerLockDelayReset]);

  // Hold current piece or swap with currently held piece
  const holdPiece = useCallback(() => {
    if (statusRef.current !== 'PLAYING' || !currentPiece) return;

    audioEngine.playRotate();
    const typeToHold = currentPiece.type;
    const targetPos = currentPiece.position;

    // Helper to find the closest non-colliding position relative to targetPos
    const getSwappedPosition = (newMatrix: number[][]): Point => {
      // First, try exact position
      if (!checkCollision(newMatrix, targetPos, board)) {
        return targetPos;
      }

      // Order of searches: nudge up/down/sides, up to 4 spaces up and 3 spaces horizontally
      const maxSearchY = 4;
      const maxSearchX = 3;

      for (let dy = 0; dy >= -maxSearchY; dy--) {
        for (let dx = 1; dx <= maxSearchX; dx++) {
          // Check left, then right
          const testLeft = { x: targetPos.x - dx, y: targetPos.y + dy };
          if (!checkCollision(newMatrix, testLeft, board)) {
            return testLeft;
          }
          const testRight = { x: targetPos.x + dx, y: targetPos.y + dy };
          if (!checkCollision(newMatrix, testRight, board)) {
            return testRight;
          }
        }
        // Check only vertical nudge for this dy
        const testY = { x: targetPos.x, y: targetPos.y + dy };
        if (dy !== 0 && !checkCollision(newMatrix, testY, board)) {
          return testY;
        }
      }

      // Fallback: If no close fit is found, default to the top-center to avoid getting stuck
      const defaultX = Math.floor((BOARD_WIDTH - newMatrix[0].length) / 2);
      const defaultY = newMatrix.length === 4 ? -1 : 0;
      return { x: defaultX, y: defaultY };
    };

    if (heldPiece === null) {
      // First hold of the game: current piece goes to hold box, nextPiece spawns
      if (nextPieces && nextPieces.length > 0) {
        const nextSpawn = nextPieces[0];
        const nextSpawnMatrix = nextSpawn.matrix;
        const validPos = getSwappedPosition(nextSpawnMatrix);
        
        setCurrentPiece({
          ...nextSpawn,
          position: validPos
        });
        setNextPieces((prev) => [...prev.slice(1), getRandomTetromino()]);
      }
    } else {
      // Swap with currently held piece
      const { matrix, color } = TETROMINOS[heldPiece];
      const copiedMatrix = JSON.parse(JSON.stringify(matrix));
      const validPos = getSwappedPosition(copiedMatrix);

      setCurrentPiece({
        type: heldPiece,
        matrix: copiedMatrix,
        color,
        position: validPos
      });
    }

    setHeldPiece(typeToHold);
    triggerLockDelayReset();
  }, [currentPiece, heldPiece, nextPieces, triggerLockDelayReset, board, checkCollision]);

  // Merge the active piece into the solid board grid
  const mergePieceToBoard = useCallback((piece: Tetromino, currentBoard: Board) => {
    const updatedBoard = currentBoard.map((row) => [...row]);
    let gameIsOver = false;

    for (let r = 0; r < piece.matrix.length; r++) {
      for (let c = 0; c < piece.matrix[r].length; c++) {
        if (piece.matrix[r][c] !== 0) {
          const boardY = piece.position.y + r;
          const boardX = piece.position.x + c;

          if (boardY < 0) {
            // Piece locked above the board boundary
            gameIsOver = true;
          } else {
            updatedBoard[boardY][boardX] = piece.color;
          }
        }
      }
    }

    if (gameIsOver) {
      setStatus('GAME_OVER');
      audioEngine.playGameOver();
      if (musicInGameOnly) {
        audioEngine.stopMusic();
      }
      const isHighScore = checkIsHighScore(score);
      setHasNewHighScore(isHighScore);
      return;
    }

    // Identify rows that are fully cleared
    const fullRowIndices: number[] = [];
    for (let r = 0; r < BOARD_HEIGHT; r++) {
      if (updatedBoard[r].every((cell) => cell !== null)) {
        fullRowIndices.push(r);
      }
    }

    const rowsCleared = fullRowIndices.length;

    if (rowsCleared > 0) {
      // Set the clearingRows so they draw in white/flashing
      setClearingRows(fullRowIndices);
      audioEngine.playLineClear(rowsCleared);
      
      // Calculate score points immediately
      const pointValues = [0, 100, 300, 500, 800]; // 1, 2, 3, 4 lines (RetroBlocks!)
      const points = pointValues[rowsCleared] || 1000;
      setScore((prev) => prev + points);
      setLines((prev) => prev + rowsCleared);

      // Hide the current active piece during the animation
      setCurrentPiece(null);

      // Timeout for line clear animation: 200ms is perfect (brief retro flash)
      setTimeout(() => {
        // Filter the rows
        const filteredBoard = updatedBoard.filter((_, idx) => !fullRowIndices.includes(idx));
        while (filteredBoard.length < BOARD_HEIGHT) {
          filteredBoard.unshift(Array(BOARD_WIDTH).fill(null));
        }
        setBoard(filteredBoard);
        setClearingRows([]);

        // Swap in the next piece and reset turn parameters
        if (nextPieces.length > 0) {
          const spawnPiece = nextPieces[0];
          if (checkCollision(spawnPiece.matrix, spawnPiece.position, filteredBoard)) {
            setStatus('GAME_OVER');
            audioEngine.playGameOver();
            if (musicInGameOnly) {
              audioEngine.stopMusic();
            }
            setHasNewHighScore(checkIsHighScore(score + points));
          } else {
            setCurrentPiece(spawnPiece);
            setNextPieces((prev) => [...prev.slice(1), getRandomTetromino()]);
          }
        }
        
        // Reset step timer
        nextStepTimeRef.current = performance.now() + getFallSpeed(speedMode, lines + rowsCleared);
      }, 200);

    } else {
      // Normal non-clearing lock
      audioEngine.playDrop();
      setBoard(updatedBoard);

      if (nextPieces.length > 0) {
        const spawnPiece = nextPieces[0];
        if (checkCollision(spawnPiece.matrix, spawnPiece.position, updatedBoard)) {
          setStatus('GAME_OVER');
          audioEngine.playGameOver();
          if (musicInGameOnly) {
            audioEngine.stopMusic();
          }
          setHasNewHighScore(checkIsHighScore(score));
        } else {
          setCurrentPiece(spawnPiece);
          setNextPieces((prev) => [...prev.slice(1), getRandomTetromino()]);
        }
      }
      nextStepTimeRef.current = performance.now() + getFallSpeed(speedMode, lines);
    }
  }, [nextPieces, score, lines, speedMode, checkCollision]);

  // Soft drop (moves down one square, scores 1 point)
  const moveDown = useCallback(() => {
    if (statusRef.current !== 'PLAYING' || !currentPiece) return;
    const newPos = { ...currentPiece.position, y: currentPiece.position.y + 1 };
    
    if (!checkCollision(currentPiece.matrix, newPos, board)) {
      setCurrentPiece({ ...currentPiece, position: newPos });
      setScore((prev) => prev + 1);
    }
  }, [currentPiece, board, checkCollision]);

  // Hard drop (instantly drop to bottom, score 2 points per block dropped)
  const hardDrop = useCallback(() => {
    if (statusRef.current !== 'PLAYING' || !currentPiece) return;
    
    const now = performance.now();
    if (now - lastHardDropTimeRef.current < 500) {
      return; // 0.5 second delay between repetitive hard drops
    }
    lastHardDropTimeRef.current = now;

    const finalY = getGhostY(currentPiece, board);
    const dropDistance = finalY - currentPiece.position.y;
    
    const finalPiece = {
      ...currentPiece,
      position: { ...currentPiece.position, y: finalY },
    };

    setScore((prev) => prev + (dropDistance * 2));
    mergePieceToBoard(finalPiece, board);
  }, [currentPiece, board, mergePieceToBoard, getGhostY]);

  // Toggle Pause Game
  const togglePause = useCallback(() => {
    const now = performance.now();
    if (now - lastPauseToggleTimeRef.current < 500) {
      return; // 0.5 second cooldown between pause toggles
    }
    lastPauseToggleTimeRef.current = now;

    if (status === 'PLAYING') {
      setStatus('PAUSED');
      if (musicInGameOnly) {
        audioEngine.stopMusic();
      }
    } else if (status === 'PAUSED') {
      setStatus('PLAYING');
      nextStepTimeRef.current = performance.now() + getFallSpeed(speedMode, lines);
      if (musicEnabled) {
        audioEngine.startMusic();
      }
    }
  }, [status, musicEnabled, speedMode, lines]);

  const clearTouchInterval = useCallback(() => {
    if (swipeHoldIntervalRef.current) {
      clearInterval(swipeHoldIntervalRef.current);
      swipeHoldIntervalRef.current = null;
    }
  }, []);

  // Clean touch intervals on unmount
  useEffect(() => {
    return () => {
      if (swipeHoldIntervalRef.current) {
        clearInterval(swipeHoldIntervalRef.current);
      }
    };
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (statusRef.current !== 'PLAYING') return;

    const touch = e.touches[0];
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();

    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    touchStartTimeRef.current = Date.now();
    isSwipingRef.current = false;
    hasTriggeredSwipeRef.current = false;
    hasTriggeredHardDropRef.current = false;

    clearTouchInterval();
  }, [clearTouchInterval]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (statusRef.current !== 'PLAYING') return;
    if (hasTriggeredHardDropRef.current) return;

    const touch = e.touches[0];
    const dx = touch.clientX - touchStartXRef.current;
    const dy = touch.clientY - touchStartYRef.current;

    // Prevent scrolling or bouncing when interacting on the board
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      if (e.cancelable) {
        e.preventDefault();
      }
    }

    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Declaring a swipe if displacement exceeds 20px
    if (!isSwipingRef.current && (absDx > 20 || absDy > 20)) {
      isSwipingRef.current = true;
    }

    if (isSwipingRef.current) {
      if (absDx > absDy) {
        // Horizontal Swipe
        if (!hasTriggeredSwipeRef.current) {
          hasTriggeredSwipeRef.current = true;
          const direction = dx > 0 ? 'right' : 'left';
          
          if (direction === 'left') {
            moveLeftRef.current();
            clearTouchInterval();
            swipeHoldIntervalRef.current = setInterval(() => {
              if (statusRef.current === 'PLAYING') {
                moveLeftRef.current();
              }
            }, 180);
          } else {
            moveRightRef.current();
            clearTouchInterval();
            swipeHoldIntervalRef.current = setInterval(() => {
              if (statusRef.current === 'PLAYING') {
                moveRightRef.current();
              }
            }, 180);
          }
        }
      } else {
        // Vertical Swipe
        if (dy > 0) {
          if (dy >= 120) {
            // Long swipe down: Hard Drop!
            clearTouchInterval();
            hardDropRef.current();
            hasTriggeredHardDropRef.current = true;
          } else if (dy > 25 && !hasTriggeredSwipeRef.current) {
            // Small swipe down and hold: continuously moves down
            hasTriggeredSwipeRef.current = true;
            moveDownRef.current();
            clearTouchInterval();
            swipeHoldIntervalRef.current = setInterval(() => {
              if (statusRef.current === 'PLAYING') {
                moveDownRef.current();
              }
            }, 100);
          }
        }
      }
    }
  }, [clearTouchInterval]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    clearTouchInterval();

    if (statusRef.current !== 'PLAYING') return;
    if (hasTriggeredHardDropRef.current) return;

    if (!isSwipingRef.current) {
      const container = e.currentTarget;
      const rect = container.getBoundingClientRect();
      const relativeX = (touchStartXRef.current - rect.left) / rect.width;
      const relativeY = (touchStartYRef.current - rect.top) / rect.height;

      if (relativeX >= 0 && relativeX <= 1 && relativeY >= 0 && relativeY <= 1) {
        // 1. Tapping top 1/8 pauses game
        if (relativeY < 0.125) {
          togglePauseRef.current();
          return;
        }

        // 2. Tapping close to edges (1/8 of width) moves block in that direction
        if (relativeX < 0.125) {
          moveLeftRef.current();
        } else if (relativeX > 0.875) {
          moveRightRef.current();
        } else {
          // 3. Single tapping middle (3/4 of width) rotates piece CW
          rotateRef.current();
        }
      }
    }
  }, [clearTouchInterval]);

  const handleTouchCancel = useCallback(() => {
    clearTouchInterval();
  }, [clearTouchInterval]);

  // Keyboard controls listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If we are currently rebinding a key, intercept and bind it!
      if (listeningAction) {
        e.preventDefault();
        const { action, index } = listeningAction;
        setKeybindings((prev) => {
          const updatedVal = [...prev[action]] as [string, string];
          updatedVal[index] = e.key;
          const updated = { ...prev, [action]: updatedVal };
          window.localStorage.setItem('retroblocks_keybindings', JSON.stringify(updated));
          return updated;
        });
        setListeningAction(null);
        audioEngine.playRotate();
        return;
      }

      const key = e.key.toLowerCase();
      const isAction = (action: keyof Keybindings) => {
        const [p, s] = keybindings[action];
        return key === p.toLowerCase() || key === s.toLowerCase();
      };

      // If game is paused or menu/game over, standard navigation keys
      if (statusRef.current !== 'PLAYING') {
        const isInputFocused = document.activeElement?.tagName === 'INPUT';
        if (isInputFocused) {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSaveScore();
          }
          return;
        }

        if (e.key === ' ' || e.key === 'Enter') {
          if (statusRef.current === 'MENU') {
            startGame();
            return;
          } else if (statusRef.current === 'GAME_OVER') {
            if (hasNewHighScoreRef.current && !isSavedRef.current) {
              e.preventDefault();
              handleSaveScore();
              return;
            } else {
              startGame();
              return;
            }
          } else if (statusRef.current === 'PAUSED' && e.key === 'Enter') {
            togglePause();
            return;
          }
        }
        if (statusRef.current === 'PAUSED' && (isAction('pause') || e.key === 'Escape')) {
          e.preventDefault();
          togglePause();
          return;
        }
        return;
      }

      if (isAction('moveLeft')) {
        e.preventDefault();
        if (!keysPressedRef.current.left) {
          keysPressedRef.current.left = true;
          moveLeft();
          lastMoveTimeRef.current.left = performance.now() + 170; // DAS Delay
        }
      } else if (isAction('moveRight')) {
        e.preventDefault();
        if (!keysPressedRef.current.right) {
          keysPressedRef.current.right = true;
          moveRight();
          lastMoveTimeRef.current.right = performance.now() + 170; // DAS Delay
        }
      } else if (isAction('softDrop')) {
        e.preventDefault();
        if (!keysPressedRef.current.down) {
          keysPressedRef.current.down = true;
          moveDown();
          lastMoveTimeRef.current.down = performance.now() + 35; // Snappy soft drop
        }
      } else if (isAction('rotateCW')) {
        e.preventDefault();
        rotate();
      } else if (isAction('rotateCCW')) {
        e.preventDefault();
        rotateCCW();
      } else if (isAction('hardDrop')) {
        e.preventDefault();
        hardDrop();
      } else if (isAction('hold')) {
        e.preventDefault();
        holdPiece();
      } else if (isAction('pause') || e.key === 'Escape') {
        e.preventDefault();
        togglePause();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const isAction = (action: keyof Keybindings) => {
        const [p, s] = keybindings[action];
        return key === p.toLowerCase() || key === s.toLowerCase();
      };

      if (isAction('moveLeft')) {
        keysPressedRef.current.left = false;
      } else if (isAction('moveRight')) {
        keysPressedRef.current.right = false;
      } else if (isAction('softDrop')) {
        keysPressedRef.current.down = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [moveLeft, moveRight, rotate, rotateCCW, moveDown, hardDrop, holdPiece, togglePause, keybindings, listeningAction, handleSaveScore]);

  // Responsive game loop tick with DAS/ARR and lock delay support
  useEffect(() => {
    let animationFrameId: number;

    const gameLoop = (time: number) => {
      if (statusRef.current === 'PLAYING') {
        const now = performance.now();
        const piece = currentPieceRef.current;
        const currentBoard = boardRef.current;

        if (piece) {
          const isGrounded = checkCollision(
            piece.matrix,
            { x: piece.position.x, y: piece.position.y + 1 },
            currentBoard
          );

          if (isGrounded) {
            if (lockTimeRef.current === 0) {
              // First time touching ground, start lock delay
              lockTimeRef.current = now + 500;
              lockResetsRef.current = 0;
            } else if (now >= lockTimeRef.current) {
              // Lock delay expired, lock the piece!
              mergePieceToBoard(piece, currentBoard);
              lockTimeRef.current = 0;
              lockResetsRef.current = 0;
            }
          } else {
            lockTimeRef.current = 0;
            lockResetsRef.current = 0;
          }

          // 1. Gravity step (only if NOT grounded)
          if (!isGrounded && now >= nextStepTimeRef.current) {
            moveDown();
            nextStepTimeRef.current = now + getFallSpeed(speedMode, linesRef.current);
          } else if (isGrounded) {
            // Push gravity timer forward so it doesn't queue ticks during lock delay
            nextStepTimeRef.current = now + getFallSpeed(speedMode, linesRef.current);
          }
        }

        // 2. DAS Left slide step
        if (keysPressedRef.current.left) {
          if (now >= lastMoveTimeRef.current.left) {
            moveLeft();
            lastMoveTimeRef.current.left = now + 40; // ARR Repeat rate
          }
        }

        // 3. DAS Right slide step
        if (keysPressedRef.current.right) {
          if (now >= lastMoveTimeRef.current.right) {
            moveRight();
            lastMoveTimeRef.current.right = now + 40; // ARR Repeat rate
          }
        }

        // 4. Soft drop continuous step
        if (keysPressedRef.current.down) {
          if (now >= lastMoveTimeRef.current.down) {
            moveDown();
            lastMoveTimeRef.current.down = now + 35; // Soft drop repeat rate
          }
        }
      }
      animationFrameId = requestAnimationFrame(gameLoop);
    };

    animationFrameId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [moveDown, moveLeft, moveRight, speedMode, mergePieceToBoard, checkCollision]);

  // Clean audio music loops on unmount
  useEffect(() => {
    return () => {
      audioEngine.stopMusic();
    };
  }, []);

  // Synchronize background music playing/stopping state based on user settings and game status
  useEffect(() => {
    if (musicEnabled) {
      if (musicInGameOnly) {
        if (status === 'PLAYING') {
          audioEngine.startMusic();
        } else {
          audioEngine.stopMusic();
        }
      } else {
        audioEngine.startMusic();
      }
    } else {
      audioEngine.stopMusic();
    }
  }, [musicEnabled, musicInGameOnly, status]);

  return (
    <div className="w-full min-h-screen bg-[#050505] text-white font-retro flex flex-col items-center justify-between p-4 md:p-8 relative scanlines overflow-x-hidden select-none">
      {/* Subtle CRT screen glow */}
      <div className="absolute inset-0 bg-radial-gradient from-zinc-900/40 via-zinc-950 to-black pointer-events-none z-0" />

      {/* Header controls bar */}
      <header className="w-full max-w-5xl flex flex-col md:flex-row md:items-end justify-between border-b-4 border-slate-800 pb-4 mb-6 z-30 gap-4">
        <div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tighter text-blue-500 uppercase">RetroBlocks</h1>
          <p className="text-[10px] text-slate-500 tracking-[0.25em] uppercase mt-1">Block-falling puzzle game // v1.0.1</p>
        </div>
        
        <div className="flex flex-wrap items-end gap-6">
          {/* Audio controls and settings */}
          <div className="flex items-center gap-3 pb-0.5">
            {/* SFX Control with Hover Slider */}
            <div className="relative group flex items-center">
              <button
                onClick={toggleSound}
                className={`p-1.5 md:p-2 border-2 rounded-lg transition-colors cursor-pointer ${
                  soundEnabled
                    ? 'bg-blue-950/40 border-blue-500 text-blue-400 shadow-[inset_0_0_10px_rgba(59,130,246,0.3)]'
                    : 'bg-black border-slate-800 text-slate-500'
                }`}
                title="Toggle SFX (Hover to adjust)"
              >
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              
              {/* SFX Slider Tooltip */}
              <div className="absolute top-[85%] left-1/2 -translate-x-1/2 pt-4 flex flex-col items-center opacity-0 scale-90 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 z-50 w-20">
                <div className="bg-slate-950 border-2 border-slate-800 p-3 rounded-lg flex flex-col items-center gap-2 shadow-[0_10px_30px_rgba(0,0,0,0.8)] w-full">
                  <span className="text-[7px] font-bold text-blue-400 tracking-wider">SFX VOL</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={sfxVolume}
                    onChange={(e) => {
                      const vol = parseFloat(e.target.value);
                      setSfxVolumeState(vol);
                      audioEngine.setSFXVolume(vol);
                      if (vol > 0 && !soundEnabled) {
                        toggleSound();
                      }
                    }}
                    style={{
                      WebkitAppearance: 'slider-vertical' as any,
                      height: '60px',
                      width: '16px',
                    }}
                    className="accent-blue-500 bg-slate-850 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-[9px] font-mono font-bold text-slate-400">{Math.round(sfxVolume * 100)}%</span>
                </div>
              </div>
            </div>

            {/* Music Control with Hover Slider */}
            <div className="relative group flex items-center">
              <button
                onClick={toggleMusic}
                className={`p-1.5 md:p-2 border-2 rounded-lg transition-colors cursor-pointer ${
                  musicEnabled
                    ? 'bg-purple-950/40 border-purple-500 text-purple-400 shadow-[inset_0_0_10px_rgba(168,85,247,0.3)]'
                    : 'bg-black border-slate-800 text-slate-500'
                }`}
                title="Toggle Music (Hover to adjust)"
              >
                {musicEnabled ? <Music className="w-4 h-4" /> : <Music4 className="w-4 h-4" />}
              </button>

              {/* Music Slider Tooltip */}
              <div className="absolute top-[85%] left-1/2 -translate-x-1/2 pt-4 flex flex-col items-center opacity-0 scale-90 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto transition-all duration-200 z-50 w-20">
                <div className="bg-slate-950 border-2 border-slate-800 p-3 rounded-lg flex flex-col items-center gap-2 shadow-[0_10px_30px_rgba(0,0,0,0.8)] w-full">
                  <span className="text-[7px] font-bold text-purple-400 tracking-wider font-sans">BGM VOL</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={musicVolume}
                    onChange={(e) => {
                      const vol = parseFloat(e.target.value);
                      setMusicVolumeState(vol);
                      audioEngine.setMusicVolume(vol);
                      if (vol > 0 && !musicEnabled) {
                        toggleMusic();
                      }
                    }}
                    style={{
                      WebkitAppearance: 'slider-vertical' as any,
                      height: '60px',
                      width: '16px',
                    }}
                    className="accent-purple-500 bg-slate-850 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-[9px] font-mono font-bold text-slate-400">{Math.round(musicVolume * 100)}%</span>
                </div>
              </div>
            </div>

            {/* Full Settings Gear Button */}
            <button
              onClick={() => {
                audioEngine.playRotate();
                setSettingsOpen(true);
              }}
              className="p-1.5 md:p-2 border-2 border-slate-800 hover:border-slate-500 bg-black text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              title="Open Settings & Keybindings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <main className="w-full max-w-5xl flex-1 flex flex-col md:grid md:grid-cols-12 gap-4 md:gap-6 items-start z-10 mb-2 md:mb-4">
        
        {/* LEFT COLUMN: PREVIEWS & LEADERBOARD */}
        <div className="w-full md:col-span-4 flex flex-col gap-4 md:gap-6">
          
          {/* RESPONSIVE PREVIEWS GRID */}
          <div className="grid grid-cols-2 md:grid-cols-1 gap-3 md:gap-4">
            {/* HOLD PIECE PREVIEW */}
            <div className="bg-slate-900/50 border-2 border-slate-800 p-4 rounded-xl flex flex-col items-center justify-center min-h-[140px] shadow-lg relative overflow-hidden">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3">Hold Piece</p>
              {heldPiece ? (
                <div className="grid gap-0.5 bg-black/40 p-2 rounded-lg border border-slate-800/80 scale-90 origin-center">
                  {TETROMINOS[heldPiece].matrix.map((row, r) => (
                    <div key={r} className="flex gap-0.5">
                      {row.map((cell, c) => (
                        <div
                          key={c}
                          className={`w-3.5 h-3.5 border ${
                            cell
                              ? 'border-white/10'
                              : 'border-transparent'
                          }`}
                          style={{
                            backgroundColor: cell ? TETROMINOS[heldPiece].color : 'transparent',
                            boxShadow: cell ? 'inset 0 0 4px rgba(0,0,0,0.5)' : 'none'
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-600 text-center uppercase tracking-wider text-[9px] font-bold border border-dashed border-slate-800 p-3 rounded-lg">
                  EMPTY [X]
                </div>
              )}
            </div>

            {/* NEXT PIECE PREVIEW */}
            <div
              style={{
                height: previewCount === 0 ? '110px' : previewCount === 1 ? '140px' : previewCount === 2 ? '220px' : '300px'
              }}
              className="bg-slate-900/50 border-2 border-slate-800 p-4 rounded-xl flex flex-col items-center justify-center shadow-lg relative overflow-hidden transition-all duration-300"
            >
              <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3">Next Pieces</p>
              {previewCount > 0 ? (
                nextPieces.length > 0 ? (
                  <div className="flex flex-col gap-3 items-center justify-center w-full relative overflow-hidden">
                    {nextPieces.slice(0, previewCount).map((piece, pIdx) => (
                      <div key={piece.id || pIdx} className="h-16 flex items-center justify-center">
                        <motion.div
                          layout
                          transition={{
                            type: 'spring',
                            stiffness: 280,
                            damping: 25
                          }}
                          className="grid gap-0.5 bg-black/40 p-2 rounded-lg border border-slate-800/80 scale-90 origin-center"
                        >
                          {piece.matrix.map((row, r) => (
                            <div key={r} className="flex gap-0.5">
                              {row.map((cell, c) => (
                                <div
                                  key={c}
                                  className={`w-3.5 h-3.5 border ${
                                    cell
                                      ? 'border-white/10'
                                      : 'border-transparent'
                                  }`}
                                  style={{
                                    backgroundColor: cell ? piece.color : 'transparent',
                                    boxShadow: cell ? 'inset 0 0 4px rgba(0,0,0,0.5)' : 'none'
                                  }}
                                />
                              ))}
                            </div>
                          ))}
                        </motion.div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-slate-600 text-[10px] border border-dashed border-slate-800 p-4 rounded-lg text-center uppercase tracking-wider font-bold">
                    EMPTY
                  </div>
                )
              ) : (
                <div className="text-slate-500 text-[9px] border border-dashed border-slate-800 p-4 rounded-lg text-center uppercase tracking-wider font-bold">
                  PREVIEWS OFF
                </div>
              )}
            </div>
          </div>

          {/* LEADERBOARD VIEW */}
          <div className="hidden md:block">
            <Leaderboard key={leaderboardKey} />
          </div>
        </div>

        {/* CENTER COLUMN: THE MAIN BOARD */}
        <div className="w-full md:col-span-5 flex flex-col items-center justify-center">
          
          <div 
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
            className="relative border-4 border-slate-800 bg-[#0a0a0a] rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.8)] overflow-hidden touch-none"
          >
            {/* Play overlay / Pause overlay / Game over screen */}
            {status === 'MENU' && (
              <div className="absolute inset-0 bg-slate-950/95 z-30 flex flex-col items-center justify-center p-6 text-center">
                <button
                  onClick={startGame}
                  className="w-16 h-16 bg-blue-600 hover:bg-blue-500 rounded-full flex items-center justify-center mb-4 border-4 border-black glow-pulse cursor-pointer transition-transform hover:scale-105 active:scale-95"
                >
                  <Play className="w-8 h-8 text-white ml-1" />
                </button>
                <h2 className="text-lg text-blue-400 mb-2 tracking-widest font-black">
                  READY PLAYER ONE
                </h2>
                <p className="text-[10px] text-slate-400 max-w-xs mb-6 leading-relaxed font-sans">
                  A pure, constant-speed retro drop challenge. Slide, rotate, and clear lines.
                </p>
                <button
                  onClick={startGame}
                  className="px-6 py-3 bg-blue-500 hover:bg-blue-400 text-black border-2 border-white rounded-md font-bold tracking-widest text-xs uppercase cursor-pointer transition-all duration-200 active:scale-95 shadow-[0_4px_0_#1d4ed8] w-full max-w-[200px]"
                >
                  START GAME
                </button>
                <button
                  onClick={() => {
                    audioEngine.playRotate();
                    setSettingsOpen(true);
                  }}
                  className="mt-3 px-6 py-2.5 bg-slate-900 hover:bg-slate-850 border border-slate-700 text-slate-300 font-bold tracking-widest text-[10px] uppercase rounded-md transition-all duration-150 active:scale-95 cursor-pointer w-full max-w-[200px]"
                >
                  SETTINGS & KEYS
                </button>
              </div>
            )}

            {status === 'PAUSED' && (
              <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-30 flex flex-col items-center justify-center gap-3">
                <h2 className="text-xl text-yellow-500 tracking-widest font-black mb-1">
                  GAME PAUSED
                </h2>
                <button
                  onClick={togglePause}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded font-bold text-[10px] tracking-wider uppercase cursor-pointer w-full max-w-[160px]"
                >
                  RESUME GAME
                </button>
                <button
                  onClick={() => setStatus('MENU')}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-850 text-slate-400 border border-slate-800 rounded font-bold text-[9px] tracking-wider uppercase cursor-pointer w-full max-w-[160px]"
                >
                  MAIN MENU
                </button>
              </div>
            )}

            {status === 'GAME_OVER' && (
              <div className="absolute inset-0 bg-slate-950/95 z-30 flex flex-col items-center justify-center p-6 text-center">
                <h2 className="text-lg text-red-500 tracking-widest font-black mb-2">
                  GAME OVER
                </h2>
                <div className="mb-4">
                  <span className="text-[9px] text-slate-500 uppercase block mb-1">
                    FINAL SCORE
                  </span>
                  <span className="text-2xl text-yellow-400 font-bold font-mono">
                    {score.toLocaleString()}
                  </span>
                </div>

                {hasNewHighScore && !isSaved ? (
                  <form onSubmit={handleSaveScore} className="w-full max-w-xs space-y-3 bg-slate-900 p-4 rounded border border-slate-800">
                    <div className="flex items-center gap-1 text-yellow-500 text-[10px] justify-center">
                      <Award className="w-4 h-4" />
                      NEW HIGH SCORE!
                    </div>
                    <input
                      type="text"
                      maxLength={10}
                      placeholder="ENTER NAME"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value.toUpperCase())}
                      className="w-full text-center px-3 py-2 bg-black border-2 border-slate-700 text-white rounded text-xs tracking-widest font-mono uppercase focus:border-blue-400 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="w-full py-2 bg-blue-500 hover:bg-blue-400 text-white font-bold tracking-widest text-[10px] uppercase rounded"
                    >
                      SUBMIT SCORE
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSaved(true)}
                      className="w-full py-1.5 text-[9px] text-slate-500 hover:text-slate-300 font-bold tracking-widest uppercase transition-colors"
                    >
                      Skip
                    </button>
                  </form>
                ) : (
                  <div className="space-y-3 w-full max-w-xs">
                    <button
                      onClick={startGame}
                      className="w-full py-3 bg-blue-500 hover:bg-blue-400 text-black border border-white font-bold tracking-widest text-[10px] uppercase rounded flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-3 h-3" /> PLAY AGAIN
                    </button>
                    <button
                      onClick={() => setStatus('MENU')}
                      className="w-full py-2.5 bg-slate-900 hover:bg-slate-850 text-slate-400 border border-slate-800 font-bold tracking-widest text-[9px] uppercase rounded"
                    >
                      MAIN MENU
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* THE RETROBLOCKS BOARD CANVAS GRID */}
            <div className="grid grid-cols-10 gap-[1px] bg-slate-900 p-1 select-none">
              {board.map((row, r) =>
                row.map((cellColor, c) => {
                  // Determine if the cell has active piece falling
                  let blockColor: string | null = cellColor;
                  let isGhost = false;

                  if (status === 'PLAYING' && currentPiece) {
                    const pieceY = currentPiece.position.y;
                    const pieceX = currentPiece.position.x;
                    const pr = r - pieceY;
                    const pc = c - pieceX;

                    // Active Falling Piece
                    if (
                      pr >= 0 &&
                      pr < currentPiece.matrix.length &&
                      pc >= 0 &&
                      pc < currentPiece.matrix[pr].length &&
                      currentPiece.matrix[pr][pc] !== 0
                    ) {
                      blockColor = currentPiece.color;
                    } else {
                      // Ghost Landing Guide
                      const ghostY = getGhostY(currentPiece, board);
                      const gpr = r - ghostY;
                      if (
                        gpr >= 0 &&
                        gpr < currentPiece.matrix.length &&
                        pc >= 0 &&
                        pc < currentPiece.matrix[gpr].length &&
                        currentPiece.matrix[gpr][pc] !== 0
                      ) {
                        blockColor = currentPiece.color;
                        isGhost = true;
                      }
                    }
                  }

                  const isClearing = clearingRows.includes(r);

                  return (
                    <div
                      key={`${r}-${c}`}
                      className={`w-6 h-6 md:w-[28px] md:h-[28px] relative border transition-all duration-75 select-none ${isClearing ? 'animate-pulse' : ''}`}
                      style={{
                        backgroundColor: isClearing
                          ? '#ffffff'
                          : blockColor
                          ? isGhost
                            ? 'transparent'
                            : blockColor
                          : '#0a0a0a',
                        borderColor: isClearing
                          ? '#ffffff'
                          : blockColor
                          ? isGhost
                            ? `${blockColor}40` // Semi-transparent ghost border
                            : 'rgba(255, 255, 255, 0.15)'
                          : '#111827',
                        boxShadow: isClearing
                          ? '0 0 15px #ffffff, inset 0 0 8px rgba(59,130,246,0.8)'
                          : 'none',
                      }}
                    >
                      {/* Sub-pixels or retro block inner bezel */}
                      {blockColor && !isGhost && !isClearing && (
                        <>
                          {/* Highlight */}
                          <div className="absolute top-0.5 left-0.5 right-0.5 h-1 bg-white/20" />
                          {/* Shadow */}
                          <div className="absolute bottom-0.5 left-0.5 right-0.5 h-1 bg-black/30" />
                        </>
                      )}
                      {isGhost && blockColor && !isClearing && (
                        <div
                          className="absolute inset-[3px] border border-dashed rounded-sm"
                          style={{ borderColor: `${blockColor}70` }}
                        />
                      )}
                      {isClearing && (
                        <div className="absolute inset-0 bg-yellow-400/30 animate-ping" />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: STATS & CONTROLS */}
        <div className="hidden md:flex w-full md:col-span-3 flex-col gap-6">
          
          {/* Stats Card */}
          <div className="hidden md:flex bg-slate-900/50 border-2 border-slate-800 p-4 rounded-xl flex-col gap-3.5 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">SCORE</span>
              <span className="text-xl font-bold text-yellow-400 font-mono tracking-wide">{score.toLocaleString().padStart(6, '0')}</span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">LINES</span>
              <span className="text-xl font-bold text-white font-mono tracking-wide">{String(lines).padStart(3, '0')}</span>
            </div>
            <button
              onClick={toggleSpeedMode}
              className="flex items-center justify-between hover:bg-slate-800/40 p-1.5 -mx-1.5 rounded-lg transition-all text-left w-full border border-transparent hover:border-slate-800 group cursor-pointer"
              title="Click to cycle fall speed mode"
            >
              <span className="text-[10px] text-slate-400 font-bold group-hover:text-blue-400 transition-colors">SPEED MODE</span>
              <span className="text-[10px] font-bold text-blue-400 bg-blue-950/60 border border-blue-900/50 px-2 py-0.5 rounded uppercase flex items-center gap-1">
                {speedMode === 'INCREMENTAL' ? `INC [${getIncrementalMultiplierString(lines)}]` : speedMode} <Sliders className="w-2.5 h-2.5 ml-1" />
              </span>
            </button>
          </div>

          {/* Controls Card */}
          <div className="hidden md:block bg-slate-900/50 border-2 border-slate-800 p-4 rounded-xl">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-3">Controls</p>
            <div className="grid grid-cols-2 gap-y-2 text-[10px] text-slate-400 font-sans">
              <div className="font-bold text-white font-mono">
                {formatKeyName(keybindings.moveLeft[0])} / {formatKeyName(keybindings.moveRight[0])} <span className="text-slate-600 font-normal">or</span> {formatKeyName(keybindings.moveLeft[1]).toUpperCase()} / {formatKeyName(keybindings.moveRight[1]).toUpperCase()}
              </div>
              <div>Move Piece</div>
              
              <div className="font-bold text-white font-mono">
                {formatKeyName(keybindings.rotateCW[0])} <span className="text-slate-600 font-normal">or</span> {formatKeyName(keybindings.rotateCW[1]).toUpperCase()}
              </div>
              <div>Rotate CW</div>
              
              <div className="font-bold text-white font-mono">
                {formatKeyName(keybindings.rotateCCW[0])} <span className="text-slate-600 font-normal">or</span> {formatKeyName(keybindings.rotateCCW[1]).toUpperCase()}
              </div>
              <div>Rotate CCW</div>
              
              <div className="font-bold text-white font-mono">
                {formatKeyName(keybindings.softDrop[0])} <span className="text-slate-600 font-normal">or</span> {formatKeyName(keybindings.softDrop[1]).toUpperCase()}
              </div>
              <div>Soft Drop</div>
              
              <div className="font-bold text-white font-mono">
                {formatKeyName(keybindings.hardDrop[0]) || 'SPACE'} <span className="text-slate-600 font-normal">or</span> {formatKeyName(keybindings.hardDrop[1]) || 'SPACE'}
              </div>
              <div className="text-blue-400 font-bold">Hard Drop</div>
              
              <div className="font-bold text-white font-mono">
                {formatKeyName(keybindings.hold[0])} <span className="text-slate-600 font-normal">or</span> {formatKeyName(keybindings.hold[1]).toUpperCase()}
              </div>
              <div>Hold Piece</div>
              
              <div className="font-bold text-white font-mono">
                {formatKeyName(keybindings.pause[0])} <span className="text-slate-600 font-normal">or</span> {formatKeyName(keybindings.pause[1]).toUpperCase()}
              </div>
              <div>Pause Game</div>
            </div>
          </div>
        </div>
      </main>

      {/* MOBILE CONTROLLER ROW (Visible on mobile screens) */}
      <OnScreenControls
        onMoveLeft={moveLeft}
        onMoveRight={moveRight}
        onRotate={rotate}
        onRotateCCW={rotateCCW}
        onHold={holdPiece}
        onSoftDrop={moveDown}
        onHardDrop={hardDrop}
        onTogglePause={togglePause}
        isPaused={status === 'PAUSED'}
      />

      {/* FULL SETTINGS MENU MODAL */}
      {settingsOpen && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-950 border-4 border-slate-800 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="border-b-2 border-slate-800 p-4 bg-slate-900/60 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-black text-blue-500 tracking-wider">SYSTEM CONFIGURATION</h3>
                <p className="text-[8px] text-slate-500 font-mono tracking-widest uppercase">Adjust sound, speed & mapping</p>
              </div>
              <button
                onClick={() => {
                  audioEngine.playRotate();
                  setSettingsOpen(false);
                }}
                className="p-1 border border-slate-800 hover:border-slate-500 hover:text-red-400 text-slate-400 rounded-md transition-colors cursor-pointer text-xs font-bold"
              >
                CLOSE [ESC]
              </button>
            </div>

            {/* Modal Contents */}
            <div className="p-5 flex-1 overflow-y-auto space-y-6 font-sans">
              
              {/* Speed Mode Selector */}
              <div className="space-y-2">
                <span className="text-[10px] text-slate-400 font-retro tracking-widest block uppercase font-bold">Fall Speed Dynamic Mode</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['REGULAR', 'FAST', 'EXTREME', 'INCREMENTAL'] as SpeedMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setSpeedMode(mode);
                        window.localStorage.setItem('retroblocks_speed_mode', mode);
                        audioEngine.playRotate();
                      }}
                      className={`py-2 px-1 text-[9px] font-retro font-bold border-2 rounded-lg transition-all cursor-pointer ${
                        speedMode === mode
                          ? 'bg-blue-950/60 border-blue-500 text-blue-400 shadow-[inset_0_0_10px_rgba(59,130,246,0.3)]'
                           : 'bg-black border-slate-800 text-slate-500 hover:border-slate-700'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 font-mono italic">
                  {speedMode === 'REGULAR' && 'Standard speed. Comfortable but engaging.'}
                  {speedMode === 'FAST' && 'Turbo speed. Twice as fast as Regular.'}
                  {speedMode === 'EXTREME' && 'Extreme speed. Twice as fast as Fast.'}
                  {speedMode === 'INCREMENTAL' && 'Classic challenge. Speed increases every 10 lines cleared.'}
                </p>
              </div>

              {/* Previews Count Configurator */}
              <div className="space-y-2 pt-4 border-t border-slate-900">
                <span className="text-[10px] text-slate-400 font-retro tracking-widest block uppercase font-bold">Pieces in Advance</span>
                <div className="grid grid-cols-4 gap-2">
                  {[0, 1, 2, 3].map((count) => (
                    <button
                      key={count}
                      onClick={() => {
                        setPreviewCount(count);
                        window.localStorage.setItem('retroblocks_preview_count', String(count));
                        audioEngine.playRotate();
                      }}
                      className={`py-2 px-1 text-[10px] font-retro font-bold border-2 rounded-lg transition-all cursor-pointer ${
                        previewCount === count
                          ? 'bg-purple-950/60 border-purple-500 text-purple-400 shadow-[inset_0_0_10px_rgba(168,85,247,0.3)]'
                          : 'bg-black border-slate-800 text-slate-500 hover:border-slate-700'
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 font-mono italic">
                  Choose how many upcoming pieces are shown in advance (0 to 3).
                </p>
              </div>

              {/* Audio Volume Sliders */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-900">
                <div className="space-y-2 bg-slate-900/30 p-3 rounded-lg border border-slate-900">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-400 font-retro tracking-widest uppercase font-bold">Sound Effects</span>
                    <span className="text-[10px] font-mono text-blue-400 font-bold">{Math.round(sfxVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={sfxVolume}
                    onChange={(e) => {
                      const vol = parseFloat(e.target.value);
                      setSfxVolumeState(vol);
                      audioEngine.setSFXVolume(vol);
                      if (vol > 0 && !soundEnabled) {
                        setSoundEnabled(true);
                        audioEngine.toggleSoundEffects();
                      } else if (vol === 0 && soundEnabled) {
                        setSoundEnabled(false);
                        audioEngine.toggleSoundEffects();
                      }
                    }}
                    className="w-full accent-blue-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-2 bg-slate-900/30 p-3 rounded-lg border border-slate-900">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-400 font-retro tracking-widest uppercase font-bold whitespace-nowrap">Background Music</span>
                    <span className="text-[10px] font-mono text-purple-400 font-bold">{Math.round(musicVolume * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={musicVolume}
                    onChange={(e) => {
                      const vol = parseFloat(e.target.value);
                      setMusicVolumeState(vol);
                      audioEngine.setMusicVolume(vol);
                      if (vol > 0 && !musicEnabled) {
                        setMusicEnabled(true);
                        audioEngine.toggleMusic();
                        if (status === 'PLAYING') audioEngine.startMusic();
                      } else if (vol === 0 && musicEnabled) {
                        setMusicEnabled(false);
                        audioEngine.toggleMusic();
                        audioEngine.stopMusic();
                      }
                    }}
                    className="w-full accent-purple-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <label className="flex items-center gap-2 mt-2 cursor-pointer group/cb select-none">
                    <input
                      type="checkbox"
                      checked={musicInGameOnly}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setMusicInGameOnly(val);
                        window.localStorage.setItem('retroblocks_bgm_ingame_only', String(val));
                        audioEngine.playRotate();
                      }}
                      className="rounded border-slate-800 bg-black text-purple-600 focus:ring-0 focus:ring-offset-0 cursor-pointer w-3.5 h-3.5 accent-purple-500"
                    />
                    <span className="text-[9px] text-slate-400 group-hover/cb:text-slate-300 transition-colors font-mono uppercase tracking-wider">Play in-game only</span>
                  </label>
                </div>
              </div>

              {/* Generative Music Style Section */}
              <div className="space-y-2 pt-4 border-t border-slate-900">
                <span className="text-[10px] text-slate-400 font-retro tracking-widest block uppercase font-bold">Generative Music Style</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['A', 'B', 'C', 'D'] as const).map((style) => (
                    <button
                      key={style}
                      onClick={() => {
                        setMusicStyle(style);
                        audioEngine.setMusicStyle(style);
                        audioEngine.playRotate();
                      }}
                      className={`py-2 px-1 text-[9px] font-retro font-bold border-2 rounded-lg transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                        musicStyle === style
                          ? 'bg-purple-950/60 border-purple-500 text-purple-400 shadow-[inset_0_0_10px_rgba(168,85,247,0.3)]'
                          : 'bg-black border-slate-800 text-slate-500 hover:border-slate-700'
                      }`}
                    >
                      <span className="text-[10px]">STYLE {style}</span>
                      <span className="text-[7px] font-mono opacity-80 uppercase">
                        {style === 'A' && 'Cyber-Pluck'}
                        {style === 'B' && 'Chill Lofi'}
                        {style === 'C' && 'Neo Arps'}
                        {style === 'D' && 'Industrial'}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-slate-500 font-mono italic">
                  {musicStyle === 'A' && 'Cyber-Pluck: Energetic synth plucks and dynamic octave bass leaps.'}
                  {musicStyle === 'B' && 'Chill Lofi: Gentle lofi rhythms, warm jazz chords, and spacious melodies.'}
                  {musicStyle === 'C' && 'Neo Arps: Continuous neo-classical synthesizer arpeggios and sustained bass.'}
                  {musicStyle === 'D' && 'Industrial: Intense natural minor tones, aggressive sawtooth leads, and pumping bass.'}
                </p>
              </div>

              {/* Keybindings Section */}
              <div className="space-y-3 pt-4 border-t border-slate-900">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-400 font-retro tracking-widest uppercase font-bold">Keybindings</span>
                  <button
                    onClick={() => {
                      setKeybindings(DEFAULT_KEYBINDINGS);
                      window.localStorage.setItem('retroblocks_keybindings', JSON.stringify(DEFAULT_KEYBINDINGS));
                      audioEngine.playRotate();
                    }}
                    className="text-[9px] text-blue-400 hover:text-blue-300 underline uppercase tracking-wider font-mono cursor-pointer"
                  >
                    Reset Keys to Default
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[220px] overflow-y-auto pr-1">
                  {Object.entries(keybindings).map(([action, keys]) => (
                    <div key={action} className="flex items-center justify-between bg-slate-900/50 p-2 rounded-lg border border-slate-800/60 hover:bg-slate-900 transition-colors">
                      <span className="text-[10px] font-retro text-slate-300 font-bold tracking-wider uppercase">
                        {getActionLabel(action)}
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => {
                            setListeningAction({ action: action as any, index: 0 });
                            audioEngine.playRotate();
                          }}
                          className={`px-2 py-1 text-[8px] font-mono font-bold border rounded-md min-w-[50px] text-center uppercase tracking-wider cursor-pointer transition-all ${
                            listeningAction?.action === action && listeningAction?.index === 0
                              ? 'bg-amber-950/40 border-amber-500 text-amber-400 animate-pulse'
                              : 'bg-black border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
                          }`}
                        >
                          {listeningAction?.action === action && listeningAction?.index === 0 ? '...' : formatKeyName((keys as [string, string])[0])}
                        </button>
                        <button
                          onClick={() => {
                            setListeningAction({ action: action as any, index: 1 });
                            audioEngine.playRotate();
                          }}
                          className={`px-2 py-1 text-[8px] font-mono font-bold border rounded-md min-w-[50px] text-center uppercase tracking-wider cursor-pointer transition-all ${
                            listeningAction?.action === action && listeningAction?.index === 1
                              ? 'bg-amber-950/40 border-amber-500 text-amber-400 animate-pulse'
                              : 'bg-black border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
                          }`}
                        >
                          {listeningAction?.action === action && listeningAction?.index === 1 ? '...' : formatKeyName((keys as [string, string])[1])}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="border-t-2 border-slate-800 p-4 bg-slate-900/40 flex justify-between items-center font-mono text-[9px] text-slate-500">
              <span>ACTIVE PROFILE: LOCAL_PLAYER</span>
              <button
                onClick={() => {
                  audioEngine.playRotate();
                  setSettingsOpen(false);
                }}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-black border border-white font-bold tracking-wider uppercase rounded cursor-pointer transition-all duration-150 active:scale-95"
              >
                SAVE & CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REBINDING MODAL OVERLAY */}
      {listeningAction && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-55 flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-slate-950 border-4 border-amber-500 p-6 rounded-2xl max-w-sm space-y-4 shadow-[0_0_50px_rgba(245,158,11,0.3)]">
            <div className="w-12 h-12 rounded-full border-2 border-amber-500 bg-amber-950/40 flex items-center justify-center mx-auto text-amber-400 animate-pulse font-bold text-lg font-mono">
              ?
            </div>
            <h3 className="text-sm font-black text-amber-500 uppercase tracking-widest">Awaiting Keyboard Input</h3>
            <p className="text-[10px] text-slate-400 font-sans leading-relaxed">
              Press any key on your keyboard to assign it to:
              <span className="block mt-2 text-white font-bold text-xs uppercase font-retro tracking-widest">
                {getActionLabel(listeningAction.action)} ({listeningAction.index === 0 ? 'PRIMARY' : 'SECONDARY'})
              </span>
            </p>
            <div className="pt-2">
              <button
                onClick={() => setListeningAction(null)}
                className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-slate-500 hover:text-white border border-slate-800 text-[8px] font-retro rounded uppercase transition-colors cursor-pointer"
              >
                Cancel Rebind [ESC]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Status Bar */}
      <footer className="w-full max-w-5xl mt-6 flex flex-col md:flex-row justify-between items-center text-[10px] text-slate-600 border-t border-slate-900 pt-4 z-10 gap-2 font-mono">
        <div className="flex gap-6">
          <span>ENGINE: PULSE_DYNAMICS</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          <span>SYSTEM READY - LOCAL_STORAGE_ACTIVE</span>
        </div>
      </footer>
    </div>
  );
}
