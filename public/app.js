'use strict';

/* ==========================================================================
   DOM references
   ========================================================================== */
const $ = (id) => document.getElementById(id);

const UI = {
    loader: $('loader'),
    landing: $('landing'),
    chat: $('chat'),
    chatBody: $('chat-body'),
    messages: $('chat-messages'),
    input: $('message-input'),
    sendBtn: $('send-btn'),
    voiceBtn: $('voice-btn'),
    uploadBtn: $('upload-btn'),
    fileInput: $('file-input'),
    createRoomBtn: $('create-room'),
    copyLinkBtn: $('copy-link'),
    leaveRoomBtn: $('leave-room'),
    clearChatBtn: $('clear-chat'),
    roomHash: $('room-hash-display'),
    statusIndicator: document.querySelector('.status-indicator'),
    replyPreview: $('reply-preview'),
    replyName: $('reply-name'),
    replyText: $('reply-text'),
    removeReplyBtn: $('remove-reply'),
    colorPickerBtn: $('color-picker-btn'),
    colorMenu: $('custom-color-menu'),
    hexInput: $('hex-input'),
    hexPreview: $('hex-preview'),
    soundToggle: $('sound-toggle'),
    soundPick: $('sound-pick'),
    soundReset: $('sound-reset'),
    soundInput: $('sound-input'),

    selectionBar: $('selection-bar'),
    mainInputContainer: $('main-input-container'),
    actionCopy: $('action-copy'),
    actionEdit: $('action-edit'),
    actionReply: $('action-reply'),
    actionDelete: $('action-delete'),
    cancelSelection: $('cancel-selection'),
    selectionCount: $('selection-count'),

    onlineBtn: $('online-btn'),
    onlineCount: $('online-count'),
    onlineDots: $('online-dots'),
    onlinePanel: $('online-panel'),
    onlineList: $('online-list'),

    scrollDown: $('scroll-down'),
    scrollDownBadge: $('scroll-down-badge'),
    dropOverlay: $('drop-overlay'),
    recordIndicator: $('record-indicator'),
    recordTime: $('record-time'),

    attachmentPreview: $('attachment-preview'),
    previewImg: $('preview-img'),
    previewAudio: $('preview-audio'),
    previewFile: $('preview-file'),
    removePreview: $('remove-preview'),
    toast: $('toast')
};

/* ==========================================================================
   State
   ========================================================================== */
if (!localStorage.getItem('uuid')) localStorage.setItem('uuid', crypto.randomUUID());
const MY_ID = localStorage.getItem('uuid');

let currentRoom = null;
let currentKey = null; // CryptoKey
let currentInviteHash = '';
let lastSeenMessageId = 0;
let publishedReadTs = 0;
let readByOthersTs = 0;
let readEvents = [];
let readPublishTimer = null;
let pollTimeout = null;
let pollAbortController = null;
let pollGeneration = 0;
let pollInFlight = false;
let initialSyncDone = false;
let consecutivePollErrors = 0;
let pollKickRequested = false;

let pendingImageBase64 = null;
let pendingAudioBase64 = null;
let pendingMediaFiles = [];
let pendingMediaPreviewUrl = null;
let mediaRecorder = null;
let recordedAudioChunks = [];
let recordCancelled = false;
let voiceStopTimer = null;
let recordTicker = null;
let replyingTo = null; // { id, sender, text, name, color }
let askAssistant = async () => {};
let editingTargetId = null; // UUID of message being edited
let isSending = false;
let unreadCount = 0;
let unseenBelow = 0;
let stickToBottom = true;

const defaultTitle = 'S E C R E T';
const notificationAudio = new Audio();
notificationAudio.preload = 'none';
let notificationAudioUnlocked = false;
let notificationSoundEnabled = localStorage.getItem('notificationSoundEnabled') !== 'false';

const selectedMessages = new Set();
const fullMessageCache = new Map();
const globalColorOverrides = new Map(); // UUID -> color
const renderedMsgIds = new Set();
const objectUrls = new Set();
let imageViewer = null;

let lastActivityTimestamp = Date.now();
let lastMessageReceiveTimestamp = Date.now();
let presenceTimer = null;
let presenceGeneration = 0;
let presenceAway = document.visibilityState !== 'visible';
let presenceIdCache = { key: '', value: '' };

const PRESENCE_BEAT_MS = 12000;
const MAX_ENCRYPTED_PAYLOAD_BYTES = 450000;
const MAX_MEDIA_FILE_BYTES = 24 * 1024 * 1024;
const POLL_ACTIVE_INTERVAL_MS = 900;
const POLL_IDLE_INTERVAL_MS = 2500;
const POLL_HIDDEN_INTERVAL_MS = 6000;
const POLL_REQUEST_TIMEOUT_MS = 7000;
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const STICK_THRESHOLD_PX = 120;
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ==========================================================================
   Small helpers
   ========================================================================== */
const ICONS = {
    reply: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    checks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m2.5 13 3.2 3.2L12 9.5"/><path d="m8 13.2 3.2 3.2L20.5 7.5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
    video: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-3v10l-6-3"/></svg>',
    audio: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    file: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    lock: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return time;
    return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${time}`;
}

function trackObjectUrl(url) {
    objectUrls.add(url);
    return url;
}

function revokeAllObjectUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
}

function bytesToBase64(bytes) {
    // Chunked to avoid "Maximum call stack size exceeded" on large payloads
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/* ==========================================================================
   Viewport / visibility
   ========================================================================== */
let viewportRaf = 0;
let lastViewport = '';
function lockMobileViewport() {
    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width || window.innerWidth);
    const height = Math.round(viewport?.height || window.innerHeight);
    const key = `${width}x${height}`;
    if (key !== lastViewport) {
        lastViewport = key;
        const root = document.documentElement.style;
        root.setProperty('--app-width', `${width}px`);
        root.setProperty('--app-height', `${height}px`);
        if (stickToBottom) requestAnimationFrame(() => scrollToBottom(false));
    }
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
}

function scheduleViewportLock() {
    if (viewportRaf) return;
    viewportRaf = requestAnimationFrame(() => {
        viewportRaf = 0;
        lockMobileViewport();
    });
}

lockMobileViewport();
window.visualViewport?.addEventListener('resize', scheduleViewportLock);
window.visualViewport?.addEventListener('scroll', scheduleViewportLock);
window.addEventListener('resize', scheduleViewportLock);

function markActivity() {
    lastActivityTimestamp = Date.now();
}

document.addEventListener('visibilitychange', () => {
    const visible = document.visibilityState === 'visible';
    document.documentElement.classList.toggle('is-hidden', !visible);
    if (visible) {
        unreadCount = 0;
        document.title = defaultTitle;
        markActivity();
        kickPoll();
        scheduleReadPublish();
    }
});

['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((type) => {
    document.addEventListener(type, markActivity, { passive: true });
});
let lastMoveMark = 0;
document.addEventListener('mousemove', () => {
    const now = Date.now();
    if (now - lastMoveMark > 1000) {
        lastMoveMark = now;
        lastActivityTimestamp = now;
    }
}, { passive: true });
window.addEventListener('focus', () => {
    markActivity();
    kickPoll();
});
window.addEventListener('online', () => {
    setConnectionState(true);
    kickPoll();
});
window.addEventListener('offline', () => setConnectionState(false));

function setConnectionState(online) {
    UI.statusIndicator?.classList.toggle('is-offline', !online);
    if (UI.statusIndicator) UI.statusIndicator.title = online ? 'Соединение активно' : 'Нет соединения';
}

/* ==========================================================================
   Notification sound
   ========================================================================== */
function applyNotificationSoundSettings() {
    notificationSoundEnabled = localStorage.getItem('notificationSoundEnabled') !== 'false';
    const customSound = localStorage.getItem('notificationSoundDataUrl');
    const nextSrc = customSound || '/notification.mp3';
    if (notificationAudio.dataset.src !== nextSrc) {
        notificationAudio.dataset.src = nextSrc;
        notificationAudio.src = nextSrc;
    }
    if (UI.soundToggle) UI.soundToggle.checked = notificationSoundEnabled;
}

const likeAudio = new Audio('/like.mp3');
likeAudio.preload = 'auto';
likeAudio.volume = 0.9;

function playLikeSplash() {
    if (!notificationSoundEnabled || !notificationAudioUnlocked) return;
    try {
        const sound = likeAudio.cloneNode();
        sound.volume = 0.9;
        sound.play().catch(() => {});
    } catch (e) {}
}

async function unlockNotificationAudio() {
    if (notificationAudioUnlocked) return;
    try {
        notificationAudio.volume = 0;
        await notificationAudio.play();
        notificationAudio.pause();
        notificationAudio.currentTime = 0;
        notificationAudioUnlocked = true;
    } catch (e) {
        // Autoplay is blocked until a real gesture; try again later.
    } finally {
        notificationAudio.volume = 0.7;
    }
}

function playNotificationSound() {
    if (!notificationSoundEnabled || !notificationAudioUnlocked) return;
    try {
        notificationAudio.pause();
        notificationAudio.currentTime = 0;
        notificationAudio.play().catch(() => {});
    } catch (e) {}
}

document.addEventListener('pointerdown', unlockNotificationAudio, { once: true });
document.addEventListener('keydown', unlockNotificationAudio, { once: true });
applyNotificationSoundSettings();

function notifyNewMessages(count) {
    if (count <= 0) return;
    playNotificationSound();
    if (document.visibilityState !== 'visible') {
        unreadCount += count;
        document.title = `(${unreadCount}) ${defaultTitle}`;
    }
}

/* ==========================================================================
   Identity
   ========================================================================== */
const generateUUID = () => crypto.randomUUID();

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
    return hash;
}

const ADJECTIVES = ['Cyber', 'Node', 'Agent', 'Cipher', 'Void', 'Neon', 'Zero', 'Ghost', 'Flux', 'Sync', 'Echo', 'Nix', 'Hex', 'Byte'];
const NOUNS = ['Wolf', 'Fox', 'Link', 'Protocol', 'Core', 'Pulse', 'Ray', 'Shift', 'Sys', 'Daemon', 'Trace', 'Viper'];
const identityCache = new Map();
function generateIdentity(uuid) {
    const key = String(uuid || '');
    if (identityCache.has(key)) return identityCache.get(key);
    const hash = Math.abs(hashCode(key));
    const name = `${ADJECTIVES[hash % ADJECTIVES.length]}-${NOUNS[(hash >> 2) % NOUNS.length]} [${(hash % 100).toString().padStart(2, '0')}]`;
    let hue = hash % 360;
    if (hue >= 290 && hue <= 345) hue = (hue + 100) % 360; // avoid pink/magenta
    const identity = { name, color: `hsl(${hue}, 65%, 80%)` };
    identityCache.set(key, identity);
    return identity;
}

function safeCssColor(color, fallback) {
    if (typeof color !== 'string') return fallback;
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
    if (/^hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*\)$/.test(color)) return color;
    return fallback;
}

function colorFor(uuid) {
    return globalColorOverrides.get(uuid) || generateIdentity(uuid).color;
}

function displayName(uuid) {
    const iden = generateIdentity(uuid);
    return uuid === MY_ID ? `${iden.name} (Вы)` : iden.name;
}

function recentChatTurns() {
    const turns = [];
    UI.messages.querySelectorAll('.msg').forEach((node) => {
        const msg = fullMessageCache.get(messageDomId(node));
        const text = msg?.text?.trim();
        if (!text) return;
        const ai = msg.sender === 'ai-assistant';
        const quote = msg.replyTo?.text ? ` (в ответ на «${msg.replyTo.text.slice(0, 140)}»)` : '';
        turns.push({
            id: msg.id,
            ai,
            who: ai ? 'ИИ' : (msg.label || displayName(msg.sender)),
            text: `${text}${quote}`.slice(0, 500)
        });
    });
    return turns.slice(-20);
}

/* ==========================================================================
   Crypto (wire format unchanged)
   ========================================================================== */
async function generateKey() {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function exportKey(key) {
    const exported = await crypto.subtle.exportKey('raw', key);
    return bytesToBase64(new Uint8Array(exported)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importKey(base64) {
    base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return crypto.subtle.importKey('raw', base64ToBytes(base64), 'AES-GCM', true, ['encrypt', 'decrypt']);
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function encryptPayload(dataObj, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = textEncoder.encode(JSON.stringify(dataObj));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    const combined = new Uint8Array(12 + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), 12);
    return bytesToBase64(combined);
}

async function decryptPayload(base64, key) {
    try {
        const combined = base64ToBytes(base64);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.subarray(0, 12) }, key, combined.subarray(12));
        return JSON.parse(textDecoder.decode(decrypted));
    } catch (e) {
        return null;
    }
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function encryptFileToBlob(file, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await file.arrayBuffer());
    return new Blob([iv, encrypted], { type: 'application/octet-stream' });
}

async function decryptEncryptedBlob(encryptedBlob, key, mimeType) {
    const combined = new Uint8Array(await encryptedBlob.arrayBuffer());
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.subarray(0, 12) }, key, combined.subarray(12));
    return new Blob([decrypted], { type: mimeType || 'application/octet-stream' });
}

function mediaKind(type = '') {
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    return 'file';
}

function uploadBlobWithProgress(blob, file, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/media-api/upload');
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        // Header values must be ISO-8859-1; keep original behaviour but avoid throwing on non-latin names
        const safeName = /^[\x20-\x7e]*$/.test(file.name || '') ? (file.name || 'media') : encodeURIComponent(file.name || 'media');
        xhr.setRequestHeader('X-File-Name', safeName);
        xhr.setRequestHeader('X-File-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress?.(e.loaded / e.total);
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(new Error('Bad upload response')); }
            } else {
                reject(new Error(`Upload failed: ${xhr.status} ${xhr.responseText}`));
            }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(blob);
    });
}

async function uploadEncryptedMedia(file, index, total) {
    if (file.size > MAX_MEDIA_FILE_BYTES) {
        showToast('Лимит файла — 24 МБ', { type: 'error' });
        return null;
    }
    const prefix = total > 1 ? `${index + 1}/${total} · ` : '';
    showToast(`${prefix}Шифрование…`, { duration: 0 });
    const encryptedBlob = await encryptFileToBlob(file, currentKey);
    let lastPct = -1;
    try {
        const uploaded = await uploadBlobWithProgress(encryptedBlob, file, (ratio) => {
            const pct = Math.round(ratio * 100);
            if (pct !== lastPct) {
                lastPct = pct;
                showToast(`${prefix}Загрузка ${pct}%`, { duration: 0 });
            }
        });
        return {
            url: uploaded.url,
            name: file.name || 'media',
            mime: file.type || 'application/octet-stream',
            size: file.size,
            kind: mediaKind(file.type)
        };
    } catch (e) {
        console.error('Media upload failed:', e);
        showToast('Не удалось загрузить файл', { type: 'error' });
        return null;
    }
}

async function uploadEncryptedMediaFiles(files) {
    const uploaded = [];
    for (let index = 0; index < files.length; index++) {
        const item = await uploadEncryptedMedia(files[index], index, files.length);
        if (!item) return null;
        uploaded.push(item);
    }
    hideToast();
    return uploaded;
}

function estimatePayloadBytes(value) {
    return Math.ceil(value.length * 0.75);
}

/* ==========================================================================
   Composer state
   ========================================================================== */
function setAttachmentPreview({ image = null, audio = null, mediaFiles = [] } = {}) {
    pendingImageBase64 = image;
    pendingAudioBase64 = audio;
    pendingMediaFiles = mediaFiles;
    if (pendingMediaPreviewUrl) {
        URL.revokeObjectURL(pendingMediaPreviewUrl);
        pendingMediaPreviewUrl = null;
    }

    const { previewImg, previewAudio, previewFile } = UI;
    previewImg.src = image || '';
    previewAudio.src = audio || '';
    previewFile.textContent = '';
    previewImg.classList.toggle('hidden', !image);
    previewAudio.classList.toggle('hidden', !audio);
    previewFile.classList.add('hidden');

    if (mediaFiles.length > 0) {
        const firstFile = mediaFiles[0];
        pendingMediaPreviewUrl = URL.createObjectURL(firstFile);
        if (firstFile.type.startsWith('image/')) {
            previewImg.src = pendingMediaPreviewUrl;
            previewImg.classList.remove('hidden');
        } else if (firstFile.type.startsWith('audio/')) {
            previewAudio.src = pendingMediaPreviewUrl;
            previewAudio.classList.remove('hidden');
        }
        const total = mediaFiles.reduce((sum, file) => sum + file.size, 0);
        previewFile.textContent = mediaFiles.length === 1
            ? `${firstFile.name || 'media'} · ${formatBytes(firstFile.size)}`
            : `${mediaFiles.length} файла(ов) · ${formatBytes(total)}`;
        previewFile.classList.remove('hidden');
    }

    UI.attachmentPreview.classList.toggle('hidden', !image && !audio && mediaFiles.length === 0);
    updateComposerState();
}

function hasComposerContent() {
    return UI.input.value.trim().length > 0
        || !!pendingImageBase64
        || !!pendingAudioBase64
        || pendingMediaFiles.length > 0
        || !!editingTargetId;
}

function updateComposerState() {
    UI.mainInputContainer.classList.toggle('has-content', hasComposerContent());
}

function autoResizeInput() {
    const input = UI.input;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, IS_TOUCH ? 120 : 160)}px`;
}

