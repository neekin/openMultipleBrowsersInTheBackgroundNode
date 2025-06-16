# Puppeteer 多实例远程控制系统

## 项目简介
基于 Node.js + Express + Puppeteer 的多实例浏览器远程控制系统，支持 session/cookie 隔离、指纹随机化、实例后台常驻、WebSocket 远程操作等功能。

## 功能特性
- 🚀 多实例管理：创建、删除、恢复浏览器实例
- 🔒 会话隔离：每个实例独立的 userDataDir，完全隔离 cookies/session
- 🎭 指纹随机：随机化 User-Agent、视口大小等浏览器指纹
- 📱 实时控制：WebSocket 实时截图、鼠标键盘操作
- 💾 持久化存储：SQLite 数据库存储实例信息，支持服务重启后恢复
- 🏷️ 标签页管理：支持多标签页切换、刷新、关闭操作
- 🎯 自动恢复：服务启动时自动恢复历史实例

## 项目结构
```
├── index.js              # 主服务文件，负责服务器启动和全局配置
├── config.js             # 统一配置管理
├── browserManager.js     # 浏览器实例管理模块
├── wsManager.js          # WebSocket 连接和操作处理
├── routes/
│   └── browsers.js       # 实例管理 API 路由
├── static/
│   └── index.html        # 前端界面
├── user_data/            # 用户数据目录（自动创建）
├── browsers.db           # SQLite 数据库（自动创建）
├── package.json          # 项目依赖
└── ecosystem.config.js   # PM2 配置文件
```

## 核心模块说明

### index.js - 主服务文件
- 服务器启动和基础配置
- 数据库初始化
- 路由挂载
- WebSocket 服务启动
- 优雅关闭处理

### config.js - 配置管理
- 服务器配置（端口、主机）
- 数据库路径配置
- 浏览器启动参数
- WebSocket 配置
- 指纹生成规则

### browserManager.js - 浏览器管理
- Chromium 路径自动检测
- 随机指纹生成
- 浏览器实例启动
- 历史实例恢复
- 批量实例管理

### wsManager.js - WebSocket 处理
- WebSocket 连接管理
- 实时截图推送
- 鼠标键盘事件处理
- 标签页操作处理
- 错误处理和日志记录

### routes/browsers.js - API 路由
- POST /browsers/create - 创建新实例
- GET /browsers - 获取实例列表
- GET /browsers/:id/pages - 获取标签页信息
- POST /browsers/:id/restore - 恢复历史实例
- DELETE /browsers/:id - 删除实例

## 安装和运行

### 环境要求
- Node.js 16+
- 系统安装 Chromium/Chrome 浏览器

### 安装依赖
```bash
npm install
```

### 开发模式运行
```bash
npm run dev
```

### 生产模式运行
```bash
node index.js
```

### PM2 部署
```bash
npm install -g pm2
pm2 start ecosystem.config.js
```

## PM2 配置注意事项
在 `ecosystem.config.js` 中添加以下配置防止频繁重启：
```javascript
module.exports = {
  apps: [{
    name: 'puppeteer-manager',
    script: 'index.js',
    ignore_watch: ['user_data', 'browsers.db', 'node_modules']
  }]
}
```

## API 文档

### 创建实例
```bash
curl -X POST http://localhost:3000/browsers/create \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### 获取实例列表
```bash
curl http://localhost:3000/browsers
```

### 删除实例
```bash
curl -X DELETE http://localhost:3000/browsers/{instance_id}
```

## WebSocket 操作
连接地址：`ws://localhost:3000/browsers/ws/operate/{instance_id}`

支持的操作类型：
- `click` - 鼠标点击
- `mousemove` - 鼠标移动
- `keydown/keyup` - 键盘按键
- `wheel` - 鼠标滚轮
- `switchTab` - 切换标签页
- `refreshTab` - 刷新标签页
- `closeTab` - 关闭标签页
- `getTabs` - 获取标签页列表

## 技术栈
- **后端**: Node.js + Express
- **数据库**: SQLite3
- **浏览器控制**: Puppeteer
- **实时通信**: WebSocket (ws)
- **前端**: 原生 HTML/CSS/JavaScript

## 开发和维护
- 代码采用模块化设计，职责分离
- 完善的错误处理和日志记录
- 支持配置化管理
- 优雅的进程关闭处理

## 注意事项
1. 确保系统有足够内存支持多个浏览器实例
2. 定期清理 `user_data` 目录避免磁盘空间不足
3. 生产环境建议使用 PM2 进行进程管理
4. 防火墙需要开放对应端口（默认 3000）
