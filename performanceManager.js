// 性能监控和优化管理器
const config = require('./config');

class PerformanceManager {
  constructor() {
    this.instanceMetrics = new Map();
    this.globalMetrics = {
      totalScreenshots: 0,
      totalOperations: 0,
      averageResponseTime: 0,
      startTime: Date.now()
    };
  }

  // 记录实例指标
  recordInstanceMetric(instanceId, metric) {
    if (!this.instanceMetrics.has(instanceId)) {
      this.instanceMetrics.set(instanceId, {
        screenshots: 0,
        operations: 0,
        responseTimes: [],
        lastActivity: Date.now(),
        bandwidth: 0,
        errors: 0
      });
    }

    const metrics = this.instanceMetrics.get(instanceId);
    
    switch (metric.type) {
      case 'screenshot':
        metrics.screenshots++;
        metrics.bandwidth += metric.size || 0;
        this.globalMetrics.totalScreenshots++;
        break;
      case 'operation':
        metrics.operations++;
        metrics.responseTimes.push(metric.responseTime || 0);
        this.globalMetrics.totalOperations++;
        break;
      case 'error':
        metrics.errors++;
        break;
    }
    
    metrics.lastActivity = Date.now();
    
    // 计算平均响应时间
    if (metrics.responseTimes.length > 0) {
      const avg = metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length;
      this.globalMetrics.averageResponseTime = avg;
      
      // 保持最近 100 次记录
      if (metrics.responseTimes.length > 100) {
        metrics.responseTimes = metrics.responseTimes.slice(-100);
      }
    }
  }

  // 获取实例性能建议
  getPerformanceSuggestions(instanceId) {
    const metrics = this.instanceMetrics.get(instanceId);
    if (!metrics) return [];

    const suggestions = [];
    
    // 分析响应时间
    if (metrics.responseTimes.length > 10) {
      const avg = metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length;
      if (avg > 200) {
        suggestions.push({
          type: 'performance',
          message: '响应时间较慢，建议启用操作批处理',
          suggestion: 'Enable batch operations',
          priority: 'high'
        });
      }
    }
    
    // 分析带宽使用
    const hourlyBandwidth = metrics.bandwidth / ((Date.now() - this.globalMetrics.startTime) / 3600000);
    if (hourlyBandwidth > 100 * 1024 * 1024) { // 100MB/hour
      suggestions.push({
        type: 'bandwidth',
        message: '带宽使用过高，建议降低截图质量或频率',
        suggestion: 'Reduce screenshot quality or frequency',
        priority: 'medium'
      });
    }
    
    // 分析错误率
    const errorRate = metrics.errors / (metrics.operations + metrics.screenshots);
    if (errorRate > 0.05) { // 5% 错误率
      suggestions.push({
        type: 'stability',
        message: '错误率过高，建议检查浏览器实例稳定性',
        suggestion: 'Check browser instance stability',
        priority: 'high'
      });
    }
    
    return suggestions;
  }

  // 获取全局性能统计
  getGlobalStats() {
    const uptime = Date.now() - this.globalMetrics.startTime;
    const activeInstances = this.instanceMetrics.size;
    
    return {
      uptime,
      activeInstances,
      totalScreenshots: this.globalMetrics.totalScreenshots,
      totalOperations: this.globalMetrics.totalOperations,
      averageResponseTime: this.globalMetrics.averageResponseTime,
      screenshotsPerSecond: this.globalMetrics.totalScreenshots / (uptime / 1000),
      operationsPerSecond: this.globalMetrics.totalOperations / (uptime / 1000)
    };
  }

  // 获取实例详细统计
  getInstanceStats(instanceId) {
    const metrics = this.instanceMetrics.get(instanceId);
    if (!metrics) return null;

    const responseTimeAvg = metrics.responseTimes.length > 0 
      ? metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length 
      : 0;

    return {
      screenshots: metrics.screenshots,
      operations: metrics.operations,
      bandwidth: metrics.bandwidth,
      errors: metrics.errors,
      averageResponseTime: responseTimeAvg,
      lastActivity: metrics.lastActivity,
      errorRate: metrics.errors / (metrics.operations + metrics.screenshots),
      suggestions: this.getPerformanceSuggestions(instanceId)
    };
  }

  // 清理实例指标
  cleanupInstance(instanceId) {
    this.instanceMetrics.delete(instanceId);
  }

  // 自动优化建议
  getAutoOptimizationConfig(instanceId) {
    const metrics = this.instanceMetrics.get(instanceId);
    if (!metrics) return config.websocket;

    const optimizedConfig = { ...config.websocket };
    
    // 基于活动频率动态调整
    const timeSinceActivity = Date.now() - metrics.lastActivity;
    
    if (timeSinceActivity > 10000) { // 10秒无活动
      optimizedConfig.screenshotInterval = Math.min(2000, optimizedConfig.screenshotInterval * 2);
    } else if (metrics.operations > 5) { // 高频操作
      optimizedConfig.screenshotInterval = Math.max(100, optimizedConfig.screenshotInterval * 0.5);
    }
    
    // 基于错误率调整
    const errorRate = metrics.errors / (metrics.operations + metrics.screenshots);
    if (errorRate > 0.1) {
      optimizedConfig.batchTimeout = Math.min(200, optimizedConfig.batchTimeout * 2);
    }
    
    return optimizedConfig;
  }
}

// 单例模式
const performanceManager = new PerformanceManager();

module.exports = performanceManager;
