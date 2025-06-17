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
    defaultUrl: 'data:text/html,<html><head><style>body{font-family:Arial;padding:20px;background:#f0f0f0;}button{padding:10px 20px;margin:10px;font-size:16px;cursor:pointer;background:#007bff;color:white;border:none;border-radius:4px;}button:hover{background:#0056b3;}#clickArea{width:200px;height:100px;background:#28a745;color:white;text-align:center;line-height:100px;margin:20px 0;cursor:pointer;border-radius:4px;}#log{background:white;border:1px solid #ccc;padding:10px;margin:20px 0;max-height:200px;overflow-y:auto;}</style></head><body><h1>浏览器实例测试页面</h1><p>页面加载成功，点击功能测试</p><button onclick="testClick(this)">点击测试按钮</button><div id="clickArea" onclick="areaClick(this)">点击这个区域</div><input type="text" placeholder="输入测试" style="padding:10px;margin:10px;"><br><a href="https://www.example.com">访问示例网站</a><div id="log"><strong>操作日志:</strong><br></div><script>let logCount=0;function log(msg){const logDiv=document.getElementById("log");logCount++;logDiv.innerHTML+=`${logCount}. ${new Date().toLocaleTimeString()}: ${msg}<br>`;logDiv.scrollTop=logDiv.scrollHeight;}function testClick(btn){log("按钮被点击了!");btn.style.background="#dc3545";setTimeout(()=>btn.style.background="#007bff",1000);alert("点击测试成功!");}function areaClick(area){log("绿色区域被点击了!");area.style.background="#ffc107";area.style.color="#000";setTimeout(()=>{area.style.background="#28a745";area.style.color="white";},1000);}document.addEventListener("click",function(e){log(`页面点击事件: x=${e.clientX}, y=${e.clientY}, 目标=${e.target.tagName}`)});document.addEventListener("DOMContentLoaded",function(){log("页面DOM加载完成");});log("页面脚本已加载");</script></body></html>',
    screenshotOptions: {
      type: 'jpeg',
      quality: 80, // 提高质量以确保准确性
      optimizeForSpeed: false, // 优先准确性而非速度
      fullPage: false, // 确保截图只包含视口区域
      clip: null, // 不裁剪，使用完整视口
      omitBackground: false, // 包含背景
      encoding: 'binary' // 确保正确的编码
    },
    launchOptions: {
      headless: process.env.DEBUG_MODE ? false : true, // 调试模式下使用有头模式
      args: [
        // 基础安全参数
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
        
        // 网络优化参数
        '--aggressive-cache-discard',
        '--disable-background-networking',
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
        
        // 渲染优化（保留交互功能）
        '--disable-gpu-sandbox', // 替换--disable-gpu，保留基本GPU功能
        '--use-simple-cache-backend',
        
        // 启用必要的交互功能
        '--enable-features=VizDisplayCompositor',
        '--disable-blink-features=AutomationControlled',
        
        // 内存优化
        '--memory-pressure-off',
        '--max_old_space_size=1024',
        '--js-flags="--max-old-space-size=512 --gc-interval=100"'
      ]
    }
  },
  
  // WebSocket 配置
  websocket: {
    screenshotInterval: 200, // 减少截图间隔以提高响应速度
    adaptiveInterval: true, // 自适应截图间隔
    minInterval: 100, // 最小间隔
    maxInterval: 1000, // 最大间隔
    path: '/browsers/ws/operate',
    batchOperations: true, // 批量操作
    batchTimeout: 10, // 大幅减少批量操作超时
    enableCompression: false, // 暂时禁用压缩以提高速度
    deltaScreenshot: false // 暂时禁用增量截图以提高响应
  },
  
  // 指纹配置
  fingerprint: {
    chromeVersionRange: { min: 70, max: 100 },
    buildRange: { min: 1000, max: 5000 },
    viewportRange: {
      width: { min: 800, max: 800 }, // 固定宽度以避免坐标问题
      height: { min: 600, max: 600 } // 固定高度以避免坐标问题
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
    requestTimeout: 60000, // 增加到60秒
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