function closeReplyPreview() {
    UI.replyPreview.classList.add('hidden');
    UI.replyPreview.classList.remove('is-editing');
}

function resetComposer() {
    UI.input.value = '';
    autoResizeInput();
    replyingTo = null;
    editingTargetId = null;
    closeReplyPreview();
    setAttachmentPreview();
}

function cancelReplyOrEdit() {
    const wasEditing = !!editingTargetId;
    replyingTo = null;
    editingTargetId = null;
    if (wasEditing) {
        UI.input.value = '';
        autoResizeInput();
    }
    closeReplyPreview();
    updateComposerState();
}

/* ==========================================================================
   Screens, toast, confirm buttons
   ========================================================================== */
function showScreen(screen) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s === screen));
}

let toastTimer = null;
function showToast(msg, { type = '', duration = 2400 } = {}) {
    const toast = UI.toast;
    toast.textContent = msg;
    toast.className = `toast show${type ? ` is-${type}` : ''}`;
    clearTimeout(toastTimer);
    if (duration > 0) toastTimer = setTimeout(hideToast, duration);
}

function hideToast() {
    clearTimeout(toastTimer);
    UI.toast.classList.remove('show');
}

/** First click arms the button, second click within `ms` confirms. */
function armConfirm(button, ms = 2600) {
    if (button.classList.contains('is-armed')) {
        clearTimeout(button._armTimer);
        button.classList.remove('is-armed');
        return true;
    }
    button.classList.add('is-armed');
    clearTimeout(button._armTimer);
    button._armTimer = setTimeout(() => button.classList.remove('is-armed'), ms);
    return false;
}

function disarm(button) {
    clearTimeout(button._armTimer);
    button.classList.remove('is-armed');
}

/* ==========================================================================
   Image viewer (pinch / wheel zoom, pan, double-tap, swipe-down to close)
   ========================================================================== */
function ensureImageViewer() {
    if (imageViewer) return imageViewer;

    const overlay = el('div', 'image-viewer hidden');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Просмотр изображения');

    const closeBtn = el('button', 'image-viewer-close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.innerHTML = '<span aria-hidden="true">&times;</span><span>Закрыть</span>';

    const stage = el('div', 'image-viewer-stage');
    const img = el('img', 'image-viewer-img');
    img.alt = 'Изображение';
    img.draggable = false;

    stage.appendChild(img);
    overlay.append(stage, closeBtn);
    document.body.appendChild(overlay);

    const state = {
        scale: 1, x: 0, y: 0,
        pointers: new Map(),
        startX: 0, startY: 0,
        startScale: 1, startDistance: 0, startMidpoint: null,
        lastMoveAt: 0, lastTap: 0,
        dismissY: 0, dismissing: false,
        returnFocus: null
    };

    const applyTransform = () => {
        img.style.transform = `translate3d(${state.x}px, ${state.y + state.dismissY}px, 0) scale(${state.scale})`;
        overlay.style.backgroundColor = state.dismissY
            ? `rgba(0,0,0,${Math.max(0.35, 0.95 - Math.abs(state.dismissY) / 500)})`
            : '';
    };

    const settle = () => {
        img.classList.add('is-settling');
        setTimeout(() => img.classList.remove('is-settling'), 300);
    };

    const clampPan = () => {
        if (state.scale <= 1) {
            state.x = 0;
            state.y = 0;
            return;
        }
        const baseWidth = img.offsetWidth;
        const baseHeight = img.offsetHeight;
        const maxX = Math.max(0, (baseWidth * state.scale - stage.clientWidth) / 2) + 80;
        const maxY = Math.max(0, (baseHeight * state.scale - stage.clientHeight) / 2) + 80;
        state.x = Math.max(-maxX, Math.min(maxX, state.x));
        state.y = Math.max(-maxY, Math.min(maxY, state.y));
    };

    const resetImage = () => {
        state.scale = 1;
        state.x = 0;
        state.y = 0;
        state.dismissY = 0;
        state.dismissing = false;
        state.pointers.clear();
        applyTransform();
    };

    const closeViewer = () => {
        overlay.classList.add('hidden');
        document.body.classList.remove('viewer-open');
        setTimeout(() => {
            if (overlay.classList.contains('hidden')) img.removeAttribute('src');
        }, 220);
        resetImage();
        state.returnFocus?.focus?.({ preventScroll: true });
    };

    const pointsArr = () => Array.from(state.pointers.values());
    const distanceBetweenPointers = () => {
        const p = pointsArr();
        return p.length < 2 ? 0 : Math.hypot(p[0].clientX - p[1].clientX, p[0].clientY - p[1].clientY);
    };
    const midpointBetweenPointers = () => {
        const p = pointsArr();
        return p.length < 2 ? null : { x: (p[0].clientX + p[1].clientX) / 2, y: (p[0].clientY + p[1].clientY) / 2 };
    };

    const zoomAt = (nextScale, point) => {
        const prevScale = state.scale;
        const scale = Math.max(1, Math.min(6, nextScale));
        if (point && prevScale !== scale) {
            const rect = stage.getBoundingClientRect();
            const originX = point.clientX - rect.left - rect.width / 2;
            const originY = point.clientY - rect.top - rect.height / 2;
            const ratio = scale / prevScale;
            state.x = originX - (originX - state.x) * ratio;
            state.y = originY - (originY - state.y) * ratio;
        }
        state.scale = scale;
        clampPan();
        applyTransform();
    };

    const openViewer = (src) => {
        state.returnFocus = document.activeElement;
        img.src = src;
        resetImage();
        img.classList.remove('is-opening');
        void img.offsetWidth;
        img.classList.add('is-opening');
        overlay.classList.remove('hidden');
        document.body.classList.add('viewer-open');
        closeBtn.focus({ preventScroll: true });
    };

    closeBtn.addEventListener('click', closeViewer);
    overlay.addEventListener('click', (e) => {
        if ((e.target === overlay || e.target === stage) && Date.now() - state.lastMoveAt > 180) closeViewer();
    });

    stage.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        stage.setPointerCapture(e.pointerId);
        state.pointers.set(e.pointerId, e);
        img.classList.remove('is-opening');

        const now = Date.now();
        if (state.pointers.size === 1 && now - state.lastTap < 280) {
            settle();
            zoomAt(state.scale > 1 ? 1 : 2.75, e);
            state.lastTap = 0;
        } else {
            state.lastTap = now;
        }

        if (state.pointers.size === 1) {
            state.startX = e.clientX - state.x;
            state.startY = e.clientY - state.y;
            state.dismissStartY = e.clientY;
        } else if (state.pointers.size === 2) {
            state.dismissY = 0;
            state.dismissing = false;
            state.startDistance = distanceBetweenPointers();
            state.startScale = state.scale;
            state.startMidpoint = midpointBetweenPointers();
        }
    });

    stage.addEventListener('pointermove', (e) => {
        if (!state.pointers.has(e.pointerId)) return;
        e.preventDefault();
        state.pointers.set(e.pointerId, e);

        if (state.pointers.size === 1) {
            if (state.scale > 1) {
                state.x = e.clientX - state.startX;
                state.y = e.clientY - state.startY;
                clampPan();
            } else {
                const dy = e.clientY - state.dismissStartY;
                if (Math.abs(dy) > 6) state.dismissing = true;
                if (state.dismissing) state.dismissY = dy;
            }
        } else if (state.pointers.size >= 2 && state.startDistance > 0) {
            const midpoint = midpointBetweenPointers() || state.startMidpoint;
            zoomAt(state.startScale * (distanceBetweenPointers() / state.startDistance), { clientX: midpoint.x, clientY: midpoint.y });
            state.lastMoveAt = Date.now();
            return;
        }
        applyTransform();
        state.lastMoveAt = Date.now();
    });

    const releasePointer = (e) => {
        state.pointers.delete(e.pointerId);
        if (state.dismissing && state.pointers.size === 0) {
            if (Math.abs(state.dismissY) > 110) {
                closeViewer();
                return;
            }
            state.dismissing = false;
            state.dismissY = 0;
            settle();
        }
        if (state.pointers.size === 1) {
            const point = pointsArr()[0];
            state.startX = point.clientX - state.x;
            state.startY = point.clientY - state.y;
        }
        clampPan();
        applyTransform();
    };

    stage.addEventListener('pointerup', releasePointer);
    stage.addEventListener('pointercancel', releasePointer);
    stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoomAt(state.scale * (1 + (e.deltaY > 0 ? -1 : 1) * 0.16), e);
    }, { passive: false });
    window.addEventListener('resize', () => {
        if (!overlay.classList.contains('hidden')) {
            clampPan();
            applyTransform();
        }
    });

    imageViewer = { open: openViewer, close: closeViewer, isOpen: () => !overlay.classList.contains('hidden') };
    return imageViewer;
}

