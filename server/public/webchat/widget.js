(function () {
    'use strict';

    var currentScript = document.currentScript;
    if (!currentScript) return;

    var widgetId = currentScript.getAttribute('data-widget-id');
    if (!widgetId) {
        console.warn('[AlphaCRM Webchat] Missing data-widget-id attribute on script tag.');
        return;
    }

    var apiBase = currentScript.src.replace(/\/webchat\/widget\.js.*$/, '');
    var sessionKey = 'acrm_webchat_session_' + widgetId;
    var sessionToken = localStorage.getItem(sessionKey);
    if (!sessionToken) {
        sessionToken = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
        localStorage.setItem(sessionKey, sessionToken);
    }

    var STYLE = '' +
        '.acrm-webchat-bubble{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;' +
        'background:var(--acrm-color,#4F46E5);box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;z-index:2147483000;' +
        'display:flex;align-items:center;justify-content:center;border:none;}' +
        '.acrm-webchat-bubble svg{width:26px;height:26px;fill:#fff;}' +
        '.acrm-webchat-panel{position:fixed;bottom:88px;right:20px;width:340px;max-width:calc(100vw - 40px);height:480px;' +
        'max-height:calc(100vh - 120px);background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.3);' +
        'display:none;flex-direction:column;overflow:hidden;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}' +
        '.acrm-webchat-panel.acrm-webchat-open{display:flex;}' +
        '.acrm-webchat-header{background:var(--acrm-color,#4F46E5);color:#fff;padding:14px 16px;font-weight:600;font-size:15px;}' +
        '.acrm-webchat-welcome{padding:10px 14px;font-size:13px;color:#555;background:#f4f4f8;}' +
        '.acrm-webchat-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#fafafa;}' +
        '.acrm-webchat-msg{max-width:78%;padding:8px 12px;border-radius:14px;font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word;}' +
        '.acrm-webchat-msg.acrm-webchat-out{align-self:flex-end;background:var(--acrm-color,#4F46E5);color:#fff;border-bottom-right-radius:4px;}' +
        '.acrm-webchat-msg.acrm-webchat-in{align-self:flex-start;background:#eee;color:#222;border-bottom-left-radius:4px;}' +
        '.acrm-webchat-inputbar{display:flex;border-top:1px solid #eee;padding:8px;gap:8px;}' +
        '.acrm-webchat-input{flex:1;border:1px solid #ddd;border-radius:20px;padding:8px 14px;font-size:13px;outline:none;}' +
        '.acrm-webchat-send{background:var(--acrm-color,#4F46E5);color:#fff;border:none;border-radius:20px;padding:8px 16px;font-size:13px;cursor:pointer;}' +
        '.acrm-webchat-send:disabled{opacity:.5;cursor:default;}';

    var styleEl = document.createElement('style');
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    var bubble = document.createElement('button');
    bubble.className = 'acrm-webchat-bubble';
    bubble.setAttribute('aria-label', 'Chat');
    bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16v12H5.17L4 17.17V4z"/></svg>';

    var panel = document.createElement('div');
    panel.className = 'acrm-webchat-panel';
    panel.innerHTML =
        '<div class="acrm-webchat-header"></div>' +
        '<div class="acrm-webchat-welcome" style="display:none"></div>' +
        '<div class="acrm-webchat-messages"></div>' +
        '<div class="acrm-webchat-inputbar">' +
        '<input class="acrm-webchat-input" type="text" placeholder="Nhap tin nhan..." />' +
        '<button class="acrm-webchat-send">Gui</button>' +
        '</div>';

    document.body.appendChild(bubble);
    document.body.appendChild(panel);

    var headerEl = panel.querySelector('.acrm-webchat-header');
    var welcomeEl = panel.querySelector('.acrm-webchat-welcome');
    var messagesEl = panel.querySelector('.acrm-webchat-messages');
    var inputEl = panel.querySelector('.acrm-webchat-input');
    var sendEl = panel.querySelector('.acrm-webchat-send');

    var isOpen = false;
    var historyLoaded = false;
    var eventSource = null;
    var renderedIds = Object.create(null);

    function appendMessage(message) {
        var id = message._id || message.providerMessageId;
        if (id && renderedIds[id]) return;
        if (id) renderedIds[id] = true;

        var el = document.createElement('div');
        el.className = 'acrm-webchat-msg ' + (message.direction === 'outbound' ? 'acrm-webchat-out' : 'acrm-webchat-in');
        el.textContent = message.content || '';
        messagesEl.appendChild(el);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function loadConfig() {
        fetch(apiBase + '/api/public/webchat/' + widgetId + '/config')
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (!res.success) return;
                var data = res.data;
                document.documentElement.style.setProperty('--acrm-color', data.primaryColorHex || '#4F46E5');
                panel.style.setProperty('--acrm-color', data.primaryColorHex || '#4F46E5');
                bubble.style.setProperty('--acrm-color', data.primaryColorHex || '#4F46E5');
                headerEl.textContent = data.widgetName || 'Ho tro truc tuyen';
                if (data.welcomeMessage) {
                    welcomeEl.textContent = data.welcomeMessage;
                    welcomeEl.style.display = 'block';
                }
            })
            .catch(function () {});
    }

    function loadHistory() {
        if (historyLoaded) return;
        historyLoaded = true;
        fetch(apiBase + '/api/public/webchat/' + widgetId + '/messages?sessionToken=' + encodeURIComponent(sessionToken))
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (!res.success) return;
                (res.data || []).forEach(appendMessage);
            })
            .catch(function () {});
    }

    function connectEvents() {
        if (eventSource) return;
        eventSource = new EventSource(apiBase + '/api/public/webchat/' + widgetId + '/events?sessionToken=' + encodeURIComponent(sessionToken));
        eventSource.addEventListener('message.new', function (e) {
            try {
                appendMessage(JSON.parse(e.data));
            } catch (err) {}
        });
    }

    function sendMessage() {
        var text = inputEl.value.trim();
        if (!text) return;
        inputEl.value = '';
        sendEl.disabled = true;
        appendMessage({ direction: 'inbound', content: text, providerMessageId: 'local-' + Date.now() });
        fetch(apiBase + '/api/public/webchat/' + widgetId + '/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: sessionToken, text: text })
        })
            .catch(function () {})
            .finally(function () { sendEl.disabled = false; });
    }

    bubble.addEventListener('click', function () {
        isOpen = !isOpen;
        panel.classList.toggle('acrm-webchat-open', isOpen);
        if (isOpen) {
            loadHistory();
            connectEvents();
        }
    });

    sendEl.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') sendMessage();
    });

    loadConfig();
})();
