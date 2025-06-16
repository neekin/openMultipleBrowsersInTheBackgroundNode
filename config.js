// 项目配置文件
const path = require('path');

const config = {
  // 服务器配置
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || 'localhost'
  },
  
  // 数据库配置
  database: {
    path: path.join(__dirname, 'browsers.db')
  },
  
  // 浏览器配置
  browser: {
    userDataDir: path.join(__dirname, 'user_data'),
    defaultUrl: 'https://www.example.com',
    screenshotOptions: {
      type: 'jpeg',
      quality: 30, // 降低质量以提高速度
      optimizeForSpeed: true
    },
    launchOptions: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    }
  },
  
  // WebSocket 配置
  websocket: {
    screenshotInterval: 500, // 截图间隔（毫秒）- 降低频率
    adaptiveInterval: true, // 自适应截图间隔
    minInterval: 200, // 最小间隔
    maxInterval: 2000, // 最大间隔
    path: '/browsers/ws/operate',
    batchOperations: true, // 批量操作
    batchTimeout: 50, // 批量操作超时（毫秒）
    enableCompression: true, // 启用压缩
    deltaScreenshot: true // 增量截图
  },
  
  // 指纹配置
  fingerprint: {
    chromeVersionRange: { min: 70, max: 100 },
    buildRange: { min: 1000, max: 5000 },
    viewportRange: {
      width: { min: 800, max: 1200 },
      height: { min: 600, max: 800 }
    }
  }
};

module.exports = config;
