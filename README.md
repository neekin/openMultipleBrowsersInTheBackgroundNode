# openMultipleBrowsersInTheBackgroundNode

本项目基于 Node.js、Express 和 Puppeteer，提供 API 实现：
- 启动独立 Puppeteer 实例（session/cookie 隔离，随机指纹，后台常驻）
- 获取实例列表
- 通过 wsEndpoint 远程连接 Puppeteer 实例

## 启动

```bash
node index.js
```

## API

- `POST /browser/new` 启动新实例
- `GET /browser/list` 获取实例列表
- `POST /browser/connect` 通过 wsEndpoint 连接远程实例
