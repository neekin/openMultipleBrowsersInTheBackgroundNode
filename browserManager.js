const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const MemoryOptimizedBrowserManager = require('./memoryOptimizedBrowserManager');
const UltraLowMemoryManager = require('./ultraLowMemoryManager');
const DouyinOptimizedManager = require('./douyinOptimizedManager');

// 初始化内存管理器 - 根据用途选择
const ultraMemoryManager = new UltraLowMemoryManager();
const fallbackManager = new MemoryOptimizedBrowserManager();
const douyinManager = new DouyinOptimizedManager(); // 抖音专用管理器

// 自动检测 chromium 路径 - 针对 ARM64 优化
function detectChromiumPath() {
  const candidates = [
    '/usr/bin/chromium',           // 标准路径
    '/usr/bin/chromium-browser',   // 备选路径
    '/snap/bin/chromium',          // Snap 路径
    '/opt/google/chrome/chrome',   // Google Chrome
    '/usr/bin/google-chrome',      // 备选 Chrome 路径
  ];
  
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log(`检测到浏览器: ${p}`);
      return p;
    }
  }
  
  console.warn('未检测到系统浏览器，将使用 Puppeteer 内置 Chrome');
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
  // 检测是否是抖音页面
  const isDouyinPage = url && url.includes('douyin.com');
  
  if (isDouyinPage) {
    // 使用抖音专用管理器
    console.log('🎵 检测到抖音页面，使用抖音专用优化');
    const canCreate = douyinManager.canCreateNewInstance();
    if (!canCreate.allowed) {
      throw new Error(canCreate.reason);
    }

    try {
      const { browser, instanceId } = await douyinManager.createDouyinOptimizedBrowser({
        userDataDir,
        instanceId: require('crypto').randomUUID()
      });

      const page = await douyinManager.createDouyinOptimizedPage(browser);

      // 导航到抖音并处理登录
      const navResult = await douyinManager.navigateToDouyinWithLogin(page, { url });
      
      // 启动登录保活
      await douyinManager.keepLoginActive(page);

      return { 
        browser, 
        page, 
        instanceId,
        isDouyinOptimized: true,
        loginStatus: navResult.loginStatus
      };
    } catch (error) {
      console.error('抖音优化模式创建失败:', error.message);
      throw error;
    }
  }

  // 非抖音页面使用原有的超低内存优化
  const canCreate = ultraMemoryManager.canCreateNewInstance();
  if (!canCreate.allowed) {
    const fallbackCanCreate = fallbackManager.canCreateNewInstance();
    if (!fallbackCanCreate.allowed) {
      throw new Error(canCreate.reason);
    }
  }

  try {
    // 优先使用超低内存管理器创建浏览器
    const { browser, instanceId } = await ultraMemoryManager.createUltraLowMemoryBrowser({
      userDataDir,
      instanceId: require('crypto').randomUUID()
    });

    // 创建超优化的页面
    const page = await ultraMemoryManager.createUltraOptimizedPage(browser, {
      enableJS: false, // 默认禁用JS以极致节省内存
      enableCSS: false, // 禁用CSS
      width: Math.min(fingerprint.viewport.width, 400),
      height: Math.min(fingerprint.viewport.height, 300)
    });

    // 设置用户代理和视口
    await page.setUserAgent(fingerprint.userAgent);
    await page.setViewport({
      ...fingerprint.viewport,
      width: Math.min(fingerprint.viewport.width, 400),
      height: Math.min(fingerprint.viewport.height, 300)
    });

    // 导航到URL（如果提供）
    if (url) {
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded', // 只等待DOM加载
          timeout: 5000 // 更短的超时时间
        });
      } catch (navError) {
        console.warn('页面导航失败，但继续创建实例:', navError.message);
      }
    }

    return { browser, page, instanceId };
  } catch (error) {
    console.error('超低内存模式创建失败，尝试标准模式:', error.message);
    
    // 回退到标准内存优化模式
    try {
      const { browser, instanceId } = await fallbackManager.createOptimizedBrowser({
        userDataDir,
        instanceId: require('crypto').randomUUID()
      });

      const page = await fallbackManager.createOptimizedPage(browser, {
        enableImages: false,
        width: fingerprint.viewport.width,
        height: fingerprint.viewport.height
      });

      await page.setUserAgent(fingerprint.userAgent);
      await page.setViewport(fingerprint.viewport);

      if (url) {
        try {
          await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 10000 
          });
        } catch (navError) {
          console.warn('页面导航失败:', navError.message);
        }
      }

      return { browser, page, instanceId };
    } catch (fallbackError) {
      console.error('创建浏览器实例失败:', fallbackError);
      throw fallbackError;
    }
  }
}