/* ==========================================================================
   Presence
   ========================================================================== */
function myPresenceProfile() {
    const iden = generateIdentity(MY_ID);
    const color = safeCssColor(globalColorOverrides.get(MY_ID) || localStorage.getItem('customColor'), iden.color);
    return { sender: MY_ID, name: iden.name, color, away: presenceAway };
}

function syncTabPresence() {
    const away = document.visibilityState !== 'visible';
    if (away === presenceAway) return;
    presenceAway = away;
    lastOnlineSignature = '';
    if (!currentRoom || !currentKey || !presenceGeneration) return;
    beatPresence(presenceGeneration).catch((e) => console.error('Presence err:', e));
}

async function presenceUserId(sender, roomId) {
    const cacheKey = `${roomId}:${sender}`;
    if (presenceIdCache.key === cacheKey) return presenceIdCache.value;
    const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(cacheKey));
    const value = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    presenceIdCache = { key: cacheKey, value };
    return value;
}

let lastOnlineSignature = '';
function renderOnlineList(people, includeSelf = true) {
    const unique = new Map();
    for (const person of people) {
        if (!person?.sender) continue;
        const iden = generateIdentity(person.sender);
        unique.set(person.sender, {
            sender: person.sender,
            name: iden.name,
            color: safeCssColor(person.color, iden.color),
            away: person.sender === MY_ID ? presenceAway : !!person.away
        });
    }
    if (includeSelf && currentRoom) unique.set(MY_ID, myPresenceProfile());
    const sorted = [...unique.values()].sort((a, b) => {
        if (a.sender === MY_ID) return -1;
        if (b.sender === MY_ID) return 1;
        return a.name.localeCompare(b.name, 'ru');
    });

    const signature = sorted.map((p) => `${p.sender}:${p.color}:${p.away ? 1 : 0}`).join('|');
    if (signature === lastOnlineSignature) return;
    lastOnlineSignature = signature;

    UI.onlineCount.textContent = String(sorted.length);
    UI.onlineBtn.title = `Онлайн: ${sorted.length}`;
    const title = UI.onlineList.previousElementSibling;
    if (title) title.textContent = `онлайн · ${sorted.length}`;

    const dots = document.createDocumentFragment();
    sorted.slice(0, 3).forEach((person) => {
        const dot = el('span');
        dot.style.color = person.color;
        dots.appendChild(dot);
    });
    UI.onlineDots.replaceChildren(dots);

    const list = document.createDocumentFragment();
    for (const person of sorted) {
        const row = el('div', `online-person${person.away ? ' is-away' : ''}`);
        const dot = el('span', 'online-dot');
        dot.style.color = person.color;
        dot.style.background = person.color;
        const name = el('span', 'online-name', person.sender === MY_ID ? `${person.name} (вы)` : person.name);
        name.style.color = person.color;
        const status = el('span', 'online-status', person.away ? 'отошёл' : 'тут');
        row.append(dot, name, status);
        list.appendChild(row);
    }
    UI.onlineList.replaceChildren(list);
}

async function beatPresence(generation) {
    if (!currentRoom || !currentKey || generation !== presenceGeneration) return;
    const profile = myPresenceProfile();
    const userId = await presenceUserId(profile.sender, currentRoom);
    const payload = await encryptPayload({ type: 'presence', sender: profile.sender, color: profile.color, away: !!profile.away }, currentKey);
    const posted = await fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: currentRoom, user_id: userId, payload })
    });
    if (!posted.ok || generation !== presenceGeneration) return;
    const res = await fetch(`/api/presence?room=${encodeURIComponent(currentRoom)}&t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok || generation !== presenceGeneration) return;
    const rows = await res.json();
    const decoded = await Promise.all(rows.map((row) => decryptPayload(row.payload, currentKey)));
    const people = decoded.filter((data) => data?.type === 'presence' && data.sender);
    if (generation === presenceGeneration) renderOnlineList(people);
}

function startPresence() {
    const generation = ++presenceGeneration;
    clearTimeout(presenceTimer);
    renderOnlineList([]);
    const tick = async () => {
        if (generation !== presenceGeneration) return;
        try {
            await beatPresence(generation);
        } catch (e) {
            console.error('Presence err:', e);
        }
        if (generation === presenceGeneration) {
            presenceTimer = setTimeout(tick, document.visibilityState === 'visible' ? PRESENCE_BEAT_MS : 15000);
        }
    };
    tick();
}

function leavePresence() {
    const room = currentRoom;
    presenceGeneration++;
    clearTimeout(presenceTimer);
    presenceTimer = null;
    renderOnlineList([], false);
    if (!room) return;
    presenceUserId(MY_ID, room).then((userId) => {
        fetch(`/api/presence?room=${encodeURIComponent(room)}&user_id=${userId}`, { method: 'DELETE', keepalive: true }).catch(() => {});
    }).catch(() => {});
}

/* ==========================================================================
   Polling
   ========================================================================== */
function getPollInterval() {
    if (document.visibilityState !== 'visible') return POLL_HIDDEN_INTERVAL_MS;
    const backoff = Math.min(consecutivePollErrors, 4) * 1500;
    const inactiveTime = Date.now() - Math.max(lastActivityTimestamp, lastMessageReceiveTimestamp);
    return (inactiveTime > 60000 ? POLL_IDLE_INTERVAL_MS : POLL_ACTIVE_INTERVAL_MS) + backoff;
}

function schedulePoll(delay = getPollInterval()) {
    clearTimeout(pollTimeout);
    const generation = pollGeneration;
    pollTimeout = setTimeout(() => pollMessages(generation), delay);
}

function kickPoll() {
    if (!currentRoom || !currentKey) return;
    if (pollInFlight) {
        pollKickRequested = true;
        pollAbortController?.abort();
        return;
    }
    schedulePoll(0);
}

function clearLocalMessages() {
    UI.messages.querySelectorAll('.msg').forEach((node) => {
        const id = messageDomId(node);
        renderedMsgIds.delete(id);
        fullMessageCache.delete(id);
        node.remove();
    });
    selectedMessages.clear();
    updateSelectionBar();
    retryPayloads.clear();
    if (editingTargetId || replyingTo) cancelReplyOrEdit();
    unseenBelow = 0;
    publishedReadTs = 0;
    readByOthersTs = 0;
    readEvents = [];
    clearTimeout(readPublishTimer);
    updateScrollDownButton();
    updateEmptyState();
}

function viewedReadTs() {
    if (document.visibilityState !== 'visible' || !UI.messages) return 0;
    const root = UI.messages.getBoundingClientRect();
    let max = 0;
    UI.messages.querySelectorAll('.msg').forEach((node) => {
        const box = node.getBoundingClientRect();
        if (box.top >= root.bottom - 4) return;
        const ts = Number(node.dataset.ts) || 0;
        if (ts > max) max = ts;
    });
    return max;
}

function readersOf(msg) {
    const by = new Map();
    for (const event of readEvents) {
        if (event.upTo < msg.ts) continue;
        const prev = by.get(event.reader);
        if (!prev || event.at < prev.at) by.set(event.reader, event);
    }
    return [...by.values()].sort((a, b) => a.at - b.at);
}

function paintReadReceipts() {
    fullMessageCache.forEach((msg) => {
        if (msg.sender !== MY_ID || !(msg.ts > 0)) return;
        const people = readersOf(msg);
        const node = $(`msg-${msg.id}`);
        if (!node || node.classList.contains('msg-pending') || node.classList.contains('msg-failed')) return;
        const status = node.querySelector('.msg-status');
        if (!status) return;
        if (!people.length) {
            node.dataset.read = '';
            status.classList.remove('is-read');
            status.querySelector('.msg-read')?.remove();
            return;
        }
        node.dataset.read = '1';
        setStatusIcon(node, ICONS.checks, 'Прочитано');
        const fresh = node.querySelector('.msg-status');
        fresh?.classList.add('is-read');
        if (!fresh) return;
        let tip = fresh.querySelector('.msg-read');
        if (!tip) {
            tip = el('div', 'msg-read');
            fresh.appendChild(tip);
        }
        tip.replaceChildren(...people.map((person) => {
            const row = el('div', 'msg-read-row');
            row.append(
                el('span', 'msg-read-name', displayName(person.reader)),
                el('span', 'msg-read-time', formatTime(person.at))
            );
            return row;
        }));
    });
}

function noteRead(reader, upTo, at) {
    const ts = Number(upTo) || 0;
    const when = Number(at) || Date.now();
    if (!reader || reader === MY_ID || reader === 'ai-assistant' || !ts) return;
    if (readEvents.some((event) => event.reader === reader && event.upTo >= ts)) return;
    readEvents.push({ reader, upTo: ts, at: when });
    if (ts > readByOthersTs) readByOthersTs = ts;
    paintReadReceipts();
}

function scheduleReadPublish() {
    clearTimeout(readPublishTimer);
    readPublishTimer = setTimeout(publishReadCursor, 500);
}

async function publishReadCursor() {
    if (!currentRoom || !currentKey || document.visibilityState !== 'visible') return;
    const ts = viewedReadTs();
    if (!ts || ts <= publishedReadTs) return;
    publishedReadTs = ts;
    const ghost = {
        type: 'read_sync',
        reader: MY_ID,
        upTo: ts,
        id: generateUUID(),
        sender: MY_ID,
        ts: Date.now()
    };
    try {
        await postPayload(ghost, await encryptPayload(ghost, currentKey));
    } catch (e) {
        publishedReadTs = Math.min(publishedReadTs, ts - 1);
    }
}

function applyIncoming(decrypted) {
    if (decrypted.type === 'clear_sync') {
        clearLocalMessages();
        return 0;
    }
    if (decrypted.type === 'delete_sync') {
        removeMessageById(decrypted.targetId);
        return 0;
    }
    if (decrypted.type === 'read_sync') {
        noteRead(decrypted.reader, decrypted.upTo, decrypted.ts);
        return 0;
    }
    if (decrypted.type === 'heart_sync') {
        const cached = fullMessageCache.get(decrypted.targetId);
        if (cached && decrypted.actor) {
            const hearts = heartIds(cached).filter((sender) => sender !== decrypted.actor);
            if (decrypted.on) hearts.push(decrypted.actor);
            cached.hearts = hearts;
            paintHearts($(`msg-${cached.id}`), cached);
            if (decrypted.on && initialSyncDone && decrypted.actor !== MY_ID) playLikeSplash();
        }
        return 0;
    }
    if (decrypted.type === 'edit_sync') {
        const cached = fullMessageCache.get(decrypted.targetId);
        if (cached) {
            cached.text = decrypted.text;
            if (decrypted.image) cached.image = decrypted.image;
            if (decrypted.audio) cached.audio = decrypted.audio;
            cached.edited = true;
            updateDOMMessage(cached);
        }
        return 0;
    }
    if (renderedMsgIds.has(decrypted.id)) {
        // Our own optimistic message echoed back by the server
        const existing = fullMessageCache.get(decrypted.id);
        if (existing && !existing.db_id) {
            existing.db_id = decrypted.db_id;
            markMessageSent(existing);
        }
        return 0;
    }
    fullMessageCache.set(decrypted.id, decrypted);
    const node = renderMessage(decrypted, { animate: initialSyncDone });
    return node && decrypted.sender !== MY_ID ? 1 : 0;
}

async function pollMessages(generation = pollGeneration) {
    if (!currentRoom || !currentKey || generation !== pollGeneration || pollInFlight) return;
    pollInFlight = true;
    pollAbortController = new AbortController();
    const controller = pollAbortController;
    const timeoutId = setTimeout(() => controller.abort(), POLL_REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`/api/messages?room=${encodeURIComponent(currentRoom)}&since_id=${lastSeenMessageId}&t=${Date.now()}`, {
            cache: 'no-store',
            signal: controller.signal
        });
        if (generation !== pollGeneration) return;
        if (res.ok) {
            const msgs = await res.json();
            if (consecutivePollErrors > 0) setConnectionState(true);
            consecutivePollErrors = 0;
            if (msgs.length > 0) {
                // Decrypt in parallel, apply in order
                const decryptedList = await Promise.all(msgs.map((m) => decryptPayload(m.payload, currentKey)));
                if (generation !== pollGeneration) return;
                const wasAtBottom = isNearBottom();
                let incoming = 0;
                for (let i = 0; i < msgs.length; i++) {
                    lastSeenMessageId = Math.max(lastSeenMessageId, msgs[i].id);
                    const decrypted = decryptedList[i];
                    if (!decrypted) continue;
                    decrypted.db_id = msgs[i].id;
                    incoming += applyIncoming(decrypted);
                }
                if (incoming > 0) lastMessageReceiveTimestamp = Date.now();
                updateEmptyState();
                if (!initialSyncDone || wasAtBottom) {
                    scrollToBottom(initialSyncDone);
                } else if (incoming > 0) {
                    unseenBelow += incoming;
                    updateScrollDownButton();
                }
                if (initialSyncDone) notifyNewMessages(incoming);
                scheduleReadPublish();
            }
            if (!initialSyncDone) {
                initialSyncDone = true;
                updateEmptyState();
                scrollToBottom(false);
            }
        } else {
            consecutivePollErrors++;
            console.error('Poll failed:', res.status, await res.text());
            if (consecutivePollErrors === 3) {
                setConnectionState(false);
                showToast(`Нет синхронизации (${res.status})`, { type: 'error' });
            }
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            consecutivePollErrors++;
            if (consecutivePollErrors >= 3) setConnectionState(false);
            console.error('Poll err:', e);
        }
    } finally {
        clearTimeout(timeoutId);
        if (pollAbortController === controller) {
            pollInFlight = false;
            pollAbortController = null;
        }
        if (generation === pollGeneration && currentRoom && currentKey) {
            schedulePoll(pollKickRequested ? 0 : getPollInterval());
        }
        pollKickRequested = false;
    }
}

/* ==========================================================================
   Sending
   ========================================================================== */
async function postPayload(payloadObj, encrypted) {
    const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: currentRoom, payload: encrypted })
    });
    if (!res.ok) throw new Error(`Send failed: ${res.status} ${await res.text()}`);
    const saved = await res.json();
    if (saved.id) {
        payloadObj.db_id = saved.id;
        lastSeenMessageId = Math.max(lastSeenMessageId, saved.id);
    }
    return saved;
}

async function deliver(payloadObj, encrypted) {
    const room = currentRoom;
    try {
        await postPayload(payloadObj, encrypted);
        if (room === currentRoom) {
            markMessageSent(payloadObj);
            paintReadReceipts();
        }
        return true;
    } catch (e) {
        console.error('Send err:', e);
        if (room === currentRoom) {
            markMessageFailed(payloadObj, encrypted);
            showToast('Сообщение не отправлено', { type: 'error' });
        }
        return false;
    }
}

async function sendEdit(text, imgBase64, audioBase64) {
    const cachedMsg = fullMessageCache.get(editingTargetId);
    if (!cachedMsg || !cachedMsg.db_id) {
        showToast('Сообщение ещё отправляется', { type: 'error' });
        return false;
    }
    const targetId = editingTargetId;
    cachedMsg.text = text;
    if (imgBase64) cachedMsg.image = imgBase64;
    if (audioBase64) cachedMsg.audio = audioBase64;
    cachedMsg.edited = true;
    updateDOMMessage(cachedMsg); // optimistic

    const ghostPayload = {
        type: 'edit_sync', targetId, id: generateUUID(),
        text, image: imgBase64, audio: audioBase64, sender: MY_ID, edited: true,
        customColor: localStorage.getItem('customColor') || undefined
    };
    const [encryptedGhost, encryptedMain] = await Promise.all([
        encryptPayload(ghostPayload, currentKey),
        encryptPayload(cachedMsg, currentKey)
    ]);
    resetComposer();
    clearSelection();

    const results = await Promise.allSettled([
        fetch('/api/messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_id: currentRoom, payload: encryptedGhost })
        }),
        fetch(`/api/messages?id=${cachedMsg.db_id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: encryptedMain })
        })
    ]);
    if (results.some((r) => r.status === 'rejected' || !r.value.ok)) {
        showToast('Не удалось сохранить изменения', { type: 'error' });
    }
    return true;
}

