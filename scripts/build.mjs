import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,'..');
await mkdir(path.join(root,'docs/vendor'),{recursive:true});
for(const name of ['index.html','shell.js','style.css','player.html'])await copyFile(path.join(root,'src',name),path.join(root,'docs',name));
const source=await readFile(path.join(root,'src/cd-library.ts'),'utf8');
const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
await writeFile(path.join(root,'docs/cd-library.js'),result.outputText.replace("from 'fflate'","from './vendor/fflate.js'"));
await copyFile(path.resolve(path.dirname(require.resolve('fflate')),'../esm/browser.js'),path.join(root,'docs/vendor/fflate.js'));
await writeFile(path.join(root,'docs/.nojekyll'),'');
const indexPath=path.join(root,'docs/data/index.json');
const index=JSON.parse(await readFile(indexPath,'utf8'));
// CD-only test: do not expose a demo catalog requiring the production proxy.
index.games={};
await writeFile(indexPath,JSON.stringify(index,null,2)+'\n');
console.log('Static CD audio test built in docs/.');
