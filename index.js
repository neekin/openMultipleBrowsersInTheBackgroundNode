const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const config = require('./config');
const { restoreAllBrowsers, memoryManager } = require('./browserManager');
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
  console.log(`🚀 超低内存浏览器管理服务器启动成功`);
  console.log(`📊 服务端口: ${PORT}`);
  console.log(`🧠 内存优化: 超低内存模式已启用`);
  console.log(`📈 最大活跃实例数: ${memoryManager.maxActiveInstances}`);
  console.log(`� 最大总实例数: ${memoryManager.maxTotalInstances}`);
  console.log(`�💻 系统内存: ${memoryManager.getSystemMemoryInfo().total.toFixed(1)}GB`);
  console.log(`🔋 内存压力监控: 已启用`);
  console.log(`😴 实例休眠机制: 已启用`);
  console.log(`\n访问地址:`);
  console.log(`  - 主控制面板: http://localhost:${PORT}`);
  console.log(`  - 高级仪表板: http://localhost:${PORT}/dashboard`);
  console.log(`  - 性能监控: http://localhost:${PORT}/performance`);
  console.log(`\n内存优化特性:`);
  console.log(`  - 极低内存模式: 每实例仅需~30MB`);
  console.log(`  - 智能休眠: 自动休眠空闲实例`);
  console.log(`  - 内存压力感知: 根据系统负载自动调整`);
  console.log(`  - 紧急内存释放: 内存不足时自动清理`);
});

// 优雅关闭处理
async function gracefulShutdown() {
  console.log('正在关闭超低内存管理器...');
  
  try {
    // 使用超低内存管理器关闭所有实例
    if (typeof memoryManager.shutdown === 'function') {
      await memoryManager.shutdown();
    } else {
      await memoryManager.closeAllInstances();
    }
    console.log('所有浏览器实例已关闭');
  } catch (error) {
    console.error('关闭浏览器实例时出错:', error.message);
  }
  
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
