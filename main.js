#!/usr/bin/env node

var fs = require('fs');
var AWS = require('aws-sdk');
var mime = require('mime');
var clc = require('cli-color');
var ProgressBar = require('progress');
var _ = require('underscore');
var rmdir = require('rimraf');

// CLI Options
var program = require('commander');

// Queue
var Queue = require('./queue');

// Build queue syncron
var queue = new Queue();

var packageJson = require('./package.json');

// VARIABLES
var argPath = '/var/tmp/mbcs3';
var meteor = require('./meteor.js');

program
  .version(packageJson.version)
  .usage('[options]')
  .option('-d, --deploy <deploy.json>', 'The path of the deploy information file.')
  .option('-p, --path <path>', 'The path used to link the files, default is "/", pass "" to link relative to the index.html.')
  .option('-t, --template <file path>', 'Provide a custom index.html template. Use {{> head}}, {{> css}} and {{> scripts}} to place the meteor resources.')
  .option('-s, --settings <settings.json>', 'Set optional data for Meteor.settings in your application.')
  .option('-u, --url <url>', 'The Root URL of your app. If "default", Meteor will try to connect to the Server where it was served from. Default is: "" (empty string)')

// .option('-d, --ddp <url>', 'The URL of your Meteor DDP server, e.g. "ddp+sockjs://ddp.myapp.com/sockjs". If you don\'t add any it will also add call "Meteor.disconnect();" to prevent the app from conneting.')
.parse(process.argv);

// RUN TASKS

// TODO: get meteor apps basepath and set it as cwd
// console.log(process.cwd());
// process.chdir('new cwd');

if (!argPath) {
  console.error('You need to provide a path for the build output, for example:');
  console.error('$ meteor-build-client myBuildFolder');

} else {

  (function() {

    // Check if in meteor folder
    try {
      if (!fs.lstatSync('./.meteor').isDirectory())
        throw new Error();

    } catch (e) {
      console.error('You\'re not in a Meteor app folder or inside a sub folder of your app.');
      return;
    }

    // Check template file
    if (program.template) {
      try {
        if (!fs.lstatSync(program.template).isFile())
          throw new Error();

      } catch (e) {
        console.error('The template file "' + program.template + '" doesn\'t exist or is not a valid template file');
        return;
      }
    }

    var deployOptions = null;
    try {
      var opts = fs.readFileSync(program.deploy || 'deploy.json', 'utf8');
      deployOptions = JSON.parse(opts);
    } catch (e) {
      console.error('Error reading deploy options', e);
      return;
    }

    // Build meteor
    queue.add(function(callback) {
      console.log('');
      console.log(clc.blue.underline('Deploy S3: Meteor Apps in AWS S3'));
      console.log('');
      console.log(clc.bold('Creating bundle...'));
      meteor.build(program, callback);
    });

    // Move the files into the build folder
    queue.add(function(callback) {
      meteor.move(callback);
    });

    // Create the index.html
    queue.add(function(callback) {
      meteor.addIndexFile(program, callback);
    });

    // Delete unecessary fiels
    queue.add(function(callback) {
      meteor.cleanUp(function() {
        console.log('Bundle created');
        console.log('');
        callback();
      });
    });

    AWS.config.loadFromPath(program.deploy || 'deploy.json');
    var s3 = new AWS.S3();

    queue.add(function(callback) {
      console.log(clc.bold('Starting deployment...'));
      console.log('Deleting old files in bucket...');
      s3.listObjects({ Bucket: deployOptions.bucket }, function(err, data) {
        if (err) return console.log(err.message);

        params = { Bucket: deployOptions.bucket };
        params.Delete = {};
        params.Delete.Objects = [];

        data.Contents.forEach(function(content) {
          params.Delete.Objects.push({ Key: content.Key });
        });

        if (params.Delete.Objects.length > 0) {
          s3.deleteObjects(params, function(err, data) {
            if (err) return console.log(err.message);
            console.log(data.Deleted.length + ' files deleted');
            callback();
          });
        } else {
          console.log('Bucket was empty');
          callback();
        }
      });
    });

    var bar;
    var lastProgress = 0;
    var printFileProgress = function(fileList, fileName) {
      var list = _.compact(fileList);
      var total = _.reduce(list, (memo, item) => item.total + memo, 0);
      var loaded = _.reduce(list, (memo, item) => item.loaded + memo, 0);

      if (!bar) {
        bar = new ProgressBar('[:bar] :percent', { total: total, width: 50 });
      } else {
        if (!bar.complete) {
          bar.tick(loaded - bar.curr);
        }
      }
    };

    // Upload
    queue.add(function(callback) {

      var getFilesInDir = function(dir) {
        var results = []
        var list = fs.readdirSync(dir)
        list.forEach(function(file) {
          file = dir + '/' + file
          var stat = fs.statSync(file)
          if (stat && stat.isDirectory()) results = results.concat(getFilesInDir(file))
          else results.push(file)
        })
        return results
      }

      console.log('Uploading files...');
      var files = getFilesInDir(argPath);
      var filesReady = 0;
      var fileList = [];
      for (var i = 0; i < files.length; i++) {
        if (files[i] != '.DS_Store') {
          var stream = fs.createReadStream(files[i]);
          var contentType = mime.lookup(files[i]);
          var stats = fs.statSync(files[i]);
          var theFileName = files[i].replace(argPath + '/', '');

          fileList[i] = {
            name: theFileName,
            ready: false,
            error: false,
            loaded: 0,
            total: stats.size,
          };

          var uploadFn = function(index, fileName, contType, isLast) {
            s3.upload({
              Bucket: deployOptions.bucket,
              Key: fileName,
              Body: stream,
              ACL: 'public-read',
              ContentType: contType,
            })
            .send(function(error, data) {
              fileList[index].ready = true;
              if (!error) {
                fileList[index].loaded = fileList[index].total;
              }

              printFileProgress(fileList);

              filesReady++;
              if (filesReady == files.length) {
                callback();
              }
            });
          };

          uploadFn(i, theFileName, contentType, i == files.length - 1);
        }
      }
    });

    queue.add(function(callback) {
      try { var files = fs.readdirSync(argPath); }
      catch (e) { return; }
      rmdir(argPath, function(error) {
        if (error) {
          console.log('Error removing files', error);
        }
      });

      callback();
      console.log('App deployed');
    });

    queue.run();
  })();
}
