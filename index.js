const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const config = require('./config');
const { restoreAllBrowsers, memoryOptimizer } = require('./browserManager');
const setupWebSocket = require('./wsManager');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

// Puppeteer 实例池
const browsers = {};

// 将browsers对象设为全局，供内存优化器使用
global.browsers = browsers;

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

// 内存监控API
app.get('/api/memory/stats', (req, res) => {
  const processMemory = process.memoryUsage();
  const memoryStats = {
    process: {
      heapUsed: Math.round(processMemory.heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(processMemory.heapTotal / 1024 / 1024) + ' MB',
      external: Math.round(processMemory.external / 1024 / 1024) + ' MB',
      rss: Math.round(processMemory.rss / 1024 / 1024) + ' MB'
    },
    instances: {}
  };
  
  // 获取各实例的内存统计
  Object.keys(browsers).forEach(instanceId => {
    if (memoryOptimizer.memoryStats.has(instanceId)) {
      memoryStats.instances[instanceId] = memoryOptimizer.memoryStats.get(instanceId);
    }
  });
  
  res.json(memoryStats);
});

// 内存优化API
app.post('/api/memory/optimize/:instanceId', async (req, res) => {
  const { instanceId } = req.params;
  
  if (!browsers[instanceId]) {
    return res.status(404).json({ error: 'Instance not found' });
  }
  
  try {
    await memoryOptimizer.optimizeMemory();
    res.json({ success: true, message: '内存优化完成' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 全局内存优化API
app.post('/api/memory/optimize', async (req, res) => {
  try {
    await memoryOptimizer.optimizeMemory();
    memoryOptimizer.performGarbageCollection();
    res.json({ success: true, message: '全局内存优化完成' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
  
  // 停止内存监控
  memoryOptimizer.stop();
  
  const closePromises = Object.values(browsers).map(async (instance) => {
    if (instance.browser) {
      try {
        // 清理内存优化器中的实例数据
        memoryOptimizer.cleanup(instance.id);
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
