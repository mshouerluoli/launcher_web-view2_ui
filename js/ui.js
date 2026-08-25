
        // ==================== 模拟游戏数据 ====================
        // 以后由 C++ 端下发（Launcher.json / 命令消息），这里先写死演示
        const GAMES = [
            {
                id: 'ys',
                name: '原神',
                process: 'YuanShen.exe',          // 进程名，显示时去掉 .exe
                icon: 'https://launcher-36j.pages.dev/icon/ys.png', // 图标 URL（没有就显示 fallback）
                fallback: '🏔️',
                path: 'D:\\Games\\Genshin Impact\\YuanShen.exe',
                launchParams: ''
            },
            {
                id: 'sr',
                name: '崩坏：星穹铁道',
                process: 'StarRail.exe',
                fallback: '🚆',
                path: 'D:\\Games\\StarRail\\StarRail.exe',
                launchParams: '-window-mode borderless'
            },
            {
                id: 'zzz',
                name: '绝区零',
                process: 'ZenlessZoneZero.exe',
                fallback: '🎮',
                path: 'D:\\Games\\ZenlessZoneZero\\ZenlessZoneZero.exe',
                launchParams: ''
            },
            {
                id: 'bh3',
                name: '崩坏3',
                process: 'BH3.exe',
                fallback: '⚡',
                path: 'D:\\Games\\BH3\\BH3.exe',
                launchParams: ''
            }
        ];

        // 内置默认背景（胡桃视频；C++ defaultBg 消息到达前/未设置时兜底）
        const DEFAULT_BG_URL = 'https://haowallpaper.com/link//common/file/previewFileImg/18862142600695168';

        // 注入类型（每游戏独立记忆，默认劫持）
        let injectTypes = {};
        GAMES.forEach(g => injectTypes[g.id] = '劫持');

        let currentGameId = GAMES[0].id;
        // 恢复上次选中的游戏（localStorage 记忆，首次启动为第一个）
        {
            const savedSel = readSettings().selectedGame;
            if (savedSel && GAMES.some(x => x.id === savedSel)) currentGameId = savedSel;
        }
        let cppConnected = false; // 是否收到过 C++ 的 gameList

        // ==================== C++ 消息通信 ====================
        const isCpp = !!(window.chrome && window.chrome.webview && window.chrome.webview.postMessage);

        function sendToCpp(msg) {
            if (isCpp) {
                window.chrome.webview.postMessage(msg);
            } else {
                console.log('send:', msg);
            }
        }

        // 用 C++ 下发的游戏列表重建数据
        function applyGameList(list) {
            cppConnected = true;
            const prevId = currentGameId;
            const savedSel = readSettings().selectedGame;
            GAMES.length = 0;
            list.forEach(g => {
                GAMES.push({
                    id: g.id || ('g' + Math.random().toString(36).slice(2, 8)),
                    name: g.name || (g.process ? g.process.replace(/\.exe$/i, '') : '未命名'),
                    process: g.process || '',
                    icon: g.icon || '',
                    fallback: '🎮',
                    path: g.path || '',
                    launchParams: g.launchParams || '',
                    injectType: g.injectType === 'thread' ? '线程' : '劫持'
                });
            });
            injectTypes = {};
            GAMES.forEach(g => injectTypes[g.id] = g.injectType);
            // 恢复选中：上次选中的还在列表里 → 沿用；否则用本地记忆；再兜底第一个
            currentGameId = null;
            if (prevId && GAMES.some(x => x.id === prevId)) currentGameId = prevId;
            else if (savedSel && GAMES.some(x => x.id === savedSel)) currentGameId = savedSel;
            if (!currentGameId) currentGameId = GAMES.length ? GAMES[0].id : null;
            renderGameList();
            renderTabs();
            refreshBg();
            resetStartBtn();
        }

        // C++ 错误/提示弹窗
        function showCppMessage(d) {
            document.getElementById('cppMsgTitle').textContent = d.title || '提示';
            document.getElementById('cppMsgText').textContent = d.text || '';
            document.getElementById('cppMsgBox').classList.add('show');
        }
        document.getElementById('cppMsgOk').addEventListener('click', () => {
            document.getElementById('cppMsgBox').classList.remove('show');
        });
        document.getElementById('cppMsgBox').addEventListener('click', (e) => {
            if (e.target === document.getElementById('cppMsgBox')) {
                document.getElementById('cppMsgBox').classList.remove('show');
            }
        });

        if (isCpp) {
            window.chrome.webview.addEventListener('message', (e) => {
                let d = e.data;
                if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) { return; } }
                if (!d || !d.cmd) return;
                if (d.cmd === 'gameList') {
                    applyGameList(Array.isArray(d.games) ? d.games : []);
                } else if (d.cmd === 'defaultBg') {
                    // 全局背景：未设置过 或 还是默认标记 → 用默认背景 URL；用户显式设置过则不覆盖
                    const s = readSettings();
                    const hasBg = !!(s.bgImage || s.bgVideo);
                    const isDefault = !!s.bgIsDefault;
                    if (d.url && (!hasBg || isDefault)) {
                        setCfg('global', { bgType: 'video', bgVideo: d.url, bgIsDefault: true });
                        refreshBg();
                    }
                } else if (d.cmd === 'showMessage') {
                    showCppMessage(d);
                } else if (d.cmd === 'selectGameFile') {
                    if (d.path) {
                        document.getElementById('addPath').value = d.path;
                        const p = d.path.replace(/\\/g, '/');
                        const base = p.split('/').pop().replace(/\.exe$/i, '');
                        const nameInput = document.getElementById('addName');
                        nameInput.value = base;
                        nameInput.select();
                        document.getElementById('addProcess').value = base + '.exe';
                    }
                }
            });
            // 页面加载完成 → 请求游戏列表
            sendToCpp({ cmd: 'pageLoaded' });
        }

        // ==================== 渲染左侧图标栏 ====================
        const iconList = document.getElementById('gameIconList');
        const gameTooltip = document.getElementById('gameTooltip');
        let tooltipTimer = null;

        function showGameTooltip(btn, text) {
            clearTimeout(tooltipTimer);
            gameTooltip.textContent = text;
            const r = btn.getBoundingClientRect();
            gameTooltip.style.left = (r.right + 14) + 'px';
            gameTooltip.style.top = (r.top + r.height / 2) + 'px';
            gameTooltip.classList.add('show');
        }
        function hideGameTooltip() {
            tooltipTimer = setTimeout(() => gameTooltip.classList.remove('show'), 120);
        }

        function renderGameList() {
            iconList.innerHTML = '';
            GAMES.forEach(g => {
                const btn = document.createElement('div');
                btn.className = 'game-icon-btn' + (g.id === currentGameId ? ' active' : '');
                btn.dataset.id = g.id;

                // 图标：有 exe 图标只显示图片（隐藏 emoji），加载失败才回退 emoji
                const fb = document.createElement('span');
                fb.className = 'icon-fallback';
                fb.textContent = g.fallback;
                if (g.icon) {
                    const img = document.createElement('img');
                    img.src = g.icon;
                    img.onerror = function () { img.style.display = 'none'; fb.style.display = 'flex'; };
                    btn.appendChild(img);
                    fb.style.display = 'none'; // 有图标时隐藏 emoji
                }
                btn.appendChild(fb);

                // hover 提示：显示游戏名称
                const tipText = g.name;
                btn.addEventListener('mouseenter', () => showGameTooltip(btn, tipText));
                btn.addEventListener('mouseleave', hideGameTooltip);

                // 右键删除
                btn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    pendingDeleteId = g.id;
                    deleteConfirmName.textContent = g.name;
                    deleteConfirmDialog.classList.add('show');
                });

                btn.addEventListener('click', () => switchGame(g.id));
                iconList.appendChild(btn);
            });
            applyGameListMaxHeight();
        }

        // 游戏图标显示数量限制：可见容器高 = 侧栏高度/2 + 一个图标高度，算出能放 N 个，超出滚轮滚动
        function applyGameListMaxHeight() {
            const list = document.getElementById('gameIconList');
            if (!list) return;
            const firstBtn = list.querySelector('.game-icon-btn');
            const iconH = firstBtn ? firstBtn.offsetHeight : 46;   // 每个图标高度
            const gap = 10;                                        // 图标间距
            const sb = document.querySelector('.side-bar');
            const H = sb ? sb.clientHeight : window.innerHeight;   // 侧栏高度
            const half = H / 2 + iconH;                            // 半侧栏 + 一个图标
            let N = Math.floor(half / iconH);                      // 能放多少个
            if (N < 1) N = 1;
            list.style.maxHeight = (N * (iconH + gap) - gap) + 'px';
            list.style.overflowY = 'auto';
        }

        // ==================== 渲染右侧 tab ====================
        const tabs = document.getElementById('gameTabs');
        function renderTabs() {
            tabs.innerHTML = '';
            GAMES.forEach(g => {
                const tab = document.createElement('div');
                tab.className = 'game-tab' + (g.id === currentGameId ? ' active' : '');
                tab.dataset.id = g.id;
                // 内容暂时不需要（只留背景层）
                tabs.appendChild(tab);
            });
        }

        // ==================== 切换游戏 ====================
        function switchGame(id) {
            if (currentGameId === id) {
                resetStartBtn(); // 点当前游戏也复位启动按钮状态（单游戏时也能刷新）
                refreshBg(); // 点当前游戏也刷新背景（视频可能因自动播放策略暂停）
                return;
            }
            currentGameId = id;
            // 记忆选中的游戏，下次启动/打开设置仍停留在此游戏
            const s = readSettings();
            if (s.selectedGame !== id) { s.selectedGame = id; writeSettings(s); }

            document.querySelectorAll('.game-icon-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.id === id));
            document.querySelectorAll('.game-tab').forEach(t =>
                t.classList.toggle('active', t.dataset.id === id));

            resetStartBtn(); // 切游戏后复位启动按钮状态
            refreshBg(); // 切换游戏后加载该游戏的背景（无则全局）
            refreshPopupMenuIfOpen();
        }

        // ==================== 弹窗菜单（注入类型在这里） ====================
        const popupMenu = document.getElementById('popupMenu');
        const menuBtn = document.getElementById('menuBtn');

        function renderPopupMenu() {
            const g = GAMES.find(x => x.id === currentGameId);
            const cur = injectTypes[currentGameId];
            popupMenu.innerHTML = `
                <div class="popup-menu-title">${g.name}</div>
                <div class="popup-menu-item" data-action="inject">
                    <span>注入类型</span>
                    <span style="color:#87ceeb;">${cur} ›</span>
                </div>
                <div class="popup-menu-item" data-action="pluginDir">
                    <span>插件目录</span>
                </div>
                <div class="popup-menu-sep"></div>
                <div class="popup-menu-item" data-action="设置"><span>设置</span></div>
            `;

            popupMenu.querySelector('.popup-menu-item[data-action="inject"]').addEventListener('click', (e) => {
                e.stopPropagation();
                showInjectDialog();
            });
            popupMenu.querySelector('.popup-menu-item[data-action="pluginDir"]').addEventListener('click', (e) => {
                e.stopPropagation();
                popupMenu.style.display = 'none';
                sendToCpp({ cmd: 'openPluginDir', game: currentGameId });
            });
            popupMenu.querySelector('.popup-menu-item[data-action="设置"]').addEventListener('click', () => {
                popupMenu.style.display = 'none';
                console.log('send:', { cmd: 'componentEvent', action: 'click', component: 'settingsBtn', game: currentGameId });
                sendToCpp({ cmd: 'componentEvent', action: 'click', component: 'settingsBtn', game: currentGameId });
                showSettingsDialog('game'); // 当前游戏的设置（背景）
            });
        }

        // ==================== 注入类型选择小弹窗 ====================
        const injectDialog = document.getElementById('injectDialog');
        const injectDialogSub = document.getElementById('injectDialogSub');
        const injectDialogTip = document.getElementById('injectDialogTip');
        let pendingInject = '劫持'; // 弹窗内待保存的选中类型（点保存才写入 injectTypes）

        // 注入类型提示（劫持需要说明劫持名/改名，线程不用）
        // 注意：两种提示必须等行数，否则悬停切换时弹窗高度变化会来回抖动
        function injectTipHtml(type) {
            const dllName = `${currentGameId}.dll`;
            const dllRow = `<span class="dll-row"><code class="dll-name">${dllName}</code><button class="copy-dll" data-dll="${dllName}" type="button">复制</button></span>`;
            if (type === '线程') {
                return `<span class="tip-title">🧵 线程注入</span>无劫持名（不用 version.dll）
① DLL 放插件目录，命名为
${dllRow}
② 点开始游戏，直接注入
③ 不用复制成 version.dll`;
            }
            return `<span class="tip-title">🔗 劫持注入</span>劫持名：<b>version.dll</b>（游戏目录里加载）
① DLL 放插件目录，命名为
${dllRow}
② 启动时自动复制为游戏目录 version.dll
③ 游戏加载后注入完成`;
        }

        function updateInjectTip(type) {
            injectDialogTip.innerHTML = injectTipHtml(type);
            injectDialogTip.querySelectorAll('.copy-dll').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    copyDllName(btn.dataset.dll, btn);
                });
            });
        }

        function copyDllName(dllName, btn) {
            const done = () => {
                const old = btn.textContent;
                btn.textContent = '已复制';
                btn.classList.add('copied');
                setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1200);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(dllName).then(done).catch(() => fallbackCopy(dllName, done));
            } else {
                fallbackCopy(dllName, done);
            }
        }

        function fallbackCopy(text, done) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            done();
        }

        function showInjectDialog() {
            const g = GAMES.find(x => x.id === currentGameId);
            pendingInject = injectTypes[currentGameId];
            injectDialogSub.textContent = `${g.name} · 当前：${pendingInject}`;
            injectDialog.querySelectorAll('.inject-dialog-option').forEach(o =>
                o.classList.toggle('active', o.dataset.inject === pendingInject));
            updateInjectTip(pendingInject);
            injectDialog.classList.add('show');
        }
        function hideInjectDialog() {
            injectDialog.classList.remove('show');
        }

        injectDialog.querySelectorAll('.inject-dialog-option').forEach(opt => {
            opt.addEventListener('click', () => {
                // 只高亮选中，不保存、不关闭弹窗（由下方“保存”按钮统一生效）
                pendingInject = opt.dataset.inject;
                injectDialog.querySelectorAll('.inject-dialog-option').forEach(o =>
                    o.classList.toggle('active', o.dataset.inject === pendingInject));
                injectDialogSub.textContent = `${GAMES.find(x => x.id === currentGameId).name} · 当前：${pendingInject}`;
                updateInjectTip(pendingInject);
            });
        });
        document.getElementById('injectSave').addEventListener('click', () => {
            const chosen = pendingInject;
            injectTypes[currentGameId] = chosen;
            hideInjectDialog();
            renderPopupMenu(); // 刷新菜单里的当前值
            // 同步右侧 tab 的选中态
            const tab = document.querySelector(`.game-tab[data-id="${currentGameId}"]`);
            tab.querySelectorAll('.inject-option').forEach(o =>
                o.classList.toggle('active', o.dataset.inject === chosen));
            console.log('send:', { cmd: 'componentEvent', action: 'selectInjectType', injectType: chosen === '线程' ? 'thread' : 'hijack', game: currentGameId });
            sendToCpp({ cmd: 'componentEvent', action: 'selectInjectType', injectType: chosen === '线程' ? 'thread' : 'hijack', game: currentGameId });
        });
        injectDialog.addEventListener('click', (e) => {
            if (e.target === injectDialog) hideInjectDialog();
        });


        function showPopupMenu() {
            renderPopupMenu();
            const rect = menuBtn.getBoundingClientRect();
            popupMenu.style.right = '30px';
            popupMenu.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
            popupMenu.style.display = 'block';
        }
        function hidePopupMenu() {
            popupMenu.style.display = 'none';
        }
        // 菜单开着时刷新内容（切游戏/改注入类型后同步显示）
        function refreshPopupMenuIfOpen() {
            if (popupMenu.style.display === 'block') renderPopupMenu();
        }

        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('send:', { cmd: 'componentEvent', action: 'click', component: 'menuBtn' });
            sendToCpp({ cmd: 'componentEvent', action: 'click', component: 'menuBtn' });
            if (popupMenu.style.display === 'block') hidePopupMenu();
            else showPopupMenu();
        });

        document.addEventListener('click', (e) => {
            if (!popupMenu.contains(e.target) && !e.target.closest('#menuBtn')) {
                hidePopupMenu();
            }
        });

        // ==================== 开始游戏（模拟，发消息结构不变） ====================
        const startBtn = document.getElementById('startBtn');
        const startBtnText = startBtn.innerHTML;
        let 正在启动 = false;
        let startTimer = null;

        // 刷新启动按钮状态：没游戏→禁用；有游戏→可点；启动中→动画态
        function updateStartBtnState() {
            const hasGame = GAMES.length > 0 && currentGameId;
            startBtn.disabled = !hasGame || 正在启动;
            startBtn.style.opacity = !hasGame ? '0.4' : (正在启动 ? '0.7' : '1');
            startBtn.style.cursor = hasGame ? 'pointer' : 'not-allowed';
        }
        // 复位：清动画、恢复文本、刷新状态（切游戏/删游戏/添加后调用）
        function resetStartBtn() {
            if (startTimer) { clearTimeout(startTimer); startTimer = null; }
            正在启动 = false;
            startBtn.innerHTML = startBtnText;
            updateStartBtnState();
        }

        startBtn.addEventListener('click', function () {
            if (正在启动) return;
            const g = GAMES.find(x => x.id === currentGameId);
            if (!g) return; // 没有游戏时忽略
            正在启动 = true;
            startBtn.innerHTML = '<svg class="spin-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="40 22" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> 启动中......';
            updateStartBtnState();

            console.log('send:', {
                cmd: 'componentEvent',
                action: 'click',
                component: 'startGame',
                game: g.id,
                process: g.process.replace(/\.exe$/i, ''),
                path: g.path,
                injectType: injectTypes[currentGameId] === '线程' ? 'thread' : 'hijack',
                launchParams: getCfg('game').launchParams || g.launchParams || ''
            });
            sendToCpp({
                cmd: 'componentEvent',
                action: 'click',
                component: 'startGame',
                game: g.id,
                process: g.process.replace(/\.exe$/i, ''),
                path: g.path,
                injectType: injectTypes[currentGameId] === '线程' ? 'thread' : 'hijack',
                launchParams: getCfg('game').launchParams || g.launchParams || ''
            });

            startTimer = setTimeout(function () {
                正在启动 = false;
                startBtn.innerHTML = startBtnText;
                updateStartBtnState();
            }, 2000);
        });

        // 初始状态
        updateStartBtnState();

        // ==================== 删除游戏 ====================
        const deleteConfirmDialog = document.getElementById('deleteConfirmDialog');
        const deleteConfirmName = document.getElementById('deleteConfirmName');
        let pendingDeleteId = null;

        document.getElementById('deleteCancel').addEventListener('click', () => {
            deleteConfirmDialog.classList.remove('show');
        });
        deleteConfirmDialog.addEventListener('click', (e) => {
            if (e.target === deleteConfirmDialog) deleteConfirmDialog.classList.remove('show');
        });
        document.getElementById('deleteConfirm').addEventListener('click', () => {
            if (!pendingDeleteId) return;
            const idx = GAMES.findIndex(x => x.id === pendingDeleteId);
            if (idx !== -1) {
                GAMES.splice(idx, 1);
                delete injectTypes[pendingDeleteId];
                if (currentGameId === pendingDeleteId) {
                    currentGameId = GAMES.length ? GAMES[0].id : null;
                }
            }
            const delId = pendingDeleteId;
            pendingDeleteId = null;
            deleteConfirmDialog.classList.remove('show');
            // 通知 C++ 删除（无 C++ 时本地模拟）
            sendToCpp({ cmd: 'removeGame', game: delId });
            if (!isCpp) {
                const idx = GAMES.findIndex(x => x.id === delId);
                if (idx !== -1) {
                    GAMES.splice(idx, 1);
                    delete injectTypes[delId];
                    if (currentGameId === delId) {
                        currentGameId = GAMES.length ? GAMES[0].id : null;
                    }
                }
                renderGameList();
                renderTabs();
                resetStartBtn();
                refreshBg();
            }
            console.log('send:', { cmd: 'removeGame', game: delId });
        });

        // ==================== 添加游戏 ====================
        const addGameDialog = document.getElementById('addGameDialog');
        const addName = document.getElementById('addName');
        const addProcess = document.getElementById('addProcess');
        const addPath = document.getElementById('addPath');
        const addGameBtn = document.getElementById('addGameBtn');
        const filePicker = document.getElementById('filePicker');
        const addConfirmBtn = document.getElementById('addConfirm');
        // 添加弹窗确定按钮状态：dup=true 时标题改「路径已存在」且底色变红（醒目提示）
        function setAddConfirmState(dup) {
            addConfirmBtn.textContent = dup ? '路径已存在' : '确定添加';
            addConfirmBtn.classList.toggle('is-dup', dup);
        }

        // 「+」按钮也用自定义悬浮提示
        addGameBtn.addEventListener('mouseenter', () => showGameTooltip(addGameBtn, '添加游戏'));
        addGameBtn.addEventListener('mouseleave', hideGameTooltip);

        addGameBtn.addEventListener('click', () => {
            addName.value = '';
            addProcess.value = '';
            addPath.value = '';
            setAddConfirmState(false); // 打开弹窗时还原确定按钮
            addGameDialog.classList.add('show');
            setTimeout(() => addName.focus(), 60);
        });
        document.getElementById('addCancel').addEventListener('click', () => {
            addGameDialog.classList.remove('show');
        });
        addGameDialog.addEventListener('click', (e) => {
            if (e.target === addGameDialog) addGameDialog.classList.remove('show');
        });
        document.getElementById('addConfirm').addEventListener('click', () => {
            const name = addName.value.trim();
            let proc = addProcess.value.trim();
            if (!name || !proc) return;
            if (!/\.exe$/i.test(proc)) proc += '.exe'; // 自动补 .exe

            // 路径去重：已有游戏使用同一路径则拒绝添加，并把确定按钮标题改成提示，点 addBrowse 还原
            const newPath = addPath.value.trim();
            if (newPath) {
                const dupPath = GAMES.some(g => {
                    const gp = (g.path || '').trim();
                    return gp && gp.toLowerCase() === newPath.toLowerCase();
                });
                if (dupPath) {
                    setAddConfirmState(true);
                    return;
                }
            }

            const id = 'g' + Date.now();
            // 通知 C++ 添加（无 C++ 时本地模拟）
            sendToCpp({ cmd: 'addGame', game: { id, name, process: proc, path: addPath.value.trim() || '', launchParams: '' } });
            if (!isCpp) {
                GAMES.push({
                    id,
                    name,
                    process: proc,
                    fallback: '🎮',
                    path: addPath.value.trim() || '未设置路径',
                    launchParams: ''
                });
                injectTypes[id] = '劫持'; // 新游戏默认劫持
                addGameDialog.classList.remove('show');
                renderGameList();
                renderTabs();
                switchGame(id);
            } else {
                addGameDialog.classList.remove('show');
            }
            console.log('send:', { cmd: 'addGame', game: GAMES[GAMES.length - 1] });
        });
        // 浏览选择 exe：C++ 环境走系统文件对话框，否则本地 file input
        document.getElementById('addBrowse').addEventListener('click', () => {
            setAddConfirmState(false); // 重新浏览时还原确定按钮
            if (isCpp) {
                sendToCpp({ cmd: 'selectGameFile' });
            } else {
                filePicker.click();
            }
        });
        filePicker.addEventListener('change', () => {
            const f = filePicker.files[0];
            if (!f) return;
            const exeName = f.name;
            const base = exeName.replace(/\.exe$/i, '');
            addName.value = base; // 每次选择都同步成 exe 名
            addProcess.value = exeName;
            addPath.value = f.name; // demo 拿不到完整路径，正式版为完整绝对路径
            console.log('send:', { cmd: 'selectGameFile', fileName: exeName, note: '正式版由 C++ 弹文件选择器返回完整路径' });
            addName.focus(); // 让客户确认/修改游戏名
            addName.select();
            filePicker.value = '';
        });

        // 回车确认
        [addName, addProcess, addPath].forEach(inp => {
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') document.getElementById('addConfirm').click();
            });
        });

        // ==================== 设置弹窗（紧凑版：背景链接，全局 + 每游戏独立） ====================
        const settingsDialog = document.getElementById('settingsDialog');
        const settingsTitle = document.getElementById('settingsTitle');
        const settingsSub = document.getElementById('settingsSub');
        const bgLayer = document.getElementById('bgLayer');
        const bgVideo = document.getElementById('bgVideo');
        const bgUrlInput = document.getElementById('bgUrlInput');
        const launchParamsInput = document.getElementById('launchParamsInput');
        const launchParamsSection = document.getElementById('launchParamsSection');
        let settingsMode = 'global'; // 'global' = 右上角齿轮；'game' = 当前游戏

        function readSettings() {
            try { return JSON.parse(localStorage.getItem('miao_settings') || '{}'); } catch (e) { return {}; }
        }
        function writeSettings(s) {
            localStorage.setItem('miao_settings', JSON.stringify(s));
        }
        // 取某个层级的背景配置（全局或某游戏），无则空对象
        function getCfg(mode) {
            if (mode === 'game') {
                const s = readSettings();
                return (s.games && s.games[currentGameId]) || {};
            }
            return readSettings();
        }
        // 合并写入配置 patch: {bgType?, bgImage?, bgVideo?}
        function setCfg(mode, patch) {
            const s = readSettings();
            if (mode === 'game') {
                if (!s.games) s.games = {};
                if (!s.games[currentGameId]) s.games[currentGameId] = {};
                Object.assign(s.games[currentGameId], patch);
            } else {
                Object.assign(s, patch);
            }
            writeSettings(s);
        }
        // 当前生效配置：游戏自己的（有背景）→ 全局（有背景）→ 内置默认背景（兜底，保证启动就有）
        function getEffectiveCfg() {
            const g = GAMES.find(x => x.id === currentGameId);
            if (g) {
                const gc = getCfg('game');
                if (gc.bgImage || gc.bgVideo) return gc;
            }
            const gc = getCfg('global');
            if (gc.bgImage || gc.bgVideo) return gc;
            return { bgType: 'video', bgVideo: DEFAULT_BG_URL, isBuiltin: true };
        }

        // 应用背景：单层。视频优先，失败回退图片（同层 → 全局图片 → 默认）；同 URL 不重复设置避免中断
        function refreshBg() {
            const cfg = getEffectiveCfg();
            const isVideo = !!(cfg && cfg.bgType === 'video' && cfg.bgVideo);
            const isImg = !!(cfg && !isVideo && cfg.bgImage);

            if (isVideo) {
                if (bgVideo.getAttribute('src') !== cfg.bgVideo) {
                    bgVideo.pause();
                    bgVideo.removeAttribute('src');
                    bgVideo.load();
                    bgVideo.src = cfg.bgVideo;
                }
                bgLayer.style.backgroundImage = '';
                const p = bgVideo.play();
                if (p && p.catch) p.catch((err) => {
                    // AbortError = 被新的 pause()/play() 请求打断（refreshBg 连续调用），正常现象不处理
                    if (err && err.name === 'AbortError') return;
                    console.log('bgVideo play failed:', err && err.name, err && err.message);
                    fallbackToImage(cfg);
                });
            } else if (isImg) {
                bgVideo.pause();
                bgVideo.removeAttribute('src');
                bgVideo.load();
                bgLayer.style.backgroundImage = `url('${cfg.bgImage}')`;
            } else {
                bgVideo.pause();
                bgVideo.removeAttribute('src');
                bgVideo.load();
                bgLayer.style.backgroundImage = '';
            }
        }
        function fallbackToImage(cfg) {
            let img = cfg.bgImage;
            if (!img) {
                const gc = readSettings();
                img = gc.bgImage || null;
            }
            // 没有已存图片、但视频 URL 本身可能是图片（无扩展名 CDN）→ 试加载
            if (!img && cfg.bgVideo) {
                const probe = new Image();
                probe.onload = () => {
                    bgVideo.pause();
                    bgVideo.removeAttribute('src');
                    bgVideo.load();
                    bgLayer.style.backgroundImage = `url('${cfg.bgVideo}')`;
                };
                probe.onerror = () => {
                    bgVideo.pause();
                    bgVideo.removeAttribute('src');
                    bgVideo.load();
                    bgLayer.style.backgroundImage = '';
                };
                probe.src = cfg.bgVideo;
                return;
            }
            bgVideo.pause();
            bgVideo.removeAttribute('src');
            bgVideo.load();
            bgLayer.style.backgroundImage = img ? `url('${img}')` : '';
        }
        bgVideo.addEventListener('error', () => fallbackToImage(getEffectiveCfg() || {}));

        // 设置弹窗 UI（紧凑）：标题/说明 + 启动参数（仅游戏）+ 背景链接
        function showSettingsDialog(mode) {
            settingsMode = mode;
            const cfg = getCfg(mode);

            bgUrlInput.value = cfg.bgVideo || '';

            if (mode === 'game') {
                const g = GAMES.find(x => x.id === currentGameId);
                settingsTitle.textContent = g ? `设置 · ${g.name}` : '设置';
                settingsSub.textContent = '🎬 背景链接（视频/图片 URL，未设置则用全局背景）';
                launchParamsSection.style.display = 'block';
                launchParamsInput.value = cfg.launchParams || (g ? g.launchParams : '') || '';
            } else {
                settingsTitle.textContent = '设置 · 全局';
                settingsSub.textContent = '🎬 背景链接（视频/图片 URL，游戏未设置时使用）';
                launchParamsSection.style.display = 'none';
            }
            settingsDialog.classList.add('show');
        }
        function hideSettingsDialog() {
            settingsDialog.classList.remove('show');
        }

        // URL 类型识别：视频/图片扩展名白名单；未知/无扩展名 → 先按视频试（失败会自动兜底图片）
        function guessBgType(url) {
            if (/\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(url)) return 'image';
            if (/\.(mp4|webm|mov|m4v|ogg|ogv)$/i.test(url)) return 'video';
            return 'video'; // 无扩展名的 CDN 链接（如好壁纸）多数是视频
        }

        // 应用 URL 链接（自动识别视频/图片，同原版「预览」）
        document.getElementById('bgUrlApply').addEventListener('click', () => {
            const url = bgUrlInput.value.trim();
            if (!url) return;
            if (guessBgType(url) === 'video') {
                setCfg(settingsMode, { bgType: 'video', bgVideo: url, bgIsDefault: false });
            } else {
                setCfg(settingsMode, { bgType: 'image', bgImage: url, bgIsDefault: false });
            }
            refreshBg();
        });
        bgUrlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('bgUrlApply').click();
        });
        document.getElementById('settingsBgReset').addEventListener('click', () => {
            setCfg(settingsMode, { bgImage: null, bgVideo: null, bgIsDefault: false });
            bgUrlInput.value = '';
            refreshBg();
        });

        // 保存设置：存启动参数（仅游戏）+ 应用背景链接输入框的值，然后关闭
        function saveSettings() {
            if (settingsMode === 'game') {
                setCfg('game', { launchParams: launchParamsInput.value.trim() });
            }
            // 背景链接输入框有值 → 保存并应用（用户显式设置）
            const url = bgUrlInput.value.trim();
            if (url) {
                if (guessBgType(url) === 'video') {
                    setCfg(settingsMode, { bgType: 'video', bgVideo: url, bgIsDefault: false });
                } else {
                    setCfg(settingsMode, { bgType: 'image', bgImage: url, bgIsDefault: false });
                }
                refreshBg();
            }
            hideSettingsDialog();
        }
        document.getElementById('settingsDone').addEventListener('click', saveSettings);
        document.getElementById('settingsCancel').addEventListener('click', hideSettingsDialog);
        document.getElementById('settingsClose').addEventListener('click', hideSettingsDialog);
        settingsDialog.addEventListener('click', (e) => {
            if (e.target === settingsDialog) hideSettingsDialog();
        });

        // 右上角齿轮（保持原样式）→ 全局设置
        document.getElementById('设置按钮').addEventListener('click', () => {
            console.log('send:', { cmd: 'componentEvent', action: 'click', component: 'settingsBtn' });
            sendToCpp({ cmd: 'componentEvent', action: 'click', component: 'settingsBtn' });
            showSettingsDialog('global');
        });

        // ==================== 窗口按钮（对接 C++） ====================
        ['最小化按钮', '最大化按钮', '关闭按钮'].forEach(id => {
            document.getElementById(id).addEventListener('click', () => {
                const action = id === '最小化按钮' ? 'minimize' : (id === '最大化按钮' ? 'maximize' : 'close');
                console.log('windowControl:', action);
                sendToCpp({ cmd: 'windowControl', action });
            });
        });

        // ==================== 顶栏拖拽移动窗口（同原版：JS 发 move 消息；app-region 兜底） ====================
        const 标题栏 = document.getElementById('标题栏');
        if (标题栏) {
            标题栏.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return; // 左键
                if (e.target.closest('button')) return; // 按钮不触发拖拽
                sendToCpp({ cmd: 'windowControl', action: 'move' });
                e.preventDefault();
            });
            标题栏.addEventListener('dblclick', (e) => {
                if (e.target.closest('button')) return;
                sendToCpp({ cmd: 'windowControl', action: 'maximize' }); // C++ maximize 自带切换
                e.preventDefault();
            });
        }

        // 启动时应用背景（单层）
        refreshBg();

        // 初始化渲染
        renderGameList();
        renderTabs();

        // 窗口尺寸变化时重新计算游戏图标显示数量上限
        window.addEventListener('resize', applyGameListMaxHeight);
    