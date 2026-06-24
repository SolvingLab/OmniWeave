// Measure content_fts storage overhead on a real indexed repo via dbstat.
// Usage: node measure-content-storage.mjs <indexed .omniweave/omniweave.db>
import { DatabaseSync } from 'node:sqlite';
const dbp = process.argv[2];
const db = new DatabaseSync(dbp, { readOnly: true });
const pageSize = db.prepare('PRAGMA page_size').get().page_size;
const totalPages = db.prepare('PRAGMA page_count').get().page_count;
// dbstat groups by table/index name; content_fts spawns content_fts_data/idx/docsize/config
const rows = db.prepare(`SELECT name, sum(pgsize) bytes FROM dbstat GROUP BY name ORDER BY bytes DESC`).all();
const group = (pred) => rows.filter(r => pred(r.name)).reduce((a, r) => a + r.bytes, 0);
const contentBytes = group(n => n.startsWith('content_fts'));
const nodesFtsBytes = group(n => n.startsWith('nodes_fts'));
const total = totalPages * pageSize;
const files = db.prepare('SELECT count(*) c FROM files').get().c;
const contentRows = (()=>{try{return db.prepare('SELECT count(*) c FROM content_fts').get().c}catch{return 0}})();
const mb = (b) => (b / 1048576).toFixed(1);
console.log(`files indexed: ${files} | content_fts rows: ${contentRows}`);
console.log(`total DB: ${mb(total)} MB`);
console.log(`content_fts: ${mb(contentBytes)} MB (${(contentBytes/total*100).toFixed(0)}% of DB)`);
console.log(`nodes_fts (symbol): ${mb(nodesFtsBytes)} MB`);
console.log(`DB-minus-content: ${mb(total - contentBytes)} MB`);
console.log(`content_fts overhead ratio: ${(total/(total-contentBytes)).toFixed(2)}x the symbol-only DB`);
db.close();
