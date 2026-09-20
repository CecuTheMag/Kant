import React from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './shell/Shell';
import { Bare } from './shell/Bare';
import './shell/shell.css';

/* ?bare=1 renders the app alone, for the device-frame iframes. */
const bare = new URLSearchParams(location.search).has('bare');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{bare ? <Bare /> : <Shell />}</React.StrictMode>,
);
