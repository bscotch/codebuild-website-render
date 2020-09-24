# AWS CodeBuild Pre-Renderer

The aim of this repo is to make it easy to deploy an AWS CodeBuild
project that fetches a list of web pages and renders them as HTML, storing the
resulting content in S3 for use by web servers. This is useful for
complex Single Page Apps (<abbr title="Single Page App">SPA</abbr>s),
and servers that render different content in different environments,
since build-time pre-rendering is not always applicable in those cases.

## Usage

