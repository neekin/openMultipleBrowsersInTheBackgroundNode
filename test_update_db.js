const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./browsers.db');

// 获取最新实例的ID
db.get('SELECT id FROM browsers ORDER BY rowid DESC LIMIT 1', (err, row) => {
  if (err) {
    console.error('Error:', err);
    return;
  }
  if (!row) {
    console.log('No instances found');
    return;
  }
  
  const instanceId = row.id;
  // 设置lastActiveTime为5分钟前（超过1分钟阈值）
  const oldTime = Date.now() - (5 * 60 * 1000);
  
  db.run('UPDATE browsers SET lastActiveTime = ? WHERE id = ?', [oldTime, instanceId], function(err) {
    if (err) {
      console.error('Update error:', err);
    } else {
      console.log(`Updated instance ${instanceId} lastActiveTime to ${oldTime} (5 minutes ago)`);
    }
    db.close();
  });
});
