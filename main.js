#!/usr/bin/env node

var fs = require('fs');
var AWS = require('aws-sdk');

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

    // check if in meteor folder
    try {
      if (!fs.lstatSync('./.meteor').isDirectory())
        throw new Error();

    } catch (e) {
      console.error('You\'re not in a Meteor app folder or inside a sub folder of your app.');
      return;
    }

    // check template file
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
      var opts = fs.readFileSync('deploy.json', 'utf8');
      deployOptions = JSON.parse(opts);
    } catch (e) {
      console.error('Error reading deploy options', e);
      return;
    }

    // build meteor
    queue.add(function(callback) {
      console.log('Bundling Meteor app...');
      meteor.build(program, callback);
    });

    // move the files into the build folder
    queue.add(function(callback) {
      console.log('Generating the index.html...');
      meteor.move(callback);
    });

    // create the index.html
    queue.add(function(callback) {
      meteor.addIndexFile(program, callback);
    });

    // delete unecessary fiels
    queue.add(function(callback) {
      meteor.cleanUp(function() {
        console.log('Bundle created');
        callback();
      });
    });

    AWS.config.loadFromPath('deploy.json');
    var s3 = new AWS.S3();

    queue.add(function(callback) {
      console.log('Starting deployment...');
      console.log('Deleting old files...');
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

    // upload
    queue.add(function(callback) {
      var files = fs.readdirSync(argPath);
      for (var i = 0; i < files.length; i++) {
        if (files[i] != '.DS_Store') {
          var buffer = fs.readFileSync(argPath + '/' + files[i]);

          var fileType = files[i];
          if (files[i].endsWith('.js')) {
            fileType = 'the JavaScript file';
          } else if (files[i].endsWith('.css')) {
            fileType = 'the CSS file';
          } else if (files[i].endsWith('.html')) {
            fileType = 'the HTML file';
          }

          var uploadFn = function(fileName, type) {
            console.log('Uploading ' + type + '...');
            s3.putObject({
              Bucket: deployOptions.bucket,
              Key: fileName,
              Body: buffer,
              ACL: 'public-read',
            }, function(error) {
              if (error) {
                console.log('Error uploading ' + type, error);
              } else {
                console.log('Successfully uploaded ' + type);
              }
            });
          };

          uploadFn(files[i], fileType);
        }
      }

      callback();
    });

    queue.add(function(callback) {
      try { var files = fs.readdirSync(argPath); }
      catch (e) { return; }

      if (files.length > 0)
        for (var i = 0; i < files.length; i++) {
          var filePath = argPath + '/' + files[i];
          if (fs.statSync(filePath).isFile())
            fs.unlinkSync(filePath);
          else
            rmDir(filePath);
        }

      fs.rmdirSync(argPath);
    });

    queue.run();
  })();
}
