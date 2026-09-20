// Polyfill: Promise.withResolvers is non-standard and some libs expect it.
// Provide a small, compatible implementation for environments (WebView)
// that don't expose it.
if (!(Promise as any).withResolvers) {
  (Promise as any).withResolvers = function() {
    let resolve: (v?: any) => void = () => {};
    let reject: (e?: any) => void = () => {};
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

import ReactDOM from 'react-dom/client';
import App from './App';

// StrictMode intentionally omitted: its double-invoke of effects in dev
// starts two libp2p nodes with the same identity, churning the relay
// reservation and breaking the circuit. No-op difference in production.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <App />
);
