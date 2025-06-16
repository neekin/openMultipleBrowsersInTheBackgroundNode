// 项目配置文件
const path = require('path');

const config = {
  // 开发模式 - 跳过严格的内存检查
  development: {
    skipMemoryCheck: process.env.NODE_ENV !== 'production'
  },
  
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
      quality: 10, // 更低质量，极致内存优化
      optimizeForSpeed: true,
      fromSurface: true, // 减少内存复制
      captureBeyondViewport: false, // 只截取可见区域
      clip: { x: 0, y: 0, width: 400, height: 300 } // 固定小尺寸截图
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
        '--disable-gpu',
        // 极致内存优化参数
        '--memory-pressure-off',
        '--max-old-space-size=128', // 进一步限制内存到128MB
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI,VizDisplayCompositor,VizHitTestSurfaceLayer',
        '--disable-ipc-flooding-protection',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-background-networking',
        '--disable-component-extensions-with-background-pages',
        '--disable-client-side-phishing-detection',
        '--disable-background-mode',
        '--single-process', // 单进程模式，大幅减少内存
        '--disable-extensions',
        '--disable-plugins',
        '--disable-images', // 默认不加载图片
        '--disable-javascript', // 默认禁用 JS（可根据需要启用）
        '--disable-web-security',
        '--aggressive-cache-discard',
        '--disable-renderer-accessibility',
        // 新增极致优化参数
        '--disable-logging',
        '--disable-gpu-sandbox',
        '--disable-software-rasterizer',
        '--disable-threaded-compositing',
        '--disable-checker-imaging',
        '--disable-new-content-rendering-timeout',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-priority-management',
        '--disable-features=AudioServiceOutOfProcess,VizServiceDisplayCompositor',
        '--renderer-process-limit=1',
        '--max-gum-fps=5', // 限制媒体帧率
        '--force-color-profile=srgb',
        '--disable-domain-reliability',
        '--disable-features=MediaRouter',
        '--disable-print-preview',
        '--disable-background-media-suspend=false'
      ]
    }
  },
  
  // 抖音专用配置
  douyin: {
    enabled: true,
    domain: 'www.douyin.com',
    mobileUserAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    viewport: {
      width: 375,
      height: 812,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true
    },
    optimization: {
      disableVideo: true,
      enableJS: true,
      enableImages: true,
      enableCookies: true,
      keepAliveInterval: 60000, // 1分钟
      loginCheckInterval: 30000, // 30秒
      maxMemoryPerInstance: 200 // 200MB
    },
    launchOptions: {
      headless: false, // 抖音可能需要非headless
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--window-size=375,812',
        '--max-old-space-size=200',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--autoplay-policy=user-gesture-required',
        '--disable-media-session-api',
        '--aggressive-cache-discard=false'
      ]
    }
  },

  // WebSocket 配置
  websocket: {
    screenshotInterval: 2000, // 进一步增加截图间隔
    adaptiveInterval: true, // 自适应截图间隔
    minInterval: 1000, // 提高最小间隔
    maxInterval: 10000, // 大幅增加最大间隔
    path: '/browsers/ws/operate',
    batchOperations: true, // 批量操作
    batchTimeout: 200, // 增加批量操作超时
    enableCompression: true, // 启用压缩
    deltaScreenshot: true, // 增量截图
    maxScreenshotCache: 2, // 进一步限制截图缓存
    enableMemoryOptimization: true, // 启用内存优化
    lowMemoryMode: true, // 低内存模式
    screenshotOnDemand: true // 按需截图，而不是定时截图
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
