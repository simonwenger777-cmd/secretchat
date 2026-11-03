(() => {
    const root = document.getElementById('payback');
    if (!root) return;
    root.innerHTML = `
<div class="stack">
<div class="card ai" id="pb-ai">
<div class="ai-line">
<select id="pb-model" aria-label="Модель">
<option value="qwen/qwen3.8-27b">Qwen</option>
<option value="openai/gpt-oss-120b">120B</option>
<option value="openai/gpt-oss-20b">20B</option>
</select>
<textarea id="pb-prompt" rows="1" placeholder="10 шт по 20$, продажа 3000…"></textarea>
<button class="ib mic" id="pb-mic" type="button" title="Голосом" hidden>●</button>
<button class="ib send" id="pb-send" type="button" title="Отправить">↑</button>
</div>
<div class="hints">
<button class="hint" type="button">Курс 92,4</button>
<button class="hint" type="button">Чехлы 50 шт за 300$, продаю по 900₽</button>
<button class="hint" type="button">Удали чехлы</button>
<button class="hint" type="button">Очисти список</button>
</div>
<div class="msg" id="pb-msg"></div>
</div>
<div class="card">
<div class="hd"><h1>Окупаемость</h1><div class="rate">$<input id="pb-rate" inputmode="decimal" placeholder="91" aria-label="Курс доллара">₽<button class="lnk" id="pb-cbr" type="button">ЦБ</button></div></div>
<div class="row r2"><div class="f"><label for="pb-name">Товар</label><input id="pb-name" class="t" placeholder="Название"></div>
<div class="f"><label for="pb-qty">Шт</label><input id="pb-qty" inputmode="numeric" placeholder="1"></div></div>
<div class="row">
<div class="f"><label for="pb-sell">Продажа</label><input id="pb-sell" inputmode="decimal" placeholder="0"><span>₽</span></div>
<div class="f buy"><label for="pb-buy">Закуп</label><input id="pb-buy" inputmode="decimal" placeholder="0"><div class="seg" id="pb-cur"><button type="button" data-c="USD" class="on">$</button><button type="button" data-c="RUB">₽</button></div></div>
</div>
<div class="conv" id="pb-conv"></div>
<div class="res" id="pb-res"><div class="res-main"><small>Прибыль</small><div class="big" id="pb-profit">0 ₽</div></div>
<div class="stats"><div><b id="pb-margin">0%</b><i>Маржа</i></div><div><b id="pb-markup">0%</b><i>Наценка</i></div><div><b id="pb-unit">0 ₽</b><i>С 1 шт</i></div></div></div>
<div class="btns"><button class="btn pri" id="pb-add" type="button">Добавить</button><button class="btn" id="pb-reset" type="button" title="Сбросить">↺</button></div>
</div>
<div class="card grow">
<div class="head"><h2>Список</h2><span id="pb-cnt"></span></div>
<div class="list" id="pb-list"></div>
<div class="tot"><div class="g">
<div class="main"><i>Общая прибыль</i><b id="pb-tProfit">0 ₽</b></div>
<div><i>Выручка</i><b id="pb-tSell">0 ₽</b></div>
<div><i>Закуп</i><b id="pb-tBuy">0 ₽</b></div>
<div><i>Маржа</i><b id="pb-tMargin">0%</b></div>
<div><i>Закуп в $</i><b id="pb-tUsd">$0</b></div>
</div></div>
<div class="acts"><button class="lnk" id="pb-copy" type="button">Скопировать</button><button class="lnk" id="pb-clear" type="button">Очистить</button></div>
</div>
</div>
<div class="pb-toast" id="pb-toast"></div>`;

    const $ = (id) => root.querySelector('#' + id);
    const F = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
    const rub = (v) => F.format(Math.round(v * 100) / 100) + ' ₽';
    const usd = (v) => '$' + F.format(Math.round(v * 100) / 100);
    const num = (el) => { const v = parseFloat(String(el.value).replace(/\s/g, '').replace(',', '.')); return Number.isNaN(v) ? 0 : v; };
    const S = JSON.parse(localStorage.getItem('calc2') || '{}');
    let items = S.items || [];
    let cur = S.cur || 'USD';
    let editId = null;
    $('pb-rate').value = S.rate && S.rate !== '85' ? S.rate : '91';
    if (S.model) $('pb-model').value = S.model;
    const save = () => localStorage.setItem('calc2', JSON.stringify({ items, cur, rate: $('pb-rate').value, model: $('pb-model').value }));
    function toast(t) { const e = $('pb-toast'); e.textContent = t; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), 1800); }
    function setCur(c) { cur = c; root.querySelectorAll('#pb-cur button').forEach((b) => b.classList.toggle('on', b.dataset.c === c)); calc(); }
    function current() {
        const rate = num($('pb-rate')), s = num($('pb-sell')), bRaw = num($('pb-buy')), q = num($('pb-qty')) || 1;
        const b = cur === 'USD' ? bRaw * rate : bRaw;
        return { rate, s, bRaw, b, q, u: s - b };
    }
    function calc() {
        const c = current();
        $('pb-profit').textContent = rub(c.u * c.q);
        $('pb-unit').textContent = rub(c.u);
        $('pb-margin').textContent = c.s ? F.format(c.u / c.s * 100) + '%' : '0%';
        $('pb-markup').textContent = c.b ? F.format(c.u / c.b * 100) + '%' : '0%';
        $('pb-res').classList.toggle('bad', c.u < 0);
        $('pb-conv').textContent = cur === 'USD' && c.bRaw ? (c.rate ? `${usd(c.bRaw)} × ${F.format(c.rate)} = ${rub(c.b)}` : 'Укажите курс доллара') : '';
        save();
    }
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function totals() {
        let s = 0, b = 0, us = 0;
        const on = items.filter((i) => i.on);
        on.forEach((i) => {
            s += i.sell * i.qty;
            const bb = i.cur === 'USD' ? i.buy * i.rate : i.buy;
            b += bb * i.qty;
            if (i.cur === 'USD') us += i.buy * i.qty;
        });
        $('pb-tProfit').textContent = rub(s - b);
        $('pb-tSell').textContent = rub(s);
        $('pb-tBuy').textContent = rub(b);
        $('pb-tUsd').textContent = usd(us);
        $('pb-tMargin').textContent = s ? F.format((s - b) / s * 100) + '%' : '0%';
        $('pb-cnt').textContent = items.length ? `${on.length} из ${items.length}` : '';
        return { s, b, on };
    }
    function render() {
        const L = $('pb-list');
        L.replaceChildren();
        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = 'Добавьте товары — итог посчитается здесь';
            L.appendChild(empty);
            totals();
            return;
        }
        items.forEach((it) => {
            const b = it.cur === 'USD' ? it.buy * it.rate : it.buy;
            const u = (it.sell - b) * it.qty;
            const d = document.createElement('div');
            d.className = 'it' + (it.on ? '' : ' off');
            d.innerHTML = `<input type="checkbox" class="chk" ${it.on ? 'checked' : ''}>
<div class="nm">${esc(it.name || 'Без названия')}<div>${it.qty} шт · ${rub(it.sell)} − ${it.cur === 'USD' ? usd(it.buy) + ' @' + F.format(it.rate) : rub(it.buy)}</div></div>
<div class="pr">${u < 0 ? '−' : ''}${rub(Math.abs(u))}<div>${it.sell ? F.format((it.sell - b) / it.sell * 100) : 0}%</div></div>
<button class="del" type="button" title="Удалить">×</button>`;
            d.querySelector('.chk').onchange = (e) => { it.on = e.target.checked; d.classList.toggle('off', !it.on); totals(); save(); };
            d.querySelector('.nm').onclick = () => load(it);
            d.querySelector('.del').onclick = () => { items = items.filter((x) => x !== it); render(); save(); };
            L.appendChild(d);
        });
        totals();
    }
    function load(it) {
        editId = it.id;
        $('pb-name').value = it.name;
        $('pb-sell').value = it.sell;
        $('pb-buy').value = it.buy;
        $('pb-qty').value = it.qty;
        if (it.cur === 'USD') $('pb-rate').value = it.rate;
        setCur(it.cur);
        $('pb-add').textContent = 'Сохранить';
        $('pb-name').focus();
    }
    function clearForm() {
        ['pb-name', 'pb-sell', 'pb-buy', 'pb-qty'].forEach((i) => { $(i).value = ''; });
        editId = null;
        $('pb-add').textContent = 'Добавить';
        calc();
    }
    $('pb-add').onclick = () => {
        const c = current();
        if (!c.s && !c.bRaw) { toast('Введите цены'); return; }
        if (cur === 'USD' && !c.rate) { toast('Укажите курс доллара'); $('pb-rate').focus(); return; }
        const data = { name: $('pb-name').value.trim(), sell: c.s, buy: c.bRaw, cur, rate: c.rate, qty: c.q, on: true };
        if (editId) { Object.assign(items.find((i) => i.id === editId), data); toast('Сохранено'); }
        else { items.push({ id: Date.now(), ...data }); toast('Добавлено'); }
        render(); clearForm(); save();
    };
    $('pb-reset').onclick = clearForm;
    $('pb-clear').onclick = () => { if (items.length && confirm('Очистить весь список?')) { items = []; render(); save(); } };
    $('pb-copy').onclick = () => {
        const t = totals();
        if (!t.on.length) { toast('Список пуст'); return; }
        const lines = t.on.map((i) => {
            const b = i.cur === 'USD' ? i.buy * i.rate : i.buy;
            return `${i.name || 'Без названия'} — ${i.qty} шт: ${rub((i.sell - b) * i.qty)}`;
        });
        lines.push('', `Выручка: ${rub(t.s)}`, `Закуп: ${rub(t.b)}`, `Прибыль: ${rub(t.s - t.b)}`);
        navigator.clipboard.writeText(lines.join('\n')).then(() => toast('Скопировано'), () => toast('Не удалось скопировать'));
    };
    $('pb-cbr').onclick = async () => {
        $('pb-cbr').textContent = '…';
        try {
            const r = await fetch('https://www.cbr-xml-daily.ru/daily_json.js');
            const j = await r.json();
            $('pb-rate').value = String(j.Valute.USD.Value.toFixed(2)).replace('.', ',');
            calc();
            toast('Курс ЦБ: ' + F.format(j.Valute.USD.Value) + ' ₽');
        } catch {
            toast('Нет связи — введите курс вручную');
        }
        $('pb-cbr').textContent = 'ЦБ';
    };
    root.querySelectorAll('#pb-cur button').forEach((b) => { b.onclick = () => setCur(b.dataset.c); });
    ['pb-rate', 'pb-name', 'pb-sell', 'pb-buy', 'pb-qty'].forEach((id) => {
        const el = $(id);
        el.addEventListener('input', () => { if (id !== 'pb-name') el.value = el.value.replace(/[^\d.,\s]/g, ''); calc(); });
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('pb-add').click(); } });
    });
    $('pb-model').addEventListener('change', save);
    setCur(cur); render();

    const SYS = `Ты парсер для калькулятора окупаемости. Пользователь пишет по-русски свободным текстом о закупках и продажах. Верни ТОЛЬКО JSON:
{"rate":число|null,"add":[{"name":строка,"sell":число,"buy":число,"cur":"USD"|"RUB","qty":число}],"update":[{"match":строка,"sell":число,"buy":число,"cur":"USD"|"RUB","qty":число,"name":строка}],"remove":[строка],"clear":boolean,"reply":строка}
Правила:
- sell — цена продажи ЗА 1 ШТУКУ в рублях. buy — цена закупа ЗА 1 ШТУКУ в валюте cur.
- Если указана общая сумма за партию ("купил 10 шт за 200$"), раздели на количество.
- $, долл, бакс, usd → cur "USD". руб, ₽, р, "к" (тысяч: 3к = 3000) → RUB. Если валюта закупа не указана, считай USD, если сумма похожа на доллары (маленькая относительно продажи), иначе RUB.
- Продажа всегда в рублях; если продажа названа в $, переведи по курсу (rate из текста или текущий).
- qty по умолчанию 1. name — короткое название товара с заглавной буквы.
- "курс 95" → rate 95. Если курс в тексте не назван, rate оставь null: действует текущий, по умолчанию 91 рубль за доллар.
- update/remove: match — название существующего товара из списка (бери точное название из списка).
- clear true только если явно просят очистить всё.
- Если передана история переписки, местоимения и «тот товар», «ещё столько же», «как в прошлый раз» относятся к ней и к уже добавленным товарам.
- reply — короткое подтверждение по-русски, что сделано (до 15 слов).
- Если не хватает цены продажи — ставь sell 0 и упомяни в reply.`;
    const msg = (t) => { $('pb-msg').textContent = t; };
    const P = $('pb-prompt');
    const grow = () => { P.style.height = '20px'; P.style.height = Math.min(P.scrollHeight, 40) + 'px'; };
    P.addEventListener('input', grow);
    P.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
    $('pb-send').onclick = ask;
    root.querySelectorAll('.hint').forEach((b) => { b.onclick = () => { P.value = b.textContent; grow(); P.focus(); }; });
    const n = (v) => { v = parseFloat(String(v).replace(',', '.')); return Number.isFinite(v) && v >= 0 ? v : 0; };
    const find = (m) => { m = String(m || '').toLowerCase(); return items.find((i) => (i.name || '').toLowerCase() === m) || items.find((i) => (i.name || '').toLowerCase().includes(m) || m.includes((i.name || '').toLowerCase())); };
    function apply(d) {
        const fresh = [];
        if (d.rate && n(d.rate)) { $('pb-rate').value = String(n(d.rate)).replace('.', ','); calc(); }
        const rate = num($('pb-rate'));
        if (d.clear) items = [];
        (d.remove || []).forEach((m) => { const it = find(m); if (it) items = items.filter((x) => x !== it); });
        (d.update || []).forEach((u) => {
            const it = find(u.match); if (!it) return;
            ['sell', 'buy', 'qty'].forEach((k) => { if (u[k] != null) it[k] = n(u[k]); });
            if (u.cur) it.cur = u.cur === 'RUB' ? 'RUB' : 'USD';
            if (u.name) it.name = String(u.name);
            if (it.cur === 'USD' && !it.rate) it.rate = rate;
            fresh.push(it.id);
        });
        (d.add || []).forEach((a, k) => {
            const itemCur = a.cur === 'RUB' ? 'RUB' : 'USD';
            const id = Date.now() + k;
            items.push({ id, name: String(a.name || ''), sell: n(a.sell), buy: n(a.buy), cur: itemCur, rate, qty: n(a.qty) || 1, on: true });
            fresh.push(id);
        });
        render(); save();
        const noRate = (d.add || []).some((a) => a.cur !== 'RUB') && !rate;
        const touched = items.filter((it) => fresh.includes(it.id) && it.on);
        const profits = touched.map((it) => {
            const buy = it.cur === 'USD' ? it.buy * (it.rate || 0) : it.buy;
            const profit = (it.sell - buy) * (it.qty || 1);
            return { name: it.name || 'Товар', profit };
        });
        let reply = d.reply || 'Готово';
        if (profits.length === 1) {
            reply += `\nПрибыль: ${rub(profits[0].profit)}`;
        } else if (profits.length > 1) {
            reply += '\n' + profits.map((row) => `${row.name}: ${rub(row.profit)}`).join('\n');
            reply += `\nИтого: ${rub(profits.reduce((sum, row) => sum + row.profit, 0))}`;
        }
        if (noRate) reply += '\nУкажите курс $, иначе закуп = 0';
        msg(reply);
        const t = totals();
        const line = (it) => {
            const buy = it.cur === 'USD' ? it.buy * (it.rate || num($('pb-rate')) || 0) : it.buy;
            const profit = (it.sell - buy) * (it.qty || 1);
            const margin = it.sell ? Math.round((it.sell - buy) / it.sell * 100) : 0;
            return `${it.name || 'Товар'}: ${it.qty} шт, продажа ${rub(it.sell)}, закуп ${rub(buy)}, прибыль ${rub(profit)}, маржа ${margin}%`;
        };
        const facts = [
            `Курс: ${num($('pb-rate')) || 'не задан'} ₽ за $`,
            touched.length ? `Только что посчитано:\n${touched.map(line).join('\n')}` : 'Новых позиций в этом шаге нет',
            t.on.length ? `Весь список:\n${t.on.map(line).join('\n')}` : 'Список пуст',
            `Итого: выручка ${rub(t.s)}, закуп ${rub(t.b)}, прибыль ${rub(t.s - t.b)}`
        ].join('\n');
        const list = t.on.map((it) => {
            const buy = it.cur === 'USD' ? it.buy * (it.rate || num($('pb-rate')) || 0) : it.buy;
            return {
                name: it.name || 'Товар',
                qty: it.qty || 1,
                profit: Math.round((it.sell - buy) * (it.qty || 1))
            };
        });
        return { reply, facts, list };
    }
    async function ask(historyText) {
        const text = P.value.trim();
        if (!text) return '';
        $('pb-ai').classList.add('busy');
        $('pb-send').disabled = true;
        msg('Обрабатываю…');
        const ctx = `Текущий курс: ${num($('pb-rate')) || 'не задан'}. Список товаров: ${items.map((i) => `"${i.name || 'Без названия'}" (продажа ${i.sell}₽, закуп ${i.buy}${i.cur === 'USD' ? '$' : '₽'}, ${i.qty} шт)`).join('; ') || 'пусто'}.`;
        const history = historyText ? `\nИстория переписки, учитывай её при разборе запроса:\n${String(historyText).slice(0, 4000)}` : '';
        try {
            const r = await fetch('/api/calc-ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: $('pb-model').value,
                    messages: [
                        { role: 'system', content: SYS },
                        { role: 'system', content: ctx + history },
                        { role: 'user', content: text }
                    ]
                })
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error?.message || ('Ошибка ' + r.status));
            const result = apply(JSON.parse(j.choices[0].message.content));
            P.value = '';
            grow();
            return result;
        } catch (e) {
            const err = e.message === 'Failed to fetch' ? 'Нет связи' : e.message;
            msg(err);
            throw new Error(err);
        } finally {
            $('pb-ai').classList.remove('busy');
            $('pb-send').disabled = false;
        }
    }
    const toggle = document.getElementById('calc-toggle');
    const setOpen = (open) => {
        root.classList.toggle('is-open', open);
        toggle?.classList.toggle('is-open', open);
        toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    toggle?.addEventListener('click', () => setOpen(!root.classList.contains('is-open')));
    window.paybackCommand = async (text, historyText) => {
        P.value = text;
        grow();
        return ask(historyText);
    };
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && root.classList.contains('is-open')) setOpen(false);
    });

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
        const rec = new SR();
        rec.lang = 'ru-RU';
        rec.interimResults = true;
        $('pb-mic').hidden = false;
        let on = false;
        rec.onresult = (e) => { P.value = [...e.results].map((r) => r[0].transcript).join(''); grow(); };
        rec.onend = () => { on = false; $('pb-mic').classList.remove('on'); if (P.value.trim()) ask(); };
        $('pb-mic').onclick = () => { if (on) { rec.stop(); return; } on = true; $('pb-mic').classList.add('on'); P.value = ''; rec.start(); };
    }
})();
