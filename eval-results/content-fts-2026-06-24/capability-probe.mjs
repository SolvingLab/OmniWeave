import { OmniWeave } from '/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/dist/index.js';
import { ToolHandler } from '/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/dist/mcp/tools.js';
import * as fs from 'node:fs'; import * as path from 'node:path'; import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'cap-'));
// 符号无关联 content:i18n JSON 值 + .ts 注释短语(词不匹配任何符号)
fs.mkdirSync(path.join(dir,'locales'),{recursive:true});
fs.writeFileSync(path.join(dir,'locales','en.json'), JSON.stringify({labels:{wireframeToCode:"Wireframe to code", embeddable:"Embeddable element"}},null,2));
fs.writeFileSync(path.join(dir,'deburr.ts'), `// so we don't have to do any deburring, which will be the most correct\nexport const deburr = (s) => s;\n`);
const ow = await OmniWeave.init(dir,{silent:true}); await ow.indexAll();
const h = new ToolHandler(ow);
const ask = async (a)=> (await h.execute('omniweave_search', a)).content.map(c=>c.text).join('');
const hit = (t,needle)=> t.includes(needle) ? 'FOUND '+needle : (/No (files|results)/.test(t)?'not found':'? '+t.slice(0,40));
console.log('=== 符号无关联 content 「Wireframe to code」(真值 en.json) ===');
console.log('  OW content (pattern:):', hit(await ask({query:'pattern:Wireframe to code'}),'en.json'));
console.log('  OW symbol  (query:)  :', hit(await ask({query:'Wireframe to code'}),'en.json'));
console.log('=== 符号无关联 content 「the most correct」(真值 deburr.ts 注释) ===');
console.log('  OW content (pattern:):', hit(await ask({query:'pattern:the most correct'}),'deburr.ts'));
console.log('  OW symbol  (query:)  :', hit(await ask({query:'the most correct'}),'deburr.ts'));
ow.close?.();
// codegraph 侧(无内容索引):
const CGBIN='/Users/liuzaoqu/Desktop/develop/sogen/OmniWeave/research/2026-06-23-codegraph-ecosystem/repos/codegraph/dist/bin/codegraph.js';
try{ execFileSync('node',[CGBIN,'init',dir],{stdio:'ignore'});
  const cgout = execFileSync('node',[CGBIN,'query','Wireframe to code'],{encoding:'utf8'});
  console.log('=== codegraph(无内容索引) ===');
  console.log('  CG search「Wireframe to code」:', /no results|not found|No /i.test(cgout)?'not found (symbol-only)':cgout.slice(0,60));
}catch(e){ console.log('  CG:', String(e.message).slice(0,80)); }
fs.rmSync(dir,{recursive:true,force:true});