async function sendMessage(text, imgBase64 = null, audioBase64 = null, mediaFiles = []) {
    if (!currentRoom || !currentKey) return false;
    if (editingTargetId) return sendEdit(text, imgBase64, audioBase64);
    if (!text && !imgBase64 && !audioBase64 && mediaFiles.length === 0) return false;

    const uploadedMediaItems = mediaFiles.length > 0 ? await uploadEncryptedMediaFiles(mediaFiles) : [];
    if (mediaFiles.length > 0 && !uploadedMediaItems) return false;
    const firstMedia = uploadedMediaItems[0] || null;

    const payloadObj = {
        type: firstMedia ? 'media' : (audioBase64 ? 'audio' : (imgBase64 ? 'image' : 'text')),
        text,
        image: imgBase64,
        audio: audioBase64,
        media: firstMedia,
        mediaItems: uploadedMediaItems,
        id: generateUUID(),
        replyTo: replyingTo,
        sender: MY_ID,
        ts: Date.now(),
        customColor: localStorage.getItem('customColor') || undefined
    };

    let encrypted;
    try {
        encrypted = await encryptPayload(payloadObj, currentKey);
    } catch (e) {
        console.error('Encrypt err:', e);
        showToast('Ошибка шифрования', { type: 'error' });
        return false;
    }
    const encryptedBytes = estimatePayloadBytes(encrypted);
    if (encryptedBytes > MAX_ENCRYPTED_PAYLOAD_BYTES) {
        showToast(`Слишком большое сообщение: ${Math.ceil(encryptedBytes / 1024)} KB`, { type: 'error' });
        return false;
    }

    // Optimistic UI: show immediately, confirm when the server answers
    resetComposer();
    if (!IS_TOUCH) UI.input.focus();
    renderMessage(payloadObj, { animate: true, pending: true });
    updateEmptyState();
    scrollToBottom(true);
    deliver(payloadObj, encrypted);
    return true;
}

async function handleSend() {
    if (isSending) return;
    if (mediaRecorder?.state === 'recording') {
        mediaRecorder.stop();
        return;
    }
    const text = UI.input.value.trim();
    if (!hasComposerContent()) return;
    if (!editingTargetId && replyingTo?.sender === 'ai-assistant' && text && !pendingImageBase64 && !pendingAudioBase64 && pendingMediaFiles.length === 0) {
        await askAssistant();
        return;
    }
    isSending = true;
    const heavy = pendingMediaFiles.length > 0;
    if (heavy) {
        UI.sendBtn.classList.add('is-busy');
        UI.sendBtn.disabled = true;
    }
    try {
        await sendMessage(text, pendingImageBase64, pendingAudioBase64, pendingMediaFiles);
    } finally {
        isSending = false;
        UI.sendBtn.classList.remove('is-busy');
        UI.sendBtn.disabled = false;
        updateComposerState();
    }
}

/* ==========================================================================
   Links
   ========================================================================== */
