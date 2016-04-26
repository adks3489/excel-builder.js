/* jshint unused: false */
/* globals  importScripts, postMessage */
var ZipJS = require('../ZipJS/zip.js').zip;
var waterfall = require("async/waterfall");
module.exports = function (self) {
    self.addEventListener('message',function (event){
        "use strict";
        if (!event.data) { return; }
        var files = event.data.files;
        ZipJS.useWebWorkers = false;
        ZipJS.createWriter(new ZipJS.Data64URIWriter("vnd.openxmlformats-officedocument.spreadsheetml.sheet"), function(writer) {
            var addFile = function(callback){
                var path = this;
                var content = files[path];
                path = path.substr(1);
                if(path.indexOf('.xml') !== -1 || path.indexOf('.rel') !== -1) {
                    writer.add(path, new ZipJS.TextReader(content), function(){
                        callback();
                    }, undefined, {level: 0, version: 0x0a});
                } else {
                    writer.add(path, new ZipJS.Data64URIReader(content), function(){
                        callback();
                    }, undefined, {level: 0, version: 0x0a});
                }
            };
            var tasks = [];
            for(var path in files) {
                if(files.hasOwnProperty(path)) {
                    tasks.push(addFile.bind(path));
                }
            }
            waterfall(tasks, function(){
                writer.close(function(base64data){
                    self.postMessage({
                        base64: !!event.data.base64
                    });
                    self.postMessage({
                        status: 'done',
                        data: base64data.substring(66)
                    });
                });
            } );

        }, undefined, true);
    });
};
