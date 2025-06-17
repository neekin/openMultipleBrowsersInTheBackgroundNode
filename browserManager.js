const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// 内存监控和优化类
class MemoryOptimizer {
  constructor() {
    this.memoryStats = new Map();
    this.gcTimer = null;
    this.monitorTimer = null;
    this.startMonitoring();
  }

  // 开始内存监控
  startMonitoring() {
    this.monitorTimer = setInterval(() => {
      this.checkMemoryUsage();
    }, config.memory.monitorInterval);

    this.gcTimer = setInterval(() => {
      this.performGarbageCollection();
    }, config.memory.gcInterval);
  }

  // 检查内存使用情况
  async checkMemoryUsage() {
    const used = process.memoryUsage();
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    
    if (heapUsedMB > config.memory.memoryThreshold) {
      console.log(`内存使用过高: ${heapUsedMB}MB，开始优化...`);
      await this.optimizeMemory();
    }
  }

  // 执行垃圾回收
  performGarbageCollection() {
    if (global.gc) {
      global.gc();
      console.log('执行手动垃圾回收');
    }
  }

  // 内存优化
  async optimizeMemory() {
    // 执行垃圾回收
    this.performGarbageCollection();
    
    // 清理过期的内存统计数据
    const now = Date.now();
    for (const [instanceId, stats] of this.memoryStats) {
      if (stats.lastActivity < now - 300000) { // 5分钟无活动
        console.log(`清理过期实例统计: ${instanceId}`);
        this.memoryStats.delete(instanceId);
      }
    }
  }

  // 清理实例统计
  cleanup(instanceId) {
    this.memoryStats.delete(instanceId);
    console.log(`清理实例内存统计: ${instanceId}`);
  }

  // 记录内存统计
  recordMemoryStats(instanceId, stats) {
    this.memoryStats.set(instanceId, {
      ...stats,
      lastActivity: Date.now()
    });
  }

  // 停止监控
  stop() {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }
}

// 创建内存优化器实例
const memoryOptimizer = new MemoryOptimizer();

