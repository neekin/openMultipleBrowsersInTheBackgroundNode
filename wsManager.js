const WebSocket = require('ws');
const config = require('./config');

function setupWebSocket(server, browsers) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    const url = req.url;
    const match = url.match(/\/browsers\/ws\/operate\/(.+)$/);
    if (!match) {
      console.log('WebSocket连接URL格式错误:', url);
      return ws.close();
    }
    
    const id = match[1];
    const inst = browsers[id];
    if (!inst) {
      console.log('WebSocket连接的实例不存在:', id);
      return ws.close();
    }
    
    console.log(`WebSocket连接建立，实例ID: ${id}`);
    let activeIdx = inst.activePageIdx || 0;

    function getActivePage() {
      return inst.pages[activeIdx] || inst.pages[0];
    }

    let closed = false;
    async function sendScreenshot() {
      if (closed) return;
      try {
        const page = getActivePage();
        if (!page) {
          ws.send(JSON.stringify({ error: '无可用页面' }));
          return;
        }
        const buf = await page.screenshot(config.browser.screenshotOptions);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(buf);
          if (inst.lastCursor) {
            ws.send(JSON.stringify({ cursor: inst.lastCursor }));
          }
        }
      } catch (e) {
        console.error(`截图失败 (${id}):`, e.message);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ error: e.message }));
        }
      }
      if (!closed) {
        setTimeout(sendScreenshot, config.websocket.screenshotInterval);
      }
    }
    sendScreenshot();

    if (!inst.wsList) inst.wsList = [];
    inst.wsList.push(ws);

    ws.on('close', () => {
      closed = true;
      if (inst.wsList) inst.wsList = inst.wsList.filter(w => w !== ws);
    });

    ws.on('message', async msg => {
      try {
        const data = JSON.parse(msg);
        const page = getActivePage();
        if (!page) {
          ws.send(JSON.stringify({ error: '无可用页面进行操作' }));
          return;
        }

        if (data.type === 'switchTab') {
          if (typeof data.idx === 'number' && inst.pages[data.idx]) {
            activeIdx = data.idx;
            inst.activePageIdx = data.idx;
          }
          return;
        }
        if (data.type === 'refreshTab') {
          if (typeof data.idx === 'number' && inst.pages[data.idx]) {
            try { 
              await inst.pages[data.idx].reload({ waitUntil: 'networkidle2' }); 
            } catch (e) {
              console.error(`刷新标签页失败 (${id}):`, e.message);
            }
            for (const ws2 of inst.wsList || []) {
              try { ws2.send(JSON.stringify({ type: 'tabUpdate' })); } catch {}
            }
          }
          return;
        }
        if (data.type === 'closeTab') {
          if (typeof data.idx === 'number' && inst.pages[data.idx]) {
            try { 
              await inst.pages[data.idx].close(); 
            } catch (e) {
              console.error(`关闭标签页失败 (${id}):`, e.message);
            }
            inst.pages.splice(data.idx, 1);
            if (activeIdx === data.idx) {
              activeIdx = 0;
              inst.activePageIdx = 0;
            } else if (activeIdx > data.idx) {
              activeIdx--;
              inst.activePageIdx = activeIdx;
            }
            for (const ws2 of inst.wsList || []) {
              try { ws2.send(JSON.stringify({ type: 'tabUpdate' })); } catch {}
            }
          }
          return;
        }
        if (data.type === 'getTabs') {
          const infos = await Promise.all(inst.pages.map(async (p, idx) => {
            let title = '';
            try { title = await p.title(); } catch {}
            let url = '';
            try { url = p.url(); } catch {}
            return { idx, title, url };
          }));
          ws.send(JSON.stringify({ type: 'tabs', tabs: infos }));
          return;
        }
        
        if (data.type === 'click') {
          const { x, y } = data.payload || {};
          await page.mouse.click(x, y);
        }
        if (data.type === 'mousemove') {
          const { x, y } = data.payload;
          await page.mouse.move(x, y);
          inst.lastCursor = { x, y };
        }
        if (data.type === 'keydown') {
          await page.keyboard.down(data.payload.key);
        }
        if (data.type === 'keyup') {
          await page.keyboard.up(data.payload.key);
        }
        if (data.type === 'wheel') {
          await page.mouse.wheel({ deltaX: data.payload.deltaX, deltaY: data.payload.deltaY });
        }
      } catch (e) {
        console.error(`WebSocket消息处理失败 (${id}):`, e.message);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ error: e.message }));
        }
      }
    });
  });
}

module.exports = setupWebSocket;
