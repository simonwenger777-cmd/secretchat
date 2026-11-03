const MEDIA_MAX_BYTES = 24 * 1024 * 1024;
const MEDIA_TTL_MS = 24 * 60 * 60 * 1000;

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		},
	});
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/api/messages")) {
			return handleMessages(request, env, url);
		}

		if (url.pathname === "/api/presence") {
			return handlePresence(request, env, url);
		}

		if (url.pathname === "/api/calc-ai" && request.method === "POST") {
			return handleCalcAi(request, env);
		}

		if (url.pathname === "/media-api/upload" && request.method === "POST") {
			return handleMediaUpload(request, env);
		}

		const mediaMatch = url.pathname.match(/^\/media-files\/([a-f0-9]{32})\.bin$/);
		if (mediaMatch && request.method === "GET") {
			return handleMediaGet(env, mediaMatch[1]);
		}

		if (env.ASSETS) return env.ASSETS.fetch(request);
		return new Response("Not found", { status: 404 });
	},

	async scheduled(_event, env, ctx) {
		ctx.waitUntil(cleanup(env));
	},
};

async function handleMessages(request, env, url) {
	if (request.method === "GET") {
		const roomId = url.searchParams.get("room");
		const sinceId = parseInt(url.searchParams.get("since_id") || "0", 10);
		if (!roomId) return new Response("Room ID required", { status: 400 });

		const { results } = await env.DB.prepare(
			"SELECT id, payload, created_at FROM messages WHERE room_id = ? AND id > ? ORDER BY id ASC"
		).bind(roomId, sinceId).all();

		return new Response(JSON.stringify(results), {
			headers: {
				"Content-Type": "application/json",
				"Cache-Control": "no-store",
			},
		});
	}

	if (request.method === "DELETE") {
		try {
			const idStr = url.searchParams.get("id");
			const roomId = url.searchParams.get("room");
			if (!idStr) {
				if (!roomId) return new Response("Room ID required", { status: 400 });
				await env.DB.prepare("DELETE FROM messages WHERE room_id = ?").bind(roomId).run();
				return json({ success: true });
			}

			const ids = idStr.split(",").map((i) => parseInt(i, 10)).filter((i) => !isNaN(i));
			if (ids.length === 0) return new Response("Invalid IDs", { status: 400 });

			const placeholders = ids.map(() => "?").join(",");
			await env.DB.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).bind(...ids).run();

			return json({ success: true });
		} catch (e) {
			return new Response(e.message, { status: 500 });
		}
	}

	if (request.method === "PUT") {
		try {
			const id = parseInt(url.searchParams.get("id"), 10);
			const body = await request.json();
			if (!id || !body.payload) return new Response("Vars required", { status: 400 });

			await env.DB.prepare("UPDATE messages SET payload = ? WHERE id = ?").bind(body.payload, id).run();
			return json({ success: true });
		} catch (e) {
			return new Response(e.message, { status: 500 });
		}
	}

	if (request.method === "POST") {
		try {
			const body = await request.json();
			if (!body.room_id || !body.payload) return new Response("Invalid payload", { status: 400 });

			const now = Date.now();
			const result = await env.DB.prepare(
				"INSERT INTO messages (room_id, payload, created_at) VALUES (?, ?, ?)"
			).bind(body.room_id, body.payload, now).run();

			return new Response(JSON.stringify({ success: true, timestamp: now, id: result.meta.last_row_id }), {
				headers: {
					"Content-Type": "application/json",
					"Cache-Control": "no-store",
				},
			});
		} catch (e) {
			return new Response(e.message, { status: 500 });
		}
	}

	return new Response("Not found", { status: 404 });
}

const CALC_MODELS = new Set([
	"qwen/qwen3.8-27b",
	"openai/gpt-oss-120b",
	"openai/gpt-oss-20b",
]);
const calcHits = new Map();

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

