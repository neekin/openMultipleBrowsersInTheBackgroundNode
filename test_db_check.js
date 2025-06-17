// 直接测试 autoMaintenanceManager 是否使用 lastActiveTime 字段
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./browsers.db');

console.log('🔍 检查数据库中的 lastActiveTime 字段使用情况');

// 查询所有实例及其 lastActiveTime
db.all('SELECT id, createdAt, lastActiveTime FROM browsers', (err, rows) => {
  if (err) {
    console.error('Error:', err);
    return;
  }
  
  console.log(`📊 数据库中共有 ${rows.length} 个实例:`);
  
  const now = Date.now();
  for (const row of rows) {
    let lastActiveTime = 0;
    let timeSource = 'unknown';
    
    if (row.lastActiveTime) {
      // 数据库中有记录的最后活跃时间
      lastActiveTime = typeof row.lastActiveTime === 'string' ? 
        parseFloat(row.lastActiveTime) : 
        row.lastActiveTime;
      timeSource = 'database.lastActiveTime';
    } else if (row.createdAt) {
      // 最后备用：使用创建时间
      lastActiveTime = new Date(row.createdAt).getTime();
      timeSource = 'database.createdAt';
    }
    
    const timeSinceLastActive = now - lastActiveTime;
    const minutesAgo = Math.round(timeSinceLastActive / 60000);
    
    console.log(`  - ${row.id.substr(0, 8)}... 时间源: ${timeSource}, ${minutesAgo}分钟前活跃`);
    console.log(`    原始数据: lastActiveTime=${row.lastActiveTime}, createdAt=${row.createdAt}`);
  }
  
  db.close();
});
