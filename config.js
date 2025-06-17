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
        // 基础安全参数
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
        
        // 内存优化参数（保留JS/CSS/图片功能）
        '--memory-pressure-off',
        '--max_old_space_size=1024',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        
        // 禁用不必要的功能（保留核心功能）
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-component-update',
        '--disable-sync',
        '--disable-speech-api',
        '--disable-desktop-notifications',
        
        // 媒体优化 - 禁止视频自动播放但保留媒体功能
        '--autoplay-policy=document-user-activation-required',
        '--disable-background-media-suspend',
        
        // 渲染优化（适度优化，保留基本功能）
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--in-process-gpu',
        '--use-simple-cache-backend',
        
        // 垃圾回收优化
        '--js-flags="--max-old-space-size=512 --gc-interval=100"'
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
  },

  // 内存管理配置
  memory: {
    // 自动垃圾回收间隔（毫秒）
    gcInterval: 60000, // 增加到60秒
    // 内存使用阈值（MB），超过此值触发优化
    memoryThreshold: 1024, // 增加阈值
    // 页面内存限制（MB）
    pageMemoryLimit: 512, // 增加页面限制
    // 自动清理间隔（毫秒）
    cleanupInterval: 120000, // 增加到2分钟
    // 内存监控间隔（毫秒）
    monitorInterval: 30000, // 增加到30秒
    // 启用内存压缩
    enableMemoryCompression: true,
    // 启用自动标签页休眠
    enableTabSuspension: false, // 禁用标签页休眠
    // 标签页休眠阈值（秒）
    tabSuspensionThreshold: 600, // 增加到10分钟
    // 最大缓存大小（MB）
    maxCacheSize: 128, // 增加缓存大小
    // 启用智能预加载
    enableSmartPreload: true, // 启用预加载
    // 图片压缩质量（1-100）
    imageCompressionQuality: 85 // 提高图片质量
  },

  // 资源优化配置
  resourceOptimization: {
    // 启用资源缓存优化
    enableCacheOptimization: true,
    // 最大同时请求数
    maxConcurrentRequests: 6,
    // 请求超时时间（毫秒）
    requestTimeout: 30000,
    // 启用DNS缓存
    enableDnsCache: true,
    // DNS缓存TTL（秒）
    dnsCacheTtl: 300,
    // 启用HTTP2
    enableHttp2: true,
    // 启用Gzip压缩
    enableGzipCompression: true
  }
};

module.exports = config;