async function restoreBrowser(row) {
  // 检测是否是抖音实例
  const isDouyinInstance = row.url && row.url.includes('douyin.com');
  
  if (isDouyinInstance) {
    console.log(`🎵 恢复抖音优化实例: ${row.id}`);
    
    // 检查抖音管理器是否可以创建新实例
    const canCreate = douyinManager.canCreateNewInstance();
    if (!canCreate.allowed) {
      throw new Error(`抖音实例恢复失败: ${canCreate.reason}`);
    }

    try {
      const { browser, instanceId } = await douyinManager.createDouyinOptimizedBrowser({
        userDataDir: row.userDataDir,
        instanceId: row.id
      });

      // 获取或创建页面
      const pages = await browser.pages();
      let page;
      
      if (pages.length === 0) {
        page = await douyinManager.createDouyinOptimizedPage(browser);
      } else {
        page = pages[0];
        // 重新应用抖音优化
        await douyinManager.optimizePageForDouyin(page);
      }

      // 恢复用户代理和视口
      const viewport = JSON.parse(row.viewport);
      await page.setUserAgent(row.userAgent);
      await page.setViewport(viewport);

      // 导航到存储的抖音URL
      if (row.url && row.url !== 'about:blank') {
        try {
          console.log(`恢复抖音实例 ${row.id} 时导航到: ${row.url}`);
          const navResult = await douyinManager.navigateToDouyinWithLogin(page, { url: row.url });
          
          // 启动登录保活
          await douyinManager.keepLoginActive(page);
          
          console.log(`抖音实例 ${row.id} 恢复成功，登录状态: ${navResult.loginStatus}`);
        } catch (e) {
          console.warn(`抖音实例 ${row.id} 导航失败:`, e.message);
        }
      }

      return { 
        browser, 
        pages: [page], 
        instanceId,
        isDouyinOptimized: true
      };
    } catch (error) {
      console.error(`恢复抖音实例 ${row.id} 失败:`, error.message);
      throw error;
    }
  }

  // 非抖音实例使用原有逻辑
  const canCreate = ultraMemoryManager.canCreateNewInstance();
  if (!canCreate.allowed) {
    // 尝试唤醒休眠实例
    try {
      const result = await ultraMemoryManager.wakeupInstance(row.id);
      if (result) {
        ultraMemoryManager.updateInstanceUsage(row.id);
        return result;
      }
    } catch (wakeupError) {
      console.warn('唤醒休眠实例失败:', wakeupError.message);
    }
    
    throw new Error(canCreate.reason);
  }

  try {
    const viewport = JSON.parse(row.viewport);
    
    // 使用超低内存管理器创建浏览器
    const { browser, instanceId } = await ultraMemoryManager.createUltraLowMemoryBrowser({
      userDataDir: row.userDataDir,
      instanceId: row.id
    });

    // 获取所有页面
    const pages = await browser.pages();
    
    // 如果没有页面，创建一个新页面
    if (pages.length === 0) {
      const page = await ultraMemoryManager.createUltraOptimizedPage(browser, {
        enableImages: false,
        width: viewport.width,
        height: viewport.height
      });
      await page.setUserAgent(row.userAgent);
      await page.setViewport(viewport);
      
      // 导航到数据库中存储的URL
      if (row.url && row.url !== 'about:blank') {
        try {
          console.log(`恢复实例 ${row.id} 时导航到: ${row.url}`);
          await page.goto(row.url, { 
            waitUntil: 'domcontentloaded',
            timeout: 10000 
          });
        } catch (e) {
          console.warn('恢复页面导航失败:', e.message);
        }
      }
      pages.push(page);
    } else {
      // 优化现有页面并导航到存储的URL
      for (const page of pages) {
        await ultraMemoryManager.ultraOptimizePageMemory(page, {
          width: viewport.width,
          height: viewport.height,
          enableJS: false,
          enableCSS: false
        });
        await page.setUserAgent(row.userAgent);
        await page.setViewport(viewport);
        
        // 如果页面当前是about:blank或空白页，导航到存储的URL
        if (row.url && row.url !== 'about:blank') {
          try {
            const currentUrl = page.url();
            if (!currentUrl || currentUrl === 'about:blank' || currentUrl === '') {
              console.log(`恢复实例 ${row.id} 时导航到: ${row.url}`);
              await page.goto(row.url, { 
                waitUntil: 'domcontentloaded',
                timeout: 10000 
              });
            } else {
              console.log(`实例 ${row.id} 页面已有内容 (${currentUrl})，跳过导航`);
            }
          } catch (e) {
            console.warn(`实例 ${row.id} 导航失败:`, e.message);
          }
        }
      }
    }

    return { browser, pages, instanceId };
  } catch (error) {
    console.error('恢复浏览器实例失败:', error);
    throw error;
  }
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
  memoryManager: ultraMemoryManager, // 导出超低内存管理器
  fallbackManager, // 导出备用管理器
  douyinManager // 导出抖音专用管理器
};
