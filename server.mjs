import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = resolve(process.cwd(), 'public');
const MEDIA_MAX_BYTES = 24 * 1024 * 1024;
const MEDIA_TTL_MS = 24 * 60 * 60 * 1000;
const PRESENCE_TTL_MS = 40 * 1000;
const PRESENCE_PAYLOAD_MAX = 8000;
const MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

const CALC_MODELS = new Set([
	'qwen/qwen3.8-27b',
	'openai/gpt-oss-120b',
	'openai/gpt-oss-20b',
]);

const messages = [];
let nextMessageId = 1;
const presence = new Map();
const media = new Map();
const calcHits = new Map();

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
	'.mp3': 'audio/mpeg',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.txt': 'text/plain; charset=utf-8',
};

function json(res, data, status = 200) {
	const body = JSON.stringify(data);
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		'Content-Length': Buffer.byteLength(body),
	});
	res.end(body);
}

function text(res, body, status = 200, type = 'text/plain; charset=utf-8') {
	res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
	res.end(body);
}

function readBody(req, limit) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(Object.assign(new Error('too large'), { status: 413 }));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

function cleanRoomId(roomId) {
	if (typeof roomId !== 'string') return '';
	const room = roomId.trim();
	if (!room || room.length > 80 || /[\s\u0000]/.test(room)) return '';
	return room;
}

function clientIp(req) {
	const forwarded = req.headers['x-forwarded-for'];
	if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
	return req.socket.remoteAddress || 'local';
}

function calcLimited(ip) {
	const now = Date.now();
	const recent = (calcHits.get(ip) || []).filter((t) => now - t < 60_000);
	if (recent.length >= 20) {
		calcHits.set(ip, recent);
		return true;
	}
	recent.push(now);
	calcHits.set(ip, recent);
	return false;
}

function sweep() {
	const now = Date.now();
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].created_at < now - MESSAGE_TTL_MS) messages.splice(i, 1);
	}
	for (const [key, row] of presence) {
		if (row.seen_at < now - 60 * 60 * 1000) presence.delete(key);
	}
	for (const [id, file] of media) {
		if (file.expires < now) media.delete(id);
	}
}

function handleMessages(req, res, url) {
	if (req.method === 'GET') {
		const roomId = url.searchParams.get('room');
		const sinceId = parseInt(url.searchParams.get('since_id') || '0', 10);
		if (!roomId) return text(res, 'Room ID required', 400);
		const results = messages.filter((row) => row.room_id === roomId && row.id > sinceId);
		return json(res, results);
	}

	if (req.method === 'DELETE') {
		const idStr = url.searchParams.get('id');
		const roomId = url.searchParams.get('room');
		if (!idStr) {
			if (!roomId) return text(res, 'Room ID required', 400);
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i].room_id === roomId) messages.splice(i, 1);
			}
			return json(res, { success: true });
		}
		const ids = new Set(idStr.split(',').map((i) => parseInt(i, 10)).filter((i) => !Number.isNaN(i)));
		if (!ids.size) return text(res, 'Invalid IDs', 400);
		for (let i = messages.length - 1; i >= 0; i--) {
			if (ids.has(messages[i].id)) messages.splice(i, 1);
		}
		return json(res, { success: true });
	}

	return readBody(req, 2_000_000).then((buf) => {
		let body;
		try {
			body = JSON.parse(buf.toString('utf8') || '{}');
		} catch {
			return text(res, 'Invalid payload', 400);
		}
		if (req.method === 'PUT') {
			const id = parseInt(url.searchParams.get('id'), 10);
			if (!id || !body.payload) return text(res, 'Vars required', 400);
			const row = messages.find((item) => item.id === id);
			if (row) row.payload = body.payload;
			return json(res, { success: true });
		}
		if (req.method === 'POST') {
			if (!body.room_id || !body.payload) return text(res, 'Invalid payload', 400);
			const now = Date.now();
			const row = { id: nextMessageId++, room_id: body.room_id, payload: body.payload, created_at: now };
			messages.push(row);
			return json(res, { success: true, timestamp: now, id: row.id });
		}
		return text(res, 'Not found', 404);
	}).catch((err) => text(res, err.status === 413 ? 'Upload too large' : 'Invalid payload', err.status || 400));
}

async function handleCalcAi(req, res) {
	if (!process.env.GROQ_API_KEY) return json(res, { error: { message: 'Ключ ещё не подключён' } }, 503);
	if (calcLimited(clientIp(req))) return json(res, { error: { message: 'Слишком много запросов, подождите минуту' } }, 429);
	let body;
	try {
		body = JSON.parse((await readBody(req, 200_000)).toString('utf8'));
	} catch {
		return text(res, 'Invalid payload', 400);
	}
	const incoming = Array.isArray(body.messages) ? body.messages.slice(0, 24) : [];
	if (!incoming.length) return text(res, 'Invalid payload', 400);
	const clean = [];
	for (const message of incoming) {
		const role = message?.role === 'system' || message?.role === 'user' || message?.role === 'assistant' ? message.role : '';
		const content = typeof message?.content === 'string' ? message.content.slice(0, 4500) : '';
		if (!role || !content) return text(res, 'Invalid payload', 400);
		clean.push({ role, content });
	}
	const model = CALC_MODELS.has(body.model) ? body.model : 'qwen/qwen3.8-27b';
	const textMode = body.format === 'text';
	let upstream;
	try {
		upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
			},
			body: JSON.stringify({
				model,
				temperature: textMode ? 0.2 : 0,
				...(textMode ? {} : { response_format: { type: 'json_object' } }),
				messages: clean,
			}),
		});
	} catch {
		return json(res, { error: { message: 'Нет связи с моделью' } }, 502);
	}
	const payload = await upstream.text();
	res.writeHead(upstream.status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
	});
	res.end(payload);
}

