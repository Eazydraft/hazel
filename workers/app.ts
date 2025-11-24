// Import Hazel dependencies - using Workers-compatible versions
import Cache from '../lib/cache.js';
import createRoutes from './routes.js';

// Cloudflare Workers entry point
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;

		// Configure Hazel with environment variables
		const config = {
			interval: env.INTERVAL || '15',
			account: env.ACCOUNT,
			repository: env.REPOSITORY,
			pre: env.PRE,
			token: env.TOKEN,
			url: env.URL || url.origin
		};

		// Initialize cache and routes
		let cache: any;
		try {
			cache = new Cache(config);
		} catch (err: any) {
			const { code, message } = err;
			if (code) {
				return new Response(JSON.stringify({
					error: { code, message }
				}), {
					status: 400,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			throw err;
		}

		const routes: any = createRoutes({ cache, config });

		// Create Node.js-like request object
		const req = {
			url: pathname + url.search,
			method: request.method,
			headers: Object.fromEntries(request.headers.entries()),
			params: {} as Record<string, string>
		};

		// Route matching helper
		const matchRoute = (pattern: string): boolean => {
			const regex = pattern.replace(/:\w+/g, '([^/]+)');
			const match = pathname.match(new RegExp(`^${regex}$`));
			if (match) {
				const keys = (pattern.match(/:\w+/g) || []).map(k => k.slice(1));
				keys.forEach((key, i) => {
					req.params[key] = match[i + 1];
				});
				return true;
			}
			return false;
		};

		// Create response wrapper with timeout fallback
		return new Promise((resolve, reject) => {
			let statusCode = 200;
			let headers: Record<string, string> = {};
			let resolved = false;

			// Timeout after 55 seconds (Workers limit is 60s)
			const timeout = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					reject(new Error('Request timeout'));
				}
			}, 55000);

			const res = {
				statusCode: 200,
				writeHead(status: number, hdrs?: Record<string, string>) {
					statusCode = status;
					if (hdrs) {
						headers = { ...headers, ...hdrs };
					}
				},
				setHeader(name: string, value: string) {
					headers[name] = value;
				},
				end(data?: any) {
					if (resolved) return;
					resolved = true;
					clearTimeout(timeout);

					if (data === undefined || data === null) {
						resolve(new Response(null, { status: statusCode, headers }));
					} else if (typeof data === 'string') {
						resolve(new Response(data, { 
							status: statusCode, 
							headers: { ...headers, 'Content-Type': headers['Content-Type'] || headers['content-type'] || 'text/html' }
						}));
					} else if (typeof data === 'object') {
						resolve(new Response(JSON.stringify(data), { 
							status: statusCode, 
							headers: { ...headers, 'Content-Type': 'application/json' }
						}));
					} else {
						resolve(new Response(String(data), { status: statusCode, headers }));
					}
				}
			};

			// Handle routing directly - wrap in async IIFE
			(async () => {
				try {
					if (pathname === '/' && request.method === 'GET') {
						await routes.overview(req, res);
					} else if (pathname === '/download' && request.method === 'GET') {
						await routes.download(req, res);
					} else if (matchRoute('/download/:platform') && request.method === 'GET') {
						await routes.downloadPlatform(req, res);
					} else if (matchRoute('/update/:platform/:version') && request.method === 'GET') {
						await routes.update(req, res);
					} else if (matchRoute('/update/win32/:version/:filename') && request.method === 'GET') {
						await routes.releases(req, res);
					} else if (matchRoute('/files/:filename') && request.method === 'GET') {
						await routes.files(req, res);
					} else {
						// 404 Not Found
						if (!resolved) {
							resolved = true;
							clearTimeout(timeout);
							resolve(new Response('Not Found', { 
								status: 404,
								headers: { 'Content-Type': 'text/plain' }
							}));
						}
					}
				} catch (error) {
					console.error('Error handling request:', error);
					if (!resolved) {
						resolved = true;
						clearTimeout(timeout);
						resolve(new Response(JSON.stringify({ 
							error: 'Internal Server Error',
							message: error instanceof Error ? error.message : 'Unknown error'
						}), { 
							status: 500,
							headers: { 'Content-Type': 'application/json' }
						}));
					}
				}
			})();
		});
	},
};

// Environment interface
interface Env {
	ACCOUNT: string;
	REPOSITORY: string;
	INTERVAL?: string;
	PRE?: string;
	TOKEN?: string;
	URL?: string;
}
