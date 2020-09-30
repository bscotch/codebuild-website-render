# AWS CodeBuild Pre-Renderer

The aim of this repo is to make it easy to deploy an AWS CodeBuild
project that fetches a list of web pages and renders them as HTML, storing the
resulting content in S3 for use by web servers.

This is useful for complex Single Page Apps (<abbr title="Single Page App">SPA</abbr>s),
servers that render different content in different environments,
and in general as part of a pre-rendering pipeline for medium to large websites.

**⚠WARNING⚠** Do not use this repo directly in CodeBuild, unless you point it to
a specific commit, as the code is subject to
change at any time and those changes may be breaking!

## Usage

### Options

Specify options using environment variables, either directly in your CodeBuild project
for simple cases or via `environmentVariablesOverride` fields in the AWS CodeBuild SDK/CLI.

#### Required

+ `SITEMAP_PATH` (e.g. "https://www.bscotch.net/sitemap.xml")  
  Either this or paths must be specified.
+ `PATHS` (CSV, e.g. "/,/about,/blog/post-1")  
  Must be specified if `SITEMAP_PATH` is not.
  Must all be HTML files.

#### Optional
+ `OUT_FOLDER` (e.g. "dev" or "dev/my-version")  
  Files are output into a folder called `"rendered"`. Optionally output into
  a subfolder.
+ `HEADERS` (CSV, e.g. "Authentication: Basic XYZ,My-Custom-Header: MyCustomHeaderValue")  
+ `MAX_SYNCHRONOUS` (default 50)  
  In effect, the number of tabs to open at once for rendering.
  The renderer will ensure that there are always this many pages
  being rendered at once.
+ `COMPUTE_SCRIPT_HASHES`  
  If "true", compute SHA hashes for each script in each HTML file,
  saving to a .json file (contents: `{scriptHashes:[]}`) with the same
  name & path as the html file (just with `.html` replaced with `.json`).
  These can be used in your 'Content-Security-Policy' header
  to set strict Javascript rules while whitelisting your inline scripts.
+ `GZIP`  
  If "true", gzip all files before writing, saving with the additional ".gz" extension.

### Create a CodeBuild Project

1. Go to the [CodeBuild console](https://console.aws.amazon.com/codesuite/codebuild/projects.)
2. [Create a new project](https://console.aws.amazon.com/codesuite/codebuild/project/new).
  + **Project Configuration**
    + Name it something descriptive.
  + **Source**
    + Make a fork of this project and point to that. Alernatively, point to a specific commit via the "additional options". Otherwise you risk an unexpected breaking change.
  + **Environment**
    + Select Ubuntu (Amazon Linux might also work, but it's untested)
    + Select the latest runtimes etc.
    + Create or choose a Service Role. You'll need to ensure it has the proper IAM permissions.
  + **Buildspec**
    + Choose "Use a Buildspec file"
  + **Artifacts**
    + Choose "Amazon S3"
    + Choose your bucket (you may want to make a new one)
    + Set any other options that make sense for your deployment. Include a prefix if the S3 bucket is used for other things.
    + Consider adding S3 caching. This project depends on downloading a large (250+MB) Chrome executable. Not having to do that every time will probably speed things up!
3. Make sure that your server **will not send pre-rendered pages when the renderer is making the requests**. Otherwise you won't be able to update your content. You can do this by having the server check for a header that you provide to the renderer.
4. Make sure that your server has increased rate limits for your rendering requests.
5. Ensure that either your server is serving up a sitemap, or that you can provide a list of URLs to the renderer.

### Trigger the renderer

You can manually run the CodeBuild project to render your pages, or call it using the AWS command line tools,
or (ideally) automate running the CodeBuild project as part of your deployment process.

### Output

Output will end up in S3, with exact details depending on your "Artifacts" settings in the CodeBuild project.

Note that the paths to your files will all start with `"rendered/"`, plus whatever you provided for `OUT_FOLDER`.

For URLs that do not have have the `.html` suffix, the output file will be an `index.html` file in a folder
by the original name. For example:

+ `/` → `./rendered[/OUT_FOLDER]/index.html`
+ `/blog` → `./rendered[/OUT_FOLDER]/blog/index.html`
+ `/blog.html` → `./rendered[/OUT_FOLDER]/blog.html`
