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
    let url = req.body?.url || 'https://www.example.com';
    if (!/^https?:\/\//.test(url)) url = 'https://' + url;
    await page.goto(url);
    browsers[id] = { browser, page, fingerprint, wsEndpoint: browser.wsEndpoint(), createdAt: new Date().toISOString(), userDataDir };
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
  // 定时截图推送
  let closed = false;
  async function sendScreenshot() {
    if (closed) return;
    try {
      const buf = await inst.page.screenshot({ type: 'jpeg', quality: 60 });
      ws.send(buf);
      // 推送鼠标坐标
      if (inst.lastCursor) {
        ws.send(JSON.stringify({ cursor: inst.lastCursor }));
      }
    } catch (e) {
      ws.send(JSON.stringify({ error: e.message }));
    }
    setTimeout(sendScreenshot, 250); // 250ms 一帧
  }
  sendScreenshot();
  ws.on('message', async msg => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'click') {
        const { x, y } = data.payload;
        await inst.page.mouse.click(x, y);
      }
      if (data.type === 'mousemove') {
        const { x, y } = data.payload;
        await inst.page.mouse.move(x, y);
        // 记录最新指针位置
        inst.lastCursor = { x, y };
      }
      if (data.type === 'keydown') {
        await inst.page.keyboard.down(data.payload.key);
      }
      if (data.type === 'keyup') {
        await inst.page.keyboard.up(data.payload.key);
      }
      if (data.type === 'wheel') {
        await inst.page.mouse.wheel({ deltaX: data.payload.deltaX, deltaY: data.payload.deltaY });
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
        browsers[row.id] = {
          browser,
          page,
          fingerprint: { userAgent: row.userAgent, viewport: JSON.parse(row.viewport) },
          wsEndpoint: browser.wsEndpoint(),
          createdAt: row.createdAt,
          userDataDir: row.userDataDir
        };
      } catch {}
    }
  });
})();

// 启动服务
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Express + Puppeteer API running on port ${PORT}`);
  console.log(`静态页面: http://localhost:${PORT}/static/index.html`);
});
