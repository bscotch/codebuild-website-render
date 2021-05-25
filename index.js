/**
 * @file Main for rendering pages of a website as HTML via
 * either sitemaps or lists of URLs. Arguments come in via
 * environment variables, either set up in the CodeBuild
 * project or passed in via an AWS CodeBuild API call via the
 * environmentVariablesOverride parameter.
 */

const pptr = require('puppeteer');
const Sitemapper = require('sitemapper').default;
const sitemapper = new Sitemapper({});
const fs = require('fs');
const path = require('path');
const events = require('events');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const URL = require('url').URL;
const dotenv = require('dotenv');
const inliner = require('inline-css');
const version = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8')
).version;
dotenv.config();

console.log({ version });

const gzip = promisify(zlib.gzip);

const outDir = 'rendered';

const emitter = new events.EventEmitter();

/**
 * @param {number} ms
 */
async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function computeInlineScriptHashes(html) {
  const scripts = html.match(/<script>(.*?)<\/script>/gs);
  if (!scripts) {
    return [];
  }
  const hashes = [];
  for (const script of scripts) {
    const hash = crypto
      .createHash('sha256')
      .update(script.replace(/<\/?script>/g, ''), 'utf8')
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
async function writeRenderedPage(params, url, html) {
  if (!html) {
    return emitter.emit('saved', { url });
  }
  let fullPath = path.join(
    outDir,
    params.outFolder,
    url.replace(new URL(url).origin, '')
  );
  if (!fullPath.endsWith('.html')) {
    fullPath = path.join(fullPath, 'index.html');
  }
  if (params.gzip) {
    fullPath += '.gz';
  }
  if (process.env.INLINE_CSS == 'true') {
    html = await inliner(html, {
      url: new URL(url).origin,
      removeLinkTags: false,
      applyLinkTags: false,
      applyStyleTags: true,
      removeStyleTags: true,
      preserveMediaQueries: true,
    });
  }

  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, params.gzip ? await gzip(html) : html);
  if (params.computeScriptHashes) {
    const metadataPath = fullPath.replace(/\.html(\.gz)?$/, '.json');
    if (metadataPath.endsWith('json')) {
      const hashes = computeInlineScriptHashes(html);
      const metadataJson = JSON.stringify({ scriptHashes: hashes });
      fs.writeFileSync(metadataPath, metadataJson);
    }
  }
  emitter.emit('saved', { url });
}

/**
 * @typedef {ReturnType<getParameters>} Parameters
 */

function assert(somethingTruthy, messageIfFalse) {
  if (!somethingTruthy) {
    throw new Error(messageIfFalse);
  }
}

function ensureSlashPrefix(path) {
  return path.startsWith('/') ? path : `/${path}`;
}

function getParameters() {
  // SITEMAP_PATH
  const sitemapPath = process.env.SITEMAP_PATH;

  // PATHS
  const paths = (process.env.PATHS || '').split(/\s*,\s*/g).filter((x) => x);

  assert(
    (sitemapPath && new URL(sitemapPath)) || paths.length,
    'Sitemap path or paths list must be provided.'
  );
  // OUT_FOLDER

  const outFolder = ensureSlashPrefix(process.env.OUT_FOLDER || '');
  // HEADERS

  const headers = (process.env.HEADERS || '')
    .split(/\s*,\s*/g)
    .filter((x) => x)
    .reduce((head, current) => {
      const [key, value] = current.split(/\s*:\s*/).map((s) => s.trim());
      head[key] = value;
      return head;
    }, {});

  return {
    sitemapPath,
    paths,
    outFolder,
    headers,
    computeScriptHashes: process.env.COMPUTE_SCRIPT_HASHES == 'true',
    gzip: process.env.GZIP == 'true',
  };
}

/**
 * @param {Parameters} parameters
 */
async function getPaths(parameters) {
  const urls = [...parameters.paths];
  if (parameters.sitemapPath) {
    // Download it!
    const { sites } = await sitemapper.fetch(parameters.sitemapPath);
    urls.push(...sites);
  }
  return urls;
}

const maxSynchronous = process.env.MAX_SYNCHRONOUS || 50;

/**
 * @param {import('puppeteer').Browser} browser
 * @param {Parameters} params
 * @param {string} url
 */
async function fetchPage(browser, params, url) {
  let html;
  const page = await browser.newPage();
  try {
    const fullUrl = url;
    // No reason to download images or fonts, since we just want the resulting HTML
    await page.setExtraHTTPHeaders(params.headers);
    await page.setRequestInterception(true);
    page.on(
      'request',
      /** @param {pptr.HTTPRequest} request */
      async (request) => {
        try {
          const typeWhitelist = [
            'document',
            'stylesheet',
            'script',
            'xhr',
            'fetch',
          ];
          const extensionWhitelist = ['js', 'css']; // are 'other' type if prefetch
          const isWhitelisted =
            typeWhitelist.includes(request.resourceType()) ||
            request
              .url()
              .match(new RegExp(`\\.(${extensionWhitelist.join('|')})\b`));
          if (isWhitelisted) {
            await request.continue();
          } else {
            await request.abort();
          }
        } catch (err) {
          console.log('INTERCEPT ERROR', err);
        }
      }
    );
    // Instead of potentially waiting forever, resolve once most requests
    // are resolved and the wait another couple seconds
    page.on('console', (msg) => {
      if (msg?._text == 'JSHandle@error') {
        console.log(msg.args?.()?.[0]?._remoteObject?.description);
      }
    });
    const response = await page.goto(fullUrl, { waitUntil: 'networkidle0' });
    const selector = process.env.WAIT_FOR_SELECTOR;
    const waitMs = Number(process.env.WAIT_MILLISECONDS);
    if (selector) {
      console.log('Waiting for selector', selector);
      await page.waitForSelector(selector);
    }
    if (waitMs) {
      await wait(Number(waitMs));
    }

    if (response.status() < 300) {
      html = await page.content();
      console.log('SUCCESS', url);
    } else {
      console.log('WARN', url, 'returned status', response.status());
    }
  } catch (err) {
    console.log('ERROR', url);
    console.log(err);
  }
  await page.close();
  return html;
}

async function prerenderPaths() {
  const params = getParameters();
  const urls = await getPaths(params);
  if (process.env.MAX_PAGES) {
    urls.splice(Number(process.env.MAX_PAGES) - 1);
  }

  const browser = await pptr.launch({ args: ['--no-sandbox'] });
  const failOnUncaughtError = (err) => {
    browser.close();
    console.log(err);
    process.exit(1);
  };

  process.on('unhandledRejection', failOnUncaughtError);
  process.on('uncaughtException', failOnUncaughtError);

  // Ensure there are ALWAYS maxSynchronous in queue
  // (each time one ends another one is added).

  let pathPointer = -1; // Index of the last URL being pre-rendered

  const renderNextUrl = () => {
    pathPointer++;
    if (pathPointer >= urls.length) {
      emitter.emit('done');
    }
    const url = urls[pathPointer];
    return (
      pathPointer >= urls.length ||
      fetchPage(browser, params, url)
        .then((html) => writeRenderedPage(params, url, html))
        .then(renderNextUrl)
    );
  };

  for (let i = 0; i < maxSynchronous; i++) {
    renderNextUrl();
  }

  const rendered = [];
  emitter.on('saved', (info) => {
    rendered.push(info.url);
    if (rendered.length == urls.length) {
      browser.close();
    }
  });
}

prerenderPaths();
