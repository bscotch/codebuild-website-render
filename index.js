/**
 * @file Main for rendering pages of a website as HTML via
 * either sitemaps or lists of URLs. Arguments come in via
 * environment variables, either set up in the CodeBuild
 * project or passed in via an AWS CodeBuild API call via the
 * environmentVariablesOverride parameter.
 * 
 * ## PARAMETERS (via env)
 * 
 *  + BASE_URL (e.g. "https://www.bscotch.net")
 *  + SITEMAP_PATH (e.g. "/sitemap.xml")
 *    Either this or paths must be specified.
 *    Must be a path relative to BASE_URL
 *  + PATHS (CSV, e.g. "/,/about,/blog/post-1")
 *    Must be relative to BASE_URL
 *  + OUT_FOLDER (e.g. "dev")
 *    Target 'folder' (key prefix) within the S3 bucket + prefix
 *    defined in the CodeBuild project.
 */


const pptr = require('puppeteer');
const Sitemapper = require('sitemapper');
const sitemapper = new Sitemapper();
const fs = require('fs');
const path = require('path');
const events = require('events');

const outDir = 'rendered';

const emitter = new events.EventEmitter();

/**
 * @param {Parameters} params
 * @param {string} url 
 * @param {string} html 
 */
function writeRenderedPage(params,url,html){
  let fullPath = path.join(outDir,params.outFolder,url);
  if(!fullPath.endsWith('.html')){
    fullPath = path.join(fullPath,'index.html');
  }
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(fullPath,html);
  emitter.emit('write',{url});
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
  const baseUrl = process.env.BASE_URL;
  assert(
    baseUrl.match(/^https?:\/\/[^/]+$/),
    "BASE_URL must match the pattern ^https?://[^/]+$"
  );
  const sitemapPath = process.env.SITEMAP_PATH
    ? ensureSlashPrefix(process.env.SITEMAP_PATH)
    : null;
  const paths = (process.env.PATHS||'')
    .split(/\s*,\s*/g)
    .filter(x=>x)
    .map(ensureSlashPrefix);
  assert(sitemapPath || paths.length, "Sitemap path or paths list must be provided.");
  const outFolder = ensureSlashPrefix(process.env.OUT_FOLDER||'');
  return {
    baseUrl,
    sitemapPath,
    paths,
    outFolder
  }
}

/**
 * @param {Parameters} parameters 
 */
async function getPaths(parameters){
  const urls = [...parameters.paths];
  if(parameters.sitemapPath){
    // Download it!
    const {sites} = (await sitemapper.fetch(`${parameters.baseUrl}${parameters.sitemapPath}`));
    urls.push(...sites);
  }
  return urls;
}

const maxSynchronous = process.env.MAX_SYNCHRONOUS || 20;

/**
 * @param {import('puppeteer').Browser} browser 
 * @param {string} baseUrl
 * @param {string} url
 */
async function fetchPage(browser,baseUrl,url){
  url = url.replace(/^\//,''); // normalize incoming urls
  const fullUrl = `${baseUrl}/${url}`;
  const page = await browser.newPage();
  // page.setExtraHTTPHeaders({
  //   'Prerender-Password': process.env.PASSWORD, // for rate limit bypass
  //   'Authorization': `Basic ${process.env.DEV_SERVER_BASIC_AUTH}`
  // });
  await page.goto(fullUrl,{waitUntil:'networkidle0'});
  const html = await page.content();
  console.log('FETCHED',url);
  await page.close();
  return html;
}

async function prerenderPaths (){
  const params = getParameters();
  const urls = await getPaths(params);

  const browser = await pptr.launch();
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
      fetchPage(browser,params.baseUrl,url)
        .then(html=>writeRenderedPage(params,url,html))
        .then(renderNextUrl); 
  };

  for(let i=0; i<maxSynchronous; i++){
    renderNextUrl();
  }

  const rendered = [];
  emitter.on('write',info=>{
    rendered.push(info.url);
    if(rendered.length == urls.length){
      browser.close();
    }
  });
}

prerenderPaths();

