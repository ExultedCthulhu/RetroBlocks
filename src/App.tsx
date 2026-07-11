/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import RetroBlocksGame from './components/RetroBlocksGame';

export default function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white selection:bg-cyan-500 selection:text-black">
      <RetroBlocksGame />
    </div>
  );
}

