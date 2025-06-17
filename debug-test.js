#!/usr/bin/env node

// 调试测试脚本 - 用于验证点击事件处理

const puppeteer = require('puppeteer');
const config = require('./config');

async function debugTest() {
  console.log('开始调试测试...');
  
  try {
    // 启动浏览器 - 使用有头模式进行调试
    const browser = await puppeteer.launch({
      headless: false, // 有头模式，可以看到实际操作
      args: config.browser.launchOptions.args,
      devtools: true // 打开开发者工具
    });
    
    const page = await browser.newPage();
    
    // 设置视口
    await page.setViewport({ width: 800, height: 600 });
    
    // 加载测试页面
    await page.goto(config.browser.defaultUrl, { waitUntil: 'domcontentloaded' });
    
    console.log('页面加载完成，等待3秒...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 测试点击按钮
    console.log('执行点击测试...');
    
    // 首先移动鼠标
    await page.mouse.move(150, 100);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 然后点击
    await page.mouse.click(150, 100, { delay: 100 });
    
    console.log('点击执行完成，等待响应...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 检查页面日志
    const logs = await page.evaluate(() => {
      const logDiv = document.getElementById('log');
      return logDiv ? logDiv.innerHTML : '无日志';
    });
    
    console.log('页面日志:', logs);
    
    // 保持浏览器打开10秒以便观察
    console.log('保持浏览器打开10秒以便观察...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    await browser.close();
    console.log('测试完成');
    
  } catch (error) {
    console.error('测试失败:', error);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  debugTest();
}

module.exports = debugTest;
