# Meteor Deploy S3

This tool builds and bundles the client part of a Meteor app with a simple index.html
and sends it to AWS S3 for static web hosting

## Installation

```
$ [sudo] npm install -g meteor-deploy-s3
```

## Usage

#### Create a bucket in AWS S3 and enable static web hosting

Create a bucket in AWS S3, then go to the properties of that bucket,
click Enable website hosting and set the index document to "index.html"

#### Create a AWS User

Go to security credentials in the menu. Go to users, and create a new one.
Then, create a inline policy for that user.

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "Stmt1452183229000",
            "Effect": "Allow",
            "Action": [
                "s3:*"
            ],
            "Resource": [
                "arn:aws:s3:::bucketname",
                "arn:aws:s3:::bucketname/*",
            ]
        }
    ]
}
```


#### Create a config file in your App

Create a file named ```deploy.json```.

```json
{
  "accessKeyId": "ACCESS_KEY",
  "secretAccessKey": "SECRET_KEY",
  "bucket": "mybucketname",
  "region": "us-east-1"
}
```

#### Deploy

Run the command in the folder of your meteor app.

```
$ deploy-s3
```

For a list of options see:

```
$ deploy-s3 --help
```

### Passing a settings.json

You can pass an additional settings file using the `--settings` or `-s` option:

```
$ deploy-s3 -s ../settings.json
```

**Note** Only the `public` property of that JSON file will be add to the `Meteor.settings` property.

### App URL

Additionally you can set the `ROOT_URL` of your app using the `--url` or `-u` option:

```
$ deploy-s3 -u http://myserver.com
```

If you pass `"default"`, your app will try to connect to the server where the application was served from.

If this option was not set, it will set the server to `""` (empty string) and will add a `Meteor.disconnect()` after Meteor was loaded.

### Using custom templates

If you want to provide a custom template for the initial HTML provide an HTML file with the `--template` or `-t` option:

```
$ deploy-s3 -t ../myTemplate.html
```

The template file need to contain the following placholders: `{{> head}}`, `{{> css}}` and `{{> scripts}}`.
The following example adds a simple loading text to the initial HTML file (Your app should later take care of removing the loading text):

```html
<!DOCTYPE html>
<html>
    <head>
        {{> head}}
        <link rel="stylesheet" type="text/css" href="/loadingScreen.css">
    </head>
    <body>
        <h1>Loading...</h1>

        {{> css}}
        {{> scripts}}
    </body>
</html>
```
By linking a file from your `public` folder (e.g. `loadingScreen.css`) and moving the `{{> css}}` and `{{> scripts}}` placeholder to the end of the `<body>` tag,
you can simply style your loading screen.
Because the small CSS file (`loadingScreen.css`) and the body content will be loaded *before* the Meteor app script, the the user sees the nice Loading text.

## Connecting to a Meteor server

In order to connect to a Meteor servers, create DDP connection by using `DDP.connect()`, as seen in the following example:

```js
// This Should be in both server and client in a lib folder
DDPConnection = (Meteor.isClient) ? DDP.connect("http://localhost:3000/") : {};

// When creating a new collection on the client use:
if(Meteor.isClient) {
    posts = new Mongo.Collection("posts", DDPConnection);

    // set the new DDP connection to all internal packages, which require one
    Meteor.connection = DDPConnection;
    Accounts.connection = Meteor.connection;
    Meteor.users = new Mongo.Collection('users');
    Meteor.connection.subscribe('users');

    // And then you subscribe like this:
    DDPConnection.subscribe("mySubscription");   
}
```
