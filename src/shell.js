import {getCdLibraryMetadata,importCdZip,importCdFolder,formatBytes} from './cd-library.js';
const $=id=>document.getElementById(id);
const player=$('player');
let library=null,running=false,expanded=false;
const updateLibrary=()=>{
  $('library').textContent=library?`${library.release} · ${library.fileCount} files · ${formatBytes(library.totalBytes)} saved on this test site.`:'No CD imported at this test address yet.';
  $('candidate').disabled=$('baseline').disabled=!library;
};
try{library=await getCdLibraryMetadata();updateLibrary();}
catch(error){$('error').textContent=error.message;$('library').textContent='Could not open local test storage. Close other test tabs and retry.';}
async function importFiles(kind,files){
 if(!files?.length)return;
 $('error').textContent='';$('progress').hidden=false;$('progress').value=0;
 $('zip').disabled=$('folder').disabled=$('candidate').disabled=$('baseline').disabled=true;
 try{
  const options={sourceName:files[0].name,onProgress:({percent,detail})=>{$('progress').value=percent;$('status').textContent=detail;}};
  library=kind==='zip'?await importCdZip(files[0],options):await importCdFolder(files,options);
  $('status').textContent='CD ready. Tap Play audio fix to start.';
 }catch(error){$('error').textContent=error.message;}
 finally{$('zip').disabled=$('folder').disabled=false;$('zip').value=$('folder').value='';$('progress').hidden=true;updateLibrary();}
}
$('zip').addEventListener('change',e=>importFiles('zip',e.target.files));
$('folder').addEventListener('change',e=>importFiles('folder',e.target.files));
function showGame(){document.body.classList.add('playing');$('game').hidden=false;syncDisplay();}
function showMenu(){document.body.classList.remove('playing');$('game').hidden=true;$('continue').hidden=!running;}
function launch(baseline){
 if(!library)return;
 if(running&&!confirm('Restart the test game? Save first if you want to keep your progress.'))return;
 const url=new URL('./player.html',location.href);
 url.search=new URLSearchParams({edition:'cd',build:'24-audio-test',audio_pipeline:'queued',SDL_AUDIO_DEVICE_SAMPLE_FRAMES:'1024',timing:baseline?'baseline':'fixed',service_timers:baseline?'0':'1',launch:String(Date.now())});
 url.hash='--config=/goblins3-web.ini --music-driver=adlib --path=/games/gob3-cd gob:gob3';
 player.src=url.href;running=true;expanded=false;showGame();
}
$('candidate').onclick=()=>launch(false);$('baseline').onclick=()=>launch(true);
$('menu').onclick=showMenu;$('continue').onclick=showGame;
function syncDisplay(){
 const standalone=matchMedia('(display-mode: standalone)').matches||Boolean(navigator.standalone);
 player.contentWindow?.postMessage({source:'goblins3-shell',type:'display-mode',standalone},location.origin);
 player.contentWindow?.postMessage({source:'goblins3-shell',type:'viewport-change'},location.origin);
}
player.addEventListener('load',syncDisplay);
addEventListener('resize',syncDisplay);addEventListener('orientationchange',syncDisplay);
visualViewport?.addEventListener('resize',syncDisplay);
addEventListener('message',async event=>{
 if(event.origin!==location.origin||event.source!==player.contentWindow||event.data?.source!=='goblins3-player')return;
 if(event.data.type==='error'){$('error').textContent=event.data.text;showMenu();}
 if(event.data.type==='status')$('status').textContent=event.data.text;
 if(event.data.type==='ready')syncDisplay();
 if(event.data.type==='toggle-fullscreen'){
  expanded=!expanded;
  if(expanded){try{await $('game').requestFullscreen?.();}catch{}}
  else{try{if(document.fullscreenElement)await document.exitFullscreen();}catch{}showMenu();}
  player.contentWindow?.postMessage({source:'goblins3-shell',type:'fullscreen-state',expanded},location.origin);
  syncDisplay();
 }
});
