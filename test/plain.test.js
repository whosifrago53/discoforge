// TASK_FORMAT=plain rendering
const os = require('os');
const path = require('path');
process.env.TASK_FORMAT = 'plain';
process.env.DB_PATH = path.join(os.tmpdir(), `discoforge-plain-${process.pid}.db`);
const assert = require('assert');
const T = require('../src/tasks');
const store = require('../src/db');

const base = { id: 1, status: 'doing', description: '- @whosifrago analizzalo, vedi se ti trovi con questo report', author_name: 'TIA', created_at: 1 };
const c = (o = {}) => T.buildPlainContent({ ...base, ...o });

assert.equal(c(), base.description);
assert.equal(c({ status: 'done' }), '✅ @whosifrago analizzalo, vedi se ti trovi con questo report');
assert.equal(c({ status: 'discarded' }), '❌ @whosifrago analizzalo, vedi se ti trovi con questo report');
assert.equal(c({ bug: 1 }), '**[BUG] 🐛 **\n' + base.description);
assert.equal(c({ important: 1 }), '**[IMPORTANT] ⚠️ **\n' + base.description);
const open = c({ details_open: 1, status: 'done', categories: ['9'], assignees: ['5'] });
assert.ok(open.includes('**Assigned by:** TIA') && open.includes('<@5>') && open.includes('<#9>') && open.includes('✅ Done'));
assert.equal(c({ description: 'x'.repeat(3000) }).length, 2000);
const p = T.buildEmbed ? null : null;
console.log('plain ok');
store.db.close();
for (const s of ['', '-wal', '-shm']) require('fs').rmSync(process.env.DB_PATH + s, { force: true });