const LINK_RE = /(?:(?:https?:\/\/|www\.)[^\s<>"']+|(?<![\w@./])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|ru|net|org|io|dev|app|me|gg|tv|co|ai|info|biz|xyz|link|ly|su|ua|by|kz|de|uk|fr|eu|site|online|store|shop|pro|cc|gl|be|it|nl|se|no|fi|pl|cz|ch|at|es|pt|br|in|jp|kr|cn|au|nz|ca|us|edu|gov|tech|chat|wiki|cloud|page|live|one)(?:\/[^\s<>"']*)?)/gi;

function splitTrailingPunctuation(raw) {
    let url = raw;
    let trail = '';
    const closers = { ')': '(', ']': '[', '}': '{' };
    while (url.length > 0) {
        const last = url[url.length - 1];
        if (/[.,;:!?…»]/.test(last)) {
            trail = last + trail;
            url = url.slice(0, -1);
            continue;
        }
        const opener = closers[last];
        if (opener && url.split(opener).length <= url.split(last).length) {
            trail = last + trail;
            url = url.slice(0, -1);
            continue;
        }
        break;
    }
    return { url, trail };
}

function linkHref(url) {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function fillTextWithLinks(el, text) {
    el.replaceChildren();
    if (!text) return;
    const re = new RegExp(LINK_RE.source, 'gi');
    let last = 0;
    for (const match of text.matchAll(re)) {
        const raw = match[0];
        const { url, trail } = splitTrailingPunctuation(raw);
        if (!url || !/[a-z0-9]/i.test(url)) {
            continue;
        }
        if (match.index > last) el.appendChild(document.createTextNode(text.slice(last, match.index)));
        const anchor = document.createElement('a');
        anchor.className = 'msg-link';
        anchor.href = linkHref(url);
        anchor.textContent = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.addEventListener('click', (e) => e.stopPropagation());
        el.appendChild(anchor);
        if (trail) el.appendChild(document.createTextNode(trail));
        last = match.index + raw.length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

/* ==========================================================================
   Rendering
   ========================================================================== */
const retryPayloads = new Map(); // id -> encrypted payload for failed sends

function isNearBottom() {
    const m = UI.messages;
    return m.scrollHeight - m.scrollTop - m.clientHeight < STICK_THRESHOLD_PX;
}

function scrollToBottom(smooth = false) {
    const m = UI.messages;
    if (smooth && !REDUCED_MOTION) m.scrollTo({ top: m.scrollHeight, behavior: 'smooth' });
    else m.scrollTop = m.scrollHeight;
    stickToBottom = true;
    unseenBelow = 0;
    updateScrollDownButton();
}

function maybeStick() {
    if (stickToBottom) UI.messages.scrollTop = UI.messages.scrollHeight;
}

function updateScrollDownButton() {
    const show = !stickToBottom && UI.messages.scrollHeight - UI.messages.clientHeight > 200;
    UI.scrollDown.classList.toggle('hidden', !show);
    UI.scrollDownBadge.classList.toggle('hidden', unseenBelow === 0);
    UI.scrollDownBadge.textContent = unseenBelow > 99 ? '99+' : String(unseenBelow);
}

let scrollRaf = 0;
UI.messages.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        stickToBottom = isNearBottom();
        if (stickToBottom) unseenBelow = 0;
        updateScrollDownButton();
        scheduleReadPublish();
    });
}, { passive: true });

UI.scrollDown.addEventListener('click', () => scrollToBottom(true));

function updateEmptyState() {
    const hasMessages = !!UI.messages.querySelector('.msg');
    let empty = UI.messages.querySelector('.empty-state');
    if (hasMessages || !initialSyncDone || !currentRoom) {
        empty?.remove();
        return;
    }
    if (empty) return;
    empty = el('div', 'empty-state');
    const icon = el('div', 'empty-icon');
    icon.innerHTML = ICONS.lock;
    const title = el('h3', null, 'Канал зашифрован');
    const text = el('p', null, 'Сообщений пока нет. Отправьте ссылку‑приглашение — ключ находится только в ней.');
    const btn = el('button', 'menu-action', 'Скопировать приглашение');
    btn.type = 'button';
    btn.addEventListener('click', copyInviteLink);
    empty.append(icon, title, text, btn);
    UI.messages.appendChild(empty);
}

/* Grouping of consecutive messages from one sender */
function prevMessageEl(node) {
    let prev = node.previousElementSibling;
    while (prev && (!prev.classList.contains('msg') || prev.classList.contains('msg-removing'))) prev = prev.previousElementSibling;
    return prev;
}

function nextMessageEl(node) {
    let next = node.nextElementSibling;
    while (next && (!next.classList.contains('msg') || next.classList.contains('msg-removing'))) next = next.nextElementSibling;
    return next;
}

function applyGrouping(node) {
    if (!node) return;
    const prev = prevMessageEl(node);
    let grouped = false;
    if (prev && prev.dataset.owner === node.dataset.owner && !node.classList.contains('has-quote')) {
        const a = Number(prev.dataset.ts) || 0;
        const b = Number(node.dataset.ts) || 0;
        grouped = !a || !b || Math.abs(b - a) < GROUP_WINDOW_MS;
    }
    node.classList.toggle('msg-cont', grouped);
}

function buildStatus(msg) {
    const status = el('span', 'msg-status');
    status.innerHTML = ICONS.check;
    status.title = 'Доставлено';
    return status;
}

function buildMeta(msg, isMe) {
    const meta = el('span', 'msg-meta');
    const edited = el('span', 'msg-edited', msg.edited ? 'изм.' : '');
    if (!msg.edited) edited.hidden = true;
    meta.appendChild(edited);
    const time = formatTime(msg.ts);
    if (time) {
        const t = el('time', null, time);
        t.dateTime = new Date(msg.ts).toISOString();
        t.title = new Date(msg.ts).toLocaleString('ru-RU');
        meta.appendChild(t);
    }
    if (isMe) meta.appendChild(buildStatus(msg));
    return meta;
}

function setStatusIcon(node, icon, title) {
    const status = node?.querySelector('.msg-status');
    if (!status) return;
    status.innerHTML = icon;
    status.title = title;
}

function markMessageSent(msg) {
    const node = $(`msg-${msg.id}`);
    retryPayloads.delete(msg.id);
    if (!node) return;
    node.classList.remove('msg-pending', 'msg-failed');
    node.querySelector('.msg-retry')?.remove();
    if (msg.db_id) node.dataset.dbid = msg.db_id;
    if (node.dataset.read === '1') {
        setStatusIcon(node, ICONS.checks, 'Прочитано');
        node.querySelector('.msg-status')?.classList.add('is-read');
        return;
    }
    setStatusIcon(node, ICONS.check, 'Доставлено');
}

function markMessageFailed(msg, encrypted) {
    const node = $(`msg-${msg.id}`);
    retryPayloads.set(msg.id, encrypted);
    if (!node) return;
    node.classList.remove('msg-pending');
    node.classList.add('msg-failed');
    setStatusIcon(node, ICONS.alert, 'Не отправлено');
    if (!node.querySelector('.msg-retry')) {
        const retry = el('button', 'msg-retry', 'Повторить');
        retry.type = 'button';
        retry.addEventListener('click', (e) => {
            e.stopPropagation();
            const payload = retryPayloads.get(msg.id);
            if (!payload) return;
            retry.remove();
            node.classList.remove('msg-failed');
            node.classList.add('msg-pending');
            setStatusIcon(node, ICONS.clock, 'Отправка…');
            deliver(msg, payload);
        });
        node.querySelector('.msg-meta')?.appendChild(retry);
    }
}

function buildHoverActions(msg, isMe) {
    if (IS_TOUCH) return null;
    const bar = el('div', 'msg-actions');
    const make = (icon, title, handler) => {
        const b = el('button');
        b.type = 'button';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.innerHTML = icon;
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            handler();
        });
        bar.appendChild(b);
    };
    make(ICONS.reply, 'Ответить', () => startReply(msg.id));
    if (msg.text) make(ICONS.copy, 'Копировать текст', async () => {
        const ok = await writeClipboardText(fullMessageCache.get(msg.id)?.text || '');
        showToast(ok ? 'Скопировано' : 'Не удалось скопировать', { type: ok ? 'success' : 'error' });
    });
    if (isMe) make(ICONS.edit, 'Изменить', () => startEdit(msg.id));
    return bar;
}

function heartIds(msg) {
    return Array.isArray(msg?.hearts) ? msg.hearts.filter((id) => typeof id === 'string' && id) : [];
}

function paintHearts(node, msg) {
    if (!node) return;
    const meta = node.querySelector('.msg-meta');
    if (!meta) return;
    let btn = meta.querySelector('.msg-heart');
    if (!btn) {
        btn = el('button', 'msg-heart');
        btn.type = 'button';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleHeart(msg.id);
        });
        meta.appendChild(btn);
    }
    const ids = heartIds(msg);
    const mine = ids.includes(MY_ID);
    btn.classList.toggle('is-on', mine);
    btn.title = mine ? 'Убрать сердечко' : 'Поставить сердечко';
    btn.setAttribute('aria-label', btn.title);
    btn.replaceChildren(document.createTextNode(mine ? '♥' : '♡'));
    if (ids.length) btn.append(el('span', 'msg-heart-count', String(ids.length)));
}

