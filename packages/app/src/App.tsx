import React, { useState, useEffect } from 'react';
import { ping, generateKeypair } from '@kant/core';
import '../index.css';

function App() {
  return (
    <div className="p-8 max-w-md mx-auto">
      <h1 className="text-3xl font-bold mb-8">Kant</h1>
      <div className="bg-gray-100 p-6 rounded-lg">
        <p>Phase 0 Status: {ping()}</p>
        <button 
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          onClick={async () => {
            const { generateKeypair } = await import('@kant/core');
            const kp = await generateKeypair('demo');
            console.log('Keypair:', kp);
          }}
        >
          Generate Keypair
        </button>
      </div>
    </div>
  );
}

export default App;
