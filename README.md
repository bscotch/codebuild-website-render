# AWS CodeBuild Pre-Renderer

The aim of this repo is to make it easy to deploy an AWS CodeBuild
project that fetches a list of web pages and renders them as HTML, storing the
resulting content in S3 for use by web servers. This is useful for
complex Single Page Apps (<abbr title="Single Page App">SPA</abbr>s),
and servers that render different content in different environments,
since build-time pre-rendering is not always applicable in those cases.

## Usage

### Create a CodeBuild Project

1. Go to the [CodeBuild console](https://console.aws.amazon.com/codesuite/codebuild/projects.)
2. [Create a new project](https://console.aws.amazon.com/codesuite/codebuild/project/new).
  + **Project Configuration**
    + Name it something descriptive.
  + **Source**
    + Consider making a fork of this project and pointing to that.
    + If you are going to use this repo as the source, specify the hash so that it doesn't auto-update on you!
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
3. Set the source to this project
  + It's a good idea to make a fork and point to that, so that when this project changes yours won't automatically change too!
  + Alternatively, specify the commit hash so that it won't auto-update on future builds.
4. Choose