async function handleCalcAi(request, env) {
	if (!env.GROQ_API_KEY) return json({ error: { message: "Ключ ещё не подключён" } }, 503);
	const ip = request.headers.get("CF-Connecting-IP") || "local";
	if (calcLimited(ip)) return json({ error: { message: "Слишком много запросов, подождите минуту" } }, 429);

	let body;
	try {
		body = await request.json();
	} catch {
		return new Response("Invalid payload", { status: 400 });
	}
	const messages = Array.isArray(body.messages) ? body.messages.slice(0, 24) : [];
	if (!messages.length || messages.length > 24) return new Response("Invalid payload", { status: 400 });
	const clean = [];
	for (const message of messages) {
		const role = message?.role === "system" || message?.role === "user" || message?.role === "assistant" ? message.role : "";
		const content = typeof message?.content === "string" ? message.content.slice(0, 4500) : "";
		if (!role || !content) return new Response("Invalid payload", { status: 400 });
		clean.push({ role, content });
	}
	const model = CALC_MODELS.has(body.model) ? body.model : "qwen/qwen3.8-27b";
	const textMode = body.format === "text";

	let upstream;
	try {
		upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.GROQ_API_KEY}`,
			},
			body: JSON.stringify({
				model,
				temperature: textMode ? 0.2 : 0,
				...(textMode ? {} : { response_format: { type: "json_object" } }),
				messages: clean,
			}),
		});
	} catch {
		return json({ error: { message: "Нет связи с моделью" } }, 502);
	}

	const text = await upstream.text();
	return new Response(text, {
		status: upstream.status,
		headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
	});
}

async function handleMediaUpload(request, env) {
	if (!env.MEDIA_KV) return new Response("Media store is not configured", { status: 503 });

	const bytes = await request.arrayBuffer();
	if (bytes.byteLength <= 0) return new Response("Empty upload", { status: 400 });
	if (bytes.byteLength > MEDIA_MAX_BYTES) return new Response("Upload too large", { status: 413 });

	const id = crypto.randomUUID().replace(/-/g, "");
	await env.MEDIA_KV.put(`${id}.bin`, bytes, { expirationTtl: Math.floor(MEDIA_TTL_MS / 1000) });

	return json({ id, url: `/media-files/${id}.bin` });
}

async function handleMediaGet(env, id) {
	if (!env.MEDIA_KV) return new Response("Media store is not configured", { status: 503 });

	const bytes = await env.MEDIA_KV.get(`${id}.bin`, "arrayBuffer");
	if (!bytes) return new Response("Not found", { status: 404 });

	return new Response(bytes, {
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Length": String(bytes.byteLength),
			"Cache-Control": "private, max-age=86400",
		},
	});
}

const PRESENCE_TTL_MS = 40 * 1000;
const PRESENCE_PAYLOAD_MAX = 8000;
let presenceSchema;

function ensurePresence(env) {
	if (!presenceSchema) {
		presenceSchema = env.DB.prepare(
			`CREATE TABLE IF NOT EXISTS presence (
				room_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				payload TEXT NOT NULL,
				seen_at INTEGER NOT NULL,
				PRIMARY KEY (room_id, user_id)
			)`
		).run().catch((err) => {
			presenceSchema = null;
			throw err;
		});
	}
	return presenceSchema;
}

function cleanRoomId(roomId) {
	if (typeof roomId !== "string") return "";
	const room = roomId.trim();
	if (!room || room.length > 80 || /[\s\u0000]/.test(room)) return "";
	return room;
}

async function handlePresence(request, env, url) {
	try {
		await ensurePresence(env);
	} catch (e) {
		return new Response(e.message, { status: 500 });
	}

	const roomId = cleanRoomId(url.searchParams.get("room") || "");

	if (request.method === "GET") {
		if (!roomId) return new Response("Room ID required", { status: 400 });
		const since = Date.now() - PRESENCE_TTL_MS;
		const { results } = await env.DB.prepare(
			"SELECT user_id, payload, seen_at FROM presence WHERE room_id = ? AND seen_at > ? ORDER BY seen_at DESC"
		).bind(roomId, since).all();
		return json(results);
	}

	if (request.method === "DELETE") {
		const userId = url.searchParams.get("user_id") || "";
		if (!roomId || !/^[a-f0-9]{32}$/.test(userId)) return new Response("Vars required", { status: 400 });
		await env.DB.prepare("DELETE FROM presence WHERE room_id = ? AND user_id = ?").bind(roomId, userId).run();
		return json({ success: true });
	}

	if (request.method === "POST") {
		let body;
		try {
			body = await request.json();
		} catch {
			return new Response("Invalid payload", { status: 400 });
		}
		const room = cleanRoomId(body.room_id);
		const userId = typeof body.user_id === "string" ? body.user_id : "";
		const payload = typeof body.payload === "string" ? body.payload : "";
		if (!room || !/^[a-f0-9]{32}$/.test(userId) || !payload || payload.length > PRESENCE_PAYLOAD_MAX) {
			return new Response("Invalid payload", { status: 400 });
		}
		const now = Date.now();
		await env.DB.prepare(
			`INSERT INTO presence (room_id, user_id, payload, seen_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(room_id, user_id) DO UPDATE SET payload = excluded.payload, seen_at = excluded.seen_at`
		).bind(room, userId, payload, now).run();
		return json({ success: true, seen_at: now });
	}

	return new Response("Not found", { status: 404 });
}

async function cleanup(env) {
	const cutoff = Date.now() - MEDIA_TTL_MS;
	await env.DB.prepare("DELETE FROM messages WHERE created_at < ?").bind(cutoff).run();
	try {
		await ensurePresence(env);
		await env.DB.prepare("DELETE FROM presence WHERE seen_at < ?").bind(Date.now() - 60 * 60 * 1000).run();
	} catch {
		// Presence storage is optional for message cleanup.
	}
}
