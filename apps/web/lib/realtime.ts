import { io, Socket } from 'socket.io-client';
import { API_BASE } from './api';
import { DEMO } from './demo';
import { realtimeSnapshot } from './demo/router';

// UI-only mode: there's no gateway to hand-shake with, so push demo snapshots on
// a timer behind the same interface the Live Dashboard already uses.
function demoSocket(onSnapshot: (snap: any) => void): Socket {
  const timer = setInterval(() => onSnapshot(realtimeSnapshot()), 2000);
  setTimeout(() => onSnapshot(realtimeSnapshot()), 200);
  return {
    on: () => {},
    off: () => {},
    emit: () => {},
    close: () => clearInterval(timer),
    disconnect: () => clearInterval(timer),
    connected: true,
  } as unknown as Socket;
}

// Connect to the live dashboard stream. withCredentials sends the httpOnly
// auth cookie so the server can authenticate the Socket.io handshake.
//
// When the API is served same-origin behind a reverse proxy under an `/api`
// prefix (e.g. https://host/api), we must NOT fold that prefix into the
// namespace: the gateway namespace is `/realtime`, and Socket.io derives the
// namespace from the URL path. So connect to the bare origin + `/realtime`, and
// move the `/api` prefix onto the transport `path` instead (`/api/socket.io`),
// which the proxy strips before it reaches the API's default `/socket.io`.
// Direct (dev) connections keep the default path. Both cases hit namespace
// `/realtime`.
export function connectRealtime(onSnapshot: (snap: any) => void): Socket {
  if (DEMO) return demoSocket(onSnapshot);
  const hasApiPrefix = /\/api\/?$/.test(API_BASE);
  const origin = API_BASE.replace(/\/api\/?$/, '');
  const socket = io(`${origin}/realtime`, {
    path: hasApiPrefix ? '/api/socket.io' : '/socket.io',
    withCredentials: true,
    transports: ['websocket'],
  });
  socket.on('snapshot', onSnapshot);
  return socket;
}