// 自动检测 chromium 路径
function detectChromiumPath() {
  const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const chromiumPath = detectChromiumPath();

function randomFingerprint() {
  const { chromeVersionRange, buildRange, viewportRange } = config.fingerprint;
  return {
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${Math.floor(Math.random() * (chromeVersionRange.max - chromeVersionRange.min) + chromeVersionRange.min)}.0.${Math.floor(Math.random() * (buildRange.max - buildRange.min) + buildRange.min)}.100 Safari/537.36`,
    viewport: {
      width: Math.floor(Math.random() * (viewportRange.width.max - viewportRange.width.min) + viewportRange.width.min),
      height: Math.floor(Math.random() * (viewportRange.height.max - viewportRange.height.min) + viewportRange.height.min),
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      isLandscape: true
    }
  };
}

async function launchBrowser({ userDataDir, fingerprint, url }) {
  const launchOptions = {
    ...config.browser.launchOptions,
    userDataDir,
    args: [
      ...config.browser.launchOptions.args,
      `--window-size=${fingerprint.viewport.width},${fingerprint.viewport.height}`,
      `--disk-cache-size=${config.memory.maxCacheSize * 1024 * 1024}`,
      `--media-cache-size=${config.memory.maxCacheSize * 1024 * 512}`
    ]
  };
  if (chromiumPath) launchOptions.executablePath = chromiumPath;
  
  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  
  // 设置内存优化
  await optimizePageMemory(page);
  
  await page.setUserAgent(fingerprint.userAgent);
  await page.setViewport(fingerprint.viewport);
  
  if (url) await page.goto(url, { 
    waitUntil: 'domcontentloaded', // 优化加载策略
    timeout: config.resourceOptimization.requestTimeout 
  });
  
  return { browser, page };
}

// 页面内存优化函数
async function optimizePageMemory(page) {
  // 设置缓存策略
  await page.setCacheEnabled(config.resourceOptimization.enableCacheOptimization);
  
  // 设置请求拦截器进行适度的资源优化
  await page.setRequestInterception(true);
  
  page.on('request', (request) => {
    const resourceType = request.resourceType();
    const url = request.url();
    
    // 只阻止明显的广告和跟踪脚本
    if (url.includes('googletagmanager') || 
        url.includes('google-analytics') || 
        url.includes('doubleclick') ||
        url.includes('facebook.com/tr')) {
      request.abort();
      return;
    }
    
    // 继续处理所有其他请求（保留JS、CSS、图片）
    request.continue();
  });
  
  // 页面加载完成后的优化
  page.on('load', async () => {
    try {
      await page.evaluate((config) => {
        // 禁止视频自动播放
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
          video.autoplay = false;
          video.muted = true; // 即使播放也静音
          video.pause();
          
          // 移除自动播放属性
          video.removeAttribute('autoplay');
          
          // 添加点击播放事件
          video.addEventListener('loadstart', function() {
            this.pause();
          });
        });
        
        // 禁止音频自动播放
        const audios = document.querySelectorAll('audio');
        audios.forEach(audio => {
          audio.autoplay = false;
          audio.muted = true;
          audio.pause();
          audio.removeAttribute('autoplay');
        });
        
        // 图片懒加载优化（保留图片功能）
        const images = document.querySelectorAll('img');
        images.forEach(img => {
          if (!img.loading) {
            img.loading = 'lazy';
          }
        });
        
        // 适度的内存清理
        const cleanup = () => {
          // 只清理明显的内存泄漏
          if (window.performance && window.performance.memory) {
            const memInfo = window.performance.memory;
            if (memInfo.usedJSHeapSize > config.memory.pageMemoryLimit * 1024 * 1024) {
              console.log('页面内存使用过高，执行清理');
              window.gc && window.gc();
            }
          }
        };
        
        // 定期清理（间隔较长）
        setInterval(cleanup, config.memory.cleanupInterval);
        
        // 页面可见性变化时暂停媒体
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            // 只暂停媒体播放，不影响其他功能
            const videos = document.querySelectorAll('video');
            videos.forEach(video => video.pause());
            
            const audios = document.querySelectorAll('audio');
            audios.forEach(audio => audio.pause());
          }
        });
        
      }, config);
    } catch (error) {
      console.log('页面优化脚本执行失败:', error.message);
    }
  });
  
  // 设置页面超时
  page.setDefaultTimeout(config.resourceOptimization.requestTimeout);
  page.setDefaultNavigationTimeout(config.resourceOptimization.requestTimeout);
}

async function restoreBrowser(row) {
  const launchOptions = {
    ...config.browser.launchOptions,
    userDataDir: row.userDataDir,
    args: [
      ...config.browser.launchOptions.args,
      `--window-size=${JSON.parse(row.viewport).width},${JSON.parse(row.viewport).height}`,
      `--disk-cache-size=${config.memory.maxCacheSize * 1024 * 1024}`,
      `--media-cache-size=${config.memory.maxCacheSize * 1024 * 512}`
    ]
  };
  if (chromiumPath) launchOptions.executablePath = chromiumPath;
  
  const browser = await puppeteer.launch(launchOptions);
  const pages = await browser.pages();
  
  for (const p of pages) {
    // 应用内存优化
    await optimizePageMemory(p);
    
    await p.setUserAgent(row.userAgent);
    await p.setViewport(JSON.parse(row.viewport));
    if (row.url) {
      try { 
        await p.goto(row.url, { 
          waitUntil: 'domcontentloaded',
          timeout: config.resourceOptimization.requestTimeout 
        }); 
      } catch {}
    }
  }
  return { browser, pages };
}

async function restoreAllBrowsers(db, browsers) {
  return new Promise((resolve) => {
    db.all('SELECT * FROM browsers', async (err, rows) => {
      if (err) {
        console.error('恢复浏览器实例时数据库查询失败:', err.message);
        return resolve();
      }
      
      console.log(`发现 ${rows.length} 个历史实例，正在尝试恢复...`);
      
      const restorePromises = rows.map(async (row) => {
        try {
          const { browser, pages } = await restoreBrowser(row);
          browser.on('targetcreated', async target => {
            if (target.type() === 'page') {
              const newPage = await target.page();
              pages.push(newPage);
              if (browsers[row.id] && browsers[row.id].wsList) {
                for (const ws of browsers[row.id].wsList) {
                  try { ws.send(JSON.stringify({ type: 'tabUpdate' })); } catch {}
                }
              }
            }
          });
          browsers[row.id] = {
            browser,
            pages,
            activePageIdx: 0,
            fingerprint: { userAgent: row.userAgent, viewport: JSON.parse(row.viewport) },
            wsEndpoint: browser.wsEndpoint(),
            createdAt: row.createdAt,
            userDataDir: row.userDataDir
          };
          console.log(`已恢复实例: ${row.id}`);
        } catch (error) {
          console.error(`恢复实例 ${row.id} 失败:`, error.message);
        }
      });
      
      await Promise.all(restorePromises);
      console.log('浏览器实例恢复完成');
      resolve();
    });
  });
}

module.exports = {
  randomFingerprint,
  launchBrowser,
  restoreBrowser,
  restoreAllBrowsers,
  detectChromiumPath,
  chromiumPath,
  memoryOptimizer,
  optimizePageMemory
};