async function handleMediaUpload(req, res) {
	let bytes;
	try {
		bytes = await readBody(req, MEDIA_MAX_BYTES);
	} catch (err) {
		return text(res, err.status === 413 ? 'Upload too large' : 'Empty upload', err.status || 400);
	}
	if (!bytes.length) return text(res, 'Empty upload', 400);
	const id = randomUUID().replace(/-/g, '');
	media.set(id, { bytes, expires: Date.now() + MEDIA_TTL_MS });
	return json(res, { id, url: `/media-files/${id}.bin` });
}

function handleMediaGet(res, id) {
	const file = media.get(id);
	if (!file || file.expires < Date.now()) {
		media.delete(id);
		return text(res, 'Not found', 404);
	}
	res.writeHead(200, {
		'Content-Type': 'application/octet-stream',
		'Content-Length': file.bytes.length,
		'Cache-Control': 'private, max-age=86400',
	});
	res.end(file.bytes);
}

function handlePresence(req, res, url) {
	const roomId = cleanRoomId(url.searchParams.get('room') || '');
	if (req.method === 'GET') {
		if (!roomId) return text(res, 'Room ID required', 400);
		const since = Date.now() - PRESENCE_TTL_MS;
		const results = [];
		for (const row of presence.values()) {
			if (row.room_id === roomId && row.seen_at > since) results.push({ user_id: row.user_id, payload: row.payload, seen_at: row.seen_at });
		}
		results.sort((a, b) => b.seen_at - a.seen_at);
		return json(res, results);
	}
	if (req.method === 'DELETE') {
		const userId = url.searchParams.get('user_id') || '';
		if (!roomId || !/^[a-f0-9]{32}$/.test(userId)) return text(res, 'Vars required', 400);
		presence.delete(`${roomId}:${userId}`);
		return json(res, { success: true });
	}
	if (req.method === 'POST') {
		return readBody(req, 20_000).then((buf) => {
			let body;
			try {
				body = JSON.parse(buf.toString('utf8'));
			} catch {
				return text(res, 'Invalid payload', 400);
			}
			const room = cleanRoomId(body.room_id);
			const userId = typeof body.user_id === 'string' ? body.user_id : '';
			const payload = typeof body.payload === 'string' ? body.payload : '';
			if (!room || !/^[a-f0-9]{32}$/.test(userId) || !payload || payload.length > PRESENCE_PAYLOAD_MAX) {
				return text(res, 'Invalid payload', 400);
			}
			const now = Date.now();
			presence.set(`${room}:${userId}`, { room_id: room, user_id: userId, payload, seen_at: now });
			return json(res, { success: true, seen_at: now });
		}).catch(() => text(res, 'Invalid payload', 400));
	}
	return text(res, 'Not found', 404);
}

function safePublicPath(pathname) {
	let rel;
	try {
		rel = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	rel = rel.replace(/^\/+/, '') || 'index.html';
	const full = resolve(PUBLIC_DIR, rel);
	const root = resolve(PUBLIC_DIR);
	if (full !== root && !full.startsWith(root + sep)) return null;
	return full;
}

function serveStatic(req, res, pathname) {
	let filePath = safePublicPath(pathname === '/' ? '/index.html' : pathname);
	if (!filePath) return text(res, 'Not found', 404);
	let stat = existsSync(filePath) && statSync(filePath).isFile() ? statSync(filePath) : null;
	if (!stat) {
		filePath = resolve(PUBLIC_DIR, 'index.html');
		if (!existsSync(filePath)) return text(res, 'Not found', 404);
		stat = statSync(filePath);
	}
	const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
	res.writeHead(200, {
		'Content-Type': type,
		'Content-Length': stat.size,
		'Cache-Control': extname(filePath) === '.html' ? 'no-store' : 'public, max-age=3600',
	});
	if (req.method === 'HEAD') return res.end();
	createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
	const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
	if (url.pathname.startsWith('/api/messages')) return handleMessages(req, res, url);
	if (url.pathname === '/api/presence') return handlePresence(req, res, url);
	if (url.pathname === '/api/calc-ai' && req.method === 'POST') return handleCalcAi(req, res);
	if (url.pathname === '/media-api/upload' && req.method === 'POST') return handleMediaUpload(req, res);
	const mediaMatch = url.pathname.match(/^\/media-files\/([a-f0-9]{32})\.bin$/);
	if (mediaMatch && req.method === 'GET') return handleMediaGet(res, mediaMatch[1]);
	if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
	return text(res, 'Not found', 404);
});

setInterval(sweep, 60_000).unref();
server.listen(PORT, '0.0.0.0', () => {
	console.log(`secretchat listening on ${PORT}`);
});
