#!/bin/bash

# 启动脚本 - 包含内存优化参数
# 启用垃圾回收和内存监控

echo "🚀 启动多实例浏览器管理系统（内存优化版）"
echo "======================================"

# 检查Node.js版本
NODE_VERSION=$(node --version)
echo "📦 Node.js版本: $NODE_VERSION"

# 检查可用内存
TOTAL_MEM=$(free -h | awk 'NR==2{printf "%.1f", $2}')
AVAIL_MEM=$(free -h | awk 'NR==2{printf "%.1f", $3}')
echo "💾 系统内存: ${TOTAL_MEM}GB 总计, ${AVAIL_MEM}GB 可用"

# 设置Node.js参数
export NODE_OPTIONS="--max-old-space-size=2048 --expose-gc"

echo "⚙️  启动参数:"
echo "   - 最大堆内存: 2048MB"
echo "   - 启用垃圾回收API"
echo "   - 内存优化: 已启用"
echo "   - 视频自动播放: 已禁用"
echo "   - 图片/JS/CSS: 已保留"

echo ""
echo "🔧 优化特性:"
echo "   ✅ 智能内存监控"
echo "   ✅ 自动垃圾回收"
echo "   ✅ 禁止视频自动播放"
echo "   ✅ 保留完整的JS/CSS/图片功能"
echo "   ✅ 适度的资源缓存"
echo "   ✅ 广告和跟踪脚本拦截"

echo ""
echo "🌐 启动服务器..."

# 启动应用
node index.js
