const pptr = require('puppeteer');

const maxSynchronous = process.env.MAX_SYNCHRONOUS || 20;

/**
 * @param {import('puppeteer').Browser} browser 
 * @param {string} baseUrl
 * @param {string} path
 */
async function fetchPage(browser,baseUrl,path){
  path = path.replace(/^\//,''); // normalize incoming urls
  const fullUrl = `${baseUrl}/${path}`;
  const page = await browser.newPage();
  page.setExtraHTTPHeaders({
    'Prerender-Password': process.env.PASSWORD, // for rate limit bypass
    'Authorization': `Basic ${process.env.DEV_SERVER_BASIC_AUTH}`
  });
  await page.goto(fullUrl,{waitUntil:'networkidle0'});
  const html = await page.content();
  await page.close();
  return html;
}

/**
 * @param {string} bucket 
 * @param {string} path 
 * @param {string} html 
 */
async function uploadPageToS3(bucket,path,html){
  // TODO: populate this
  return;
}

/**
 * @param {{baseUrl:string, bucket:string, paths:string[]}} data
 */
async function prerenderPaths (data){
  const browser = await pptr.launch();
  // Ensure there are ALWAYS maxSynchronous in queue
  // (each time one ends another one is added).

  let pathPointer = -1; // Index of the last URL being pre-rendered

  const renderNextUrl = ()=>{
    pathPointer++;
    return pathPointer >= data.paths.length ||
      fetchPage(browser,data.baseUrl,data.paths[pathPointer])
        .then(html=>uploadPageToS3(data.bucket,data.paths[pathPointer],html))
        .then(renderNextUrl); 
  };

  for(let i=0; i<maxSynchronous; i++){
    renderNextUrl();
  }
}

prerenderPaths({
  baseUrl: process.env.BASE_URL,
  bucket: process.env.BUCKET,
  paths: process.env.PRERENDER_PATHS
    .split(process.env.PRERENDER_PATHS_SEP||';')
});

