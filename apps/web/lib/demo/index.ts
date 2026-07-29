// UI-only (demo) mode.
//
// When NEXT_PUBLIC_DEMO_MODE=1 the browser's fetch is wrapped so every request
// aimed at the API origin is answered from local demo data instead of going out
// over the network. Nothing else in the app has to know: `lib/api.ts`, raw
// fetch calls for recordings, and the softphone config all go through fetch.
//
// Turn it off by removing NEXT_PUBLIC_DEMO_MODE from .env.local (or setting it
// to 0) and the app talks to the real NestJS API again.

import { handleRequest, HttpError } from './router';
import { resetDb } from './data';

export const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === '1';

// Read the API origin the same way lib/api.ts does, without importing it —
// this module is imported *by* lib/api.ts.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data ?? null), { status, headers: { 'Content-Type': 'application/json' } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let installed = false;

export function installDemoBackend() {
  if (!DEMO || installed || typeof window === 'undefined') return;
  installed = true;

  const real = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : input.url;

    // Anything not aimed at the API (Next.js assets, RSC payloads…) passes through.
    if (!url.startsWith(API_BASE)) return real(input as any, init);

    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const target = url.slice(API_BASE.length) || '/';

    let body: any;
    try { if (typeof init?.body === 'string') body = JSON.parse(init.body); } catch { /* not JSON */ }

    await sleep(60 + Math.random() * 120); // enough latency for loading states to show

    // Recording playback/download — serve the bundled audio clip so the players work.
    if (method === 'GET' && /^\/call-logs\/[^/]+\/recording/.test(target)) {
      try {
        const res = await real('/assets/incoming-ringtone.mp3');
        if (res.ok) return new Response(await res.blob(), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
      } catch { /* fall through */ }
      return json({ message: 'Recording unavailable in demo mode' }, 404);
    }

    try {
      const data = handleRequest(method, target, body);
      return data === null || data === undefined ? new Response(null, { status: 204 }) : json(data);
    } catch (e: any) {
      if (e instanceof HttpError) return json({ message: e.message }, e.status);
      return json({ message: e?.message ?? 'Demo backend error' }, 500);
    }
  };

  // Handy escape hatch while clicking around: nativetalkDemo.reset() in the console.
  (window as any).nativetalkDemo = {
    reset() { resetDb(); window.location.reload(); },
  };
}
