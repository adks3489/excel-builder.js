/* jshint unused: false */
/* globals  importScripts, JSZip, postMessage */
var JSZip = require('jszip');
module.exports = function (self) {
    self.addEventListener('message',function (event){
      "use strict";
      if (!event.data) { return; }
      var zip = new JSZip();
      var files = event.data.files;
      for(var path in files) {
          if(files.hasOwnProperty(path)) {
              var content = files[path];
              path = path.substr(1);
              if(path.indexOf('.xml') !== -1 || path.indexOf('.rel') !== -1) {
                  zip.file(path, content, {base64: false});
              } else {
                  zip.file(path, content, {base64: true, binary: true});
              }
          }
      }
      self.postMessage({
          base64: !!event.data.base64
      });
      self.postMessage({
          status: 'done',
          data: zip.generate({
              base64: !!event.data.base64
          })
      });
    });
};