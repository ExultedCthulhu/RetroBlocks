/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, ArrowDownToLine, Pause, Play } from 'lucide-react';

interface OnScreenControlsProps {
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onRotate: () => void;
  onRotateCCW?: () => void;
  onHold?: () => void;
  onSoftDrop: () => void;
  onHardDrop: () => void;
  onTogglePause: () => void;
  isPaused: boolean;
}

export default function OnScreenControls({
  onMoveLeft,
  onMoveRight,
  onRotate,
  onRotateCCW,
  onHold,
  onSoftDrop,
  onHardDrop,
  onTogglePause,
  isPaused,
}: OnScreenControlsProps) {
  return (
    <div className="w-full max-w-md mx-auto mt-1 bg-zinc-900/90 border-2 border-zinc-800 p-3 rounded-xl shadow-[0_-5px_15px_rgba(0,0,0,0.5)] md:hidden">
      <div className="flex justify-between items-center mb-2.5">
        <span className="font-retro text-[8px] text-zinc-500 uppercase tracking-widest">
          Mobile Controller
        </span>
        <button
          onClick={onTogglePause}
          className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 border border-zinc-700 text-zinc-300 font-retro text-[9px] rounded uppercase active:bg-zinc-700 transition-colors"
        >
          {isPaused ? <Play className="w-3 h-3 text-green-500" /> : <Pause className="w-3 h-3 text-yellow-500" />}
          {isPaused ? 'RESUME' : 'PAUSE'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 max-w-sm mx-auto">
        {/* Left Side: Keyboard-style Arrow Keys (Inverted-T) */}
        <div className="grid grid-cols-3 gap-2 w-[148px] h-24 mx-auto select-none">
          {/* Row 1 */}
          <div /> {/* Empty top-left */}
          <button
            onTouchStart={(e) => {
              e.preventDefault();
              onRotate();
            }}
            onClick={onRotate}
            className="w-11 h-11 bg-zinc-800 active:bg-cyan-500 border-2 border-zinc-700 text-white rounded-md flex items-center justify-center shadow-lg active:scale-95 transition-all"
            aria-label="Rotate (Up)"
          >
            <ArrowUp className="w-5 h-5 text-cyan-400" />
          </button>
          <div /> {/* Empty top-right */}

          {/* Row 2 */}
          <button
            onTouchStart={(e) => {
              e.preventDefault();
              onMoveLeft();
            }}
            onClick={onMoveLeft}
            className="w-11 h-11 bg-zinc-800 active:bg-cyan-500 border-2 border-zinc-700 text-white rounded-md flex items-center justify-center shadow-lg active:scale-95 transition-all"
            aria-label="Move Left"
          >
            <ArrowLeft className="w-5 h-5 text-cyan-400" />
          </button>

          <button
            onTouchStart={(e) => {
              e.preventDefault();
              onSoftDrop();
            }}
            onClick={onSoftDrop}
            className="w-11 h-11 bg-zinc-800 active:bg-cyan-500 border-2 border-zinc-700 text-white rounded-md flex items-center justify-center shadow-lg active:scale-95 transition-all"
            aria-label="Move Down (Soft Drop)"
          >
            <ArrowDown className="w-5 h-5 text-cyan-400" />
          </button>

          <button
            onTouchStart={(e) => {
              e.preventDefault();
              onMoveRight();
            }}
            onClick={onMoveRight}
            className="w-11 h-11 bg-zinc-800 active:bg-cyan-500 border-2 border-zinc-700 text-white rounded-md flex items-center justify-center shadow-lg active:scale-95 transition-all"
            aria-label="Move Right"
          >
            <ArrowRight className="w-5 h-5 text-cyan-400" />
          </button>
        </div>

        {/* Right Side: Action Buttons aligned with Left Side */}
        <div className="flex flex-col justify-between items-center h-24 w-[148px] mx-auto select-none">
          {/* Hard Drop Button (Space) */}
          <button
            onTouchStart={(e) => {
              e.preventDefault();
              onHardDrop();
            }}
            onClick={onHardDrop}
            className="w-16 h-16 bg-red-600 active:bg-red-500 border-4 border-zinc-950 rounded-full flex flex-col items-center justify-center text-white shadow-xl active:scale-90 transition-all cursor-pointer relative"
            aria-label="Hard Drop"
          >
            {/* Glossy overlay */}
            <div className="absolute top-1 left-1.5 w-6 h-2 bg-white/20 rounded-full rotate-[-15deg] pointer-events-none" />
            <ArrowDownToLine className="w-5 h-5 text-white mb-0.5" />
            <span className="font-retro text-[6px] tracking-wide text-zinc-100 font-bold">
              DROP
            </span>
          </button>
          
          <div className="flex gap-1.5 w-full justify-center">
            {/* Hold Button */}
            {onHold && (
              <button
                onTouchStart={(e) => {
                  e.preventDefault();
                  onHold();
                }}
                onClick={onHold}
                className="py-1 px-1 bg-yellow-600 active:bg-yellow-500 border border-yellow-700 text-[6px] tracking-tight font-retro font-black rounded uppercase active:scale-95 transition-all w-[60px]"
              >
                HOLD [X]
              </button>
            )}
            
            {/* Rotate CCW Button */}
            {onRotateCCW && (
              <button
                onTouchStart={(e) => {
                  e.preventDefault();
                  onRotateCCW();
                }}
                onClick={onRotateCCW}
                className="py-1 px-1 bg-purple-600 active:bg-purple-500 border border-purple-700 text-[6px] tracking-tight font-retro font-black rounded uppercase active:scale-95 transition-all w-[60px]"
              >
                ROT CCW [Z]
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
