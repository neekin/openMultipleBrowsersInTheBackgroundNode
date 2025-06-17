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

// 设置全局数据库引用，供WebSocket管理器使用
global.db = db;

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS browsers (
    id TEXT PRIMARY KEY,
    userAgent TEXT,
    viewport TEXT,
    wsEndpoint TEXT,
    createdAt TEXT,
    userDataDir TEXT,
    url TEXT,
    lastActiveTime TEXT,
    online INTEGER DEFAULT 1
  )`);
  
  // 为现有记录添加lastActiveTime字段（如果不存在）
  db.run(`ALTER TABLE browsers ADD COLUMN lastActiveTime TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('添加lastActiveTime字段失败:', err.message);
    }
  });
  
  // 为现有记录添加online字段（如果不存在）
  db.run(`ALTER TABLE browsers ADD COLUMN online INTEGER DEFAULT 1`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('添加online字段失败:', err.message);
    } else {
      console.log('数据库表结构已更新，包含online字段');
    }
  });
});

// 恢复历史实例
(async () => {
  await restoreAllBrowsers(db, browsers);
})();

// 启动自动维护管理器
const AutoMaintenanceManager = require('./autoMaintenanceManager');
const autoMaintenance = new AutoMaintenanceManager(browsers, db);

// 启动实例自动关闭管理器
const InstanceAutoCloseManager = require('./instanceAutoCloseManager');
const autoCloseManager = new InstanceAutoCloseManager(browsers, db);

// 将管理器设为全局可访问
global.autoMaintenance = autoMaintenance;
global.autoCloseManager = autoCloseManager;

// 挂载 /browsers 路由
const browsersRouter = require('./routes/browsers')(browsers, db);
app.use('/api/browsers', browsersRouter);

// WebSocket 操作接口
const server = http.createServer(app);
setupWebSocket(server, browsers);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

app.get('/performance', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'performance.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'advanced-dashboard.html'));
});

// 向后兼容的路由
app.use('/browsers', browsersRouter);

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