async function toggleHeart(id) {
    const cached = fullMessageCache.get(id);
    if (!cached || !currentRoom || !currentKey) return;
    const had = heartIds(cached).includes(MY_ID);
    const hearts = heartIds(cached).filter((sender) => sender !== MY_ID);
    if (!had) hearts.push(MY_ID);
    cached.hearts = hearts;
    paintHearts($(`msg-${id}`), cached);
    if (!had) playLikeSplash();
    try {
        const ghost = {
            type: 'heart_sync',
            targetId: id,
            actor: MY_ID,
            on: !had,
            id: generateUUID(),
            sender: MY_ID,
            ts: Date.now()
        };
        await postPayload(ghost, await encryptPayload(ghost, currentKey));
        if (cached.db_id) {
            await fetch(`/api/messages?id=${cached.db_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payload: await encryptPayload(cached, currentKey) })
            });
        }
    } catch (e) {
        cached.hearts = had ? [...heartIds(cached).filter((sender) => sender !== MY_ID), MY_ID] : heartIds(cached).filter((sender) => sender !== MY_ID);
        paintHearts($(`msg-${id}`), cached);
        showToast('Сердечко не сохранилось', { type: 'error' });
    }
}

function updateDOMMessage(msg) {
    const node = $(`msg-${msg.id}`);
    if (!node) return;
    const body = node.querySelector('.msg-body');
    let p = node.querySelector('.msg-payload-text');
    if (msg.text) {
        if (!p) {
            p = el('div', 'msg-payload-text');
            body.prepend(p);
        }
        fillTextWithLinks(p, msg.text);
    } else if (p) {
        p.remove();
    }
    if (msg.edited) {
        const edited = node.querySelector('.msg-edited');
        if (edited) {
            edited.hidden = false;
            edited.textContent = 'изм.';
            edited.title = 'Изменено';
        }
    }
}

const lazyImageObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            lazyImageObserver.unobserve(entry.target);
            entry.target._load?.();
        });
    }, { root: UI.messages, rootMargin: '600px 0px' })
    : null;

async function openEncryptedMedia(media, button, box) {
    if (!media?.url || !currentKey) return;
    const room = currentRoom;
    const originalText = button ? button.textContent : '';
    if (button) {
        button.disabled = true;
        button.textContent = 'Расшифровка…';
    }
    try {
        const res = await fetch(media.url, { cache: 'force-cache' });
        if (!res.ok) throw new Error(`Media fetch failed: ${res.status}`);
        const decryptedBlob = await decryptEncryptedBlob(await res.blob(), currentKey, media.mime);
        if (room !== currentRoom) return;
        const objectUrl = trackObjectUrl(URL.createObjectURL(decryptedBlob));
        box.replaceChildren();
        box.classList.remove('is-loading');
        box.classList.add('has-media');

        if (media.kind === 'image') {
            const img = el('img', 'msg-img');
            img.alt = media.name || 'Изображение';
            img.decoding = 'async';
            img.onload = maybeStick;
            img.src = objectUrl;
            box.appendChild(img);
        } else if (media.kind === 'video') {
            const video = el('video', 'msg-video');
            video.src = objectUrl;
            video.controls = true;
            video.playsInline = true;
            video.preload = 'metadata';
            video.onloadedmetadata = maybeStick;
            box.appendChild(video);
            video.play().catch(() => {});
        } else if (media.kind === 'audio') {
            const audio = el('audio', 'msg-audio');
            audio.src = objectUrl;
            audio.controls = true;
            box.appendChild(audio);
            audio.play().catch(() => {});
        } else {
            const link = el('a', 'media-open', `Скачать · ${media.name || 'файл'}`);
            link.href = objectUrl;
            link.download = media.name || 'media';
            box.appendChild(link);
            link.click();
        }
    } catch (e) {
        console.error('Open media failed:', e);
        if (room !== currentRoom) return;
        box.classList.remove('is-loading');
        if (!box.querySelector('.media-open')) {
            // Image auto-load failed: show the manual button instead of a skeleton
            box.replaceChildren(...buildMediaCard(media, box));
        }
        showToast('Не удалось открыть файл', { type: 'error' });
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

function buildMediaCard(media, box) {
    const kind = el('div', 'media-kind');
    kind.innerHTML = ICONS[media.kind] || ICONS.file;
    const info = el('div', 'media-info');
    info.append(el('span', 'media-label', media.name || 'media'), el('span', 'media-size', formatBytes(media.size)));
    const button = el('button', 'media-open', media.kind === 'video' ? 'Смотреть' : (media.kind === 'audio' ? 'Слушать' : 'Открыть'));
    button.type = 'button';
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        openEncryptedMedia(media, button, box);
    });
    return [kind, info, button];
}

function renderMediaItem(media) {
    const box = el('div', 'media-box');
    if (media.kind === 'image') {
        box.classList.add('is-loading');
        box.append(...buildMediaCard(media, box));
        box._load = () => openEncryptedMedia(media, null, box);
        if (lazyImageObserver) lazyImageObserver.observe(box);
        else box._load();
    } else {
        box.append(...buildMediaCard(media, box));
    }
    return box;
}

function buildQuote(replyTo) {
    const quoteBox = el('div', 'quote-block');
    const quoteColor = safeCssColor(globalColorOverrides.get(replyTo.sender) || replyTo.color, generateIdentity(replyTo.sender).color);
    quoteBox.dataset.quoteOwner = replyTo.sender || '';
    quoteBox.style.setProperty('--quote', quoteColor);
    const qAuth = el('div', 'quote-author', replyTo.name || generateIdentity(replyTo.sender).name);
    const qText = el('div', 'quote-text');
    fillTextWithLinks(qText, replyTo.text);
    quoteBox.append(qAuth, qText);
    quoteBox.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('a') || messageTextSelectionActive()) return;
        const targetEl = $(`msg-${replyTo.id}`);
        if (targetEl) {
            targetEl.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'center' });
            targetEl.classList.remove('highlight-pulse');
            void targetEl.offsetWidth;
            targetEl.classList.add('highlight-pulse');
            setTimeout(() => targetEl.classList.remove('highlight-pulse'), 1400);
        } else {
            showToast('Исходное сообщение недоступно');
        }
    });
    return quoteBox;
}

function renderMessage(msg, { animate = false, pending = false } = {}) {
    if (!msg?.id || renderedMsgIds.has(msg.id)) return null;
    renderedMsgIds.add(msg.id);
    fullMessageCache.set(msg.id, msg);

    if (msg.customColor && msg.sender) applyDynamicColor(msg.sender, msg.customColor);

    const isMe = msg.sender === MY_ID;
    const isAi = msg.sender === 'ai-assistant';
    const node = el('div', `msg ${isMe ? 'msg-out' : 'msg-in'}${isAi ? ' msg-ai' : ''}`);
    node.id = `msg-${msg.id}`;
    node.dataset.owner = msg.sender || '';
    if (msg.ts) node.dataset.ts = String(msg.ts);
    if (msg.db_id) node.dataset.dbid = msg.db_id;
    if (!globalColorOverrides.has(msg.sender)) node.style.setProperty('--sender', generateIdentity(msg.sender).color);
    if (animate && !REDUCED_MOTION) {
        node.classList.add('msg-enter');
        node.addEventListener('animationend', () => node.classList.remove('msg-enter'), { once: true });
    }
    if (pending) node.classList.add('msg-pending');

    const header = el('div', 'msg-header');
    const nameSpan = el('span', 'msg-name', msg.label || displayName(msg.sender));
    nameSpan.dataset.owner = msg.sender || '';
    header.appendChild(nameSpan);
    node.appendChild(header);

    if (msg.replyTo) {
        node.classList.add('has-quote');
        node.appendChild(buildQuote(msg.replyTo));
    }

    if (msg.image) {
        const img = el('img', 'msg-img');
        img.alt = 'Изображение';
        img.decoding = 'async';
        img.onload = maybeStick;
        img.src = msg.image;
        node.appendChild(img);
    }

    if (msg.audio) {
        const audio = el('audio', 'msg-audio');
        audio.src = msg.audio;
        audio.controls = true;
        audio.preload = 'metadata';
        node.appendChild(audio);
    }

    const mediaItems = Array.isArray(msg.mediaItems) && msg.mediaItems.length > 0
        ? msg.mediaItems
        : (msg.media ? [msg.media] : []);
    if (mediaItems.length > 0) {
        const carousel = el('div', `media-carousel${mediaItems.length > 1 ? ' is-multi' : ''}`);
        mediaItems.forEach((media, index) => {
            const itemWrap = el('div', 'media-carousel-item');
            itemWrap.appendChild(renderMediaItem(media));
            if (mediaItems.length > 1) itemWrap.appendChild(el('div', 'media-count', `${index + 1}/${mediaItems.length}`));
            carousel.appendChild(itemWrap);
        });
        node.appendChild(carousel);
    }

    if (Array.isArray(msg.calcList) && msg.calcList.length) {
        const chip = el('div', 'calc-chip');
        msg.calcList.forEach((row) => {
            const line = el('div', 'calc-chip-row');
            const qty = Number(row.qty) || 1;
            const profit = Number(row.profit) || 0;
            const money = new Intl.NumberFormat('ru-RU').format(Math.abs(Math.round(profit))) + ' ₽';
            line.append(
                el('span', 'calc-chip-name', `${row.name || 'Товар'} · ${qty} шт`),
                el('span', 'calc-chip-profit', `${profit < 0 ? '−' : ''}${money}`)
            );
            chip.appendChild(line);
        });
        node.appendChild(chip);
    }

    const body = el('div', 'msg-body');
    if (msg.text) {
        const p = el('div', 'msg-payload-text');
        fillTextWithLinks(p, msg.text);
        body.appendChild(p);
    }
    body.appendChild(buildMeta(msg, isMe));
    node.appendChild(body);
    paintHearts(node, msg);
    if (pending) setStatusIcon(node, ICONS.clock, 'Отправка…');

    const actions = buildHoverActions(msg, isMe);
    if (actions) node.appendChild(actions);

    UI.messages.appendChild(node);
    applyGrouping(node);
    return node;
}

function removeMessageById(id) {
    const node = $(`msg-${id}`);
    selectedMessages.delete(id);
    if (!node || node.classList.contains('msg-removing')) return;
    node.classList.add('msg-removing');
    const next = nextMessageEl(node);
    const finish = () => {
        node.remove();
        applyGrouping(next);
        updateEmptyState();
        updateScrollDownButton();
    };
    if (REDUCED_MOTION || !node.animate) {
        finish();
        return;
    }
    const height = node.offsetHeight;
    node.style.pointerEvents = 'none';
    node.animate([
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0)', height: `${height}px`, marginBottom: '0px' },
        { opacity: 0, transform: 'scale(0.94)', filter: 'blur(6px)', height: `${height}px`, marginBottom: '0px', offset: 0.6 },
        { opacity: 0, transform: 'scale(0.94)', filter: 'blur(6px)', height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: '-10px', borderWidth: '0px' }
    ], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }).onfinish = finish;
}

/* ==========================================================================
   Clipboard
   ========================================================================== */
function messageDomId(node) {
    return node.id.startsWith('msg-') ? node.id.slice(4) : node.id;
}

function selectedMessageNodes() {
    return [...UI.messages.querySelectorAll('.msg')].filter((node) => selectedMessages.has(messageDomId(node)));
}

function selectionClipboardText() {
    const nodes = selectedMessageNodes();
    const chunks = [];
    nodes.forEach((node) => {
        const msg = fullMessageCache.get(messageDomId(node));
        const text = msg?.text?.trim();
        if (!text) return;
        chunks.push(nodes.length > 1 ? `${displayName(msg.sender)}:\n${text}` : text);
    });
    return chunks.join('\n\n');
}

async function writeClipboardText(text) {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) {}
    }
    try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
        document.body.appendChild(area);
        area.focus();
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
    } catch (_) {
        return false;
    }
}

async function writeClipboardImage(src) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined' || !src) return false;
    const png = (async () => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('empty image');
        return blob;
    })();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
}

async function copySelectedMessages() {
    if (selectedMessages.size === 0) return;
    const text = selectionClipboardText();
    try {
        if (text) {
            const ok = await writeClipboardText(text);
            showToast(ok ? 'Скопировано' : 'Не удалось скопировать', { type: ok ? 'success' : 'error' });
            if (ok) clearSelection();
            return;
        }
        const nodes = selectedMessageNodes();
        if (nodes.length === 1) {
            const msg = fullMessageCache.get(messageDomId(nodes[0]));
            const src = msg?.image || nodes[0].querySelector('.media-box .msg-img')?.src;
            if (src && await writeClipboardImage(src)) {
                showToast('Изображение скопировано', { type: 'success' });
                clearSelection();
                return;
            }
        }
        showToast('Нечего копировать');
    } catch (_) {
        showToast('Не удалось скопировать', { type: 'error' });
    }
}

async function copyInviteLink() {
    if (!currentInviteHash) return;
    const inviteUrl = `${window.location.origin}${window.location.pathname}#${currentInviteHash}`;
    const ok = await writeClipboardText(inviteUrl);
    if (ok) {
        showToast('Ссылка скопирована. Делитесь только по защищённому каналу', { type: 'success', duration: 3200 });
    } else if (navigator.share) {
        navigator.share({ title: 'S E C R E T', url: inviteUrl }).catch(() => {});
    } else {
        showToast('Не удалось скопировать ссылку', { type: 'error' });
    }
}

function messageTextSelectionActive() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    const node = selection.anchorNode;
    return !!node && UI.messages.contains(node.nodeType === 1 ? node : node.parentElement);
}

/* ==========================================================================
   Selection mode
   ========================================================================== */
function updateSelectionBar() {
    const count = selectedMessages.size;
    disarm(UI.actionDelete);
    UI.messages.classList.toggle('is-selecting', count > 0);
    if (count > 0) {
        UI.mainInputContainer.classList.add('hidden');
        UI.selectionBar.classList.remove('hidden');
        UI.selectionCount.textContent = `Выбрано: ${count}`;
        let allMine = true;
        selectedMessages.forEach((id) => {
            if (fullMessageCache.get(id)?.sender !== MY_ID) allMine = false;
        });
        UI.actionReply.classList.toggle('hidden', count !== 1);
        UI.actionEdit.classList.toggle('hidden', !(count === 1 && allMine));
    } else {
        UI.mainInputContainer.classList.remove('hidden');
        UI.selectionBar.classList.add('hidden');
    }
}

function clearSelection() {
    selectedMessages.forEach((id) => $(`msg-${id}`)?.classList.remove('msg-selected'));
    selectedMessages.clear();
    updateSelectionBar();
}

function toggleSelection(node) {
    const id = messageDomId(node);
    if (selectedMessages.has(id)) {
        selectedMessages.delete(id);
        node.classList.remove('msg-selected');
    } else {
        selectedMessages.add(id);
        node.classList.add('msg-selected');
        if (IS_TOUCH && navigator.vibrate) navigator.vibrate(8);
    }
    updateSelectionBar();
}

let suppressNextMsgClick = false;
UI.messages.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.msg-payload-text, .quote-text, .quote-author')) return;
    const drag = { x: e.clientX, y: e.clientY, moved: false };
    const move = (ev) => {
        if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 6) drag.moved = true;
    };
    const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        if (!drag.moved) return;
        suppressNextMsgClick = true;
        setTimeout(() => { suppressNextMsgClick = false; }, 0);
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
});

UI.messages.addEventListener('click', (e) => {
    if (e.target.classList.contains('msg-img')) {
        e.preventDefault();
        e.stopPropagation();
        if (selectedMessages.size === 0) {
            ensureImageViewer().open(e.target.src);
            return;
        }
    }
    const msgDiv = e.target.closest('.msg');
    if (suppressNextMsgClick || messageTextSelectionActive()) {
        suppressNextMsgClick = false;
        return;
    }
    if (!msgDiv || msgDiv.classList.contains('msg-removing')) return;
    if (e.target.closest('.quote-block, audio, video, button, a, input')) return;
    if (e.target.closest('.media-box') && selectedMessages.size === 0) return;
    toggleSelection(msgDiv);
});

/* Swipe right/left on touch to reply */
(function setupSwipeToReply() {
    let swipe = null;
    const THRESHOLD = 64;
    UI.messages.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch' || selectedMessages.size > 0) return;
        const node = e.target.closest('.msg');
        if (!node || e.target.closest('.media-carousel, audio, video, a, button')) return;
        swipe = { node, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false, locked: false, icon: null };
    }, { passive: true });

    UI.messages.addEventListener('pointermove', (e) => {
        if (!swipe || e.pointerId !== swipe.id) return;
        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (!swipe.active && !swipe.locked) {
            if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { swipe.locked = true; return; }
            if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
                swipe.active = true;
                swipe.icon = el('span', 'swipe-reply-icon');
                swipe.icon.innerHTML = ICONS.reply;
                swipe.node.appendChild(swipe.icon);
                window.getSelection()?.removeAllRanges();
            }
        }
        if (!swipe.active) return;
        const dir = swipe.node.classList.contains('msg-out') ? -1 : 1;
        const travel = Math.max(0, Math.min(90, dx * dir));
        swipe.dx = travel;
        swipe.node.style.transition = 'none';
        swipe.node.style.transform = `translateX(${travel * dir}px)`;
        const progress = Math.min(1, travel / THRESHOLD);
        swipe.icon.style.opacity = String(progress);
        swipe.icon.style.transform = `scale(${0.5 + progress * 0.5})`;
        if (travel >= THRESHOLD && !swipe.buzzed) {
            swipe.buzzed = true;
            navigator.vibrate?.(10);
        }
    }, { passive: true });

    const end = (e) => {
        if (!swipe || e.pointerId !== swipe.id) return;
        const { node, active, dx, icon } = swipe;
        swipe = null;
        if (!active) return;
        suppressNextMsgClick = true;
        setTimeout(() => { suppressNextMsgClick = false; }, 50);
        node.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        node.style.transform = '';
        setTimeout(() => {
            node.style.transition = '';
            icon?.remove();
        }, 300);
        if (dx >= THRESHOLD) startReply(messageDomId(node));
    };
    UI.messages.addEventListener('pointerup', end);
    UI.messages.addEventListener('pointercancel', end);
})();

/* ==========================================================================
   Reply / edit
   ========================================================================== */
function startReply(id) {
    const cached = fullMessageCache.get(id);
    if (!cached) return;
    editingTargetId = null;
    replyingTo = {
        id: cached.id,
        sender: cached.sender,
        name: cached.label || displayName(cached.sender),
        color: colorFor(cached.sender),
        text: cached.text ? cached.text : '[Вложение]'
    };
    UI.replyPreview.classList.remove('is-editing');
    UI.replyName.textContent = replyingTo.name;
    UI.replyName.style.color = safeCssColor(replyingTo.color, '');
    UI.replyText.textContent = replyingTo.text;
    clearSelection();
    UI.replyPreview.classList.remove('hidden');
    updateComposerState();
    UI.input.focus();
}

