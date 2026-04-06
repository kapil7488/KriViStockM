import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Vite plugin: handles Upstox OAuth token exchange keeping client_secret server-side. */
function upstoxTokenPlugin(): Plugin {
  let clientId = '';
  let clientSecret = '';

  return {
    name: 'upstox-token-exchange',
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir || process.cwd(), '');
      clientId = env.VITE_UPSTOX_CLIENT_ID || '';
      clientSecret = env.UPSTOX_CLIENT_SECRET || '';
    },
    configureServer(server) {
      server.middlewares.use('/api/upstox/token', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        for await (const chunk of req) body += chunk;
        let code: string;
        try {
          code = JSON.parse(body).code;
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid request body' }));
          return;
        }

        if (!code || !clientId || !clientSecret) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Missing code or Upstox credentials' }));
          return;
        }

        const origin = req.headers.origin || req.headers.referer?.replace(/\/[^/]*$/, '') || `http://localhost:${server.config.server.port || 3000}`;
        const callbackUri = `${origin}/callback`;

        try {
          const tokenRes = await fetch('https://api.upstox.com/v2/login/authorization/token', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: callbackUri,
              grant_type: 'authorization_code',
            }).toString(),
          });

          const data = await tokenRes.json();
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = tokenRes.ok ? 200 : 400;
          res.end(JSON.stringify(data));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Token exchange failed', detail: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), upstoxTokenPlugin()],
  envDir: __dirname,
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
      },
      '/api/yahoo2': {
        target: 'https://query2.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo2/, ''),
      },
      '/api/fc': {
        target: 'https://fc.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/fc/, ''),
      },
      '/api/finnhub': {
        target: 'https://finnhub.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/finnhub/, ''),
      },
      '/api/alphavantage': {
        target: 'https://www.alphavantage.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/alphavantage/, ''),
      },
    },
  },
});
