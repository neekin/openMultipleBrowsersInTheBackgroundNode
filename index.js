const express = require('express');
const puppeteer = require('puppeteer');
const crypto = require('crypto');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

// Puppeteer 实例池
const browsers = {};

// SQLite 数据库
const db = new sqlite3.Database(path.join(__dirname, 'browsers.db'));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS browsers (
    id TEXT PRIMARY KEY,
    userAgent TEXT,
    viewport TEXT,
    wsEndpoint TEXT,
    createdAt TEXT,
    userDataDir TEXT,
    url TEXT
  )`);
});

// 随机生成浏览器指纹
function randomFingerprint() {
  return {
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${Math.floor(Math.random()*30+70)}.0.${Math.floor(Math.random()*4000+1000)}.100 Safari/537.36`,
    viewport: {
      width: Math.floor(Math.random()*400+800),
      height: Math.floor(Math.random()*200+600),
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      isLandscape: true
    }
  };
}

// 创建 Puppeteer 实例
app.post('/browsers/create', async (req, res) => {
  try {
    const id = crypto.randomUUID();
    const fingerprint = randomFingerprint();
    const userDataDir = path.join(__dirname, 'user_data', id);
    const browser = await puppeteer.launch({
      headless: true,
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--window-size=${fingerprint.viewport.width},${fingerprint.viewport.height}`
      ]
    });
    const page = await browser.newPage();
    await page.setUserAgent(fingerprint.userAgent);
    await page.setViewport(fingerprint.viewport);

    // 支持多标签页：维护 pages 数组，监听新标签页
    const pages = [page];
    browser.on('targetcreated', async target => {
      if (target.type() === 'page') {
        const newPage = await target.page();
        pages.push(newPage);
        // 新增：新标签页创建后主动通知前端刷新标签栏
        if (browsers[id] && browsers[id].wsList) {
          for (const ws of browsers[id].wsList) {
            try { ws.send(JSON.stringify({ type: 'tabUpdate' })); } catch {}
          }
        }
      }
    });

    let url = req.body?.url || 'https://www.example.com';
    if (!/^https?:\/\//.test(url)) url = 'https://' + url;
    await page.goto(url);
    browsers[id] = { browser, pages, activePageIdx: 0, fingerprint, wsEndpoint: browser.wsEndpoint(), createdAt: new Date().toISOString(), userDataDir };
    // 记录到sqlite
    db.run(
      `INSERT OR REPLACE INTO browsers (id, userAgent, viewport, wsEndpoint, createdAt, userDataDir, url) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, fingerprint.userAgent, JSON.stringify(fingerprint.viewport), browser.wsEndpoint(), new Date().toISOString(), userDataDir, url]
    );
    res.json({ id, wsEndpoint: browser.wsEndpoint(), fingerprint });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取实例列表
app.get('/browsers', (req, res) => {
  const list = Object.entries(browsers).map(([id, b]) => ({
    id,
    wsEndpoint: b.wsEndpoint,
    userAgent: b.fingerprint?.userAgent,
    createdAt: b.createdAt || ''
  }));
  res.json(list);
});

// 通过 wsEndpoint 连接远程浏览器
app.post('/browser/connect', async (req, res) => {
  const { wsEndpoint } = req.body;
  if (!wsEndpoint) return res.status(400).json({ error: 'wsEndpoint required' });
  try {
    const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
    const id = crypto.randomUUID();
    browsers[id] = { browser, wsEndpoint };
    res.json({ id, wsEndpoint });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取指定实例的所有标签页信息
app.get('/browsers/:id/pages', async (req, res) => {
  const inst = browsers[req.params.id];
  if (!inst) return res.status(404).json({ error: 'not found' });
  const infos = await Promise.all(inst.pages.map(async (p, idx) => {
    let title = '';
    try { title = await p.title(); } catch {}
    let url = '';
    try { url = p.url(); } catch {}
    return { idx, title, url };
  }));
  res.json(infos);
});

// WebSocket 操作接口（需配合 ws 库实现）
const http = require('http');
const server = http.createServer(app);
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server }); // 不加 path，允许所有路径

wss.on('connection', (ws, req) => {
  const url = req.url;
  const match = url.match(/\/browsers\/ws\/operate\/(.+)$/);
  if (!match) return ws.close();
  const id = match[1];
  const inst = browsers[id];
  if (!inst) return ws.close();
  let activeIdx = inst.activePageIdx || 0;
  function getActivePage() {
    return inst.pages[activeIdx] || inst.pages[0];
  }
  // 定时截图推送
  let closed = false;
  async function sendScreenshot() {
    if (closed) return;
    try {
      const buf = await getActivePage().screenshot({ type: 'jpeg', quality: 60 });
      ws.send(buf);
      if (inst.lastCursor) {
        ws.send(JSON.stringify({ cursor: inst.lastCursor }));
      }
    } catch (e) {
      ws.send(JSON.stringify({ error: e.message }));
    }
    setTimeout(sendScreenshot, 250);
  }
  sendScreenshot();
  // 记录每个实例的所有 ws 连接，便于推送事件
  if (!inst.wsList) inst.wsList = [];
  inst.wsList.push(ws);
  ws.on('close', () => {
    closed = true;
    if (inst.wsList) inst.wsList = inst.wsList.filter(w => w !== ws);
  });
  ws.on('message', async msg => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'switchTab') {
        if (typeof data.idx === 'number' && inst.pages[data.idx]) {
          activeIdx = data.idx;
          inst.activePageIdx = data.idx;
        }
        return;
      }
      if (data.type === 'refreshTab') {
        if (typeof data.idx === 'number' && inst.pages[data.idx]) {
          try { await inst.pages[data.idx].reload({ waitUntil: 'networkidle2' }); } catch {}
          // 通知前端刷新标签信息
          for (const ws2 of inst.wsList || []) {
            try { ws2.send(JSON.stringify({ type: 'tabUpdate' })); } catch {}
          }
        }
        return;
      }
      if (data.type === 'closeTab') {
        if (typeof data.idx === 'number' && inst.pages[data.idx]) {
          try { await inst.pages[data.idx].close(); } catch {}
          inst.pages.splice(data.idx, 1);
          // 如果关闭的是当前活跃标签，切换到第一个
          if (activeIdx === data.idx) {
            activeIdx = 0;
            inst.activePageIdx = 0;
          } else if (activeIdx > data.idx) {
            activeIdx--;
            inst.activePageIdx = activeIdx;
          }
          for (const ws2 of inst.wsList || []) {
            try { ws2.send(JSON.stringify({ type: 'tabUpdate' })); } catch {}
          }
        }
        return;
      }
      if (data.type === 'getTabs') {
        // 主动获取标签页列表
        const infos = await Promise.all(inst.pages.map(async (p, idx) => {
          let title = '';
          try { title = await p.title(); } catch {}
          let url = '';
          try { url = p.url(); } catch {}
          return { idx, title, url };
        }));
        ws.send(JSON.stringify({ type: 'tabs', tabs: infos }));
        return;
      }
      const page = getActivePage();
      if (data.type === 'click') {
        const { x, y } = data.payload;
        await page.mouse.click(x, y);
      }
      if (data.type === 'mousemove') {
        const { x, y } = data.payload;
        await page.mouse.move(x, y);
        inst.lastCursor = { x, y };
      }
      if (data.type === 'keydown') {
        await page.keyboard.down(data.payload.key);
      }
      if (data.type === 'keyup') {
        await page.keyboard.up(data.payload.key);
      }
      if (data.type === 'wheel') {
        await page.mouse.wheel({ deltaX: data.payload.deltaX, deltaY: data.payload.deltaY });
      }
    } catch {}
  });
  ws.on('close', () => { closed = true; });
});

// 让根目录直接返回 index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

// 启动时自动恢复所有实例
(async () => {
  db.all('SELECT * FROM browsers', async (err, rows) => {
    if (err) return;
    for (const row of rows) {
      try {
        const browser = await puppeteer.launch({
          headless: true,
          userDataDir: row.userDataDir,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            `--window-size=${JSON.parse(row.viewport).width},${JSON.parse(row.viewport).height}`
          ]
        });
        const page = await browser.newPage();
        await page.setUserAgent(row.userAgent);
        await page.setViewport(JSON.parse(row.viewport));
        if (row.url) await page.goto(row.url);
        // 恢复多标签页结构
        const pages = [page];
        browser.on('targetcreated', async target => {
          if (target.type() === 'page') {
            const newPage = await target.page();
            pages.push(newPage);
            // 新增：新标签页创建后主动通知前端刷新标签栏
            if (browsers[row.id] && browsers[row.id].wsList) {
              for (const ws of browsers[row.id].wsList) {
                try { ws.send(JSON.stringify({ type: 'tabUpdate' })); } catch {}
              }
            }
          }
        });
        browsers[row.id] = {
          browser,
          pages,
          activePageIdx: 0,
          fingerprint: { userAgent: row.userAgent, viewport: JSON.parse(row.viewport) },
          wsEndpoint: browser.wsEndpoint(),
          createdAt: row.createdAt,
          userDataDir: row.userDataDir
        };
      } catch {}
    }
  });
})();

// 删除实例
app.delete('/browsers/:id', async (req, res) => {
  const id = req.params.id;
  const inst = browsers[id];
  if (!inst) return res.status(404).json({ error: 'not found' });
  try {
    // 关闭所有页面和浏览器
    if (inst.pages) {
      for (const p of inst.pages) {
        try { await p.close(); } catch (e) {}
      }
    }
    if (inst.browser) {
      try { await inst.browser.close(); } catch (e) {}
    }
    // 清理 ws 连接
    if (inst.wsList) {
      for (const ws of inst.wsList) {
        try { ws.close(); } catch (e) {}
      }
    }
    // 删除 userDataDir 目录（可选，防止残留）
    const fs = require('fs');
    const rimraf = (dir) => { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); };
    if (inst.userDataDir) rimraf(inst.userDataDir);
    // 从内存和数据库移除
    delete browsers[id];
    db.run('DELETE FROM browsers WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 处理未定义路由
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