function startEdit(id) {
    const cached = fullMessageCache.get(id);
    if (!cached || cached.sender !== MY_ID) return;
    if (!cached.db_id) {
        showToast('Сообщение ещё отправляется');
        return;
    }
    replyingTo = null;
    editingTargetId = id;
    UI.input.value = cached.text || '';
    autoResizeInput();
    UI.replyPreview.classList.add('is-editing');
    UI.replyName.textContent = 'Редактирование';
    UI.replyName.style.color = '#fbbf24';
    UI.replyText.textContent = cached.text || '[Без текста]';
    clearSelection();
    UI.replyPreview.classList.remove('hidden');
    updateComposerState();
    UI.input.focus();
    const len = UI.input.value.length;
    UI.input.setSelectionRange(len, len);
}

function lastOwnMessageId() {
    const nodes = UI.messages.querySelectorAll('.msg-out:not(.msg-removing)');
    for (let i = nodes.length - 1; i >= 0; i--) {
        const id = messageDomId(nodes[i]);
        if (fullMessageCache.get(id)?.text) return id;
    }
    return null;
}

/* ==========================================================================
   Deletion
   ========================================================================== */
async function deleteSelectedMessages() {
    if (selectedMessages.size === 0) return;
    const dbIds = [];
    const targets = [...selectedMessages];
    targets.forEach((id) => {
        const cached = fullMessageCache.get(id);
        if (cached?.db_id) dbIds.push(cached.db_id);
    });
    clearSelection();
    targets.forEach(removeMessageById);

    try {
        if (dbIds.length > 0) {
            await fetch(`/api/messages?room=${encodeURIComponent(currentRoom)}&id=${dbIds.join(',')}`, { method: 'DELETE' });
        }
        const ghosts = await Promise.all(targets.map((id) => encryptPayload(
            { type: 'delete_sync', targetId: id, id: generateUUID(), sender: MY_ID }, currentKey
        )));
        await Promise.all(ghosts.map((payload) => fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_id: currentRoom, payload })
        })));
        showToast(targets.length > 1 ? `Удалено: ${targets.length}` : 'Удалено', { type: 'success' });
    } catch (e) {
        console.error('Delete err:', e);
        showToast('Удаление не синхронизировано', { type: 'error' });
    }
}

let clearChatBusy = false;
async function clearChat() {
    if (!currentRoom || !currentKey || clearChatBusy) return;
    if (!armConfirm(UI.clearChatBtn)) {
        showToast('Нажмите ещё раз, чтобы очистить чат');
        return;
    }
    clearChatBusy = true;
    try {
        const deleted = await fetch(`/api/messages?room=${encodeURIComponent(currentRoom)}`, { method: 'DELETE' });
        if (!deleted.ok) throw new Error(`clear ${deleted.status}`);
        clearLocalMessages();
        const payload = await encryptPayload(
            { type: 'clear_sync', id: generateUUID(), sender: MY_ID },
            currentKey
        );
        await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_id: currentRoom, payload })
        });
        showToast('Чат очищен', { type: 'success' });
    } catch (e) {
        console.error('Clear err:', e);
        showToast('Не удалось очистить чат', { type: 'error' });
    } finally {
        clearChatBusy = false;
    }
}

/* ==========================================================================
   Identity colours (sanitised before injecting into CSS)
   ========================================================================== */
let dynamicStyleEl = null;
function applyDynamicColor(uuid, color) {
    const safe = safeCssColor(color, null);
    if (!uuid || !safe || globalColorOverrides.get(uuid) === safe) return;
    globalColorOverrides.set(uuid, safe);
    if (!dynamicStyleEl) {
        dynamicStyleEl = document.createElement('style');
        dynamicStyleEl.id = 'dynamic-colors';
        document.head.appendChild(dynamicStyleEl);
    }
    let cssText = '';
    globalColorOverrides.forEach((c, u) => {
        const sel = CSS.escape(u);
        cssText += `.msg[data-owner="${sel}"]{--sender:${c} !important}`;
        cssText += `.quote-block[data-quote-owner="${sel}"]{--quote:${c} !important}`;
    });
    dynamicStyleEl.textContent = cssText;
}

/* ==========================================================================
   Menus
   ========================================================================== */
const MENUS = [
    { button: UI.colorPickerBtn, panel: UI.colorMenu },
    { button: UI.onlineBtn, panel: UI.onlinePanel }
];

function closeMenus(except = null) {
    let closed = false;
    MENUS.forEach(({ button, panel }) => {
        if (panel === except || panel.classList.contains('hidden')) return;
        panel.classList.add('hidden');
        button.setAttribute('aria-expanded', 'false');
        closed = true;
    });
    return closed;
}

function toggleMenu(button, panel) {
    const willOpen = panel.classList.contains('hidden');
    closeMenus(panel);
    panel.classList.toggle('hidden', !willOpen);
    button.setAttribute('aria-expanded', String(willOpen));
    return willOpen;
}

function syncColorMenu() {
    const current = localStorage.getItem('customColor') || '';
    UI.hexInput.value = current;
    UI.hexInput.classList.remove('is-invalid');
    UI.hexPreview.style.background = safeCssColor(current, generateIdentity(MY_ID).color);
    document.querySelectorAll('.color-swatch').forEach((sw) => {
        sw.classList.toggle('is-active', sw.dataset.color.toLowerCase() === current.toLowerCase());
    });
}

function setMyColor(color) {
    localStorage.setItem('customColor', color);
    applyDynamicColor(MY_ID, color);
    syncColorMenu();
    lastOnlineSignature = '';
    if (currentRoom) startPresence();
}

/* ==========================================================================
   Voice recording
   ========================================================================== */
function stopRecordingUI() {
    clearInterval(recordTicker);
    clearTimeout(voiceStopTimer);
    UI.voiceBtn.classList.remove('is-recording');
    UI.mainInputContainer.classList.remove('is-recording');
    UI.recordIndicator.classList.add('hidden');
    UI.voiceBtn.title = 'Голосовое сообщение';
}

function cancelRecording() {
    if (mediaRecorder?.state !== 'recording') return false;
    recordCancelled = true;
    mediaRecorder.stop();
    return true;
}

async function toggleVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        showToast('Запись голоса не поддерживается', { type: 'error' });
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus'
                : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : ''));
        recordedAudioChunks = [];
        recordCancelled = false;
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRecorder = recorder;

        recorder.addEventListener('dataavailable', (event) => {
            if (event.data.size > 0) recordedAudioChunks.push(event.data);
        });

        recorder.addEventListener('stop', () => {
            stopRecordingUI();
            stream.getTracks().forEach((track) => track.stop());
            if (recordCancelled) {
                recordCancelled = false;
                showToast('Запись отменена');
                return;
            }
            const blob = new Blob(recordedAudioChunks, { type: recorder.mimeType || 'audio/webm' });
            if (blob.size < 500) {
                showToast('Слишком короткая запись');
                return;
            }
            if (blob.size > MAX_MEDIA_FILE_BYTES) {
                showToast('Слишком длинная запись', { type: 'error' });
                return;
            }
            const extension = blob.type.includes('ogg') ? 'ogg' : (blob.type.includes('mp4') ? 'm4a' : 'webm');
            const voiceFile = new File([blob], `voice-${Date.now()}.${extension}`, { type: blob.type || 'audio/webm' });
            setAttachmentPreview({ mediaFiles: [voiceFile] });
            showToast('Голосовое готово — нажмите «Отправить»', { type: 'success' });
        }, { once: true });

        recorder.start(1000);
        const startedAt = Date.now();
        UI.voiceBtn.classList.add('is-recording');
        UI.mainInputContainer.classList.add('is-recording');
        UI.recordIndicator.classList.remove('hidden');
        UI.voiceBtn.title = 'Остановить запись';
        UI.recordTime.textContent = '0:00';
        recordTicker = setInterval(() => {
            const sec = Math.floor((Date.now() - startedAt) / 1000);
            UI.recordTime.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        }, 500);
        voiceStopTimer = setTimeout(() => {
            if (recorder.state === 'recording') recorder.stop();
        }, 2 * 60 * 60 * 1000);
    } catch (e) {
        console.error('Voice recording failed:', e);
        stopRecordingUI();
        showToast('Микрофон недоступен', { type: 'error' });
    }
}

/* ==========================================================================
   Files: picker, paste, drag & drop
   ========================================================================== */
function acceptFiles(files) {
    const list = files.filter(Boolean);
    if (list.length === 0) return;
    if (list.some((file) => file.size > MAX_MEDIA_FILE_BYTES)) {
        showToast('Лимит файла — 24 МБ', { type: 'error' });
        return;
    }
    setAttachmentPreview({ mediaFiles: [...pendingMediaFiles, ...list] });
    UI.input.focus();
}

function setupDragAndDrop() {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const show = (on) => {
        UI.dropOverlay.classList.toggle('hidden', !on);
        UI.mainInputContainer.classList.toggle('is-dragging', on);
    };
    UI.chat.addEventListener('dragenter', (e) => {
        if (!hasFiles(e) || !currentRoom) return;
        e.preventDefault();
        depth++;
        show(true);
    });
    UI.chat.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    UI.chat.addEventListener('dragleave', () => {
        depth = Math.max(0, depth - 1);
        if (depth === 0) show(false);
    });
    UI.chat.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth = 0;
        show(false);
        acceptFiles([...e.dataTransfer.files]);
    });
}

/* ==========================================================================
   Keyboard
   ========================================================================== */
function isTypingTarget(node) {
    return node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (imageViewer?.isOpen()) { imageViewer.close(); return; }
        if (closeMenus()) return;
        if (cancelRecording()) return;
        if (selectedMessages.size > 0) { clearSelection(); return; }
        if (editingTargetId || replyingTo) { cancelReplyOrEdit(); return; }
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedMessages.size > 0) {
        if (isTypingTarget(document.activeElement) || messageTextSelectionActive()) return;
        e.preventDefault();
        copySelectedMessages();
        return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedMessages.size > 0 && !isTypingTarget(document.activeElement)) {
        e.preventDefault();
        if (armConfirm(UI.actionDelete)) deleteSelectedMessages();
        return;
    }

    // Start typing anywhere → focus the composer
    if (UI.chat.classList.contains('active') && !isTypingTarget(document.activeElement)
        && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
        && selectedMessages.size === 0 && !imageViewer?.isOpen()) {
        UI.input.focus();
    }
});

/* ==========================================================================
   Init
   ========================================================================== */
