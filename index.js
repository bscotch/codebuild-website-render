/**
 * @file Main for rendering pages of a website as HTML via
 * either sitemaps or lists of URLs. Arguments come in via
 * environment variables, either set up in the CodeBuild
 * project or passed in via an AWS CodeBuild API call via the
 * environmentVariablesOverride parameter.
 * 
 * ## PARAMETERS (via env)
 * 
 *  + SITEMAP_PATH (e.g. "https://www.bscotch.net/sitemap.xml")
 *    Either this or paths must be specified.
 *  + PATHS (CSV, e.g. "https://www.bscotch.net/,https://www.bscotch.net/about,https://www.bscotch.net/blog/post-1")
 *  + OUT_FOLDER (e.g. "dev")
 *    Subdirectory into which files should go, within the "rendered" folder.
 *  + HEADERS (CSV, e.g. "Authentication: Basic XYZ, My-Custom-Header: MyCustomHeaderValue")
 *  + MAX_SYNCHRONOUS (default 100)
 *    In effect, the number of tabs to open at once for rendering.
 *    The renderer will ensure that there are always this many pages
 *    being rendered at once.
 *  + COMPUTE_SCRIPT_HASHES
 *    If "true", compute SHA hashes for each script in the HTML,
 *    saving in a .json file (contents: `{scriptHashes:[]}`) with the same
 *    name & path as the html file. These can be used via the 'Content-Security-Policy'
 *    to set super-strict Javascript rules while whitelisting your inline scripts.
 *  + GZIP
 *    If "true", gzip all files before writing, saving with the additional ".gz" extension.
 */


const pptr = require('puppeteer');
const Sitemapper = require('sitemapper');
const sitemapper = new Sitemapper();
const fs = require('fs');
const path = require('path');
const events = require('events');
const crypto = require('crypto');
const zlib = require('zlib');
const {promisify} = require('util');
const URL = require('url').URL;

const gzip = promisify(zlib.gzip);

const outDir = 'rendered';

const emitter = new events.EventEmitter();

function computeInlineScriptHashes(html){
  const scripts = html.match(/<script>(.*?)<\/script>/sg);
  if(!scripts){
    return [];
  }
  const hashes = [];
  for(const script of scripts){
    const hash = crypto
      .createHash('sha256')
      .update(script.replace(/<\/?script>/g,''),'utf8')
      .digest('base64');
    hashes.push(hash);
  }
  return hashes;
}

/**
 * @param {Parameters} params
 * @param {string} url 
 * @param {string} html 
 */
async function writeRenderedPage(params,url,html){
  if(!html){
    return emitter.emit('saved',{url});
  }
  let fullPath = path.join(outDir,params.outFolder,url.replace(new URL(url).origin,''));
  if(!fullPath.endsWith('.html')){
    fullPath = path.join(fullPath,'index.html');
  }
  if(params.gzip){
    fullPath += '.gz';
  }
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(fullPath, params.gzip ? await gzip(html) : html);
  if(params.computeScriptHashes){
    const metadataPath = fullPath.replace(/\.html(\.gz)?$/,'.json');
    if(metadataPath.endsWith('json')){
      const hashes = computeInlineScriptHashes(html);
      const metadataJson = JSON.stringify({scriptHashes:hashes});
      fs.writeFileSync(metadataPath,metadataJson);
    }
  }
  emitter.emit('saved',{url});
}

/**
 * @typedef {ReturnType<getParameters>} Parameters
 */

function assert(somethingTruthy,messageIfFalse){
  if(!somethingTruthy){
    throw new Error(messageIfFalse);
  }
}

function ensureSlashPrefix(path){
  return path.startsWith('/') ? path : `/${path}`;
}

function getParameters(){

  // SITEMAP_PATH
  const sitemapPath = process.env.SITEMAP_PATH;

  // PATHS
  const paths = (process.env.PATHS||'')
    .split(/\s*,\s*/g)
    .filter(x=>x);

  assert((sitemapPath && new URL(sitemapPath)) || paths.length, "Sitemap path or paths list must be provided.");
  // OUT_FOLDER

  const outFolder = ensureSlashPrefix(process.env.OUT_FOLDER||'');
  // HEADERS

  const headers = (process.env.HEADERS || '').split(/\s*,\s*/g).filter(x=>x).reduce((head,current)=>{
      const [key,value] = current.split(/\s*:\s*/).map(s=>s.trim());
      head[key] = value;
      return head;
    },{});

  return {
    sitemapPath,
    paths,
    outFolder,
    headers,
    computeScriptHashes:
      process.env.COMPUTE_SCRIPT_HASHES == 'true',
    gzip:
      process.env.GZIP == 'true'
  }
}

/**
 * @param {Parameters} parameters 
 */
async function getPaths(parameters){
  const urls = [...parameters.paths];
  if(parameters.sitemapPath){
    // Download it!
    const {sites} = (await sitemapper.fetch(parameters.sitemapPath));
    urls.push(...sites);
  }
  return urls;
}

const maxSynchronous = process.env.MAX_SYNCHRONOUS || 100;

/**
 * @param {import('puppeteer').Browser} browser 
 * @param {Parameters} params
 * @param {string} url
 */
async function fetchPage(browser,params,url){
  let html;
  try{
    const fullUrl = url;
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders(params.headers);
    const response = await page.goto(fullUrl,{waitUntil:'networkidle0'});
    if(response.status()<300){
      html = await page.content();
      console.log("SUCCESS",url);
    }
    else{
      console.log("WARN",url,'returned status',response.status());
    }
    await page.close();
  }
  catch(err){
    console.log(err);
  }
  return html;
}

async function prerenderPaths (){
  const params = getParameters();
  const urls = await getPaths(params);

  const browser = await pptr.launch({args:['--no-sandbox']});
  const failOnUncaughtError = err=>{
    browser.close();
    console.log(err);
    process.exit(1);
  }

  process.on('unhandledRejection', failOnUncaughtError);
  process.on('uncaughtException', failOnUncaughtError);


  // Ensure there are ALWAYS maxSynchronous in queue
  // (each time one ends another one is added).

  let pathPointer = -1; // Index of the last URL being pre-rendered

  const renderNextUrl = ()=>{
    pathPointer++;
    if(pathPointer >= urls.length){
      emitter.emit('done');
    }
    const url = urls[pathPointer];
    return pathPointer >= urls.length ||
      fetchPage(browser,params,url)
        .then(html=>writeRenderedPage(params,url,html))
        .then(renderNextUrl); 
  };

  for(let i=0; i<maxSynchronous; i++){
    renderNextUrl();
  }

  const rendered = [];
  emitter.on('saved',info=>{
    rendered.push(info.url);
    if(rendered.length == urls.length){
      browser.close();
    }
  });
}

prerenderPaths();

