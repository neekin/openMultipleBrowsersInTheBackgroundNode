// 配置文件
module.exports = {
  // 数据库配置
  database: {
    path: './browsers.db'
  },
  
  // 服务器配置
  server: {
    port: 3000,
    host: '0.0.0.0'
  },
  
  // 浏览器配置
  browser: {
    userDataDir: './user_data',
    defaultUrl: 'https://www.example.com',
    screenshotOptions: {
      type: 'jpeg',
      quality: 30,
      clip: { x: 0, y: 0, width: 800, height: 600 }
    },
    launchOptions: {
      headless: true,
      protocolTimeout: 30000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-web-security',
        '--window-size=800,600',
        '--max-old-space-size=512',
        '--disable-extensions',
        '--disable-plugins',
        '--no-first-run'
      ]
    }
  },
  
  // 抖音专用配置
  douyin: {
    enabled: true,
    domain: 'www.douyin.com',
    desktopUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    viewport: {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1
    },
    optimization: {
      disableVideo: true,
      enableJS: true,
      enableImages: true,
      enableCookies: true,
      keepAliveInterval: 60000,
      loginCheckInterval: 30000,
      maxMemoryPerInstance: 200
    },
    launchOptions: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--window-size=1366,768',
        '--max-old-space-size=200',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-plugins'
      ]
    }
  },

  // WebSocket 配置
  websocket: {
    screenshotInterval: 3000,
    adaptiveInterval: true,
    minInterval: 2000,
    maxInterval: 10000,
    path: '/browsers/ws/operate',
    batchOperations: true,
    batchTimeout: 200,
    enableCompression: true,
    deltaScreenshot: true,
    maxScreenshotCache: 2,
    enableMemoryOptimization: true,
    lowMemoryMode: true,
    screenshotOnDemand: true
  },
  
  // 指纹配置
  fingerprint: {
    chromeVersionRange: {
      min: 91,
      max: 120
    },
    buildRange: {
      min: 4000,
      max: 5000
    },
    viewportRange: {
      width: {
        min: 1280,
        max: 1920
      },
      height: {
        min: 720,
        max: 1080
      }
    },
    userAgents: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    ],
    viewports: [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 }
    ]
  },
  
  // 内存管理配置
  memory: {
    maxInstances: 10,
    lowMemoryThreshold: 80,
    emergencyThreshold: 90,
    checkInterval: 30000,
    screenshotMemoryLimit: 50 * 1024 * 1024,
    instanceMemoryLimit: 100 * 1024 * 1024
  }
};