function initApp() {
    const stuckColor = localStorage.getItem('customColor');
    if (stuckColor && (stuckColor.includes('242, 140, 191') || stuckColor === '#f28cbf' || !safeCssColor(stuckColor, null))) {
        localStorage.removeItem('customColor');
    }
    const initialColor = localStorage.getItem('customColor');
    if (initialColor) applyDynamicColor(MY_ID, initialColor);

    // Menus
    UI.colorPickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (toggleMenu(UI.colorPickerBtn, UI.colorMenu)) syncColorMenu();
    });
    UI.onlineBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMenu(UI.onlineBtn, UI.onlinePanel);
    });
    document.addEventListener('pointerdown', (e) => {
        if (MENUS.some(({ button, panel }) => panel.contains(e.target) || button.contains(e.target))) return;
        closeMenus();
    });

    document.querySelectorAll('.color-swatch').forEach((btn) => {
        btn.addEventListener('click', () => {
            setMyColor(btn.dataset.color);
            showToast('Цвет обновлён', { type: 'success' });
        });
    });

    UI.hexInput.addEventListener('input', (e) => {
        let val = e.target.value.trim();
        if (val && !val.startsWith('#')) val = `#${val}`;
        e.target.value = val;
        const valid = /^#[0-9A-F]{6}$/i.test(val);
        e.target.classList.toggle('is-invalid', val.length === 7 && !valid);
        if (valid) setMyColor(val);
    });
    UI.hexInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') closeMenus();
    });

    // Sound
    UI.soundToggle.checked = notificationSoundEnabled;
    UI.soundToggle.addEventListener('change', () => {
        localStorage.setItem('notificationSoundEnabled', UI.soundToggle.checked ? 'true' : 'false');
        applyNotificationSoundSettings();
        showToast(UI.soundToggle.checked ? 'Звук включён' : 'Звук выключен');
    });
    UI.soundPick.addEventListener('click', () => UI.soundInput.click());
    UI.soundInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        UI.soundInput.value = '';
        if (!file) return;
        if (!file.type.startsWith('audio/')) {
            showToast('Выберите аудиофайл', { type: 'error' });
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            showToast('Звук должен быть меньше 2 МБ', { type: 'error' });
            return;
        }
        try {
            localStorage.setItem('notificationSoundDataUrl', await blobToDataUrl(file));
        } catch (err) {
            showToast('Не хватает места для звука', { type: 'error' });
            return;
        }
        localStorage.setItem('notificationSoundEnabled', 'true');
        applyNotificationSoundSettings();
        notificationAudioUnlocked = true;
        playNotificationSound();
        showToast('Звук уведомления обновлён', { type: 'success' });
    });
    UI.soundReset.addEventListener('click', () => {
        localStorage.removeItem('notificationSoundDataUrl');
        localStorage.setItem('notificationSoundEnabled', 'true');
        applyNotificationSoundSettings();
        notificationAudioUnlocked = true;
        playNotificationSound();
        showToast('Звук сброшен');
    });

    // Composer
    UI.input.addEventListener('input', () => {
        autoResizeInput();
        updateComposerState();
    });
    const promptSymbol = document.querySelector('.prompt-symbol');
    let assistantBusy = false;
    askAssistant = async function () {
        const text = UI.input.value.trim();
        if (!text) {
            showToast('Напишите запрос');
            return;
        }
        if (assistantBusy || !currentRoom) return;
        assistantBusy = true;
        promptSymbol?.classList.add('is-busy');
        const quoted = replyingTo?.sender === 'ai-assistant' ? { ...replyingTo } : null;
        try {
            const question = {
                type: 'text',
                text,
                id: generateUUID(),
                sender: MY_ID,
                ts: Date.now(),
                replyTo: quoted,
                customColor: localStorage.getItem('customColor') || undefined
            };
            const questionEncrypted = await encryptPayload(question, currentKey);
            renderMessage(question, { animate: true, pending: true });
            updateEmptyState();
            scrollToBottom(true);
            UI.input.value = '';
            autoResizeInput();
            const questionSent = await deliver(question, questionEncrypted);
            if (quoted) cancelReplyOrEdit();
            if (!questionSent) return;

            const prior = recentChatTurns().filter((turn) => turn.id !== question.id);
            const historyText = prior.map((turn) => `${turn.who}: ${turn.text}`).join('\n');
            const prompt = quoted
                ? `Предыдущий ответ: ${quoted.text}\nУточнение: ${text}`
                : text;
            const chatMessages = [
                ...prior.map((turn) => ({
                    role: turn.ai ? 'assistant' : 'user',
                    content: turn.ai ? turn.text : `${turn.who}: ${turn.text}`
                })),
                { role: 'user', content: prompt.slice(0, 2000) }
            ];
            const callModel = async (messages, format) => {
                const res = await fetch('/api/calc-ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ format, messages })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error?.message || 'Нет ответа');
                return String(data.choices?.[0]?.message?.content || '').trim();
            };
            const planRaw = await callModel([
                { role: 'system', content: 'Реши, нужен ли калькулятор окупаемости. Верни только JSON {"calc":true|false,"command":"","reply":""}. calc=true, если речь о цене, закупе, продаже, количестве, курсе, прибыли, марже, наценке, сравнении сделок или «а если». command — короткая команда калькулятору на русском, что добавить, изменить, удалить или посчитать, с учётом истории. Если цифры уже есть и менять список не нужно, command может быть «посчитай текущий список». calc=false для обычной беседы: тогда reply — короткий ответ по-русски, 1–2 предложения, без markdown. Понимай «это», «тот», «ещё» по истории.' },
                ...chatMessages
            ], 'json');
            let plan = {};
            try { plan = JSON.parse(planRaw); } catch { plan = {}; }
            let reply = '';
            let calcList = null;
            if (plan.calc) {
                if (typeof window.paybackCommand !== 'function') throw new Error('Калькулятор не готов');
                const result = await window.paybackCommand(String(plan.command || prompt).slice(0, 2000), historyText);
                calcList = Array.isArray(result?.list) ? result.list.slice(0, 24) : null;
                const facts = result?.facts || result?.reply || '';
                try {
                    reply = await callModel([
                        { role: 'system', content: 'Ответь пользователю по-русски, 1–3 коротких предложения, без markdown и без списков. Используй только цифры из блока «Факты калькулятора»: прибыль, маржу, выручку, сравнение. Можно сказать, выгодно ли это, что изменилось и ответить на «а если». Не выдумывай суммы. Если фактов не хватает, скажи, чего не хватает.' },
                        { role: 'user', content: `Вопрос: ${prompt.slice(0, 1500)}\n\nФакты калькулятора:\n${String(facts).slice(0, 3500)}` }
                    ], 'text');
                } catch {
                    reply = result?.reply || '';
                }
            } else {
                reply = String(plan.reply || '').trim();
                if (!reply) {
                    reply = await callModel([
                        { role: 'system', content: 'Ты участник этой переписки. Отвечай по-русски очень коротко: одно или два предложения. Без списков, без приветствий и без markdown. Сообщения до последней реплики — уже сказанное в комнате. Понимай «это», «он», «там», «ещё» по ним. Не пересказывай всю историю.' },
                        ...chatMessages
                    ], 'text');
                }
            }
            if (!reply) throw new Error('Пустой ответ');
            const payloadObj = {
                type: 'text',
                text: reply,
                id: generateUUID(),
                sender: 'ai-assistant',
                label: 'ИИ',
                ts: Date.now(),
                calcList: calcList?.length ? calcList : undefined,
                replyTo: { id: question.id, sender: MY_ID, name: displayName(MY_ID), text, color: colorFor(MY_ID) }
            };
            const encrypted = await encryptPayload(payloadObj, currentKey);
            renderMessage(payloadObj, { animate: true, pending: true });
            updateEmptyState();
            scrollToBottom(true);
            await deliver(payloadObj, encrypted);
        } catch (e) {
            showToast(e.message === 'Failed to fetch' ? 'Нет связи' : e.message, { type: 'error' });
        } finally {
            assistantBusy = false;
            promptSymbol?.classList.remove('is-busy');
        }
    }
    promptSymbol?.addEventListener('click', askAssistant);
    promptSymbol?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            askAssistant();
        }
    });

    UI.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
            const forceSend = e.ctrlKey || e.metaKey;
            if (forceSend || (!e.shiftKey && !IS_TOUCH)) {
                e.preventDefault();
                handleSend();
            }
            return;
        }
        if (e.key === 'ArrowUp' && !UI.input.value && !editingTargetId) {
            const id = lastOwnMessageId();
            if (id) {
                e.preventDefault();
                startEdit(id);
            }
        }
    });
    if (IS_TOUCH) UI.input.setAttribute('enterkeyhint', 'enter');
    UI.sendBtn.addEventListener('pointerdown', (e) => {
        // Keep the keyboard open on mobile when tapping send
        if (IS_TOUCH && document.activeElement === UI.input) e.preventDefault();
    });
    UI.sendBtn.addEventListener('click', handleSend);
    UI.uploadBtn.addEventListener('click', () => UI.fileInput.click());
    UI.fileInput.addEventListener('change', (e) => {
        acceptFiles(Array.from(e.target.files || []));
        UI.fileInput.value = '';
    });
    UI.voiceBtn.addEventListener('click', toggleVoiceRecording);

    UI.removeReplyBtn.addEventListener('click', cancelReplyOrEdit);
    UI.removePreview.addEventListener('click', () => setAttachmentPreview());

    UI.input.addEventListener('paste', (e) => {
        const items = [...(e.clipboardData?.items || [])].filter((item) => item.kind === 'file');
        if (items.length === 0) return;
        e.preventDefault();
        acceptFiles(items.map((item) => item.getAsFile()));
    });
    setupDragAndDrop();

    // Selection actions
    UI.cancelSelection.addEventListener('click', clearSelection);
    UI.actionCopy.addEventListener('click', copySelectedMessages);
    UI.actionReply.addEventListener('click', () => startReply([...selectedMessages][0]));
    UI.actionEdit.addEventListener('click', () => startEdit([...selectedMessages][0]));
    UI.actionDelete.addEventListener('click', () => {
        if (armConfirm(UI.actionDelete)) deleteSelectedMessages();
    });

    // Rooms
    UI.createRoomBtn.addEventListener('click', async () => {
        UI.createRoomBtn.classList.add('is-busy');
        try {
            const roomId = generateUUID().slice(0, 12);
            const keyStr = await exportKey(await generateKey());
            currentInviteHash = `${roomId}|${keyStr}`;
            const inviteUrl = `${window.location.origin}${window.location.pathname}#${currentInviteHash}`;
            const copied = await writeClipboardText(inviteUrl);
            window.location.hash = currentInviteHash;
            setTimeout(() => showToast(copied ? 'Комната создана · ссылка скопирована' : 'Комната создана', { type: 'success', duration: 3200 }), 450);
        } finally {
            UI.createRoomBtn.classList.remove('is-busy');
        }
    });

    UI.copyLinkBtn.addEventListener('click', copyInviteLink);
    UI.roomHash.addEventListener('click', copyInviteLink);
    UI.clearChatBtn.addEventListener('click', clearChat);
    document.addEventListener('visibilitychange', syncTabPresence);
    UI.leaveRoomBtn.addEventListener('click', () => {
        if (!armConfirm(UI.leaveRoomBtn)) {
            showToast('Нажмите ещё раз, чтобы выйти');
            return;
        }
        hideToast();
        window.location.hash = '';
    });

    window.addEventListener('pagehide', leavePresence);
    window.addEventListener('hashchange', checkHash);
    checkHash();
}

async function checkHash() {
    leavePresence();
    lockMobileViewport();
    clearTimeout(pollTimeout);
    pollGeneration++;
    pollAbortController?.abort();
    pollAbortController = null;
    pollInFlight = false;
    initialSyncDone = false;
    consecutivePollErrors = 0;
    if (mediaRecorder?.state === 'recording') cancelRecording();
    imageViewer?.close();
    closeMenus();

    lazyImageObserver?.disconnect();
    UI.messages.replaceChildren();
    revokeAllObjectUrls();
    renderedMsgIds.clear();
    fullMessageCache.clear();
    retryPayloads.clear();
    selectedMessages.clear();
    updateSelectionBar();
    resetComposer();
    lastSeenMessageId = 0;
    publishedReadTs = 0;
    readByOthersTs = 0;
    readEvents = [];
    clearTimeout(readPublishTimer);
    unseenBelow = 0;
    stickToBottom = true;
    updateScrollDownButton();
    lastOnlineSignature = '';

    const params = new URLSearchParams(window.location.search);
    const queryRoom = params.get('room');
    const queryKey = params.get('key');
    const rawHash = window.location.hash.substring(1);
    let hash = queryRoom && queryKey ? `${queryRoom}|${queryKey}` : rawHash;
    try {
        hash = decodeURIComponent(hash);
    } catch (e) {
        hash = hash.replace(/%7C/ig, '|');
    }

    const separator = hash.includes('|') ? '|' : '.';
    if (!hash || !hash.includes(separator)) {
        currentRoom = null;
        currentKey = null;
        currentInviteHash = '';
        UI.roomHash.textContent = '';
        showScreen(UI.landing);
        return;
    }

    const [roomId, keyStr] = hash.split(separator);
    try {
        currentKey = await importKey(keyStr);
        currentRoom = roomId;
        currentInviteHash = `${roomId}|${keyStr}`;
        UI.roomHash.textContent = `ROOM_ID: ${roomId}`;
        const sys = el('div', 'system-msg', '> соединение установлено · ключ проверен');
        UI.messages.appendChild(sys);
        showScreen(UI.chat);
        setConnectionState(navigator.onLine !== false);
        kickPoll();
        startPresence();
        if (!IS_TOUCH) setTimeout(() => UI.input.focus({ preventScroll: true }), 300);
    } catch (e) {
        showToast('Недействительная ссылка комнаты', { type: 'error' });
        window.location.hash = '';
    }
}

initApp();
