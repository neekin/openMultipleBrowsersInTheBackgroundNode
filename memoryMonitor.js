#!/usr/bin/env node

/**
 * 内存监控工具
 * 用于监控浏览器实例的内存使用情况
 */

const config = require('./config');

class MemoryMonitor {
  constructor() {
    this.interval = null;
    this.logFile = './memory-monitor.log';
  }

  start() {
    console.log('开始内存监控...');
    this.interval = setInterval(() => {
      this.checkMemory();
    }, config.memory.monitorInterval);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('内存监控已停止');
    }
  }

  checkMemory() {
    const memoryUsage = process.memoryUsage();
    const timestamp = new Date().toISOString();
    
    const memoryInfo = {
      timestamp,
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memoryUsage.external / 1024 / 1024), // MB
      rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
    };

    // 检查是否超过阈值
    if (memoryInfo.heapUsed > config.memory.memoryThreshold) {
      console.log(`⚠️  内存使用过高: ${memoryInfo.heapUsed}MB (阈值: ${config.memory.memoryThreshold}MB)`);
      this.triggerOptimization();
    }

    // 输出当前内存使用情况
    console.log(`📊 内存使用: Heap ${memoryInfo.heapUsed}MB/${memoryInfo.heapTotal}MB, RSS ${memoryInfo.rss}MB, External ${memoryInfo.external}MB`);

    // 记录到日志文件
    this.logToFile(memoryInfo);
  }

  async triggerOptimization() {
    try {
      console.log('🔧 开始执行内存优化...');
      
      // 手动垃圾回收
      if (global.gc) {
        global.gc();
        console.log('✅ 执行垃圾回收完成');
      } else {
        console.log('⚠️  垃圾回收不可用，需要使用 --expose-gc 启动参数');
      }

      // 获取优化后的内存使用情况
      setTimeout(() => {
        const afterGC = process.memoryUsage();
        const heapUsedAfter = Math.round(afterGC.heapUsed / 1024 / 1024);
        console.log(`📈 优化后内存使用: ${heapUsedAfter}MB`);
      }, 1000);

    } catch (error) {
      console.error('❌ 内存优化失败:', error.message);
    }
  }

  logToFile(memoryInfo) {
    const fs = require('fs');
    const logLine = `${memoryInfo.timestamp} - Heap: ${memoryInfo.heapUsed}/${memoryInfo.heapTotal}MB, RSS: ${memoryInfo.rss}MB, External: ${memoryInfo.external}MB\n`;
    
    fs.appendFile(this.logFile, logLine, (err) => {
      if (err) {
        console.error('写入日志文件失败:', err.message);
      }
    });
  }

  async getSystemMemoryInfo() {
    const os = require('os');
    
    const totalMem = Math.round(os.totalmem() / 1024 / 1024 / 1024); // GB
    const freeMem = Math.round(os.freemem() / 1024 / 1024 / 1024); // GB
    const usedMem = totalMem - freeMem;
    
    console.log(`💻 系统内存: ${usedMem}GB/${totalMem}GB (${Math.round(usedMem/totalMem*100)}%)`);
    
    return {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      percentage: Math.round(usedMem/totalMem*100)
    };
  }

  async generateReport() {
    console.log('📋 生成内存使用报告...');
    
    const processMemory = process.memoryUsage();
    const systemMemory = await this.getSystemMemoryInfo();
    
    const report = {
      timestamp: new Date().toISOString(),
      process: {
        heapUsed: Math.round(processMemory.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(processMemory.heapTotal / 1024 / 1024) + 'MB',
        external: Math.round(processMemory.external / 1024 / 1024) + 'MB',
        rss: Math.round(processMemory.rss / 1024 / 1024) + 'MB'
      },
      system: {
        total: systemMemory.total + 'GB',
        used: systemMemory.used + 'GB',
        free: systemMemory.free + 'GB',
        percentage: systemMemory.percentage + '%'
      },
      recommendations: this.getRecommendations(processMemory, systemMemory)
    };

    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  getRecommendations(processMemory, systemMemory) {
    const recommendations = [];
    const heapUsedMB = Math.round(processMemory.heapUsed / 1024 / 1024);
    
    if (heapUsedMB > config.memory.memoryThreshold) {
      recommendations.push('进程内存使用过高，建议执行垃圾回收或重启部分实例');
    }
    
    if (systemMemory.percentage > 85) {
      recommendations.push('系统内存使用率过高，建议关闭不必要的实例');
    }
    
    if (processMemory.external > processMemory.heapUsed) {
      recommendations.push('外部内存使用较高，可能存在内存泄漏');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('内存使用正常');
    }
    
    return recommendations;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  const monitor = new MemoryMonitor();
  
  // 启动监控
  monitor.start();
  
  // 立即生成一次报告
  monitor.generateReport();
  
  // 处理退出信号
  process.on('SIGINT', () => {
    console.log('\n收到退出信号，正在停止监控...');
    monitor.stop();
    process.exit(0);
  });
  
  console.log('内存监控已启动，按 Ctrl+C 退出');
}

module.exports = MemoryMonitor;
