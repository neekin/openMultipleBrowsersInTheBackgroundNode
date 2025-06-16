const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const config = require('./config');
const { restoreAllBrowsers } = require('./browserManager');
const setupWebSocket = require('./wsManager');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

// Puppeteer 实例池
const browsers = {};

// SQLite 数据库
const db = new sqlite3.Database(config.database.path);
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

// 恢复历史实例
(async () => {
  await restoreAllBrowsers(db, browsers);
})();

// 挂载 /browsers 路由
const browsersRouter = require('./routes/browsers')(browsers, db);
app.use('/browsers', browsersRouter);

// WebSocket 操作接口
const server = http.createServer(app);
setupWebSocket(server, browsers);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = config.server.port;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`访问 http://localhost:${PORT} 开始使用`);
});

// 优雅关闭处理
async function gracefulShutdown() {
  console.log('正在关闭所有浏览器实例...');
  const closePromises = Object.values(browsers).map(async (instance) => {
    if (instance.browser) {
      try {
        await instance.browser.close();
        console.log('浏览器实例已关闭');
      } catch (error) {
        console.error('关闭浏览器实例时出错:', error.message);
      }
    }
  });
  
  await Promise.all(closePromises);
  console.log('所有浏览器实例已关闭');
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
